"""Small HTTP boundary; domain and provider failures have one public error shape."""

from functools import wraps

from rest_framework import status
from rest_framework.decorators import api_view
from rest_framework.response import Response
from rest_framework.views import exception_handler as drf_exception_handler

from . import services
from .errors import RoutingError
from .serializers import GeocodeSerializer, TripPlanSerializer


def exception_handler(error, context):
    """Also normalize parse/405 errors raised before a function view executes."""
    response = drf_exception_handler(error, context)
    if response is None:
        return None
    detail = response.data.get("detail", "The request could not be processed.")
    response.data = {"error": {"code": str(getattr(error, "default_code", "REQUEST_FAILED")).upper(),
                               "message": str(detail)}}
    return response


def _errors(view):
    @wraps(view)
    def wrapped(*args, **kwargs):
        try:
            return view(*args, **kwargs)
        except RoutingError as error:
            response = Response(error.payload(), status=error.status)
            if error.retry_after is not None:
                response["Retry-After"] = str(error.retry_after)
            return response
    return wrapped


def _validation(serializer):
    return Response({"error": {"code": "VALIDATION_ERROR", "message": "Check the highlighted inputs.",
                               "fields": serializer.errors}}, status=status.HTTP_400_BAD_REQUEST)


@api_view(["GET"])
@_errors
def health(request):
    return Response({"healthy": True, **services.readiness(), **services.dependency_status()})


@api_view(["GET"])
@_errors
def geocode(request):
    serializer = GeocodeSerializer(data=request.query_params)
    if not serializer.is_valid():
        return _validation(serializer)
    identity = request.META.get("HTTP_X_FORWARDED_FOR", request.META.get("REMOTE_ADDR", ""))
    # The hosting proxy sets this header. Redis stores only its SHA-256 digest.
    identity = identity.split(",", 1)[0].strip()[:128]
    return Response(services.geocode(serializer.validated_data["q"], identity=identity))


@api_view(["POST"])
@_errors
def plan_trip(request):
    serializer = TripPlanSerializer(data=request.data)
    if not serializer.is_valid():
        return _validation(serializer)
    return Response(services.plan_trip(serializer.validated_data))


@api_view(["GET"])
@_errors
def corridor(request, trip_id):
    return Response(services.corridor_for_trip(trip_id))
