FROM python:3.12-slim

WORKDIR /app

# Install dependencies
COPY pyproject.toml .
RUN pip install --no-cache-dir hatchling && \
    pip install --no-cache-dir \
        grpcio==1.64.1 \
        grpcio-tools==1.64.1 \
        sqlalchemy[asyncio]==2.0.31 \
        asyncpg==0.29.0 \
        alembic==1.13.2 \
        pydantic==2.8.2 \
        pydantic-settings==2.3.4 \
        python-dotenv==1.0.1 \
        structlog==24.2.0

# Copy proto sources and generate stubs
COPY ../proto /proto
RUN python -m grpc_tools.protoc \
        -I/proto \
        --python_out=/app/generated \
        --grpc_python_out=/app/generated \
        agentplatform/v1/common.proto \
        agentplatform/v1/health.proto \
        agentplatform/v1/agent.proto \
        agentplatform/v1/skill.proto \
        agentplatform/v1/knowledge.proto \
        agentplatform/v1/log.proto \
        agentplatform/v1/settings.proto && \
    find /app/generated -type d -exec touch {}/__init__.py \;

# Copy application code
COPY . .

# Run Alembic migrations then start server
CMD ["sh", "-c", "alembic upgrade head && python server.py"]
