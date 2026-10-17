from datetime import UTC, datetime

import pytest

from routing.demo import sample_corridor, sample_trip

DEPARTURE = datetime(2026, 10, 18, 12, tzinfo=UTC)


def test_sample_has_three_distinct_routes_and_explains_weather_recommendation():
    trip = sample_trip(DEPARTURE, 35_000, 25)
    assert trip["mode"] == "sample"
    assert len(trip["routes"]) == 3
    assert len({str(route["geometry"]) for route in trip["routes"]}) == 3
    assert trip["recommended_route_id"] == "sample-b"
    assert "synthetic" in trip["warnings"][0]
    assert any(route["summary"]["status"] == "blocked" for route in trip["routes"])
    for route in trip["routes"]:
        assert route["checkpoints"][0]["eta"] == trip["departure_at"]
        assert route["checkpoints"][-1]["eta"] == route["summary"]["arrival_at"]
        assert sum(route["summary"]["risk_miles"].values()) * 1609.344 == pytest.approx(
            route["distance_meters"]
        )


def test_sample_route_and_checkpoint_ids_are_deterministic_and_load_changes_risk():
    light = sample_trip(DEPARTURE, 30_000, 25)
    heavy = sample_trip(DEPARTURE, 45_000, 25)
    assert [route["id"] for route in light["routes"]] == [route["id"] for route in heavy["routes"]]
    assert [[cp["id"] for cp in route["checkpoints"]] for route in light["routes"]] == [
        [cp["id"] for cp in route["checkpoints"]] for route in heavy["routes"]
    ]
    assert light["routes"][0]["summary"]["status"] == "eligible"
    assert heavy["routes"][0]["summary"]["status"] == "blocked"
    assert (
        heavy["routes"][2]["summary"]["severe_miles"]
        > light["routes"][2]["summary"]["severe_miles"]
    )


def test_sample_corridor_has_49_changing_frames_and_keeps_recommendation_unchanged():
    trip = sample_trip(DEPARTURE, 35_000, 50)
    original_recommendation = trip["recommended_route_id"]
    corridor = sample_corridor(trip)
    assert corridor["trip_id"] == trip["id"]
    assert corridor["hours"][0] == trip["departure_at"]
    assert corridor["hours"][-1] == "2026-10-20T12:00:00+00:00"
    assert 0 < len(corridor["cells"]["features"]) <= 200
    changed = False
    for feature in corridor["cells"]["features"]:
        properties = feature["properties"]
        for key in ("risks", "wind_mph", "rain_in_hr", "snow_in_hr"):
            assert len(properties[key]) == 49
        assert all(score in (0, 1, 2, 3, 4) for score in properties["risks"])
        changed |= len(set(properties["risks"])) > 1
    assert changed
    assert trip["recommended_route_id"] == original_recommendation
