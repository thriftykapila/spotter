import itertools
from datetime import UTC, datetime

import pytest
from hypothesis import given
from hypothesis import strategies as st
from shapely.geometry import Point, shape
from shapely.ops import unary_union

from routing.geometry import MILE_METERS, corridor_grid, sample_route, segments_for_route

DEPARTURE = datetime(2026, 10, 18, 12, tzinfo=UTC)


def route_fixture(length_miles=100):
    return {
        "id": "a",
        "distance_meters": length_miles * MILE_METERS,
        "duration_seconds": 10_000,
        "geometry": {"type": "LineString", "coordinates": [[-104, 39], [-103, 39], [-102, 39]]},
        "progress": [
            {"point_index": 0, "distance_meters": 0, "duration_seconds": 0},
            {
                "point_index": 1,
                "distance_meters": length_miles * MILE_METERS / 2,
                "duration_seconds": 1000,
            },
            {
                "point_index": 2,
                "distance_meters": length_miles * MILE_METERS,
                "duration_seconds": 10_000,
            },
        ],
    }


def test_arrival_interpolates_cumulative_section_time_instead_of_uniform_whole_route():
    checkpoints = sample_route(route_fixture(), DEPARTURE, 25)
    assert [point["distance_meters"] / MILE_METERS for point in checkpoints] == pytest.approx(
        [0, 25, 50, 75, 100]
    )
    assert [point["elapsed_seconds"] for point in checkpoints] == pytest.approx(
        [0, 500, 1000, 5500, 10_000]
    )
    assert checkpoints[2]["lon"] == pytest.approx(-103)
    assert checkpoints[2]["eta"] == "2026-10-18T12:16:40+00:00"


@given(
    length=st.floats(min_value=0.01, max_value=3000, allow_nan=False),
    spacing=st.sampled_from([10, 25, 50]),
)
def test_sampling_covers_both_endpoints_without_duplicates(length, spacing):
    route = route_fixture(length)
    checkpoints = sample_route(route, DEPARTURE, spacing)
    distances = [point["distance_meters"] for point in checkpoints]
    assert distances[0] == 0
    assert distances[-1] == route["distance_meters"]
    assert all(a < b for a, b in itertools.pairwise(distances))
    assert all((b - a) <= spacing * MILE_METERS + 1e-6 for a, b in itertools.pairwise(distances))
    assert len({point["id"] for point in checkpoints}) == len(checkpoints)
    assert checkpoints[0]["lon"] == -104
    assert checkpoints[-1]["lon"] == -102
    assert checkpoints[-1]["elapsed_seconds"] == 10_000


def test_short_route_still_has_origin_and_destination_and_final_partial_interval():
    assert len(sample_route(route_fixture(5), DEPARTURE, 50)) == 2
    assert [
        cp["distance_meters"] / MILE_METERS
        for cp in sample_route(route_fixture(120), DEPARTURE, 25)
    ] == pytest.approx([0, 25, 50, 75, 100, 120])


def test_sampling_requires_provider_progress_and_aware_departure():
    route = route_fixture()
    route.pop("progress")
    with pytest.raises(ValueError, match="progress"):
        sample_route(route, DEPARTURE, 25)
    with pytest.raises(ValueError, match="timezone"):
        sample_route(route_fixture(), datetime(2026, 10, 18), 25)


def test_segments_follow_bends_instead_of_cutting_between_checkpoints():
    route = route_fixture()
    route["geometry"]["coordinates"][1] = [-103, 40]
    route["checkpoints"] = sample_route(route, DEPARTURE, 50)
    for checkpoint in route["checkpoints"]:
        checkpoint["risk"] = {"level": "low", "score": 0, "reasons": []}
    features = segments_for_route(route)["features"]
    assert features[0]["geometry"]["coordinates"][-1] == [-103, 40]
    assert features[1]["geometry"]["coordinates"][0] == [-103, 40]
    assert features[0]["properties"]["start_checkpoint_id"] == "a-cp-0"


def test_coarse_interval_retains_intermediate_geometry_vertices():
    route = route_fixture(40)
    route["geometry"]["coordinates"][1] = [-103, 40]
    route["checkpoints"] = sample_route(route, DEPARTURE, 50)
    for checkpoint in route["checkpoints"]:
        checkpoint["risk"] = {"level": "low", "score": 0, "reasons": []}
    segment = segments_for_route(route)["features"][0]
    assert segment["geometry"]["coordinates"] == [[-104, 39], [-103, 40], [-102, 39]]


def test_corridor_is_deduplicated_clipped_and_capped():
    route = route_fixture()
    grid, size = corridor_grid([route, route], max_cells=40)
    single_grid, single_size = corridor_grid([route], max_cells=40)
    assert grid == single_grid
    assert size == single_size
    assert 0 < len(grid["features"]) <= 40
    assert size >= 10 and size % 5 == 0
    polygons = [shape(feature["geometry"]) for feature in grid["features"]]
    assert all(polygon.is_valid and polygon.area > 0 for polygon in polygons)
    for feature, polygon in zip(grid["features"], polygons):
        properties = feature["properties"]
        assert polygon.covers(Point(properties["lon"], properties["lat"]))
    assert unary_union(polygons).covers(Point(-103, 39))
    assert not unary_union(polygons).covers(Point(-103, 41))


def test_grid_can_coarsen_to_single_cell_without_infinite_loop():
    grid, size = corridor_grid([route_fixture()], max_cells=1)
    assert len(grid["features"]) == 1
    assert size > 10
