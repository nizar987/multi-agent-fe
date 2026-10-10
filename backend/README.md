# Agent Platform — Python Backend

Folder ini berisi backend Python (Fase 0 + Fase 1 dari PRD-backend-migration.md).

## Arsitektur

```
backend/
├── proto/agentplatform/v1/   ← .proto files (source of truth)
├── core/                     ← gRPC service (Python)
│   ├── app/                  ← settings, logging
│   ├── db/                   ← SQLAlchemy models, Alembic migrations
│   ├── domain/               ← repository per domain
│   ├── services/             ← gRPC servicer per domain
│   └── server.py             ← entry point
├── gateway/                  ← FastAPI REST gateway
│   └── app/
│       ├── routers/          ← REST endpoints → gRPC calls
│       ├── middleware/       ← auth (Bearer token)
│       ├── main.py           ← FastAPI app
│       └── grpc_client.py    ← shared gRPC channel
├── migration/                ← SQLite → PostgreSQL data migration script
├── tests/
│   ├── unit/                 ← repository unit tests (in-memory SQLite)
│   └── parity/               ← response shape comparison vs legacy backend
├── docker-compose.yml
├── .env.example
├── Makefile
└── codegen.py                ← generates gRPC stubs from .proto files
```

## Quick Start

### 1. Setup environment

```bash
cp .env.example .env
# Edit .env: set GATEWAY_SECRET to a strong random value
```

### 2. Generate gRPC stubs

```bash
pip install grpcio-tools==1.64.1
python codegen.py
```

### 3. Start with docker-compose

```bash
make up
# or: docker compose up --build
```

### 4. Verify health

```bash
make health
# or: curl -H "Authorization: Bearer changeme-dev-secret" http://localhost:8000/health
```

### 5. Run unit tests

```bash
# Install test deps
pip install pytest pytest-asyncio aiosqlite sqlalchemy

# Run from backend/
cd core && pip install -e ".[dev]"
make test
```

## API Endpoints

All endpoints (except `/health`) require `Authorization: Bearer <GATEWAY_SECRET>`.

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Health check (public) |
| GET | `/api/agents` | List agents |
| POST | `/api/agents` | Create agent |
| GET | `/api/agents/{id}` | Get agent |
| PUT | `/api/agents/{id}` | Update agent |
| DELETE | `/api/agents/{id}` | Delete agent |
| GET | `/api/skills` | List skills |
| POST | `/api/skills` | Create skill |
| GET | `/api/skills/{id}` | Get skill |
| PUT | `/api/skills/{id}` | Update skill |
| DELETE | `/api/skills/{id}` | Delete skill |
| GET | `/api/knowledge` | List knowledge |
| POST | `/api/knowledge` | Create knowledge item |
| GET | `/api/knowledge/{id}` | Get knowledge item |
| DELETE | `/api/knowledge/{id}` | Delete knowledge item |
| GET | `/api/logs?n=200` | Get log lines |
| DELETE | `/api/logs` | Clear logs |
| GET | `/api/settings` | Get config |
| PUT | `/api/settings` | Update config |

Response format:
```json
{ "ok": true, "data": {}, "error": null, "meta": {} }
```

## Parity Tests

Requires both legacy (port 3210) and gateway (port 8000) running:

```bash
GATEWAY_SECRET=changeme-dev-secret pytest tests/parity -v
```

## Data Migration (SQLite → PostgreSQL)

```bash
# Dry run first
python migration/migrate_sqlite_to_postgres.py \
    --sqlite /path/to/data/app.db \
    --pg-url postgresql://agentplatform:changeme@localhost:5432/agentplatform \
    --dry-run

# Actual migration (backs up SQLite first)
python migration/migrate_sqlite_to_postgres.py \
    --sqlite /path/to/data/app.db \
    --pg-url postgresql://agentplatform:changeme@localhost:5432/agentplatform
```

## Alembic Migrations

```bash
cd core
alembic upgrade head      # run pending migrations
alembic history           # show history
alembic downgrade -1      # roll back one step
```
