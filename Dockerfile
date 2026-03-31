FROM python:3.14-alpine

LABEL org.opencontainers.image.source="https://github.com/andreuinyu/periodt"
LABEL org.opencontainers.image.description="Periodt"
# TODO: LABEL org.opencontainers.image.license=""

WORKDIR /app

# Install Python deps
COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy backend
COPY backend/main.py .
COPY backend/notifications.py .

# Copy frontend
COPY frontend /app/frontend

# Data directory
RUN mkdir -p /data

EXPOSE 8000

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
