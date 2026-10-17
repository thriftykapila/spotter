"""Synthetic fixtures exercise provider semantics and stateless HTTP boundaries."""

import copy
import json
import threading
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime, timedelta
from unittest.mock import Mock

import httpx
import pytest
from django.core import signing
from django.test import override_settings
from rest_framework.test import APIClient

from routing import services
from routing.errors import RoutingError
from routing.providers import ForecastSeries, OpenMeteoProvider, TomTomProvider
from routing.serializers import TripPlanSerializer
from routing.store import RELEASE_LOCK_SCRIPT, WEATHER_BUDGET_SCRIPT, SharedStore


def forecast_payload(times=None):
    times = times or [0, 3600, 7200]
    count = len(times)
    return {
        "hourly_units": {"time": "unixtime", "wind_speed_10m": "mp/h",
                         "wind_gusts_10m": "mp/h", "rain": "inch", "showers": "inch",
                         "snowfall": "inch"},
        "hourly": {"time": times, "wind_speed_10m": [10 + i * 10 for i in range(count)],
                   "wind_gusts_10m": [20 + i * 10 for i in range(count)],
                   "rain": [i * 0.2 for i in range(count)],
                   "showers": [i * 0.1 for i in range(count)],
                   "snowfall": list(range(count))},
    }


def test_accumulation_uses_containing_hour_and_wind_interpolates():
    series = ForecastSeries.from_provider(forecast_payload())
    halfway = series.weather_at(1800)
    assert halfway == {"wind_mph": 15, "gust_mph": 30,
                       "rain_in_hr": pytest.approx(0.3), "snow_in_hr": 1}
    assert series.weather_at(3600) == {
        "wind_mph": 20, "gust_mph": 30, "rain_in_hr": pytest.approx(0.3), "snow_in_hr": 1
    }
    assert series.weather_at(-1) is None
    assert series.weather_at(7201) is None


def test_weather_unit_normalization_does_not_round():
    payload = forecast_payload()
    payload["hourly_units"].update({"wind_speed_10m": "km/h", "wind_gusts_10m": "m/s",
                                    "rain": "mm", "showers": "mm", "snowfall": "cm"})
    weather = ForecastSeries.from_provider(payload).weather_at(3600)
    assert weather["wind_mph"] == pytest.approx(20 / 1.609344)
    assert weather["gust_mph"] == pytest.approx(30 * 2.2369362920544)
    assert weather["rain_in_hr"] == pytest.approx(0.3 / 25.4)
    assert weather["snow_in_hr"] == pytest.approx(1 / 2.54)


@pytest.mark.parametrize("field", ["wind_speed_10m", "rain", "showers", "snowfall"])
@pytest.mark.parametrize("invalid", [None, -1, float("nan"), float("inf")])
def test_missing_or_invalid_required_weather_never_becomes_clear(field, invalid):
    payload = forecast_payload()
    payload["hourly"][field][1] = invalid
    assert ForecastSeries.from_provider(payload).weather_at(3600) is None


def test_missing_informational_gust_does_not_remove_known_weather():
    payload = forecast_payload()
    payload["hourly"]["wind_gusts_10m"][1] = None
    value = ForecastSeries.from_provider(payload).weather_at(3600)
    assert value["wind_mph"] == 20
    assert value["gust_mph"] is None


def test_wind_interpolation_needs_both_endpoints():
    payload = forecast_payload()
    payload["hourly"]["wind_speed_10m"][0] = None
    assert ForecastSeries.from_provider(payload).weather_at(1800) is None


@pytest.mark.parametrize("mutation", ["units", "time_gap", "length"])
def test_invalid_provider_series_is_rejected(mutation):
    payload = forecast_payload()
    if mutation == "units":
        payload["hourly_units"]["rain"] = "unexpected"
    elif mutation == "time_gap":
        payload["hourly"]["time"][1] = 3700
    else:
        payload["hourly"]["rain"] = [1]
    with pytest.raises(RoutingError):
        ForecastSeries.from_provider(payload)


def routing_payload(count=2):
    return {"routes": [
        {"summary": {"lengthInMeters": 100000, "travelTimeInSeconds": 7200},
         "legs": [{"points": [{"latitude": 39.7, "longitude": -104.9},
                               {"latitude": 39.9 + index * 0.1, "longitude": -104.3},
                               {"latitude": 39.8, "longitude": -103.8}]}],
         "progress": [{"pointIndex": 0, "distanceInMeters": 0, "travelTimeInSeconds": 0},
                      {"pointIndex": 1, "distanceInMeters": 60000,
                       "travelTimeInSeconds": 5000},
                      {"pointIndex": 2, "distanceInMeters": 100000,
                       "travelTimeInSeconds": 7200}]}
        for index in range(count)
    ]}


def test_tomtom_requests_truck_and_repeated_progress_parameters():
    captured = []

    def response(request):
        captured.append(request)
        return httpx.Response(200, json=routing_payload())

    provider = TomTomProvider("secret", client=httpx.Client(transport=httpx.MockTransport(response)))
    origin, destination = {"lat": 39.7, "lon": -104.9}, {"lat": 39.8, "lon": -103.8}
    routes = provider.routes(origin, destination, datetime.now(UTC))
    assert len(routes) == 2
    params = captured[0].url.params
    assert params["travelMode"] == "truck"
    assert params["maxAlternatives"] == "2"
    assert params.get_list("extendedRouteRepresentation") == ["distance", "travelTime"]
    assert "vehicleWeight" not in params  # Payload weight is not gross vehicle weight.
    assert routes[0]["progress"][1]["duration_seconds"] == 5000


def test_route_progress_missing_or_decreasing_is_rejected():
    coordinates = [[-104.9, 39.7], [-104.3, 39.9], [-103.8, 39.8]]
    with pytest.raises(RoutingError):
        TomTomProvider._progress(None, coordinates, 100, 100)
    with pytest.raises(RoutingError):
        TomTomProvider._progress([
            {"pointIndex": 1, "distanceInMeters": 80, "travelTimeInSeconds": 80},
            {"pointIndex": 2, "distanceInMeters": 70, "travelTimeInSeconds": 70},
        ], coordinates + [[-103, 39]], 100, 100)


def test_geocode_encodes_entire_query_and_filters_non_us(monkeypatch):
    captured = []

    def response(request):
        captured.append(request)
        return httpx.Response(200, json={"results": [
            {"address": {"countryCode": "US", "freeformAddress": "Denver"},
             "position": {"lat": 39.7, "lon": -104.9}},
            {"address": {"countryCode": "CA", "freeformAddress": "Toronto"},
             "position": {"lat": 43.7, "lon": -79.4}},
        ]})

    monkeypatch.setattr("routing.providers._timezone_finder", lambda: Mock(
        timezone_at=Mock(return_value="America/Denver")))
    provider = TomTomProvider("secret", client=httpx.Client(transport=httpx.MockTransport(response)))
    results = provider.geocode("Denver? x/#")
    assert len(results) == 1
    assert results[0]["timezone"] == "America/Denver"
    assert captured[0].url.params["countrySet"] == "US"
    assert b"Denver%3F%20x%2F%23.json" in captured[0].url.raw_path


def test_geocode_deduplicates_only_identical_options_preserving_order(monkeypatch):
    first = {"address": {"countryCode": "US", "freeformAddress": "Denver, CO"},
             "position": {"lat": 39.738453, "lon": -104.984853}}
    nearby = copy.deepcopy(first)
    nearby["position"]["lat"] += 0.0000001
    other_label = copy.deepcopy(first)
    other_label["address"]["freeformAddress"] = "Denver downtown, CO"
    payload = {"results": [first, copy.deepcopy(first), nearby, other_label]}
    monkeypatch.setattr("routing.providers._timezone_finder", lambda: Mock(
        timezone_at=Mock(return_value="America/Denver")))
    provider = TomTomProvider("secret", client=httpx.Client(transport=httpx.MockTransport(
        lambda request: httpx.Response(200, json=payload))))
    results = provider.geocode("Denver, CO")
    assert len(results) == 3
    assert [(result["label"], result["lat"]) for result in results] == [
        ("Denver, CO", 39.738453),
        ("Denver, CO", nearby["position"]["lat"]),
        ("Denver downtown, CO", 39.738453),
    ]


@pytest.mark.parametrize("status, expected_calls", [(429, 1), (500, 2), (403, 1)])
def test_provider_retries_are_bounded_and_never_retry_429(status, expected_calls):
    calls = []

    def response(request):
        calls.append(request)
        return httpx.Response(status, text="contains-secret", headers={"Retry-After": "12"})

    provider = TomTomProvider("secret", client=httpx.Client(transport=httpx.MockTransport(response)))
    with pytest.raises(RoutingError) as caught:
        provider.routes({"lat": 39, "lon": -104}, {"lat": 40, "lon": -103}, datetime.now(UTC))
    assert len(calls) == expected_calls
    assert "secret" not in caught.value.message
    if status == 429:
        assert caught.value.retry_after == 12


class MemoryStore:
    """Injected test double only; production has no live local-cache fallback."""

    def __init__(self):
        self.data = {}
        self.reservations = []
        self._mutex = threading.Lock()

    weather_key = staticmethod(SharedStore.weather_key)

    def get_json(self, key):
        return copy.deepcopy(self.data.get(key))

    def set_json(self, key, value, ttl=900):
        self.data[key] = copy.deepcopy(value)

    def get_many_json(self, keys):
        return {key: copy.deepcopy(self.data[key]) for key in keys if key in self.data}

    def set_many_json(self, values, ttl=900):
        self.data.update(copy.deepcopy(values))

    def reserve_weather_budget(self, locations):
        with self._mutex:
            self.reservations.append(locations)

    def trip_lock(self, signature):
        from contextlib import nullcontext

        return nullcontext()


def test_weather_batches_preserve_requested_coordinates_and_cache_full_series():
    requests = []

    def response(request):
        requests.append(request)
        params = request.url.params
        assert params["timezone"] == "GMT" and params["timeformat"] == "unixtime"
        assert params["precipitation_unit"] == "inch" and params["wind_speed_unit"] == "mph"
        first = int(datetime.fromisoformat(params["start_hour"]).replace(tzinfo=UTC).timestamp())
        last = int(datetime.fromisoformat(params["end_hour"]).replace(tzinfo=UTC).timestamp())
        count = len(params["latitude"].split(","))
        return httpx.Response(200, json=[forecast_payload(list(range(first, last + 1, 3600)))
                                        for _ in range(count)])

    store = MemoryStore()
    provider = OpenMeteoProvider(store, client=httpx.Client(transport=httpx.MockTransport(response)))
    start = datetime.now(UTC).replace(minute=15, second=0, microsecond=0) + timedelta(hours=1)
    coordinates = [(39 + index * 0.001, -104) for index in range(51)]
    results, warnings = provider.forecasts(coordinates + [coordinates[0]], start, start + timedelta(hours=2))
    assert set(results) == set(coordinates)
    assert sorted(store.reservations) == [1, 50]
    assert len(requests) == 2
    assert not warnings
    second, _ = provider.forecasts(coordinates, start, start + timedelta(hours=2))
    assert set(second) == set(results)
    assert len(requests) == 2


def test_corridor_provider_failure_is_unknown_and_never_fabricated():
    def response(request):
        return httpx.Response(503, text="unavailable")

    store = MemoryStore()
    provider = OpenMeteoProvider(store, client=httpx.Client(transport=httpx.MockTransport(response)))
    start = datetime.now(UTC) + timedelta(hours=1)
    result, warnings = provider.forecasts([(39, -104)], start, start + timedelta(hours=48), partial=True)
    assert result == {}
    assert warnings and "unknown" in warnings[0]
    assert store.reservations == [1, 1]


def test_forecast_horizon_checked_before_any_request():
    provider = OpenMeteoProvider(MemoryStore(), client=Mock())
    start = datetime.now(UTC) + timedelta(days=17)
    with pytest.raises(RoutingError) as caught:
        provider.forecasts([(39, -104)], start, start + timedelta(hours=1))
    assert caught.value.code == "FORECAST_WINDOW_EXCEEDED"
    provider.client.get.assert_not_called()


@pytest.mark.parametrize("payload", [None, [], {"hourly": None}, {"hourly_units": []}])
def test_malformed_weather_shapes_are_structured_errors(payload):
    with pytest.raises(RoutingError) as caught:
        ForecastSeries.from_provider(payload)
    assert caught.value.code == "WEATHER_DATA_INVALID"


@pytest.mark.parametrize("payload", [None, [], {"routes": None}, {"routes": [None]}])
def test_malformed_route_shapes_are_structured_errors(payload):
    provider = TomTomProvider("secret", client=httpx.Client(transport=httpx.MockTransport(
        lambda request: httpx.Response(200, content=json.dumps(payload)))))
    with pytest.raises(RoutingError) as caught:
        provider.routes({"lat": 39, "lon": -104}, {"lat": 40, "lon": -103}, datetime.now(UTC))
    assert caught.value.code == "ROUTING_DATA_INVALID"


def test_provider_route_out_of_range_coordinates_are_rejected():
    payload = routing_payload()
    payload["routes"][0]["legs"][0]["points"][0]["latitude"] = 95
    provider = TomTomProvider("secret", client=httpx.Client(transport=httpx.MockTransport(
        lambda request: httpx.Response(200, json=payload))))
    with pytest.raises(RoutingError) as caught:
        provider.routes({"lat": 39, "lon": -104}, {"lat": 40, "lon": -103}, datetime.now(UTC))
    assert caught.value.code == "ROUTING_DATA_INVALID"


def test_corridor_429_stops_all_queued_weather_batches():
    calls = []
    mutex = threading.Lock()

    def response(request):
        with mutex:
            calls.append(request)
        return httpx.Response(429, headers={"Retry-After": "42"})

    store = MemoryStore()
    provider = OpenMeteoProvider(store, client=httpx.Client(transport=httpx.MockTransport(response)))
    start = datetime.now(UTC) + timedelta(hours=1)
    result, warnings = provider.forecasts([(39 + index * .001, -104) for index in range(251)],
                                         start, start + timedelta(hours=48), partial=True)
    assert result == {}
    assert 1 <= len(calls) <= 3  # At most the already in-flight requests, never queued batches.
    assert len(store.reservations) == len(calls)
    assert any("Retry after 42" in warning for warning in warnings)


def test_shared_budget_429_stops_queued_batches_without_network_calls():
    store = MemoryStore()
    store.reserve_weather_budget = Mock(side_effect=RoutingError(
        "WEATHER_BUDGET_EXCEEDED", "Allowance exhausted", 429, retry_after=120))
    provider = OpenMeteoProvider(store, client=Mock())
    start = datetime.now(UTC) + timedelta(hours=1)
    result, warnings = provider.forecasts([(39 + index * .001, -104) for index in range(251)],
                                         start, start + timedelta(hours=48), partial=True)
    assert result == {}
    provider.client.get.assert_not_called()
    assert store.reserve_weather_budget.call_count <= 3
    assert any("Retry after 120" in warning for warning in warnings)


def test_long_weather_window_reserves_conservative_weight():
    store = MemoryStore()
    provider = OpenMeteoProvider(store, client=httpx.Client(transport=httpx.MockTransport(
        lambda request: httpx.Response(503))))
    start = datetime.now(UTC).replace(hour=1, minute=0, second=0, microsecond=0)
    provider.forecasts([(39, -104)], start, start + timedelta(days=15), partial=True)
    assert store.reservations == [2, 2]


class AtomicRedis:
    """Server-side command boundary: EVAL holds one lock for check-and-increment.

    Concurrent SharedStore instances issue genuine REST command payloads into this
    double. No Python-side client lock can make their multi-command races safe.
    """

    def __init__(self):
        self.lock = threading.Lock()
        self.counts = [0, 0, 0]
        self.values = {}
        self.eval_calls = 0

    def handle(self, request):
        command = json.loads(request.content)
        with self.lock:
            if command[0] == "EVAL" and command[1] == WEATHER_BUDGET_SCRIPT:
                self.eval_calls += 1
                cost = command[3]
                for used, limit, retry in zip(self.counts, [550, 4500, 9000], [60, 3600, 86400]):
                    if used + cost > limit:
                        return httpx.Response(200, json={"result": [0, retry]})
                self.counts = [value + cost for value in self.counts]
                return httpx.Response(200, json={"result": [1, 0]})
            if command[0] == "SET":
                key, value = command[1:3]
                if "NX" in command and key in self.values:
                    result = None
                else:
                    self.values[key] = value
                    result = "OK"
            elif command[0] == "EVAL" and command[1] == RELEASE_LOCK_SCRIPT:
                key, token = command[3:5]
                result = int(self.values.get(key) == token)
                if result:
                    del self.values[key]
            else:
                raise AssertionError(command)
            return httpx.Response(200, json={"result": result})


def test_shared_budget_race_allows_only_capacity_and_rejects_atomically():
    server = AtomicRedis()
    client = httpx.Client(transport=httpx.MockTransport(server.handle))
    stores = [SharedStore("https://redis.test", "token", client=client) for _ in range(8)]

    def reserve(index):
        try:
            stores[index % len(stores)].reserve_weather_budget(1)
            return True
        except RoutingError as error:
            assert error.code == "WEATHER_BUDGET_EXCEEDED"
            return False

    with ThreadPoolExecutor(max_workers=8) as pool:
        accepted = list(pool.map(reserve, range(600)))
    assert sum(accepted) == 550
    assert server.counts == [550, 550, 550]
    assert server.eval_calls == 600
    server.counts = [0, 4490, 8990]
    with pytest.raises(RoutingError):
        stores[0].reserve_weather_budget(11)
    assert server.counts == [0, 4490, 8990]  # A failing window cannot debit the other windows.


def test_lock_release_cannot_remove_a_successor_lease():
    server = AtomicRedis()
    store = SharedStore("https://redis.test", "token",
                        client=httpx.Client(transport=httpx.MockTransport(server.handle)))
    with store.trip_lock("trip"):
        server.values["spotter:lock:trip"] = "successor-token"
    assert server.values["spotter:lock:trip"] == "successor-token"


def test_redis_outage_is_fail_closed():
    def unavailable(request):
        raise httpx.ReadTimeout("private-details", request=request)

    store = SharedStore("https://redis.test", "token",
                        client=httpx.Client(transport=httpx.MockTransport(unavailable)))
    with pytest.raises(RoutingError) as caught:
        store.reserve_weather_budget(1)
    assert caught.value.code == "CACHE_UNAVAILABLE"
    assert "private-details" not in caught.value.message


@override_settings(TOMTOM_API_KEY="", UPSTASH_REDIS_REST_URL="", UPSTASH_REDIS_REST_TOKEN="")
def test_health_missing_configuration_and_stateless_sample_flow():
    client = APIClient()
    response = client.get("/api/health")
    assert response.status_code == 200
    assert response.json()["live_available"] is False
    assert "TOMTOM_API_KEY" in response.json()["missing_configuration"]
    assert response.json()["implementation"] == "CPython"
    departure = (datetime.now(UTC) + timedelta(hours=1)).isoformat()
    response = client.post("/api/trips/plan", {"mode": "sample", "departure_at": departure,
                                              "load_lb": 35000, "spacing_miles": 25}, format="json")
    assert response.status_code == 200
    trip = response.json()
    assert trip["mode"] == "sample" and len(trip["routes"]) == 3
    assert trip["id"].startswith("sample_")
    # Separate client/instance reconstructs this signed sample without a cache or Redis.
    corridor = APIClient().get(f"/api/trips/{trip['id']}/corridor")
    assert corridor.status_code == 200
    body = corridor.json()
    assert body["trip_id"] == trip["id"]
    assert len(body["hours"]) == 49
    assert all(len(cell["properties"]["risks"]) == 49 for cell in body["cells"]["features"])
    assert APIClient().get(f"/api/trips/{trip['id']}tampered/corridor").status_code == 404


def test_expired_sample_token_is_404(monkeypatch):
    data = {"departure_at": datetime.now(UTC), "load_lb": 1000, "spacing_miles": 50}
    trip = services.plan_sample(data)
    real_time = signing.time.time
    monkeypatch.setattr(signing.time, "time", lambda: real_time() + 901)
    with pytest.raises(RoutingError) as caught:
        services.get_trip(trip["id"])
    assert caught.value.status == 404


def test_oversized_trip_has_actionable_error_before_response(monkeypatch):
    monkeypatch.setattr(services, "MAX_RESPONSE_BYTES", 1024)
    response = APIClient().post("/api/trips/plan", {"mode": "sample"}, format="json")
    assert response.status_code == 400
    assert response.json()["error"]["code"] == "ANALYSIS_TOO_LARGE"
    assert "shorter trip" in response.json()["error"]["message"]


def test_oversized_corridor_has_actionable_error(monkeypatch):
    trip = services.plan_sample({"departure_at": datetime.now(UTC), "load_lb": 1000,
                                 "spacing_miles": 50})
    monkeypatch.setattr(services, "MAX_RESPONSE_BYTES", 1024)
    response = APIClient().get(f"/api/trips/{trip['id']}/corridor")
    assert response.status_code == 400
    assert response.json()["error"]["code"] == "ANALYSIS_TOO_LARGE"


def test_payload_budget_counts_actual_utf8_bytes():
    with pytest.raises(RoutingError):
        services._check_response_size({"label": "é" * (2 * 1024 * 1024)})


@pytest.mark.parametrize("field,value", [
    ("load_lb", -1), ("load_lb", "NaN"), ("load_lb", "Infinity"), ("load_lb", True),
    ("spacing_miles", 15), ("departure_at", "2026-10-18T10:00:00"), ("mode", "invalid"),
])
def test_invalid_inputs_use_common_error_shape(field, value):
    body = {"mode": "sample", "departure_at": datetime.now(UTC).isoformat(),
            "load_lb": 1000, "spacing_miles": 25, field: value}
    response = APIClient().post("/api/trips/plan", body, format="json")
    assert response.status_code == 400
    assert response.json()["error"]["code"] == "VALIDATION_ERROR"
    assert field in response.json()["error"]["fields"]


def live_data():
    return {"mode": "live", "origin": {"label": "Denver", "lat": 39.7, "lon": -104.9,
                                         "timezone": "America/Denver"},
            "destination": {"label": "Limon", "lat": 39.8, "lon": -103.8,
                            "timezone": "America/Denver"},
            "departure_at": datetime.now(UTC) + timedelta(hours=1),
            "load_lb": 35000, "spacing_miles": 25}


def test_live_location_and_departure_validation():
    data = live_data()
    data["origin"]["lat"] = float("nan")
    assert not TripPlanSerializer(data=data).is_valid()
    data = live_data()
    data["origin"]["timezone"] = "not/a-zone"
    assert not TripPlanSerializer(data=data).is_valid()
    data = live_data()
    data["departure_at"] = datetime.now(UTC) - timedelta(hours=1)
    assert not TripPlanSerializer(data=data).is_valid()


@override_settings(TOMTOM_API_KEY="", UPSTASH_REDIS_REST_URL="", UPSTASH_REDIS_REST_TOKEN="")
def test_live_missing_configuration_never_falls_back_to_sample():
    data = live_data()
    data["departure_at"] = data["departure_at"].isoformat()
    response = APIClient().post("/api/trips/plan", data, format="json")
    assert response.status_code == 503
    assert response.json()["error"]["code"] == "LIVE_NOT_CONFIGURED"
    assert "routes" not in response.json()


@override_settings(TOMTOM_API_KEY="test", UPSTASH_REDIS_REST_URL="https://redis.test",
                   UPSTASH_REDIS_REST_TOKEN="test")
def test_live_service_fewer_routes_unknown_weather_and_trip_cache():
    routing = Mock()
    raw = routing_payload(count=2)
    routes = []
    for index, item in enumerate(raw["routes"]):
        coordinates = [[p["longitude"], p["latitude"]] for p in item["legs"][0]["points"]]
        routes.append({"id": f"route-{index}", "label": f"Route {index}",
                       "geometry": {"type": "LineString", "coordinates": coordinates},
                       "distance_meters": 100000, "duration_seconds": 7200,
                       "progress": TomTomProvider._progress(item["progress"], coordinates, 100000, 7200)})
    routing.routes.return_value = routes
    weather = Mock()
    weather.forecasts.return_value = ({}, [])
    store = MemoryStore()
    data = live_data()
    result = services.plan_trip(data, store=store, routing=routing, weather=weather)
    assert len(result["routes"]) == 2
    assert all(route["summary"]["status"] == "incomplete" for route in result["routes"])
    assert result["recommended_route_id"] is None
    assert any("2 distinct" in warning for warning in result["warnings"])
    cached = services.plan_trip(data, store=store, routing=routing, weather=weather)
    assert cached["id"] == result["id"]
    assert routing.routes.call_count == 1


@override_settings(TOMTOM_API_KEY="test", UPSTASH_REDIS_REST_URL="https://redis.test",
                   UPSTASH_REDIS_REST_TOKEN="test")
def test_checkpoint_cap_stops_before_weather_spend():
    route = {"id": "long", "label": "Long route", "distance_meters": 10_000_000,
             "duration_seconds": 200000,
             "geometry": {"type": "LineString", "coordinates": [[-124, 40], [-75, 40]]},
             "progress": [{"point_index": 0, "distance_meters": 0, "duration_seconds": 0},
                          {"point_index": 1, "distance_meters": 10_000_000,
                           "duration_seconds": 200000}]}
    routing, weather = Mock(), Mock()
    routing.routes.return_value = [route]
    data = live_data()
    data["spacing_miles"] = 10
    with pytest.raises(RoutingError) as caught:
        services.plan_trip(data, store=MemoryStore(), routing=routing, weather=weather)
    assert caught.value.code == "TOO_MANY_CHECKPOINTS"
    weather.forecasts.assert_not_called()
