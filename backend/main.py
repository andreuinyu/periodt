from fastapi import FastAPI, HTTPException, Depends
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from pydantic import BaseModel
from typing import Optional, List
import sqlite3
import json
from datetime import date, datetime, timedelta
from pathlib import Path
import os

app = FastAPI(title="Period Tracker API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

DB_PATH = "/data/tracker.db"

def get_db():
    conn = sqlite3.connect(DB_PATH)
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
            flow_intensity TEXT DEFAULT 'medium',
            notes TEXT,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP
        )
    """)
    c.execute("""
        CREATE TABLE IF NOT EXISTS symptoms (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            log_date TEXT NOT NULL,
            symptoms TEXT NOT NULL,
            mood TEXT,
            pain_level INTEGER DEFAULT 0,
            notes TEXT
        )
    """)
    c.execute("""
        CREATE TABLE IF NOT EXISTS push_subscriptions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            subscription TEXT NOT NULL UNIQUE,
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
    flow_intensity: Optional[str] = "medium"
    notes: Optional[str] = None

class CycleUpdate(BaseModel):
    end_date: Optional[str] = None
    flow_intensity: Optional[str] = None
    notes: Optional[str] = None

class SymptomLog(BaseModel):
    log_date: str
    symptoms: List[str]
    mood: Optional[str] = None
    pain_level: Optional[int] = 0
    notes: Optional[str] = None

class PushSubscription(BaseModel):
    subscription: dict

# ── Cycles ───────────────────────────────────────────────────────────────────

@app.get("/api/cycles")
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
    fields = {k: v for k, v in update.dict().items() if v is not None}
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
def get_symptoms(db: sqlite3.Connection = Depends(get_db)):
    rows = db.execute("SELECT * FROM symptoms ORDER BY log_date DESC").fetchall()
    result = []
    for r in rows:
        d = dict(r)
        d["symptoms"] = json.loads(d["symptoms"])
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

# ── Predictions ───────────────────────────────────────────────────────────────

@app.get("/api/predictions")
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

# ── Push Notifications ────────────────────────────────────────────────────────

@app.post("/api/push/subscribe", status_code=201)
def subscribe_push(sub: PushSubscription, db: sqlite3.Connection = Depends(get_db)):
    sub_json = json.dumps(sub.subscription)
    try:
        db.execute("INSERT OR REPLACE INTO push_subscriptions (subscription) VALUES (?)", (sub_json,))
        db.commit()
    except Exception:
        pass
    return {"status": "subscribed"}

# ── Serve frontend ────────────────────────────────────────────────────────────

frontend_path = Path("/app/frontend")
if frontend_path.exists():
    app.mount("/static", StaticFiles(directory=str(frontend_path / "static")), name="static")

    @app.get("/", include_in_schema=False)
    @app.get("/{path:path}", include_in_schema=False)
    def serve_frontend(path: str = ""):
        index = frontend_path / "index.html"
        if index.exists():
            return FileResponse(str(index))
        return {"message": "Frontend not found"}
