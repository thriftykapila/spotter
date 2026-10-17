"""Normalize provider data before it reaches the risk engine.

All route coordinates remain road coordinates. Weather response coordinates identify
model grid cells and must never replace them. Hourly precipitation is a preceding-hour
accumulation; instantaneous wind is interpolated independently.
"""

import bisect
import math
import threading
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from functools import lru_cache
from itertools import pairwise
from urllib.parse import quote

import httpx

from .errors import Deadline, RoutingError

HOURLY_FIELDS = ("wind_speed_10m", "wind_gusts_10m", "rain", "showers", "snowfall")
FORECAST_ENDPOINT = "https://api.open-meteo.com/v1/forecast"


def _finite(value, *, nonnegative=False):
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    result = float(value)
    if not math.isfinite(result) or (nonnegative and result < 0):
        return None
    return result


def coordinate_key(lat, lon):
    # Only merge numerically identical checkpoint coordinates, not nearby roads.
    return (float(lat), float(lon))


def _request_json(url, params, deadline, *, before_attempt=None, client=None, stop_event=None):
    """At most two attempts; never retry a provider's 429 response."""
    for attempt in range(2):
        remaining = deadline.remaining()
        if stop_event and stop_event.is_set():
            raise RoutingError("WEATHER_FETCH_STOPPED", "Further forecast requests were stopped.")
        if before_attempt:
            before_attempt()
        if stop_event and stop_event.is_set():
            raise RoutingError("WEATHER_FETCH_STOPPED", "Further forecast requests were stopped.")
        timeout = httpx.Timeout(min(10.0, remaining), connect=min(3.0, remaining))
        try:
            response = (client or httpx).get(url, params=params, timeout=timeout)
        except (httpx.TimeoutException, httpx.TransportError):
            if attempt == 0 and deadline.remaining() > 1:
                continue
            raise RoutingError(
                "PROVIDER_UNAVAILABLE", "A data provider did not respond. Please try again."
            ) from None
        deadline.remaining()
        if response.status_code == 429:
            if stop_event:
                stop_event.set()
            retry = response.headers.get("Retry-After", "60")
            retry = int(retry) if retry.isdigit() else 60
            raise RoutingError(
                "PROVIDER_RATE_LIMITED",
                "The data provider is busy. Please wait before trying again.",
                429,
                retry_after=max(1, min(retry, 3600)),
            )
        if response.status_code >= 500 and attempt == 0:
            continue
        if response.status_code >= 400:
            # Do not return provider bodies/URLs, which can contain API keys.
            raise RoutingError(
                "PROVIDER_REQUEST_FAILED", "The data provider could not complete this request."
            )
        try:
            return response.json()
        except ValueError:
            raise RoutingError("PROVIDER_DATA_INVALID", "The data provider returned invalid data.")
    raise AssertionError("bounded retry loop exhausted")


@lru_cache(maxsize=1)
def _timezone_finder():
    from timezonefinder import TimezoneFinder

    return TimezoneFinder(in_memory=False)


class TomTomProvider:
    def __init__(self, api_key, *, client=None, store=None, identity=""):
        self.api_key = api_key
        self.client = client
        self.store = store
        self.identity = identity

    def _reserve(self):
        if self.store:
            self.store.reserve_tomtom_budget(self.identity)

    def geocode(self, query, deadline=None):
        payload = _request_json(
            "https://api.tomtom.com/search/2/geocode/" + quote(query, safe="") + ".json",
            {"key": self.api_key, "countrySet": "US", "limit": 5},
            deadline or Deadline(),
            before_attempt=self._reserve,
            client=self.client,
        )
        if not isinstance(payload, dict) or not isinstance(payload.get("results"), list):
            raise RoutingError("GEOCODING_DATA_INVALID", "The location provider returned invalid data.")
        results = []
        seen = set()
        for item in payload["results"]:
            if not isinstance(item, dict) or not isinstance(item.get("address"), dict):
                raise RoutingError("GEOCODING_DATA_INVALID", "The location provider returned invalid data.")
            address = item.get("address", {})
            if address.get("countryCode") != "US":
                continue
            position = item.get("position", {})
            if not isinstance(position, dict):
                raise RoutingError("GEOCODING_DATA_INVALID", "The location provider returned invalid data.")
            lat, lon = _finite(position.get("lat")), _finite(position.get("lon"))
            if lat is None or lon is None or not (-90 <= lat <= 90 and -180 <= lon <= 180):
                continue
            timezone = _timezone_finder().timezone_at(lat=lat, lng=lon)
            if not timezone:
                continue
            label = address.get("freeformAddress") or address.get("municipality")
            if label:
                signature = (label, lat, lon, timezone)
                if signature in seen:
                    continue
                seen.add(signature)
                results.append({"label": label, "lat": lat, "lon": lon, "timezone": timezone})
        return results

    def routes(self, origin, destination, departure, deadline=None):
        points = f"{origin['lat']},{origin['lon']}:{destination['lat']},{destination['lon']}"
        # Repeated extendedRouteRepresentation parameters are required by routing v1.
        params = [
            ("key", self.api_key), ("travelMode", "truck"),
            ("vehicleCommercial", "true"), ("maxAlternatives", "2"),
            ("routeType", "fastest"), ("traffic", "true"),
            ("departAt", departure.astimezone(UTC).isoformat()),
            ("routeRepresentation", "polyline"),
            ("extendedRouteRepresentation", "distance"),
            ("extendedRouteRepresentation", "travelTime"),
        ]
        payload = _request_json(
            f"https://api.tomtom.com/routing/1/calculateRoute/{points}/json",
            params, deadline or Deadline(), client=self.client, before_attempt=self._reserve,
        )
        if not isinstance(payload, dict) or not isinstance(payload.get("routes"), list):
            raise RoutingError("ROUTING_DATA_INVALID", "The routing provider returned invalid data.")
        routes = []
        seen = set()
        for item in payload.get("routes", [])[:3]:
            if (not isinstance(item, dict) or not isinstance(item.get("legs"), list)
                    or not isinstance(item.get("summary"), dict)):
                raise RoutingError("ROUTING_DATA_INVALID", "The routing provider returned invalid data.")
            coordinates = []
            for leg in item.get("legs", []):
                if not isinstance(leg, dict) or not isinstance(leg.get("points"), list):
                    raise RoutingError("ROUTING_DATA_INVALID", "Route geometry is incomplete.")
                for point in leg.get("points", []):
                    if not isinstance(point, dict):
                        raise RoutingError("ROUTING_DATA_INVALID", "Route geometry is incomplete.")
                    lat = _finite(point.get("latitude"))
                    lon = _finite(point.get("longitude"))
                    if (lat is None or lon is None or not -90 <= lat <= 90
                            or not -180 <= lon <= 180):
                        raise RoutingError("ROUTING_DATA_INVALID", "Route geometry is incomplete.")
                    coordinates.append([lon, lat])
            summary = item.get("summary", {})
            distance = _finite(summary.get("lengthInMeters"), nonnegative=True)
            duration = _finite(summary.get("travelTimeInSeconds"), nonnegative=True)
            if len(coordinates) < 2 or not distance or not duration:
                raise RoutingError("ROUTING_DATA_INVALID", "Route distance or time is unavailable.")
            fingerprint = tuple(tuple(point) for point in coordinates)
            if fingerprint in seen:
                continue
            seen.add(fingerprint)
            progress = self._progress(item.get("progress"), coordinates, distance, duration)
            number = len(routes) + 1
            routes.append({
                "id": f"route-{number}", "label": f"Route {number}",
                "distance_meters": distance, "duration_seconds": duration,
                "geometry": {"type": "LineString", "coordinates": coordinates},
                "progress": progress,
            })
        if not routes:
            raise RoutingError("NO_ROUTES", "No truck routes were found between these locations.", 400)
        return routes

    @staticmethod
    def _progress(raw, coordinates, distance, duration):
        if not isinstance(raw, list) or not raw:
            raise RoutingError(
                "ROUTING_DATA_INVALID", "The routing provider did not return checkpoint travel times."
            )
        anchors = {0: {"point_index": 0, "distance_meters": 0.0, "duration_seconds": 0.0}}
        for point in raw:
            if not isinstance(point, dict):
                raise RoutingError("ROUTING_DATA_INVALID", "Route progress data is invalid.")
            index = point.get("pointIndex")
            meters = _finite(point.get("distanceInMeters"), nonnegative=True)
            seconds = _finite(point.get("travelTimeInSeconds"), nonnegative=True)
            if (isinstance(index, bool) or not isinstance(index, int)
                    or not 0 <= index < len(coordinates) or meters is None or seconds is None
                    or meters > distance + 1 or seconds > duration + 1):
                raise RoutingError("ROUTING_DATA_INVALID", "Route progress data is invalid.")
            anchors[index] = {"point_index": index, "distance_meters": meters,
                              "duration_seconds": seconds}
        anchors[0] = {"point_index": 0, "distance_meters": 0.0, "duration_seconds": 0.0}
        last = len(coordinates) - 1
        anchors[last] = {"point_index": last, "distance_meters": distance,
                         "duration_seconds": duration}
        result = [anchors[index] for index in sorted(anchors)]
        for left, right in pairwise(result):
            if (right["distance_meters"] < left["distance_meters"]
                    or right["duration_seconds"] < left["duration_seconds"]):
                raise RoutingError("ROUTING_DATA_INVALID", "Route progress is not chronological.")
        return result


def _convert(value, unit, kind):
    value = _finite(value, nonnegative=True)
    if value is None:
        return None
    factors = {
        "wind": {"mp/h": 1.0, "mph": 1.0, "km/h": 1 / 1.609344,
                 "m/s": 2.2369362920544, "kn": 1.150779448},
        "rain": {"inch": 1.0, "in": 1.0, "mm": 1 / 25.4},
        "snow": {"inch": 1.0, "in": 1.0, "cm": 1 / 2.54},
    }
    if unit not in factors[kind]:
        raise RoutingError("WEATHER_UNITS_INVALID", "The weather provider returned unexpected units.")
    return value * factors[kind][unit]


@dataclass
class ForecastSeries:
    times: list
    wind: list
    gust: list
    rain: list
    snow: list

    @classmethod
    def from_provider(cls, payload):
        if not isinstance(payload, dict):
            raise RoutingError("WEATHER_DATA_INVALID", "The weather forecast is invalid.")
        hourly, units = payload.get("hourly", {}), payload.get("hourly_units", {})
        if not isinstance(hourly, dict) or not isinstance(units, dict):
            raise RoutingError("WEATHER_DATA_INVALID", "The weather forecast is incomplete.")
        times = hourly.get("time")
        if (units.get("time") != "unixtime" or not isinstance(times, list) or not times
                or any(isinstance(t, bool) or not isinstance(t, int) for t in times)
                or any(b - a != 3600 for a, b in pairwise(times))):
            raise RoutingError("WEATHER_DATA_INVALID", "The weather forecast time series is invalid.")
        values = {}
        for field in HOURLY_FIELDS:
            series = hourly.get(field)
            if not isinstance(series, list) or len(series) != len(times):
                raise RoutingError("WEATHER_DATA_INVALID", "The weather forecast is incomplete.")
            kind = "wind" if field.startswith("wind_") else "snow" if field == "snowfall" else "rain"
            values[field] = [_convert(value, units.get(field), kind) for value in series]
        rain = [None if a is None or b is None else a + b
                for a, b in zip(values["rain"], values["showers"])]
        return cls(times, values["wind_speed_10m"], values["wind_gusts_10m"], rain,
                   values["snowfall"])

    def covers(self, start, end):
        return bool(self.times) and self.times[0] <= start and self.times[-1] >= end

    def complete(self):
        return all(value is not None for values in (self.wind, self.gust, self.rain, self.snow)
                   for value in values)

    def to_dict(self):
        return {"times": self.times, "wind": self.wind, "gust": self.gust,
                "rain": self.rain, "snow": self.snow}

    @classmethod
    def from_cache(cls, value):
        if not isinstance(value, dict) or set(value) != {"times", "wind", "gust", "rain", "snow"}:
            return None
        times = value["times"]
        if (not isinstance(times, list) or not times
                or any(isinstance(t, bool) or not isinstance(t, int) for t in times)
                or any(b - a != 3600 for a, b in pairwise(times))):
            return None
        for field in ("wind", "gust", "rain", "snow"):
            values = value[field]
            if (not isinstance(values, list) or len(values) != len(times)
                    or any(item is not None and _finite(item, nonnegative=True) is None
                           for item in values)):
                return None
        return cls(**value)

    def weather_at(self, at):
        epoch = at.timestamp() if isinstance(at, datetime) else float(at)
        # At an exact hour the ending accumulation bucket is that hour itself.
        bucket = math.ceil(epoch / 3600) * 3600
        index = bisect.bisect_left(self.times, bucket)
        if index >= len(self.times) or self.times[index] != bucket:
            return None
        if epoch < self.times[0] or epoch > self.times[-1]:
            return None
        if epoch == bucket:
            wind = self.wind[index]
        elif index == 0 or self.wind[index - 1] is None or self.wind[index] is None:
            wind = None
        else:
            fraction = (epoch - self.times[index - 1]) / 3600
            wind = self.wind[index - 1] + fraction * (self.wind[index] - self.wind[index - 1])
        values = {"wind_mph": wind, "gust_mph": self.gust[index],
                  "rain_in_hr": self.rain[index], "snow_in_hr": self.snow[index]}
        required = (values["wind_mph"], values["rain_in_hr"], values["snow_in_hr"])
        return None if any(value is None for value in required) else values


class OpenMeteoProvider:
    def __init__(self, store, *, client=None):
        self.store = store
        self.client = client

    def _batch(self, coordinates, start, end, deadline, stop_event):
        if stop_event.is_set():
            raise RoutingError("WEATHER_FETCH_STOPPED", "Further forecast requests were stopped.")
        params = {
            "latitude": ",".join(str(point[0]) for point in coordinates),
            "longitude": ",".join(str(point[1]) for point in coordinates),
            "hourly": ",".join(HOURLY_FIELDS), "wind_speed_unit": "mph",
            "precipitation_unit": "inch", "timezone": "GMT", "timeformat": "unixtime",
            "start_hour": datetime.fromtimestamp(start, UTC).strftime("%Y-%m-%dT%H:%M"),
            "end_hour": datetime.fromtimestamp(end, UTC).strftime("%Y-%m-%dT%H:%M"),
        }
        def reserve():
            if stop_event.is_set():
                raise RoutingError("WEATHER_FETCH_STOPPED", "Further forecast requests were stopped.")
            try:
                # Reserve conservatively for the provider's variable/time weighting.
                day_weight = max(1, (end - start + 3600) / (14 * 86400))
                variable_weight = max(1, len(HOURLY_FIELDS) / 10)
                cost = math.ceil(len(coordinates) * day_weight * variable_weight)
                self.store.reserve_weather_budget(cost)
            except RoutingError as error:
                if error.status == 429 or error.code == "CACHE_UNAVAILABLE":
                    stop_event.set()
                raise

        payload = _request_json(
            FORECAST_ENDPOINT, params, deadline, client=self.client,
            before_attempt=reserve, stop_event=stop_event,
        )
        payload = payload if isinstance(payload, list) else [payload]
        if len(payload) != len(coordinates):
            raise RoutingError("WEATHER_DATA_INVALID", "Some forecast locations were not returned.")
        return {point: ForecastSeries.from_provider(item)
                for point, item in zip(coordinates, payload)}

    def forecasts(self, coordinates, start, end, deadline=None, *, partial=False):
        deadline = deadline or Deadline()
        start = math.floor(start.timestamp() / 3600) * 3600
        end = math.ceil(end.timestamp() / 3600) * 3600
        today = datetime.now(UTC).replace(hour=0, minute=0, second=0, microsecond=0)
        if start < today.timestamp() or end >= (today + timedelta(days=16)).timestamp():
            raise RoutingError(
                "FORECAST_WINDOW_EXCEEDED",
                "The trip extends beyond the available 16-day weather forecast. Choose an earlier departure.",
                400,
            )
        coordinates = list(dict.fromkeys(coordinate_key(*point) for point in coordinates))
        keys = [self.store.weather_key(point, start, end) for point in coordinates]
        cached = self.store.get_many_json(keys)
        result, missing = {}, []
        for point, key in zip(coordinates, keys):
            value = cached.get(key)
            series = ForecastSeries.from_cache(value)
            if series and series.covers(start, end):
                result[point] = series
            else:
                missing.append(point)
        batches = [missing[index:index + 50] for index in range(0, len(missing), 50)]
        warnings = []
        if not batches:
            return result, warnings
        pool = ThreadPoolExecutor(max_workers=3)
        stop_event = threading.Event()
        futures = {pool.submit(self._batch, batch, start, end, deadline, stop_event): batch
                   for batch in batches}
        try:
            for future in as_completed(futures, timeout=deadline.remaining()):
                batch = futures[future]
                try:
                    values = future.result()
                    for point, series in values.items():
                        if not series.covers(start, end):
                            raise RoutingError(
                                "WEATHER_DATA_INVALID", "Weather is unavailable for some trip hours."
                            )
                    result.update(values)
                    complete = {self.store.weather_key(point, start, end): series.to_dict()
                                for point, series in values.items() if series.complete()}
                    if complete:
                        self.store.set_many_json(complete, ttl=900)
                except RoutingError as error:
                    # Redis failures never fail open, including the exploratory heatmap.
                    if not partial or error.code == "CACHE_UNAVAILABLE":
                        stop_event.set()
                        raise
                    if error.status == 429:
                        stop_event.set()
                        warnings.append(
                            "Further corridor requests stopped at the forecast request limit; "
                            f"unavailable cells are unknown. Retry after {error.retry_after or 60} seconds."
                        )
                    elif error.code != "WEATHER_FETCH_STOPPED":
                        warnings.append(
                            f"Weather is unavailable in {len(batch)} corridor cells; they are shown as unknown."
                        )
        except TimeoutError:
            if not partial:
                raise RoutingError("DEADLINE_EXCEEDED", "Weather retrieval took too long.", 504)
            warnings.append("Some corridor forecasts timed out; unavailable cells are shown as unknown.")
        finally:
            stop_event.set()
            for future in futures:
                future.cancel()
            pool.shutdown(wait=False, cancel_futures=True)
        return result, warnings
