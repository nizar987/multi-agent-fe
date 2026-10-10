"""Settings router — maps to SettingsService gRPC."""
from typing import Optional
import grpc
from fastapi import APIRouter
from pydantic import BaseModel

from app.grpc_client import get_channel
from app.errors import grpc_error_to_http
from generated.agentplatform.v1 import settings_pb2, settings_pb2_grpc

router = APIRouter(prefix="/api/settings", tags=["settings"])


class AiConfigIn(BaseModel):
    base_url:     Optional[str] = None
    model:        Optional[str] = None
    provider:     Optional[str] = None
    vision_model: Optional[str] = None


class GitlabConfigIn(BaseModel):
    api_url: Optional[str] = None


class FilesystemConfigIn(BaseModel):
    allowed_dirs: Optional[list[str]] = None


class ContextConfigIn(BaseModel):
    limit_enabled: Optional[bool] = None
    max_tokens:    Optional[int]  = None


class UiConfigIn(BaseModel):
    theme: Optional[str] = None


class UpdateConfigIn(BaseModel):
    ai:              Optional[AiConfigIn]         = None
    gitlab:          Optional[GitlabConfigIn]     = None
    filesystem:      Optional[FilesystemConfigIn] = None
    context:         Optional[ContextConfigIn]    = None
    ui:              Optional[UiConfigIn]         = None
    onboarding_done: Optional[bool]               = None


def _config_to_dict(cfg: settings_pb2.ConfigResponse) -> dict:
    return {
        "ai": {
            "baseUrl":     cfg.ai.base_url,
            "model":       cfg.ai.model,
            "provider":    cfg.ai.provider,
            "visionModel": cfg.ai.vision_model,
        },
        "gitlab": {"apiUrl": cfg.gitlab.api_url},
        "filesystem": {"allowedDirs": list(cfg.filesystem.allowed_dirs)},
        "context": {
            "limitEnabled": cfg.context.limit_enabled,
            "maxTokens":    cfg.context.max_tokens,
        },
        "ui": {"theme": cfg.ui.theme},
        "onboardingDone": cfg.onboarding_done,
    }


@router.get("")
async def get_settings():
    stub = settings_pb2_grpc.SettingsServiceStub(get_channel())
    try:
        cfg = await stub.GetConfig(settings_pb2.GetConfigRequest())
        meta = await stub.GetSecretMeta(settings_pb2.GetSecretMetaRequest())
    except grpc.aio.AioRpcError as e:
        raise grpc_error_to_http(e)
    return {
        "ok": True,
        "data": {
            "config": _config_to_dict(cfg),
            "secrets": {
                s.name: {"set": s.is_set, "tail": s.tail}
                for s in meta.secrets
            },
            "secretBackend": {
                "label":  meta.backend_label,
                "secure": meta.backend_secure,
            },
        },
        "error": None,
    }


@router.put("")
async def update_settings(body: UpdateConfigIn):
    stub = settings_pb2_grpc.SettingsServiceStub(get_channel())

    req = settings_pb2.UpdateConfigRequest()

    if body.ai:
        req.ai.CopyFrom(settings_pb2.AiConfig(
            base_url     = body.ai.base_url     or "",
            model        = body.ai.model        or "",
            provider     = body.ai.provider     or "",
            vision_model = body.ai.vision_model or "",
        ))
    if body.gitlab:
        req.gitlab.CopyFrom(settings_pb2.GitlabConfig(
            api_url = body.gitlab.api_url or "",
        ))
    if body.filesystem:
        req.filesystem.CopyFrom(settings_pb2.FilesystemConfig(
            allowed_dirs = body.filesystem.allowed_dirs or [],
        ))
    if body.context:
        req.context.CopyFrom(settings_pb2.ContextConfig(
            limit_enabled = body.context.limit_enabled or False,
            max_tokens    = body.context.max_tokens    or 100000,
        ))
    if body.ui:
        req.ui.CopyFrom(settings_pb2.UiConfig(
            theme = body.ui.theme or "system",
        ))
    if body.onboarding_done is not None:
        req.onboarding_done = body.onboarding_done

    try:
        cfg = await stub.UpdateConfig(req)
    except grpc.aio.AioRpcError as e:
        raise grpc_error_to_http(e)

    return {"ok": True, "data": {"config": _config_to_dict(cfg)}, "error": None}
