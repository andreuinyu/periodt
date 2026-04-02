FROM python:3.14-alpine

WORKDIR /app

COPY requirements.txt .
RUN apk update && apk upgrade --no-cache
RUN pip install --upgrade pip
RUN pip install --no-cache-dir -r requirements.txt

COPY main.py .
COPY notifications.py .

COPY ../frontend /app/frontend

RUN mkdir -p /data

EXPOSE 8000

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
