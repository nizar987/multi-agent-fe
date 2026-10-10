"""
Error mapping: gRPC StatusCode → HTTP status code.
Used by every router to convert gRPC exceptions to consistent JSON responses.
"""
import grpc
from fastapi import HTTPException


_GRPC_TO_HTTP: dict[grpc.StatusCode, int] = {
    grpc.StatusCode.OK:                  200,
    grpc.StatusCode.NOT_FOUND:           404,
    grpc.StatusCode.INVALID_ARGUMENT:    400,
    grpc.StatusCode.ALREADY_EXISTS:      409,
    grpc.StatusCode.PERMISSION_DENIED:   403,
    grpc.StatusCode.UNAUTHENTICATED:     401,
    grpc.StatusCode.RESOURCE_EXHAUSTED:  429,
    grpc.StatusCode.UNIMPLEMENTED:       501,
    grpc.StatusCode.UNAVAILABLE:         503,
    grpc.StatusCode.DEADLINE_EXCEEDED:   504,
    grpc.StatusCode.INTERNAL:            500,
}


def grpc_error_to_http(exc: grpc.aio.AioRpcError) -> HTTPException:
    http_status = _GRPC_TO_HTTP.get(exc.code(), 500)
    # Never expose internal gRPC details to clients in production —
    # use the gRPC message only for non-5xx errors (user-facing).
    if http_status < 500:
        detail = exc.details() or "request_error"
    else:
        detail = "internal_error"
    return HTTPException(status_code=http_status, detail=detail)
