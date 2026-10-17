"""A clearly synthetic, reproducible Denver–Kansas City demonstration."""

import itertools
from datetime import UTC, datetime, timedelta
from math import ceil, cos, exp, pi, sin
from uuid import uuid4

from .domain import assess_route, classify_weather, recommend_routes
from .geometry import GEOD, MILE_METERS, as_utc_datetime, corridor_grid, sample_route

DENVER = {
    "label": "Denver, Colorado",
    "lat": 39.7392,
    "lon": -104.9903,
    "timezone": "America/Denver",
}
KANSAS_CITY = {
    "label": "Kansas City, Missouri",
    "lat": 39.0997,
    "lon": -94.5786,
    "timezone": "America/Chicago",
}
PATHS = (
    (
        "sample-a",
        "Route A · I-70",
        1.06,
        [
            (-104.9903, 39.7392),
            (-104.80, 39.72),
            (-103.692, 39.263),
            (-102.27, 39.306),
            (-101.71, 39.351),
            (-101.052, 39.395),
            (-100.855, 39.127),
            (-99.881, 39.025),
            (-99.326, 38.879),
            (-98.86, 38.895),
            (-97.61, 38.84),
            (-96.831, 39.029),
            (-95.675, 39.047),
            (-95.235, 38.971),
            (-94.5786, 39.0997),
        ],
    ),
    (
        "sample-b",
        "Route B · I-76 / I-80 / I-29",
        1.05,
        [
            (-104.9903, 39.7392),
            (-104.80, 39.82),
            (-103.80, 40.25),
            (-103.207, 40.625),
            (-102.264, 40.988),
            (-101.719, 41.128),
            (-100.762, 41.14),
            (-99.081, 40.699),
            (-98.342, 40.925),
            (-96.685, 40.813),
            (-95.859, 40.676),
            (-94.846, 39.768),
            (-94.5786, 39.0997),
        ],
    ),
    (
        "sample-c",
        "Route C · US-50 / I-35",
        1.10,
        [
            (-104.9903, 39.7392),
            (-104.87, 39.55),
            (-104.821, 38.833),
            (-104.609, 38.254),
            (-103.543, 37.985),
            (-102.62, 38.087),
            (-100.872, 37.97),
            (-100.017, 37.752),
            (-98.74, 37.644),
            (-97.336, 37.688),
            (-96.181, 38.404),
            (-95.267, 38.615),
            (-94.5786, 39.0997),
        ],
    ),
)


def _demo_route(route_id, label, road_factor, waypoints):
    coordinates = [list(waypoints[0])]
    progress = [{"point_index": 0, "distance_meters": 0.0, "duration_seconds": 0.0}]
    distance = duration = 0.0
    for hop_index, (start, end) in enumerate(itertools.pairwise(waypoints)):
        length = GEOD.inv(*start, *end)[2]
        pieces = max(1, ceil(length / (12 * MILE_METERS)))
        intermediate = GEOD.npts(*start, *end, pieces - 1) if pieces > 1 else []
        points = [start, *intermediate, end]
        # Urban approaches are deliberately slower than open highway sections.
        speed_mph = 30 if hop_index == 0 else 40 if hop_index == len(waypoints) - 2 else 62
        if route_id == "sample-c" and 3 <= hop_index <= 8:
            speed_mph = 54
        for previous, point in itertools.pairwise(points):
            leg_distance = GEOD.inv(*previous, *point)[2] * road_factor
            distance += leg_distance
            duration += leg_distance / (speed_mph * MILE_METERS / 3600)
            coordinates.append(list(point))
            progress.append(
                {
                    "point_index": len(coordinates) - 1,
                    "distance_meters": distance,
                    "duration_seconds": duration,
                }
            )
    return {
        "id": route_id,
        "label": label,
        "distance_meters": distance,
        "duration_seconds": duration,
        "geometry": {"type": "LineString", "coordinates": coordinates},
        "progress": progress,
    }


def synthetic_weather(lat, lon, at, departure_at):
    departure = as_utc_datetime(departure_at)
    time = as_utc_datetime(at)
    hours = (time - departure).total_seconds() / 3600
    phase = (departure.hour + departure.minute / 60) / 24 * 2 * pi
    pulse = 1 + 0.10 * sin(hours / 5 + phase)
    center_lon = -100.0 + 0.08 * hours
    direct_storm = exp(-0.5 * (((lat - 38.96) / 0.55) ** 2 + ((lon - center_lon) / 1.35) ** 2))
    south_storm = exp(
        -0.5 * (((lat - 37.85) / 0.5) ** 2 + ((lon + 98.6 - 0.025 * hours) / 2.0) ** 2)
    )
    north_front = exp(
        -0.5 * (((lat - 40.9) / 0.55) ** 2 + ((lon + 99.6 + 0.06 * hours) / 1.9) ** 2)
    )
    base_wind = 16 + 1.5 * cos(hours / 4 + phase)
    wind = base_wind + pulse * (35 * direct_storm + 23 * south_storm + 11 * north_front)
    rain = max(0, 0.018 + 0.20 * direct_storm + 0.29 * south_storm + 0.015 * sin(hours / 3))
    snow = max(0, 0.62 * north_front * (0.65 + 0.35 * cos(hours / 7 + phase)))
    return {
        "wind_mph": wind,
        "gust_mph": wind + 6 + 3 * max(direct_storm, south_storm, north_front),
        "rain_in_hr": rain,
        "snow_in_hr": snow,
    }


def sample_trip(departure_at, load_lb, spacing_miles):
    departure = as_utc_datetime(departure_at)
    routes = []
    for route_args in PATHS:
        route = _demo_route(*route_args)
        route["checkpoints"] = sample_route(route, departure, spacing_miles)
        for checkpoint in route["checkpoints"]:
            checkpoint["weather"] = synthetic_weather(
                checkpoint["lat"], checkpoint["lon"], checkpoint["eta"], departure
            )
        routes.append(assess_route(route, departure, load_lb))
    recommended_id, recommendation_reason = recommend_routes(routes)
    now = datetime.now(UTC)
    return {
        "id": f"sample-{uuid4().hex}",
        "mode": "sample",
        "origin": DENVER.copy(),
        "destination": KANSAS_CITY.copy(),
        "departure_at": departure.isoformat(),
        "load_lb": load_lb,
        "spacing_miles": spacing_miles,
        "routes": routes,
        "recommended_route_id": recommended_id,
        "recommendation_reason": recommendation_reason,
        "warnings": [
            "Sample data: route geometry and all weather are synthetic, not live forecasts.",
            "Driving ETAs exclude stops, rest breaks, and hours-of-service constraints.",
            "Risk miles conservatively use the worse risk at each interval's endpoints.",
        ],
        "weather_fetched_at": now.isoformat(),
        "expires_at": (now + timedelta(minutes=15)).isoformat(),
    }


def sample_corridor(trip):
    departure = as_utc_datetime(trip["departure_at"])
    hours = [(departure + timedelta(hours=hour)).isoformat() for hour in range(49)]
    grid, cell_size = corridor_grid(trip["routes"])
    for cell in grid["features"]:
        properties = cell["properties"]
        lat, lon = properties.pop("lat"), properties.pop("lon")
        forecasts = [synthetic_weather(lat, lon, time, departure) for time in hours]
        properties.update(
            {
                "risks": [
                    classify_weather(weather, trip["load_lb"])["score"] for weather in forecasts
                ],
                "wind_mph": [weather["wind_mph"] for weather in forecasts],
                "rain_in_hr": [weather["rain_in_hr"] for weather in forecasts],
                "snow_in_hr": [weather["snow_in_hr"] for weather in forecasts],
            }
        )
    return {
        "trip_id": trip["id"],
        "departure_at": trip["departure_at"],
        "hours": hours,
        "cell_size_miles": cell_size,
        "cells": grid,
        "warnings": [
            "Sample data: this is a synthetic forecast heatmap.",
            (
                f"Coarse corridor forecast sampled in approximately {cell_size} mile cells; "
                "covers 25 miles either side of all route alternatives."
            ),
            "The forecast slider does not change the departure-specific route recommendation.",
        ],
    }
