#!/usr/bin/env bash
# setup_dev.sh — one-time local dev setup
# Run from backend/ directory:
#   chmod +x setup_dev.sh && ./setup_dev.sh
set -e

PYTHON=${PYTHON:-/opt/homebrew/bin/python3.12}
VENV=".venv"

echo "→ Creating virtualenv with $PYTHON"
$PYTHON -m venv $VENV

echo "→ Upgrading pip"
$VENV/bin/pip install --upgrade pip --quiet

echo "→ Installing core deps"
$VENV/bin/pip install \
    grpcio==1.64.1 \
    grpcio-tools==1.64.1 \
    sqlalchemy[asyncio]==2.0.31 \
    asyncpg==0.29.0 \
    alembic==1.13.2 \
    pydantic==2.8.2 \
    pydantic-settings==2.3.4 \
    python-dotenv==1.0.1 \
    structlog==24.2.0 \
    fastapi==0.111.1 \
    "uvicorn[standard]==0.30.1" \
    httpx==0.27.0

echo "→ Installing test deps"
$VENV/bin/pip install \
    pytest==8.3.2 \
    pytest-asyncio==0.23.8 \
    aiosqlite \
    psycopg2-binary

echo "→ Running codegen"
$VENV/bin/python codegen.py

echo ""
echo "✓ Setup complete. To activate: source $VENV/bin/activate"
echo ""
echo "Next steps:"
echo "  1. Copy and edit env:   cp .env.example .env"
echo "  2. Start postgres:      docker compose up postgres -d"
echo "  3. Run migrations:      cd core && ../$VENV/bin/alembic upgrade head"
echo "  4. Start core:          cd core && ../$VENV/bin/python server.py"
echo "  5. Start gateway:       cd gateway && ../$VENV/bin/uvicorn app.main:app --reload"
echo "  6. Health check:        make health"
echo "  7. Unit tests:          $VENV/bin/pytest tests/unit -v"
