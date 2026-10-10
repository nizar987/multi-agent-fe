"""
Settings repository — reads/writes app_meta key-value rows.
Non-secret config only. Secrets never leave the core service.
"""
from typing import Optional
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from db.models import AppMeta

# Default config values — mirror of lib/config.ts DEFAULTS
_DEFAULTS: dict = {
    "ai.baseUrl":            "https://api.anthropic.com",
    "ai.model":              "claude-sonnet-5",
    "ai.provider":           "auto",
    "ai.visionModel":        "",
    "gitlab.apiUrl":         "https://gitlab.com/api/v4",
    "filesystem.allowedDirs": "[]",
    "context.limitEnabled":  "false",
    "context.maxTokens":     "100000",
    "ui.theme":              "system",
    "onboardingDone":        "false",
}


class SettingsRepository:
    def __init__(self, session: AsyncSession) -> None:
        self._s = session

    async def get(self, key: str) -> Optional[str]:
        row = await self._s.execute(select(AppMeta).where(AppMeta.key == key))
        meta = row.scalar_one_or_none()
        if meta is None:
            return _DEFAULTS.get(key)
        return meta.value

    async def set(self, key: str, value: str) -> None:
        await self._s.execute(
            text(
                "INSERT INTO app_meta(key, value) VALUES(:k, :v) "
                "ON CONFLICT(key) DO UPDATE SET value = excluded.value"
            ),
            {"k": key, "v": value},
        )
        await self._s.commit()

    async def get_all(self) -> dict[str, str]:
        rows = await self._s.execute(select(AppMeta))
        stored = {r.key: r.value for r in rows.scalars().all()}
        return {**_DEFAULTS, **stored}
