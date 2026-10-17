"""Pure, deterministic rules supplied by the assignment."""

import itertools
from copy import deepcopy
from datetime import timedelta
from math import isfinite

from .geometry import (
    LEVEL_SCORES,
    MILE_METERS,
    as_utc_datetime,
    interval_level,
    segments_for_route,
)


def classify_weather(weather, load_lb):
    if (
        isinstance(load_lb, bool)
        or not isinstance(load_lb, (int, float))
        or not isfinite(load_lb)
        or load_lb < 0
    ):
        raise ValueError("Load weight must be a finite nonnegative number.")
    required = ("wind_mph", "rain_in_hr", "snow_in_hr")
    if weather is None or any(
        isinstance(weather.get(key), bool)
        or not isinstance(weather.get(key), (int, float))
        or not isfinite(weather[key])
        or weather[key] < 0
        for key in required
    ):
        return {
            "level": "unknown",
            "score": None,
            "reasons": ["Weather unavailable or incomplete."],
        }
    wind, rain, snow = (weather[key] for key in required)
    wind_score = (
        4 if wind >= 55 else 3 if wind >= 45 else 2 if wind >= 35 else 1 if wind >= 25 else 0
    )
    rain_score = (
        4 if rain > 1 else 3 if rain >= 0.5 else 2 if rain >= 0.25 else 1 if rain >= 0.1 else 0
    )
    snow_score = 4 if snow > 3 else 3 if snow >= 2 else 2 if snow >= 1 else 1 if snow >= 0.5 else 0
    reasons = []
    if wind >= 55:
        reasons.append(f"Sustained wind {wind:g} mph: No Travel for every load.")
    elif wind >= 45 and load_lb > 30_000:
        wind_score = 4
        reasons.append(f"Sustained wind {wind:g} mph and load above 30,000 lb: No Travel.")
    elif wind >= 35 and wind < 45 and load_lb > 40_000:
        wind_score = 3
        reasons.append(f"Sustained wind {wind:g} mph and load above 40,000 lb: Severe.")
    elif wind_score:
        reasons.append(f"Sustained wind {wind:g} mph.")
    if rain_score:
        reasons.append(f"Liquid rainfall {rain:g} in/hr.")
    if snow_score:
        reasons.append(f"Snowfall {snow:g} in/hr.")
    score = max(wind_score, rain_score, snow_score)
    level = next(level for level, value in LEVEL_SCORES.items() if value == score)
    return {
        "level": level,
        "score": score,
        "reasons": reasons or ["Weather is within the supplied low-risk thresholds."],
    }


def assess_route(route, departure_at, load_lb):
    result = deepcopy(route)
    checkpoints = result["checkpoints"]
    if len(checkpoints) < 2:
        raise ValueError("A route must include origin and destination checkpoints.")
    for checkpoint in checkpoints:
        checkpoint["risk"] = classify_weather(checkpoint.get("weather"), load_lb)
    risk_miles = dict.fromkeys((*LEVEL_SCORES, "unknown"), 0.0)
    for start, end in itertools.pairwise(checkpoints):
        distance = end["distance_meters"] - start["distance_meters"]
        if distance <= 0:
            raise ValueError("Checkpoint distances must increase strictly.")
        risk_miles[interval_level(start, end)] += distance / MILE_METERS
    total_miles = result["distance_meters"] / MILE_METERS
    if abs(sum(risk_miles.values()) - total_miles) > 1e-6:
        raise ValueError("Checkpoints must cover the complete route distance.")
    blocked = any(checkpoint["risk"]["level"] == "no_travel" for checkpoint in checkpoints)
    incomplete = any(checkpoint["risk"]["level"] == "unknown" for checkpoint in checkpoints)
    average_risk = (
        None
        if incomplete
        else sum(risk_miles[level] * score for level, score in LEVEL_SCORES.items()) / total_miles
    )
    result["segments"] = segments_for_route(result)
    result["summary"] = {
        "status": "blocked" if blocked else "incomplete" if incomplete else "eligible",
        "arrival_at": checkpoints[-1].get("eta")
        or (
            as_utc_datetime(departure_at) + timedelta(seconds=result["duration_seconds"])
        ).isoformat(),
        "risk_miles": risk_miles,
        "average_risk": average_risk,
        "severe_miles": risk_miles["severe"],
        "high_miles": risk_miles["high"],
    }
    result.pop("progress", None)
    return result


def recommend_routes(routes):
    eligible = [
        route
        for route in routes
        if route["summary"]["status"] == "eligible" and route["summary"]["average_risk"] is not None
    ]
    if not eligible:
        return (
            None,
            (
                "No route recommended. All alternatives contain No Travel conditions or incomplete "
                "weather; inspect the checkpoints and try a different departure."
            ),
        )
    criteria = (
        ("severe_miles", "fewer Severe miles"),
        ("high_miles", "fewer High miles"),
        ("average_risk", "lower distance-weighted average risk"),
    )

    def ranking(route):
        summary = route["summary"]
        return (
            summary["severe_miles"],
            summary["high_miles"],
            summary["average_risk"],
            route["duration_seconds"],
            route["id"],
        )

    ranked = sorted(eligible, key=ranking)
    best = ranked[0]
    if len(ranked) == 1:
        explanation = "the only completely assessed alternative without No Travel conditions"
    else:
        runner_up = ranked[1]
        explanation = "equal weather and travel-time scores; stable route order resolves the tie"
        for field, description in criteria:
            if best["summary"][field] < runner_up["summary"][field]:
                difference = runner_up["summary"][field] - best["summary"][field]
                if field == "average_risk":
                    delta = f"{difference:.2f}" if difference >= 0.01 else "less than 0.01"
                    explanation = f"{description} than {runner_up['label']} by {delta} risk points"
                else:
                    delta = f"{difference:.1f}" if difference >= 0.1 else "less than 0.1"
                    explanation = f"{delta} {description} than {runner_up['label']}"
                break
        else:
            if best["duration_seconds"] < runner_up["duration_seconds"]:
                minutes = (runner_up["duration_seconds"] - best["duration_seconds"]) / 60
                delta = f"{minutes:.0f}" if minutes >= 1 else "less than 1"
                explanation = (
                    f"shorter travel time than {runner_up['label']} by {delta} minutes "
                    "after equal weather scores"
                )
        if best["duration_seconds"] > runner_up["duration_seconds"]:
            minutes = (best["duration_seconds"] - runner_up["duration_seconds"]) / 60
            delta = f"{minutes:.0f}" if minutes >= 1 else "less than 1"
            explanation += f"; {delta} minutes longer driving time"
    excluded_count = len(routes) - len(eligible)
    excluded = (
        f" {excluded_count} blocked or incomplete alternative(s) excluded."
        if excluded_count
        else ""
    )
    return best["id"], f"{best['label']} is recommended: {explanation}.{excluded}"
