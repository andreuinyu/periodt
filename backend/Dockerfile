FROM python:3.14-alpine
COPY --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/uv

WORKDIR /app

COPY requirements.txt .
RUN apk upgrade --no-cache && uv pip install --system --no-cache -r requirements.txt

COPY main.py .
COPY notifications.py .

COPY ../frontend /app/frontend

RUN mkdir -p /data

EXPOSE 8000

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
