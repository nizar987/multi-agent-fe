"""Logs router — maps to LogService gRPC."""
import grpc
from fastapi import APIRouter, Query

from app.grpc_client import get_channel
from app.errors import grpc_error_to_http
from generated.agentplatform.v1 import log_pb2, log_pb2_grpc

router = APIRouter(prefix="/api/logs", tags=["logs"])


@router.get("")
async def list_logs(n: int = Query(200, ge=1, le=1000)):
    stub = log_pb2_grpc.LogServiceStub(get_channel())
    try:
        resp = await stub.ListLogs(log_pb2.ListLogsRequest(n=n))
    except grpc.aio.AioRpcError as e:
        raise grpc_error_to_http(e)
    return {"ok": True, "data": {"lines": list(resp.lines)}, "error": None}


@router.delete("")
async def clear_logs():
    stub = log_pb2_grpc.LogServiceStub(get_channel())
    try:
        await stub.ClearLogs(log_pb2.ClearLogsRequest())
    except grpc.aio.AioRpcError as e:
        raise grpc_error_to_http(e)
    return {"ok": True, "data": None, "error": None}
