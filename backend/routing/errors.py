"""Public, credential-free failures shared by the API and upstream adapters."""

import time


class RoutingError(Exception):
    def __init__(self, code, message, status=503, *, fields=None, retry_after=None):
        super().__init__(message)
        self.code = code
        self.message = message
        self.status = status
        self.fields = fields
        self.retry_after = retry_after

    def payload(self):
        error = {"code": self.code, "message": self.message}
        if self.fields:
            error["fields"] = self.fields
        if self.retry_after is not None:
            error["retry_after"] = self.retry_after
        return {"error": error}


class Deadline:
    """One monotonic budget shared by cache, routing, and weather operations."""

    def __init__(self, seconds=60):
        self.end = time.monotonic() + seconds

    def remaining(self):
        remaining = self.end - time.monotonic()
        if remaining <= 0:
            raise RoutingError(
                "DEADLINE_EXCEEDED", "The analysis took too long. Please try again.", 504
            )
        return remaining
