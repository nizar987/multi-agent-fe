.PHONY: help codegen migrate-init migrate migrate-down up down logs test parity fmt lint

# ── vars ─────────────────────────────────────────────────────────────────────
PYTHON     ?= python3
PIP        ?= pip
DC         ?= docker compose
ALEMBIC    ?= alembic

help:          ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?##' $(MAKEFILE_LIST) | awk 'BEGIN{FS=":.*?##"}{printf "  %-22s %s\n",$$1,$$2}'

# ── codegen ──────────────────────────────────────────────────────────────────
codegen:       ## Generate gRPC stubs from .proto files
	@echo "Installing grpcio-tools if needed..."
	$(PIP) install grpcio-tools==1.64.1 -q
	$(PYTHON) codegen.py

# ── docker-compose ────────────────────────────────────────────────────────────
up:            ## Start all services (postgres + core + gateway)
	$(DC) up --build -d

down:          ## Stop and remove containers
	$(DC) down

logs:          ## Tail all service logs
	$(DC) logs -f

ps:            ## Show container status
	$(DC) ps

# ── database migrations (run from core/) ─────────────────────────────────────
migrate-init:  ## Init alembic (first time only)
	cd core && $(ALEMBIC) init db/alembic

migrate:       ## Run pending alembic migrations
	cd core && $(ALEMBIC) upgrade head

migrate-down:  ## Roll back last migration
	cd core && $(ALEMBIC) downgrade -1

migrate-history: ## Show migration history
	cd core && $(ALEMBIC) history

# ── tests ─────────────────────────────────────────────────────────────────────
test:          ## Run unit tests
	cd core    && $(PYTHON) -m pytest tests/unit -v
	cd gateway && $(PYTHON) -m pytest tests/unit -v

parity:        ## Run parity tests (requires both backends running)
	$(PYTHON) -m pytest tests/parity -v

# ── dev quality ───────────────────────────────────────────────────────────────
fmt:           ## Format code with ruff
	$(PYTHON) -m ruff format .

lint:          ## Lint with ruff
	$(PYTHON) -m ruff check .

# ── local dev (no docker) ─────────────────────────────────────────────────────
dev-core:      ## Run core gRPC server locally
	cd core && $(PYTHON) server.py

dev-gateway:   ## Run gateway FastAPI locally
	cd gateway && uvicorn app.main:app --reload --host 0.0.0.0 --port 8000

health:        ## Quick health check against running gateway
	curl -sf -H "Authorization: Bearer $${GATEWAY_SECRET:-changeme-dev-secret}" \
		http://localhost:8000/health | python3 -m json.tool
