# 🌙 Periodt — Period Tracker PWA

A privacy-first, self-hosted, dead simple period tracking Progressive Web App. Data stays locally

## Stack

| Layer | Tech |
|-------|------|
| Backend | Python 3.12 + FastAPI |
| Database | SQLite (persisted via Docker volume) |
| Frontend | Vanilla JS PWA |
| Container | Docker + Docker Compose |

---

## 🚀 Quick Start
TBD - this is devmode. eventually published to registry and an example docker compose will be provided.

```bash
# 1. Clone / download this folder
cd period-tracker

# 2. Build and start
docker compose up --build

# 3. Open your browser
open http://localhost:8000
```

That's it. The app is live.

---

## PWA Features

- **Offline support** — service worker caches the app shell; API calls fall back gracefully when offline
- **Home screen install** — an install banner appears automatically in supported browsers (Chrome, Edge, Safari on iOS via "Add to Home Screen")
- **Push notifications** — tap the 🔔 button to opt in; the backend stores subscriptions in SQLite

### Installing on mobile

**Android (Chrome):** tap the install banner or browser menu → "Add to Home Screen"  
**iOS (Safari):** Share → "Add to Home Screen"

---

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/cycles` | List all cycles |
| POST | `/api/cycles` | Start a new cycle |
| PATCH | `/api/cycles/{id}` | Update cycle (e.g. set end date) |
| DELETE | `/api/cycles/{id}` | Delete a cycle |
| GET | `/api/symptoms` | List symptom logs |
| POST | `/api/symptoms` | Log symptoms |
| GET | `/api/predictions` | Get next period prediction |
| POST | `/api/push/subscribe` | Register push subscription |

Interactive API docs: http://localhost:3111/docs

---

## Data Persistence

SQLite database is stored in a named Docker volume (`periodt_data`). To back up:

```bash
docker run --rm -v periodt_data:/data -v $(pwd):/backup alpine \
  cp /data/tracker.db /backup/tracker_backup.db
```

Or, instead of using a docker volume in the [docker-compose.yml](docker-compose.yml) `periodt_data:/data`, use a real path of your choosing `/path/to/your/periodt_data:/data`

---

## Configuration

Edit `docker-compose.yml` to change the port:

```yaml
  ports:
    - "3111:8000"   # expose on port 3111
```

## Development (without Docker)

```bash
cd backend
pip install -r requirements.txt

# Copy frontend into place (backend serves it)
cp -r ../frontend /tmp/periodt_frontend

# Run
DATA_DIR=/tmp uvicorn main:app --reload
```

---

## Project Structure

```
period-tracker/
├── Dockerfile
├── docker-compose.yml
├── README.md
├── backend/
│   ├── main.py          # FastAPI app
│   └── requirements.txt
└── frontend/
    ├── index.html       # PWA shell
    └── static/
        ├── manifest.json
        ├── scripts.js
        ├── styles.css
        ├── translations/LANGUAGE.json
        ├── sw.js        # Service worker
        └── icons/
            ├── icon-192.png
            └── icon-512.png
```
