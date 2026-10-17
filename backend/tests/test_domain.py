from copy import deepcopy
from datetime import UTC, datetime

import pytest
from hypothesis import given
from hypothesis import strategies as st

from routing.domain import assess_route, classify_weather, recommend_routes
from routing.geometry import MILE_METERS, sample_route


def weather(wind=0, rain=0, snow=0):
    return {"wind_mph": wind, "gust_mph": None, "rain_in_hr": rain, "snow_in_hr": snow}


@pytest.mark.parametrize(
    ("value", "level"),
    [
        (24.999, "low"),
        (25, "moderate"),
        (34.999, "moderate"),
        (35, "high"),
        (44.999, "high"),
        (45, "severe"),
        (54.999, "severe"),
        (55, "no_travel"),
    ],
)
def test_wind_continuous_boundaries(value, level):
    assert classify_weather(weather(wind=value), 30_000)["level"] == level


@pytest.mark.parametrize(
    ("value", "level"),
    [
        (0.09999, "low"),
        (0.1, "moderate"),
        (0.24999, "moderate"),
        (0.25, "high"),
        (0.49999, "high"),
        (0.5, "severe"),
        (1, "severe"),
        (1.00001, "no_travel"),
    ],
)
def test_rain_shared_endpoints_use_higher_band_but_one_is_severe(value, level):
    assert classify_weather(weather(rain=value), 0)["level"] == level


@pytest.mark.parametrize(
    ("value", "level"),
    [
        (0.49999, "low"),
        (0.5, "moderate"),
        (0.99999, "moderate"),
        (1, "high"),
        (1.99999, "high"),
        (2, "severe"),
        (3, "severe"),
        (3.00001, "no_travel"),
    ],
)
def test_snow_shared_endpoints_use_higher_band_but_three_is_severe(value, level):
    assert classify_weather(weather(snow=value), 0)["level"] == level


@pytest.mark.parametrize(
    ("wind", "load", "level"),
    [
        (45, 30_000, "severe"),
        (45, 30_000.01, "no_travel"),
        (35, 40_000, "high"),
        (35, 40_000.01, "severe"),
        (44.999, 40_001, "severe"),
        (55, 0, "no_travel"),
        (55, 80_000, "no_travel"),
    ],
)
def test_load_upgrade_comparisons_are_strict(wind, load, level):
    assert classify_weather(weather(wind=wind), load)["level"] == level


def test_combined_conditions_use_worst_hazard_and_ignore_informative_gust():
    values = weather(wind=28, rain=0.3, snow=2)
    values["gust_mph"] = 70
    assert classify_weather(values, 30_000)["level"] == "severe"
    assert classify_weather(weather(wind=34.99999), 40_001)["level"] == "moderate"


@pytest.mark.parametrize(
    "values",
    [
        None,
        {},
        weather(wind=True),
        weather(wind=None),
        weather(rain=float("nan")),
        weather(snow=-0.1),
        weather(wind=float("inf")),
    ],
)
def test_missing_and_invalid_weather_is_unknown(values):
    assert classify_weather(values, 30_000)["score"] is None


@pytest.mark.parametrize("load", [True, "30000", None, -1, float("nan"), float("inf")])
def test_invalid_load_fails_explicitly(load):
    with pytest.raises(ValueError, match="Load"):
        classify_weather(weather(), load)


@given(
    wind=st.floats(min_value=0, max_value=80, allow_nan=False),
    rain=st.floats(min_value=0, max_value=2, allow_nan=False),
    snow=st.floats(min_value=0, max_value=5, allow_nan=False),
    load=st.floats(min_value=0, max_value=80_000, allow_nan=False),
    extra=st.floats(min_value=0, max_value=20, allow_nan=False),
)
def test_risk_cannot_decrease_when_weather_or_load_increases(wind, rain, snow, load, extra):
    original = classify_weather(weather(wind, rain, snow), load)["score"]
    assert classify_weather(weather(wind + extra, rain, snow), load)["score"] >= original
    assert classify_weather(weather(wind, rain + extra, snow), load)["score"] >= original
    assert classify_weather(weather(wind, rain, snow + extra), load)["score"] >= original
    assert classify_weather(weather(wind, rain, snow), load + extra * 1000)["score"] >= original


def assessed_fixture(values):
    route = {
        "id": "test-route",
        "label": "Route A",
        "distance_meters": 120 * MILE_METERS,
        "duration_seconds": 7200,
        "geometry": {"type": "LineString", "coordinates": [[-104, 39], [-102, 39]]},
        "progress": [
            {"point_index": 0, "distance_meters": 0, "duration_seconds": 0},
            {"point_index": 1, "distance_meters": 120 * MILE_METERS, "duration_seconds": 7200},
        ],
    }
    route["checkpoints"] = sample_route(route, datetime(2026, 10, 18, 12, tzinfo=UTC), 25)
    for checkpoint, value in zip(route["checkpoints"], values, strict=True):
        checkpoint["weather"] = value
    return assess_route(route, "2026-10-18T12:00:00+00:00", 30_000)


def test_exposure_uses_worse_endpoint_with_exact_partial_interval():
    route = assessed_fixture(
        [weather(), weather(wind=35), weather(), weather(wind=45), weather(), weather()]
    )
    summary = route["summary"]
    assert summary["risk_miles"]["high"] == pytest.approx(50)
    assert summary["risk_miles"]["severe"] == pytest.approx(50)
    assert summary["risk_miles"]["low"] == pytest.approx(20)
    assert sum(summary["risk_miles"].values()) == pytest.approx(120)
    assert summary["average_risk"] == pytest.approx(250 / 120)
    assert [feature["properties"]["level"] for feature in route["segments"]["features"]] == [
        "high",
        "high",
        "severe",
        "severe",
        "low",
    ]
    assert "progress" not in route


def test_missing_forecast_prevents_recommendation_instead_of_averaging_known_points():
    route = assessed_fixture([weather(), weather(), None, weather(), weather(), weather()])
    assert route["summary"]["status"] == "incomplete"
    assert route["summary"]["average_risk"] is None
    assert route["summary"]["risk_miles"]["unknown"] == pytest.approx(50)
    assert recommend_routes([route])[0] is None


def test_known_no_travel_blocks_even_with_other_missing_forecasts():
    route = assessed_fixture([weather(wind=55), None, weather(), weather(), weather(), weather()])
    assert route["summary"]["status"] == "blocked"
    assert route["summary"]["average_risk"] is None
    assert recommend_routes([route])[0] is None


def ranked_route(route_id="a", severe=0, high=0, average=0, duration=100, status="eligible"):
    return {
        "id": route_id,
        "label": f"Route {route_id}",
        "duration_seconds": duration,
        "summary": {
            "severe_miles": severe,
            "high_miles": high,
            "average_risk": average,
            "status": status,
        },
    }


@pytest.mark.parametrize(
    ("winner", "loser", "reason_part"),
    [
        (
            ranked_route("b", high=100, average=2, duration=500),
            ranked_route(severe=1),
            "Severe miles",
        ),
        (ranked_route("b", average=2, duration=500), ranked_route(high=1), "High miles"),
        (ranked_route("b", average=0.1, duration=500), ranked_route(average=0.2), "average risk"),
        (ranked_route("b", duration=50), ranked_route(duration=100), "shorter travel time"),
    ],
)
def test_recommendation_obeys_each_lexicographic_priority(winner, loser, reason_part):
    recommended_id, reason = recommend_routes([loser, winner])
    assert recommended_id == "b"
    assert reason_part in reason


def test_blocked_and_unknown_never_win_even_if_their_metrics_look_better():
    routes = [
        ranked_route("blocked", status="blocked"),
        ranked_route("unknown", status="incomplete", average=None),
        ranked_route("eligible", severe=100),
    ]
    assert recommend_routes(routes)[0] == "eligible"
    assert recommend_routes(routes[:2])[0] is None
    assert recommend_routes([])[0] is None


def test_final_tie_is_stable_and_input_is_not_reordered():
    routes = [ranked_route("b"), ranked_route("a")]
    original = deepcopy(routes)
    assert recommend_routes(routes)[0] == "a"
    assert routes == original
