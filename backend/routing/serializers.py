"""API input validation happens before any billable upstream operation."""

import math
import re
from datetime import UTC, datetime, timedelta
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from rest_framework import serializers


class FiniteFloatField(serializers.FloatField):
    def to_internal_value(self, data):
        if isinstance(data, bool):
            self.fail("invalid")
        value = super().to_internal_value(data)
        if not math.isfinite(value):
            self.fail("invalid")
        return value


class AwareDateTimeField(serializers.DateTimeField):
    def to_internal_value(self, value):
        if isinstance(value, str):
            if not re.search(r"(?:Z|[+-]\d{2}:?\d{2})$", value, re.IGNORECASE):
                raise serializers.ValidationError("Include an explicit time zone offset.")
        elif isinstance(value, datetime) and value.utcoffset() is None:
            raise serializers.ValidationError("Include an explicit time zone offset.")
        return super().to_internal_value(value)


class LocationSerializer(serializers.Serializer):
    label = serializers.CharField(max_length=300)
    lat = FiniteFloatField(min_value=-90, max_value=90)
    lon = FiniteFloatField(min_value=-180, max_value=180)
    timezone = serializers.CharField(max_length=100)

    def validate_timezone(self, value):
        try:
            ZoneInfo(value)
        except (ZoneInfoNotFoundError, ValueError):
            raise serializers.ValidationError("Choose a location with a valid time zone.") from None
        return value


class TripPlanSerializer(serializers.Serializer):
    mode = serializers.ChoiceField(choices=("sample", "live"))
    origin = LocationSerializer(required=False)
    destination = LocationSerializer(required=False)
    departure_at = AwareDateTimeField(default=lambda: datetime.now(UTC))
    load_lb = FiniteFloatField(min_value=0, default=35000)
    spacing_miles = serializers.ChoiceField(choices=(10, 25, 50), default=25)

    def validate(self, data):
        if data["mode"] == "live":
            errors = {}
            for field in ("origin", "destination"):
                if field not in data:
                    errors[field] = ["Select an origin and destination from the search results."]
            if errors:
                raise serializers.ValidationError(errors)
            if (data["origin"]["lat"], data["origin"]["lon"]) == (
                data["destination"]["lat"], data["destination"]["lon"]
            ):
                raise serializers.ValidationError(
                    {"destination": ["Choose a destination different from the origin."]}
                )
            now = datetime.now(UTC)
            cutoff = now.replace(hour=0, minute=0, second=0, microsecond=0) + timedelta(days=16)
            if data["departure_at"] < now - timedelta(minutes=5):
                raise serializers.ValidationError(
                    {"departure_at": ["Choose a departure time in the future."]}
                )
            if data["departure_at"] + timedelta(hours=49) >= cutoff:
                raise serializers.ValidationError(
                    {"departure_at": [("Choose an earlier departure so the full 48-hour corridor "
                                       "fits within the 16-day forecast.")]}
                )
        return data


class GeocodeSerializer(serializers.Serializer):
    q = serializers.CharField(min_length=3, max_length=200, trim_whitespace=True)
