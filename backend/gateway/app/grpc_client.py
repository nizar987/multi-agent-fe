"""
gRPC channel factory — one shared channel per process.
Uses insecure channel for internal communication (gateway↔core on same network).
TLS termination is handled at the edge (load balancer / reverse proxy).
"""
import grpc
from app.settings import settings

_channel: grpc.aio.Channel | None = None


def get_channel() -> grpc.aio.Channel:
    global _channel
    if _channel is None:
        _channel = grpc.aio.insecure_channel(
            settings.core_address,
            options=[
                ("grpc.max_send_message_length",    50 * 1024 * 1024),
                ("grpc.max_receive_message_length",  50 * 1024 * 1024),
                ("grpc.keepalive_time_ms",           30_000),
                ("grpc.keepalive_timeout_ms",        10_000),
                ("grpc.keepalive_permit_without_calls", 1),
            ],
        )
    return _channel


async def close_channel() -> None:
    global _channel
    if _channel is not None:
        await _channel.close()
        _channel = None
