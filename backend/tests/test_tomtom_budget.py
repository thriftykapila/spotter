"""Routing and geocoding must debit the same free-tier request allowance."""

import json
from datetime import UTC, datetime

import httpx
import pytest

from routing.errors import RoutingError
from routing.providers import TomTomProvider
from routing.store import TOMTOM_BUDGET_SCRIPT, TOMTOM_DAILY_LIMIT, SharedStore


def test_mixed_geocode_and_routing_requests_stop_at_shared_daily_allowance():
    used = TOMTOM_DAILY_LIMIT - 2
    provider_requests = []
    budget_requests = []

    def handle(request):
        nonlocal used
        if request.url.host == "redis.test":
            command = json.loads(request.content)
            assert command[:3] == ["EVAL", TOMTOM_BUDGET_SCRIPT, 0]
            budget_requests.append(command)
            daily_limit = command[4]
            if used >= daily_limit:
                return httpx.Response(200, json={"result": [0, 3600]})
            used += 1
            return httpx.Response(200, json={"result": [1, 0]})
        provider_requests.append(request)
        if "/search/" in request.url.path:
            return httpx.Response(200, json={"results": []})
        return httpx.Response(200, json={"routes": [{
            "summary": {"lengthInMeters": 100000, "travelTimeInSeconds": 7200},
            "legs": [{"points": [{"latitude": 39.7, "longitude": -104.9},
                                  {"latitude": 39.8, "longitude": -103.8}]}],
            "progress": [{"pointIndex": 0, "distanceInMeters": 0,
                          "travelTimeInSeconds": 0},
                         {"pointIndex": 1, "distanceInMeters": 100000,
                          "travelTimeInSeconds": 7200}],
        }]})

    with httpx.Client(transport=httpx.MockTransport(handle)) as client:
        store = SharedStore("https://redis.test", "test-token", client=client)
        provider = TomTomProvider("test-key", client=client, store=store, identity="driver")
        assert provider.geocode("Denver") == []
        assert len(provider.routes(
            {"lat": 39.7, "lon": -104.9}, {"lat": 39.8, "lon": -103.8}, datetime.now(UTC)
        )) == 1
        with pytest.raises(RoutingError) as caught:
            provider.geocode("Kansas City")

    assert caught.value.code == "ROUTING_BUDGET_EXCEEDED"
    assert caught.value.status == 429
    assert caught.value.retry_after == 3600
    assert used == TOMTOM_DAILY_LIMIT
    assert len(provider_requests) == 2
    assert len(budget_requests) == 3
    assert all(command[4] == 500 for command in budget_requests)
