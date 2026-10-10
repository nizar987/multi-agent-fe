"""
Parity test suite — compares responses between:
  - Legacy backend (Next.js, default http://localhost:3210)
  - New gateway    (FastAPI,   default http://localhost:8000)

Run:
    GATEWAY_SECRET=changeme-dev-secret pytest tests/parity -v

Environment variables:
    LEGACY_BASE_URL   — legacy backend base URL  (default http://localhost:3210)
    GATEWAY_BASE_URL  — new gateway base URL      (default http://localhost:8000)
    GATEWAY_SECRET    — Bearer token for new gateway
"""
import os
import pytest
import httpx

LEGACY_BASE  = os.environ.get("LEGACY_BASE_URL",  "http://localhost:3210")
GATEWAY_BASE = os.environ.get("GATEWAY_BASE_URL",  "http://localhost:8000")
SECRET       = os.environ.get("GATEWAY_SECRET",    "changeme-dev-secret")

GATEWAY_HEADERS = {"Authorization": f"Bearer {SECRET}"}


# ── helpers ───────────────────────────────────────────────────────────────────

def _required_fields_present(item: dict, fields: list[str]) -> None:
    """Assert that every expected field exists in item (not value equality)."""
    for f in fields:
        assert f in item, f"Field '{f}' missing from response item: {item.keys()}"


# ── agents ────────────────────────────────────────────────────────────────────

class TestAgentsParity:
    AGENT_FIELDS = [
        "id", "name", "description", "system_prompt",
        "tools", "skill_ids", "avatar", "color",
    ]

    def test_list_agents_schema(self):
        legacy  = httpx.get(f"{LEGACY_BASE}/api/agents",  timeout=10)
        gateway = httpx.get(f"{GATEWAY_BASE}/api/agents", timeout=10,
                            headers=GATEWAY_HEADERS)

        assert legacy.status_code  == 200, f"Legacy: {legacy.text}"
        assert gateway.status_code == 200, f"Gateway: {gateway.text}"

        legacy_data  = legacy.json()
        gateway_body = gateway.json()

        # Legacy returns a plain array; gateway returns {ok, data, meta}
        legacy_items  = legacy_data  if isinstance(legacy_data, list) else legacy_data.get("data", [])
        gateway_items = gateway_body["data"] if gateway_body.get("ok") else []

        assert gateway_body["ok"] is True
        assert len(gateway_items) == len(legacy_items), (
            f"Count mismatch: legacy={len(legacy_items)}, gateway={len(gateway_items)}"
        )

        for item in gateway_items:
            _required_fields_present(item, self.AGENT_FIELDS)

    def test_get_agent_404(self):
        legacy  = httpx.get(f"{LEGACY_BASE}/api/agents/999999",  timeout=10)
        gateway = httpx.get(f"{GATEWAY_BASE}/api/agents/999999", timeout=10,
                            headers=GATEWAY_HEADERS)
        # Both should return non-200 for unknown ID
        assert legacy.status_code  in (404, 400, 500)
        assert gateway.status_code == 404


# ── skills ────────────────────────────────────────────────────────────────────

class TestSkillsParity:
    SKILL_FIELDS = ["id", "name", "description", "content"]

    def test_list_skills_schema(self):
        legacy  = httpx.get(f"{LEGACY_BASE}/api/skills",  timeout=10)
        gateway = httpx.get(f"{GATEWAY_BASE}/api/skills", timeout=10,
                            headers=GATEWAY_HEADERS)

        assert legacy.status_code  == 200
        assert gateway.status_code == 200

        legacy_data   = legacy.json()
        gateway_body  = gateway.json()

        legacy_items  = legacy_data  if isinstance(legacy_data, list) else legacy_data.get("data", [])
        gateway_items = gateway_body["data"] if gateway_body.get("ok") else []

        assert len(gateway_items) == len(legacy_items)
        for item in gateway_items:
            _required_fields_present(item, self.SKILL_FIELDS)


# ── knowledge ─────────────────────────────────────────────────────────────────

class TestKnowledgeParity:
    KNOWLEDGE_FIELDS = ["id", "title", "content"]

    def test_list_knowledge_schema(self):
        legacy  = httpx.get(f"{LEGACY_BASE}/api/knowledge",  timeout=10)
        gateway = httpx.get(f"{GATEWAY_BASE}/api/knowledge", timeout=10,
                            headers=GATEWAY_HEADERS)

        assert legacy.status_code  == 200
        assert gateway.status_code == 200

        legacy_data   = legacy.json()
        gateway_body  = gateway.json()

        legacy_items  = legacy_data  if isinstance(legacy_data, list) else legacy_data.get("data", [])
        gateway_items = gateway_body["data"] if gateway_body.get("ok") else []

        assert len(gateway_items) == len(legacy_items)
        for item in gateway_items:
            _required_fields_present(item, self.KNOWLEDGE_FIELDS)


# ── logs ──────────────────────────────────────────────────────────────────────

class TestLogsParity:
    def test_list_logs_returns_lines(self):
        gateway = httpx.get(f"{GATEWAY_BASE}/api/logs?n=10", timeout=10,
                            headers=GATEWAY_HEADERS)
        assert gateway.status_code == 200
        body = gateway.json()
        assert body["ok"] is True
        assert "lines" in body["data"]
        assert isinstance(body["data"]["lines"], list)


# ── settings ──────────────────────────────────────────────────────────────────

class TestSettingsParity:
    CONFIG_KEYS = ["ai", "gitlab", "filesystem", "context", "ui"]

    def test_get_settings_schema(self):
        gateway = httpx.get(f"{GATEWAY_BASE}/api/settings", timeout=10,
                            headers=GATEWAY_HEADERS)
        assert gateway.status_code == 200
        body = gateway.json()
        assert body["ok"] is True
        cfg = body["data"]["config"]
        for key in self.CONFIG_KEYS:
            assert key in cfg, f"Config key '{key}' missing"

    def test_get_settings_ai_fields(self):
        gateway = httpx.get(f"{GATEWAY_BASE}/api/settings", timeout=10,
                            headers=GATEWAY_HEADERS)
        body = gateway.json()
        ai = body["data"]["config"]["ai"]
        for field in ["baseUrl", "model", "provider"]:
            assert field in ai, f"AI config field '{field}' missing"


# ── health ────────────────────────────────────────────────────────────────────

class TestHealth:
    def test_health_public(self):
        resp = httpx.get(f"{GATEWAY_BASE}/health", timeout=10)
        assert resp.status_code == 200
        body = resp.json()
        assert body["ok"] is True
        assert "gateway" in body["data"]

    def test_auth_required(self):
        resp = httpx.get(f"{GATEWAY_BASE}/api/agents", timeout=10)
        assert resp.status_code == 401
