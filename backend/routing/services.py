"""Coordinate trip analysis without coupling weather risk to a map inspection time."""

import importlib
import importlib.metadata
import json
import math
import platform
import uuid
from datetime import UTC, datetime, timedelta
from functools import lru_cache

from django.conf import settings
from django.core import signing

from .demo import sample_corridor, sample_trip
from .domain import assess_route, classify_weather, recommend_routes
from .errors import Deadline, RoutingError
from .geometry import corridor_grid, sample_route
from .providers import OpenMeteoProvider, TomTomProvider, coordinate_key
from .store import SharedStore, trip_signature, trip_ttl

SAMPLE_SALT = "spotter.sample-trip.v1"
CONFIGURATION_NAMES = ("TOMTOM_API_KEY", "UPSTASH_REDIS_REST_URL", "UPSTASH_REDIS_REST_TOKEN")
MAX_RESPONSE_BYTES = 4 * 1024 * 1024


def _check_response_size(payload):
    # Vercel's request/response limit is 4.5 MB. Leave room for encoding and
    # platform headers without silently simplifying road or checkpoint geometry.
    size = len(json.dumps(payload, ensure_ascii=False, separators=(",", ":"),
                          allow_nan=False).encode("utf-8"))
    if size > MAX_RESPONSE_BYTES:
        raise RoutingError(
            "ANALYSIS_TOO_LARGE",
            "This trip is too large to display reliably. Plan a shorter trip or split it into legs.",
            400,
        )
    return payload


def readiness():
    missing = [name for name in CONFIGURATION_NAMES if not getattr(settings, name, "").strip()]
    return {"live_available": not missing, "missing_configuration": missing}


@lru_cache(maxsize=1)
def dependency_status():
    versions = {}
    for module, package in (("django", "django"), ("rest_framework", "djangorestframework"),
                            ("httpx", "httpx"), ("shapely", "shapely"),
                            ("pyproj", "pyproj"), ("timezonefinder", "timezonefinder")):
        importlib.import_module(module)
        versions[package] = importlib.metadata.version(package)
    return {"python": platform.python_version(), "implementation": platform.python_implementation(),
            "dependencies": versions}


def require_live():
    state = readiness()
    if not state["live_available"]:
        raise RoutingError(
            "LIVE_NOT_CONFIGURED",
            "Live routing is not configured yet. Use the labeled sample trip.", 503,
            fields={"missing_configuration": state["missing_configuration"]},
        )


def _iso(value):
    return value.astimezone(UTC).isoformat()


def plan_sample(data):
    created = datetime.now(UTC)
    params = {"departure_at": _iso(data["departure_at"]), "load_lb": data["load_lb"],
              "spacing_miles": data["spacing_miles"], "created_at": _iso(created)}
    identifier = "sample_" + signing.dumps(params, salt=SAMPLE_SALT, compress=True)
    trip = sample_trip(data["departure_at"], data["load_lb"], data["spacing_miles"])
    trip.update({"id": identifier, "mode": "sample", "weather_fetched_at": _iso(created),
                 "expires_at": _iso(created + timedelta(minutes=15))})
    return _check_response_size(trip)


def _sample_from_id(identifier):
    try:
        params = signing.loads(identifier.removeprefix("sample_"), salt=SAMPLE_SALT, max_age=900)
        departure = datetime.fromisoformat(params["departure_at"])
        created = datetime.fromisoformat(params["created_at"])
        if (departure.utcoffset() is None or created.utcoffset() is None
                or not math.isfinite(params["load_lb"]) or params["load_lb"] < 0
                or params["spacing_miles"] not in (10, 25, 50)):
            raise ValueError("invalid signed sample parameters")
        if created + timedelta(minutes=15) <= datetime.now(UTC):
            raise signing.SignatureExpired("expired sample")
    except (signing.BadSignature, KeyError, TypeError, ValueError):
        raise RoutingError(
            "TRIP_EXPIRED", "This trip has expired or could not be found. Plan it again.", 404
        ) from None
    trip = sample_trip(departure, params["load_lb"], params["spacing_miles"])
    trip.update({"id": identifier, "mode": "sample", "weather_fetched_at": _iso(created),
                 "expires_at": _iso(created + timedelta(minutes=15))})
    return trip


def plan_trip(data, *, store=None, routing=None, weather=None):
    if data["mode"] == "sample":
        return plan_sample(data)
    require_live()
    deadline = Deadline(60)
    store = store or SharedStore()
    routing = routing or TomTomProvider(settings.TOMTOM_API_KEY, store=store)
    weather = weather or OpenMeteoProvider(store)
    signature = trip_signature(data)
    request_key = "spotter:analysis:" + signature
    cached_id = store.get_json(request_key)
    if cached_id:
        cached = store.get_json("spotter:trip:" + cached_id)
        if cached and trip_ttl(cached) > 0:
            return _check_response_size(cached)
    with store.trip_lock(signature):
        # A completed request can populate the cache between the first read and lock.
        cached_id = store.get_json(request_key)
        if cached_id:
            cached = store.get_json("spotter:trip:" + cached_id)
            if cached and trip_ttl(cached) > 0:
                return _check_response_size(cached)
        routes = routing.routes(data["origin"], data["destination"], data["departure_at"], deadline)
        deadline.remaining()
        for route in routes:
            route["checkpoints"] = sample_route(route, data["departure_at"], data["spacing_miles"])
        coordinates = list(dict.fromkeys(
            coordinate_key(point["lat"], point["lon"])
            for route in routes for point in route["checkpoints"]
        ))
        if len(coordinates) > 300:
            raise RoutingError(
                "TOO_MANY_CHECKPOINTS",
                f"This trip needs {len(coordinates)} weather locations. Choose 25- or 50-mile "
                "checkpoint spacing, or plan a shorter trip (maximum 300 locations).",
                400,
                fields={"spacing_miles": ["Increase checkpoint spacing or shorten the trip."]},
            )
        max_eta = max(datetime.fromisoformat(point["eta"]) for route in routes
                      for point in route["checkpoints"])
        forecasts, warnings = weather.forecasts(
            coordinates, data["departure_at"], max_eta, deadline
        )
        deadline.remaining()
        for route in routes:
            for point in route["checkpoints"]:
                forecast = forecasts.get(coordinate_key(point["lat"], point["lon"]))
                point["weather"] = (forecast.weather_at(datetime.fromisoformat(point["eta"]))
                                    if forecast else None)
        assessed = [assess_route(route, data["departure_at"], data["load_lb"]) for route in routes]
        recommended, reason = recommend_routes(assessed)
        if len(assessed) < 3:
            warnings.append(f"The routing provider returned {len(assessed)} distinct truck route(s). "
                            "Three alternatives are not available for every trip.")
        if any(route["summary"]["status"] == "incomplete" for route in assessed):
            warnings.append("Some checkpoints have unavailable weather. Incomplete routes are not "
                            "eligible for recommendation.")
        created = datetime.now(UTC)
        identifier = uuid.uuid4().hex
        trip = {"id": identifier, "mode": "live", "origin": dict(data["origin"]),
                "destination": dict(data["destination"]), "departure_at": _iso(data["departure_at"]),
                "load_lb": data["load_lb"], "spacing_miles": data["spacing_miles"],
                "routes": assessed, "recommended_route_id": recommended,
                "recommendation_reason": reason, "warnings": warnings,
                "weather_fetched_at": _iso(created),
                "expires_at": _iso(created + timedelta(minutes=15))}
        _check_response_size(trip)
        store.set_json("spotter:trip:" + identifier, trip, ttl=900)
        store.set_json(request_key, identifier, ttl=900)
        deadline.remaining()
        return trip


def get_trip(identifier, *, store=None):
    if len(identifier) > 2048:
        raise RoutingError("TRIP_NOT_FOUND", "This trip could not be found.", 404)
    if identifier.startswith("sample_"):
        return _sample_from_id(identifier)
    if len(identifier) != 32 or any(char not in "0123456789abcdef" for char in identifier):
        raise RoutingError("TRIP_NOT_FOUND", "This trip could not be found.", 404)
    require_live()
    trip = (store or SharedStore()).get_json("spotter:trip:" + identifier)
    if not trip or trip_ttl(trip) <= 0:
        raise RoutingError("TRIP_EXPIRED", "This trip has expired. Plan it again.", 404)
    return trip


def corridor_for_trip(identifier, *, store=None, weather=None):
    deadline = Deadline(60)
    if identifier.startswith("sample_"):
        return _check_response_size(sample_corridor(get_trip(identifier)))
    store = store or SharedStore()
    trip = get_trip(identifier, store=store)
    key = "spotter:corridor:" + identifier
    cached = store.get_json(key)
    if cached:
        return _check_response_size(cached)
    with store.trip_lock("corridor:" + identifier):
        cached = store.get_json(key)
        if cached:
            return _check_response_size(cached)
        cells, size = corridor_grid(trip["routes"], max_cells=200)
        points = [coordinate_key(cell["properties"]["lat"], cell["properties"]["lon"])
                  for cell in cells["features"]]
        departure = datetime.fromisoformat(trip["departure_at"])
        hours = [departure + timedelta(hours=index) for index in range(49)]
        weather = weather or OpenMeteoProvider(store)
        forecasts, warnings = weather.forecasts(points, hours[0], hours[-1], deadline, partial=True)
        for cell, point in zip(cells["features"], points):
            forecast = forecasts.get(point)
            properties = {"id": cell["properties"]["id"], "risks": [], "wind_mph": [],
                          "rain_in_hr": [], "snow_in_hr": []}
            for hour in hours:
                value = forecast.weather_at(hour) if forecast else None
                risk = classify_weather(value, trip["load_lb"])
                properties["risks"].append(risk["score"])
                for name in ("wind_mph", "rain_in_hr", "snow_in_hr"):
                    properties[name].append(value[name] if value else None)
            cell["properties"] = properties
        result = {"trip_id": identifier, "departure_at": trip["departure_at"],
                  "hours": [_iso(hour) for hour in hours], "cell_size_miles": size,
                  "cells": cells, "warnings": warnings}
        _check_response_size(result)
        ttl = trip_ttl(trip)
        if ttl <= 0:
            raise RoutingError("TRIP_EXPIRED", "This trip has expired. Plan it again.", 404)
        # A retry after a provider cooldown must be able to fill unknown cells.
        complete = all(score is not None for cell in cells["features"]
                       for score in cell["properties"]["risks"])
        if complete and not warnings:
            store.set_json(key, result, ttl=ttl)
        return result


def geocode(query, *, store=None, routing=None, identity=""):
    require_live()
    store = store or SharedStore()
    import hashlib

    key = "spotter:geocode:" + hashlib.sha256(query.casefold().encode()).hexdigest()
    cached = store.get_json(key)
    if cached is not None:
        return {"results": cached, "live_available": True}
    results = (routing or TomTomProvider(settings.TOMTOM_API_KEY, store=store,
                                        identity=identity)).geocode(query, Deadline(20))
    store.set_json(key, results, ttl=900)
    return {"results": results, "live_available": True}
