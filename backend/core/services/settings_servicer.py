"""
Settings servicer — reads/writes non-secret config from app_meta table.
Secrets are never returned as plaintext — only metadata (is_set, tail).
"""
import json
import grpc
import structlog

from generated.agentplatform.v1 import settings_pb2, settings_pb2_grpc
from db.session import AsyncSessionLocal
from domain.settings.repository import SettingsRepository

log = structlog.get_logger(__name__)


def _build_config_response(data: dict) -> settings_pb2.ConfigResponse:
    return settings_pb2.ConfigResponse(
        ai=settings_pb2.AiConfig(
            base_url     = data.get("ai.baseUrl",     "https://api.anthropic.com"),
            model        = data.get("ai.model",        "claude-sonnet-5"),
            provider     = data.get("ai.provider",     "auto"),
            vision_model = data.get("ai.visionModel",  ""),
        ),
        gitlab=settings_pb2.GitlabConfig(
            api_url = data.get("gitlab.apiUrl", "https://gitlab.com/api/v4"),
        ),
        filesystem=settings_pb2.FilesystemConfig(
            allowed_dirs = json.loads(data.get("filesystem.allowedDirs", "[]")),
        ),
        context=settings_pb2.ContextConfig(
            limit_enabled = data.get("context.limitEnabled", "false").lower() == "true",
            max_tokens    = int(data.get("context.maxTokens", "100000")),
        ),
        ui=settings_pb2.UiConfig(
            theme = data.get("ui.theme", "system"),
        ),
        onboarding_done = data.get("onboardingDone", "false").lower() == "true",
    )


class SettingsServicer(settings_pb2_grpc.SettingsServiceServicer):

    async def GetConfig(
        self,
        request: settings_pb2.GetConfigRequest,
        context: grpc.aio.ServicerContext,
    ) -> settings_pb2.ConfigResponse:
        async with AsyncSessionLocal() as session:
            data = await SettingsRepository(session).get_all()
        return _build_config_response(data)

    async def UpdateConfig(
        self,
        request: settings_pb2.UpdateConfigRequest,
        context: grpc.aio.ServicerContext,
    ) -> settings_pb2.ConfigResponse:
        async with AsyncSessionLocal() as session:
            repo = SettingsRepository(session)
            updates: dict[str, str] = {}

            if request.HasField("ai"):
                if request.ai.base_url:     updates["ai.baseUrl"]     = request.ai.base_url
                if request.ai.model:         updates["ai.model"]       = request.ai.model
                if request.ai.provider:      updates["ai.provider"]    = request.ai.provider
                if request.ai.vision_model is not None:
                    updates["ai.visionModel"] = request.ai.vision_model

            if request.HasField("gitlab"):
                if request.gitlab.api_url:
                    updates["gitlab.apiUrl"] = request.gitlab.api_url

            if request.HasField("filesystem"):
                updates["filesystem.allowedDirs"] = json.dumps(
                    list(request.filesystem.allowed_dirs)
                )

            if request.HasField("context"):
                updates["context.limitEnabled"] = str(request.context.limit_enabled).lower()
                updates["context.maxTokens"]    = str(request.context.max_tokens)

            if request.HasField("ui"):
                if request.ui.theme:
                    updates["ui.theme"] = request.ui.theme

            if request.onboarding_done:
                updates["onboardingDone"] = "true"

            for k, v in updates.items():
                await repo.set(k, v)

            data = await repo.get_all()

        log.info("settings_updated", keys=list(updates.keys()))
        return _build_config_response(data)

    async def GetSecretMeta(
        self,
        request: settings_pb2.GetSecretMetaRequest,
        context: grpc.aio.ServicerContext,
    ) -> settings_pb2.SecretMetaResponse:
        # Secrets are managed by the config service (Electron safeStorage / secrets.json).
        # The core service does not hold secrets — return placeholder metadata only.
        # In a full remote deployment, secrets would be stored encrypted in DB;
        # that migration is tracked in PRD §10 (Fase 4).
        return settings_pb2.SecretMetaResponse(
            secrets=[],
            backend_label="remote_core",
            backend_secure=True,
        )
