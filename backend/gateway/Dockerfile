FROM python:3.12-slim

WORKDIR /app

# Install Python dependencies
COPY pyproject.toml .
RUN pip install --no-cache-dir \
        fastapi==0.111.1 \
        "uvicorn[standard]==0.30.1" \
        grpcio==1.64.1 \
        grpcio-tools==1.64.1 \
        pydantic==2.8.2 \
        pydantic-settings==2.3.4 \
        python-dotenv==1.0.1 \
        structlog==24.2.0 \
        httpx==0.27.0

# Copy proto sources and generate stubs into app/generated/
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
COPY app/ ./app/

EXPOSE 8000

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--log-config", "/dev/null"]
