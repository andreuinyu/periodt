FROM python:3.14-alpine

LABEL org.opencontainers.image.source="https://github.com/andreuinyu/periodt"
LABEL org.opencontainers.image.title="Periodt"
LABEL org.opencontainers.image.description="Self-hosted period tracking."
LABEL org.opencontainers.image.license="CC-BY-NC-4.0"

RUN apk update && apk upgrade --no-cache
RUN apk add --no-cache tzdata

WORKDIR /app

# Install Python deps
COPY backend/requirements.txt .
RUN pip install --upgrade pip
RUN pip install --no-cache-dir -r requirements.txt

# Copy backend
COPY backend/main.py .
COPY backend/notifications.py .

# Copy frontend
COPY frontend /app/frontend

## Inject version from build args
ARG APP_VERSION=dev
ENV APP_VERSION=${APP_VERSION}
# Into service worker for cache busting
RUN sed -i "s/__APP_VERSION__/${APP_VERSION}/g" /app/frontend/sw.js

# Data directory
RUN mkdir -p /data
ENV PYTHONUNBUFFERED=1
ENV TZ=UTC

EXPOSE 8000

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
