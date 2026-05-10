# ---------- builder ----------
FROM python:3.14-alpine AS builder

WORKDIR /app

# Install deps with uv (fast pip)
COPY backend/requirements.txt .
COPY --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/uv
RUN apk add --no-cache tzdata && uv pip install --system --no-cache -r requirements.txt


# ---------- final ----------
FROM python:3.14-alpine

## Inject version from build args
ARG APP_VERSION=dev
ENV APP_VERSION=${APP_VERSION}

LABEL org.opencontainers.image.source="https://github.com/andreuinyu/periodt" \
      org.opencontainers.image.title="Periodt" \
      org.opencontainers.image.description="Self-hosted period tracking." \
      org.opencontainers.image.license="CC-BY-NC-4.0" \
      org.opencontainers.image.version="${APP_VERSION}"

RUN apk add --no-cache tzdata

WORKDIR /app

# Copy installed packages from builder
COPY --from=builder /usr/local/lib/python3.14/site-packages /usr/local/lib/python3.14/site-packages
COPY --from=builder /usr/local/bin /usr/local/bin

# Copy backend
COPY backend/main.py .
COPY backend/notifications.py .
COPY backend/log_config.json .

# Copy frontend
COPY frontend /app/frontend

# Inject version into service worker
RUN sed -i "s/__APP_VERSION__/${APP_VERSION}/g" /app/frontend/sw.js

# Runtime config
RUN mkdir -p /data
ENV PYTHONUNBUFFERED=1
ENV TZ=UTC

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8000/health || exit 1

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000", "--log-config", "log_config.json"]