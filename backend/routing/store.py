"""Shared Redis storage and atomic provider budgets for stateless deployments."""

import hashlib
import json
import time
import uuid
from contextlib import contextmanager

import httpx
from django.conf import settings

from .errors import RoutingError

# The shared hash tag permits all budget counters to live in one Redis cluster slot.
# Redis TIME establishes one clock. Check all windows before incrementing any of them.
WEATHER_BUDGET_SCRIPT = """
local now = tonumber(redis.call('TIME')[1])
local amount = tonumber(ARGV[1])
local windows = {60, 3600, 86400}
local limits = {550, 4500, 9000}
local keys = {}
for i, seconds in ipairs(windows) do
  keys[i] = 'spotter:{weather-budget}:' .. seconds .. ':' .. math.floor(now / seconds)
  local used = tonumber(redis.call('GET', keys[i]) or '0')
  if used + amount > limits[i] then
    return {0, seconds - (now % seconds)}
  end
end
for i, key in ipairs(keys) do
  redis.call('INCRBY', key, amount)
  redis.call('EXPIRE', key, windows[i] - (now % windows[i]) + 2)
end
return {1, 0}
"""

RELEASE_LOCK_SCRIPT = """
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('DEL', KEYS[1])
end
return 0
"""

TOMTOM_BUDGET_SCRIPT = """
local now = tonumber(redis.call('TIME')[1])
local minute = math.floor(now / 60)
local day = math.floor(now / 86400)
local keys = {'spotter:{tomtom-budget}:minute:' .. minute,
              'spotter:{tomtom-budget}:day:' .. day}
local limits = {120, 1500}
local ttls = {60 - (now % 60), 86400 - (now % 86400)}
if ARGV[1] ~= '' then
  keys[3] = 'spotter:{tomtom-budget}:ip:' .. ARGV[1] .. ':' .. minute
  limits[3] = 30
  ttls[3] = ttls[1]
end
for i, key in ipairs(keys) do
  if tonumber(redis.call('GET', key) or '0') >= limits[i] then
    return {0, ttls[i]}
  end
end
for i, key in ipairs(keys) do
  redis.call('INCR', key)
  redis.call('EXPIRE', key, ttls[i] + 2)
end
return {1, 0}
"""


def _json(value):
    return json.dumps(value, separators=(",", ":"), allow_nan=False)


class SharedStore:
    """REST Redis avoids persistent connection assumptions in serverless functions.

    There is deliberately no in-process live fallback: losing distributed locks or
    budget counters would create unrestricted provider calls across function instances.
    """

    def __init__(self, url=None, token=None, *, client=None):
        self.url = (url if url is not None else settings.UPSTASH_REDIS_REST_URL).rstrip("/")
        self.token = token if token is not None else settings.UPSTASH_REDIS_REST_TOKEN
        self.client = client

    def _post(self, path, payload):
        if not self.url or not self.token:
            self._unavailable()
        try:
            response = (self.client or httpx).post(
                self.url + path, json=payload,
                headers={"Authorization": f"Bearer {self.token}"},
                timeout=httpx.Timeout(3.0, connect=1.5),
            )
            if response.status_code >= 400:
                self._unavailable()
            value = response.json()
            if isinstance(value, dict) and "error" in value:
                self._unavailable()
            return value
        except (httpx.HTTPError, ValueError):
            self._unavailable()

    @staticmethod
    def _unavailable():
        raise RoutingError(
            "CACHE_UNAVAILABLE",
            "Live planning is temporarily unavailable because its shared cache could not be reached. "
            "Please try again or use the labeled sample trip.",
            503,
        )

    def command(self, *command):
        value = self._post("", list(command))
        if not isinstance(value, dict) or "result" not in value:
            self._unavailable()
        return value["result"]

    def pipeline(self, commands):
        if not commands:
            return []
        values = self._post("/pipeline", commands)
        if not isinstance(values, list) or len(values) != len(commands):
            self._unavailable()
        if any(not isinstance(value, dict) or "error" in value or "result" not in value
               for value in values):
            self._unavailable()
        return [value["result"] for value in values]

    def get_json(self, key):
        raw = self.command("GET", key)
        if raw is None:
            return None
        try:
            return json.loads(raw)
        except (ValueError, TypeError):
            # Treat malformed cache data as a miss, never as a fabricated forecast.
            return None

    def set_json(self, key, value, ttl=900):
        return self.command("SET", key, _json(value), "EX", max(1, int(ttl)))

    def get_many_json(self, keys):
        result = {}
        for offset in range(0, len(keys), 100):
            batch = keys[offset:offset + 100]
            values = self.command("MGET", *batch)
            if not isinstance(values, list) or len(values) != len(batch):
                self._unavailable()
            for key, value in zip(batch, values):
                if value is None:
                    continue
                try:
                    result[key] = json.loads(value)
                except (ValueError, TypeError):
                    continue
        return result

    def set_many_json(self, values, ttl=900):
        items = list(values.items())
        for offset in range(0, len(items), 50):
            self.pipeline([
                ["SET", key, _json(value), "EX", max(1, int(ttl))]
                for key, value in items[offset:offset + 50]
            ])

    @staticmethod
    def weather_key(point, start, end):
        # Cache complete hourly series, not load-dependent risks or a single ETA.
        signature = _json([point, start, end, "mph", "inch", "best_match"])
        return "spotter:weather:v1:" + hashlib.sha256(signature.encode()).hexdigest()

    def reserve_weather_budget(self, locations):
        if isinstance(locations, bool) or not isinstance(locations, int) or locations < 1:
            raise ValueError("Location budget cost must be a positive integer")
        result = self.command("EVAL", WEATHER_BUDGET_SCRIPT, 0, locations)
        if not isinstance(result, list) or len(result) != 2:
            self._unavailable()
        if result[0] != 1:
            raise RoutingError(
                "WEATHER_BUDGET_EXCEEDED",
                "The shared weather request allowance is temporarily exhausted. "
                "Wait before planning another trip, or use the labeled sample trip.",
                429,
                retry_after=int(result[1]),
            )

    def reserve_tomtom_budget(self, identity=""):
        identity_hash = hashlib.sha256(identity.encode()).hexdigest() if identity else ""
        result = self.command("EVAL", TOMTOM_BUDGET_SCRIPT, 0, identity_hash)
        if not isinstance(result, list) or len(result) != 2:
            self._unavailable()
        if result[0] != 1:
            raise RoutingError(
                "ROUTING_BUDGET_EXCEEDED",
                "Too many location or routing requests. Please wait before trying again.",
                429, retry_after=int(result[1]),
            )

    @contextmanager
    def trip_lock(self, signature):
        token = uuid.uuid4().hex
        key = "spotter:lock:" + signature
        acquired = self.command("SET", key, token, "NX", "EX", 65)
        if acquired != "OK":
            raise RoutingError(
                "ANALYSIS_IN_PROGRESS", "This trip is already being analyzed. Please retry shortly.",
                409, retry_after=2,
            )
        try:
            yield
        finally:
            try:
                self.command("EVAL", RELEASE_LOCK_SCRIPT, 1, key, token)
            except RoutingError:
                # The lease expires; a release outage must not mask the original error.
                pass


def trip_signature(data):
    normalized = {"origin": [data["origin"]["lat"], data["origin"]["lon"]],
                  "destination": [data["destination"]["lat"], data["destination"]["lon"]],
                  "departure": data["departure_at"].isoformat(),
                  "load": data["load_lb"], "spacing": data["spacing_miles"]}
    return hashlib.sha256(_json(normalized).encode()).hexdigest()


def trip_ttl(trip):
    from datetime import datetime

    return max(0, int(datetime.fromisoformat(trip["expires_at"]).timestamp() - time.time()))
