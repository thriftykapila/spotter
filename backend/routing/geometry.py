"""Distance-aware sampling and a bounded, equal-area forecast grid."""

import itertools
from bisect import bisect_right
from datetime import UTC, datetime, timedelta
from math import ceil, floor, isclose, isfinite

from pyproj import Geod, Transformer
from shapely import transform
from shapely.geometry import LineString, box, mapping
from shapely.ops import unary_union
from shapely.prepared import prep

MILE_METERS = 1609.344
CORRIDOR_SIMPLIFICATION_METERS = 50
GEOD = Geod(ellps="WGS84")
TO_EQUAL_AREA = Transformer.from_crs("EPSG:4326", "EPSG:5070", always_xy=True)
FROM_EQUAL_AREA = Transformer.from_crs("EPSG:5070", "EPSG:4326", always_xy=True)
LEVEL_SCORES = {"low": 0, "moderate": 1, "high": 2, "severe": 3, "no_travel": 4}


def as_utc_datetime(value):
    result = datetime.fromisoformat(value) if isinstance(value, str) else value
    if not isinstance(result, datetime) or result.tzinfo is None:
        raise ValueError("Departure must include a timezone offset.")
    return result.astimezone(UTC)


def _route_profile(route, require_progress=True):
    coordinates = route["geometry"]["coordinates"]
    if len(coordinates) < 2:
        raise ValueError("Route geometry needs at least two coordinates.")
    total_distance = float(route["distance_meters"])
    if not isfinite(total_distance) or total_distance <= 0:
        raise ValueError("Route distance must be positive.")
    edge_lengths = [
        GEOD.inv(*start[:2], *end[:2])[2] for start, end in itertools.pairwise(coordinates)
    ]
    progress = route.get("progress")
    if not progress:
        if require_progress:
            raise ValueError("Routing progress is required to estimate checkpoint arrival times.")
        progress = [
            {"point_index": 0, "distance_meters": 0, "duration_seconds": 0},
            {
                "point_index": len(coordinates) - 1,
                "distance_meters": total_distance,
                "duration_seconds": route["duration_seconds"],
            },
        ]
    anchors = []
    for item in progress:
        anchor = (
            int(item["point_index"]),
            float(item["distance_meters"]),
            float(item["duration_seconds"]),
        )
        if not all(isfinite(value) for value in anchor):
            raise ValueError("Routing progress must contain finite numbers.")
        if anchors and anchor[0] == anchors[-1][0]:
            if anchor[1:] != anchors[-1][1:]:
                raise ValueError("Conflicting routing progress for the same geometry point.")
            continue
        anchors.append(anchor)
    if len(anchors) < 2 or anchors[0] != (0, 0.0, 0.0):
        raise ValueError("Routing progress must begin at the origin with zero elapsed time.")
    if anchors[-1][0] != len(coordinates) - 1:
        raise ValueError("Routing progress must include the destination.")
    if not isclose(anchors[-1][1], total_distance, rel_tol=1e-6, abs_tol=1):
        raise ValueError("Routing progress does not match route distance.")
    distances = [0.0] * len(coordinates)
    durations = [0.0] * len(coordinates)
    for start, end in itertools.pairwise(anchors):
        start_index, start_distance, start_duration = start
        end_index, end_distance, end_duration = end
        if (
            end_index <= start_index
            or start_index < 0
            or end_index >= len(coordinates)
            or end_distance < start_distance
            or end_duration < start_duration
        ):
            raise ValueError("Routing progress must be monotonic.")
        geometric_length = sum(edge_lengths[start_index:end_index])
        if geometric_length == 0 and end_distance > start_distance:
            raise ValueError("Positive routing distance has no corresponding geometry.")
        traversed = 0.0
        for index in range(start_index, end_index + 1):
            fraction = traversed / geometric_length if geometric_length else 0.0
            if index == end_index:
                fraction = 1.0
            distances[index] = start_distance + fraction * (end_distance - start_distance)
            durations[index] = start_duration + fraction * (end_duration - start_duration)
            if index < end_index:
                traversed += edge_lengths[index]
    # Providers sometimes round their final progress distance independently of the summary.
    scale = total_distance / distances[-1]
    distances = [distance * scale for distance in distances]
    return coordinates, distances, durations


def _point_at_distance(coordinates, distances, durations, distance):
    if distance <= 0:
        return list(coordinates[0][:2]), durations[0]
    if distance >= distances[-1]:
        return list(coordinates[-1][:2]), durations[-1]
    index = min(bisect_right(distances, distance) - 1, len(coordinates) - 2)
    span = distances[index + 1] - distances[index]
    fraction = (distance - distances[index]) / span if span else 0.0
    start, end = coordinates[index], coordinates[index + 1]
    azimuth, _, length = GEOD.inv(*start[:2], *end[:2])
    lon, lat, _ = GEOD.fwd(*start[:2], azimuth, length * fraction)
    elapsed = durations[index] + fraction * (durations[index + 1] - durations[index])
    return [lon, lat], elapsed


def sample_route(route, departure_at, spacing_miles):
    if spacing_miles not in (10, 25, 50):
        raise ValueError("Checkpoint spacing must be 10, 25, or 50 miles.")
    departure = as_utc_datetime(departure_at)
    coordinates, distances, durations = _route_profile(route)
    total_distance = float(route["distance_meters"])
    spacing = spacing_miles * MILE_METERS
    sample_distances = [index * spacing for index in range(ceil(total_distance / spacing))]
    sample_distances.append(total_distance)
    checkpoints = []
    for index, distance in enumerate(sample_distances):
        (lon, lat), elapsed = _point_at_distance(coordinates, distances, durations, distance)
        checkpoints.append(
            {
                "id": f"{route['id']}-cp-{index}",
                "lat": lat,
                "lon": lon,
                "distance_meters": distance,
                "elapsed_seconds": elapsed,
                "eta": (departure + timedelta(seconds=elapsed)).isoformat(),
                "weather": None,
                "risk": {"level": "unknown", "score": None, "reasons": ["Weather unavailable."]},
            }
        )
    return checkpoints


def interval_level(start, end):
    levels = [start["risk"]["level"], end["risk"]["level"]]
    if "no_travel" in levels:
        return "no_travel"
    if "unknown" in levels:
        return "unknown"
    return max(levels, key=LEVEL_SCORES.__getitem__)


def segments_for_route(route):
    coordinates, distances, durations = _route_profile(route, require_progress=False)
    features = []
    for start, end in zip(route["checkpoints"], route["checkpoints"][1:]):
        start_distance, end_distance = start["distance_meters"], end["distance_meters"]
        if end_distance <= start_distance:
            raise ValueError("Checkpoint distances must increase strictly.")
        start_point, _ = _point_at_distance(coordinates, distances, durations, start_distance)
        end_point, _ = _point_at_distance(coordinates, distances, durations, end_distance)
        points = [start_point]
        points.extend(
            list(point[:2])
            for point, distance in zip(coordinates, distances)
            if start_distance < distance < end_distance
        )
        points.append(end_point)
        deduplicated = [points[0]]
        for point in points[1:]:
            if point != deduplicated[-1]:
                deduplicated.append(point)
        if len(deduplicated) == 1:
            deduplicated.append(points[-1])
        features.append(
            {
                "type": "Feature",
                "geometry": {"type": "LineString", "coordinates": deduplicated},
                "properties": {
                    "route_id": route["id"],
                    "level": interval_level(start, end),
                    "start_checkpoint_id": start["id"],
                    "end_checkpoint_id": end["id"],
                },
            }
        )
    return {"type": "FeatureCollection", "features": features}


def _polygon_parts(geometry):
    if geometry.is_empty:
        return []
    if geometry.geom_type == "Polygon":
        return [geometry] if geometry.area > 1 else []
    if geometry.geom_type in ("MultiPolygon", "GeometryCollection"):
        return [part for item in geometry.geoms for part in _polygon_parts(item)]
    return []


def corridor_grid(routes, max_cells=200, *, deadline=None):
    """Clip forecast cells to an approximate 25-mile route corridor.

    Road-level geometry is simplified by at most 50 projected meters for this
    coarse overlay only. Buffering each route before the polygon union avoids
    noding thousands of overlapping road segments into an expensive network.
    """
    if not routes or max_cells < 1:
        raise ValueError("A corridor needs routes and a positive cell budget.")
    unique_lines = {}
    for route in routes:
        if deadline:
            deadline.remaining()
        line = (
            transform(
                LineString(route["geometry"]["coordinates"]),
                TO_EQUAL_AREA.transform,
                interleaved=False,
            )
            .simplify(CORRIDOR_SIMPLIFICATION_METERS, preserve_topology=False)
            .normalize()
        )
        unique_lines[line.wkb] = line
    projected = [unique_lines[key] for key in sorted(unique_lines)]
    buffers = []
    for line in projected:
        if deadline:
            deadline.remaining()
        buffers.append(line.buffer(25 * MILE_METERS, quad_segs=8))
    if deadline:
        deadline.remaining()
    corridor = unary_union(buffers)
    prepared = prep(corridor)
    min_x, min_y, max_x, max_y = corridor.bounds
    # Keep one origin while coarsening, so even a budget of one cell can terminate.
    origin_x = floor(min_x / (10 * MILE_METERS)) * 10 * MILE_METERS
    origin_y = floor(min_y / (10 * MILE_METERS)) * 10 * MILE_METERS
    cell_size_miles = 10
    while True:
        if deadline:
            deadline.remaining()
        size = cell_size_miles * MILE_METERS
        cells = []
        overflow = False
        for row in range(ceil((max_y - origin_y) / size)):
            if deadline:
                deadline.remaining()
            for column in range(ceil((max_x - origin_x) / size)):
                square = box(
                    origin_x + column * size,
                    origin_y + row * size,
                    origin_x + (column + 1) * size,
                    origin_y + (row + 1) * size,
                )
                if not prepared.intersects(square):
                    continue
                for part_index, polygon in enumerate(_polygon_parts(square.intersection(corridor))):
                    point = polygon.representative_point()
                    lon, lat = FROM_EQUAL_AREA.transform(point.x, point.y)
                    cells.append(
                        {
                            "type": "Feature",
                            "geometry": mapping(
                                transform(polygon, FROM_EQUAL_AREA.transform, interleaved=False)
                            ),
                            "properties": {
                                "id": f"cell-{row}-{column}-{part_index}",
                                "lat": lat,
                                "lon": lon,
                            },
                        }
                    )
                    if len(cells) > max_cells:
                        overflow = True
                        break
                if overflow:
                    break
            if overflow:
                break
        if not overflow:
            return {"type": "FeatureCollection", "features": cells}, cell_size_miles
        cell_size_miles += 5
