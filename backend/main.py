from fastapi import FastAPI, HTTPException, Depends
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, JSONResponse
from fastapi_cache.decorator import cache
from fastapi_cache.backends.inmemory import InMemoryBackend
from fastapi_cache import FastAPICache
from pydantic import BaseModel, field_validator
from typing import Optional, List
import logging
import sqlite3
import json
import os
from datetime import date, timedelta
from pathlib import Path

from notifications import lifespan, router as push_router

app = FastAPI(title="Period Tracker API", lifespan=lifespan)
app.include_router(push_router)

@app.on_event("startup")
async def startup():
    FastAPICache.init(InMemoryBackend())


logger = logging.getLogger("uvicorn.error")

@app.exception_handler(Exception)
async def all_exception_handler(request, exc):
    logger.exception(f"Unhandled error: {exc}")
    return JSONResponse(status_code=500, content={"detail": str(exc)})

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

DB_PATH = "/data/tracker.db"
APP_VERSION = os.getenv("APP_VERSION", "dev")

def get_db():
    conn = sqlite3.connect(DB_PATH, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    try:
        yield conn
    finally:
        conn.close()

def init_db():
    Path("/data").mkdir(exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute("""
        CREATE TABLE IF NOT EXISTS cycles (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            start_date TEXT NOT NULL,
            end_date TEXT,
            flow_intensity INTEGER CHECK(flow_intensity BETWEEN 0 AND 3) DEFAULT 0,
            notes TEXT,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP
        )
    """)
    c.execute("""
        CREATE TABLE IF NOT EXISTS symptoms (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            log_date TEXT NOT NULL,
            symptoms TEXT NOT NULL, 
            mood INTEGER,
            pain_level INTEGER DEFAULT 0,
            notes TEXT
        )
    """)
    c.execute("""
        CREATE TABLE IF NOT EXISTS push_subscriptions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            subscription TEXT NOT NULL UNIQUE,
            strings TEXT,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP
        )
    """)
    conn.commit()
    conn.close()

init_db()

# ── Models ──────────────────────────────────────────────────────────────────

class CycleCreate(BaseModel):
    start_date: str
    end_date: Optional[str] = None
    flow_intensity: Optional[int] = 0
    notes: Optional[str] = None

    @field_validator("flow_intensity")
    @classmethod
    def flow_must_be_valid(cls, v):
        if v is not None and v not in (0, 1, 2, 3):
            raise ValueError("flow_intensity must be 0–3")
        return v

class CycleUpdate(BaseModel):
    end_date: Optional[str] = None
    flow_intensity: Optional[int] = 0
    notes: Optional[str] = None

    @field_validator("flow_intensity")
    @classmethod
    def flow_must_be_valid(cls, v):
        if v is not None and v not in (0, 1, 2, 3):
            raise ValueError("flow_intensity must be 0–3")
        return v

class SymptomLog(BaseModel):
    log_date: str
    symptoms: List[int]
    mood: Optional[int] = None
    pain_level: Optional[int] = 0
    notes: Optional[str] = None

    @field_validator("symptoms")
    @classmethod
    def symptoms_must_be_valid(cls, v):
        if any(idx < 0 for idx in v):
            raise ValueError("Symptom indexes must be non-negative integers")
        return v

    @field_validator("mood")
    @classmethod
    def mood_must_be_valid(cls, v):
        if v is not None and v < 0:
            raise ValueError("Mood index must be a non-negative integer")
        return v

# ── Cycles ───────────────────────────────────────────────────────────────────

@app.get("/api/cycles")
@cache(expire=60)
def get_cycles(db: sqlite3.Connection = Depends(get_db)):
    rows = db.execute("SELECT * FROM cycles ORDER BY start_date DESC").fetchall()
    return [dict(r) for r in rows]

@app.post("/api/cycles", status_code=201)
def create_cycle(cycle: CycleCreate, db: sqlite3.Connection = Depends(get_db)):
    cur = db.execute(
        "INSERT INTO cycles (start_date, end_date, flow_intensity, notes) VALUES (?,?,?,?)",
        (cycle.start_date, cycle.end_date, cycle.flow_intensity, cycle.notes)
    )
    db.commit()
    row = db.execute("SELECT * FROM cycles WHERE id=?", (cur.lastrowid,)).fetchone()
    return dict(row)

@app.patch("/api/cycles/{cycle_id}")
def update_cycle(cycle_id: int, update: CycleUpdate, db: sqlite3.Connection = Depends(get_db)):
    cycle = db.execute("SELECT * FROM cycles WHERE id=?", (cycle_id,)).fetchone()
    if not cycle:
        raise HTTPException(404, "Cycle not found")
    fields = {k: v for k, v in update.dict(exclude_unset=True).items()}
    if fields:
        sets = ", ".join(f"{k}=?" for k in fields)
        db.execute(f"UPDATE cycles SET {sets} WHERE id=?", (*fields.values(), cycle_id))
        db.commit()
    return dict(db.execute("SELECT * FROM cycles WHERE id=?", (cycle_id,)).fetchone())

@app.delete("/api/cycles/{cycle_id}", status_code=204)
def delete_cycle(cycle_id: int, db: sqlite3.Connection = Depends(get_db)):
    db.execute("DELETE FROM cycles WHERE id=?", (cycle_id,))
    db.commit()

# ── Symptoms ─────────────────────────────────────────────────────────────────

@app.get("/api/symptoms")
@cache(expire=60)
def get_symptoms(db: sqlite3.Connection = Depends(get_db)):
    rows = db.execute("SELECT * FROM symptoms ORDER BY log_date DESC").fetchall()
    result = []
    for r in rows:
        d = dict(r)
        d["symptoms"] = json.loads(d["symptoms"])  # "[0,3,5]" → [0, 3, 5]
        result.append(d)
    return result


@app.post("/api/symptoms", status_code=201)
def log_symptom(log: SymptomLog, db: sqlite3.Connection = Depends(get_db)):
    cur = db.execute(
        "INSERT INTO symptoms (log_date, symptoms, mood, pain_level, notes) VALUES (?,?,?,?,?)",
        (log.log_date, json.dumps(log.symptoms), log.mood, log.pain_level, log.notes)
    )
    db.commit()
    row = db.execute("SELECT * FROM symptoms WHERE id=?", (cur.lastrowid,)).fetchone()
    d = dict(row)
    d["symptoms"] = json.loads(d["symptoms"])
    return d

@app.delete("/api/symptoms/{log_id}", status_code=204)
def delete_symptom(log_id: int, db: sqlite3.Connection = Depends(get_db)):
    cur = db.execute("DELETE FROM symptoms WHERE id=?", (log_id,))
    db.commit()
    if cur.rowcount == 0:
        # If no row was deleted, return 404
        raise HTTPException(status_code=404, detail="Symptom log not found")
        
# ── Predictions ───────────────────────────────────────────────────────────────

@app.get("/api/predictions")
@cache(expire=60)
def get_predictions(db: sqlite3.Connection = Depends(get_db)):
    rows = db.execute(
        "SELECT start_date FROM cycles WHERE end_date IS NOT NULL ORDER BY start_date DESC LIMIT 6"
    ).fetchall()
    if len(rows) < 2:
        return {"next_period": None, "cycle_length": None, "fertile_window": None}

    starts = [date.fromisoformat(r["start_date"]) for r in rows]
    lengths = [(starts[i] - starts[i+1]).days for i in range(len(starts)-1)]
    avg_length = round(sum(lengths) / len(lengths))

    next_period = starts[0] + timedelta(days=avg_length)
    fertile_start = next_period - timedelta(days=16)
    fertile_end = next_period - timedelta(days=12)

    return {
        "next_period": next_period.isoformat(),
        "cycle_length": avg_length,
        "fertile_window": {
            "start": fertile_start.isoformat(),
            "end": fertile_end.isoformat()
        },
        "last_period": starts[0].isoformat()
    }

@app.get("/api/version")
@cache(expire=60)
def get_version():
    return {"version": APP_VERSION}

# ── Serve frontend ────────────────────────────────────────────────────────────

frontend_path = Path("/app/frontend")
if frontend_path.exists():
    app.mount("/static", StaticFiles(directory=str(frontend_path / "static")), name="static")

    @app.get("/sw.js", include_in_schema=False)
    def serve_sw():
        return FileResponse(str(frontend_path / "sw.js"))

    @app.get("/", include_in_schema=False)
    @app.get("/{path:path}", include_in_schema=False)
    def serve_frontend(path: str = ""):
        index = frontend_path / "index.html"
        if index.exists():
            return FileResponse(str(index))
        return {"message": "Frontend not found"}
