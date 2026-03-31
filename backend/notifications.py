from fastapi import Request
from pywebpush import webpush, WebPushException
from py_vapid import Vapid
from cryptography.hazmat.primitives.serialization import Encoding, PublicFormat
from apscheduler.schedulers.background import BackgroundScheduler
from contextlib import asynccontextmanager
from datetime import date, timedelta
from fastapi_cache import FastAPICache
from fastapi_cache.decorator import cache
from fastapi_cache.backends.inmemory import InMemoryBackend
import sqlite3
import base64
import json
import logging
import os

logger = logging.getLogger("uvicorn.error")

VAPID_CLAIMS = {"sub": "mailto:app@localhost"}
DB_PATH = "/data/tracker.db"
NOTIFY_DAYS_BEFORE = int(os.getenv("NOTIFY_DAYS_BEFORE", 3))  # Max days in advance to send notifications
logger.info(f"Notification range set to {NOTIFY_DAYS_BEFORE} days before predicted period")
NOTIFY_HOUR = int(os.getenv("NOTIFY_HOUR", 9))  # Hour of day to run the notification job
logger.info(f"Notification job scheduled to run at {NOTIFY_HOUR}:00 daily")
scheduler = BackgroundScheduler()


# ── DB helpers ────────────────────────────────────────────────────────────────

def get_db_conn() -> sqlite3.Connection:
    con = sqlite3.connect(DB_PATH)
    con.row_factory = sqlite3.Row
    return con


def ensure_config_table(db: sqlite3.Connection):
    db.execute("""
        CREATE TABLE IF NOT EXISTS config (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        )
    """)
    db.commit()


# ── VAPID key management ──────────────────────────────────────────────────────

def get_or_create_vapid_keys(db: sqlite3.Connection) -> tuple[str, str]:
    ensure_config_table(db)
    row = db.execute("SELECT value FROM config WHERE key='vapid_keys'").fetchone()
    if row:
        keys = json.loads(row["value"])
        return keys["private"], keys["public"]

    vapid = Vapid()
    vapid.generate_keys()
    private_pem = vapid.private_pem().decode()
    raw_public = vapid.public_key.public_bytes(
        encoding=Encoding.X962,
        format=PublicFormat.UncompressedPoint
    )
    public_b64 = base64.urlsafe_b64encode(raw_public).decode().rstrip("=")

    db.execute(
        "INSERT INTO config (key, value) VALUES (?, ?)",
        ("vapid_keys", json.dumps({"private": private_pem, "public": public_b64}))
    )
    db.commit()
    logger.info("Generated new VAPID keys")
    return private_pem, public_b64


# ── Push send ─────────────────────────────────────────────────────────────────

def send_push(subscription_info: dict, title: str, body: str, vapid_private: str) -> str:
    try:
        # Extract the audience from the subscription endpoint
        endpoint = subscription_info.get("endpoint", "")
        aud = "/".join(endpoint.split("/")[:3])

        vapid_claims = {"sub": "mailto:app@localhost", "aud": aud}

        vapid = Vapid.from_pem(vapid_private.encode())
        webpush(
            subscription_info=subscription_info,
            data=json.dumps({"title": title, "body": body}),
            vapid_private_key=vapid,
            vapid_claims=vapid_claims
        )
        return "ok"
    except WebPushException as e:
        if e.response and e.response.status_code == 410:
            return "expired"
        logger.error(f"Push failed: {e}")
        return "error"


# ── Period prediction ─────────────────────────────────────────────────────────

def predict_next_period(db: sqlite3.Connection) -> date | None:
    rows = db.execute("""
        SELECT start_date FROM cycles
        WHERE end_date IS NOT NULL
        ORDER BY start_date DESC LIMIT 6
    """).fetchall()
    if len(rows) < 2:
        return None
    starts = [date.fromisoformat(r["start_date"]) for r in rows]
    gaps = [(starts[i] - starts[i + 1]).days for i in range(len(starts) - 1)]
    avg_cycle = round(sum(gaps) / len(gaps))
    return starts[0] + timedelta(days=avg_cycle)


# ── Scheduled job ─────────────────────────────────────────────────────────────

def check_and_notify():
    logger.info("Starting check_and_notify job")
    db = get_db_conn()
    logger.info("Running scheduled check for upcoming periods")
    try:
        next_period = predict_next_period(db)
        if not next_period:
            return

        days_away = (next_period - date.today()).days
        logger.info(f"Next period predicted for {next_period} (in {days_away} days), sending notifications to subscribers")
        if days_away not in range(1, NOTIFY_DAYS_BEFORE):
            logger.info(f"Next period is not within 1-{NOTIFY_DAYS_BEFORE-1} days, skipping notifications")
            return

        keys_row = db.execute("SELECT value FROM config WHERE key='vapid_keys'").fetchone()
        if not keys_row:
            logger.error("VAPID keys not found in config, cannot send push notifications")
            return
        vapid_private = json.loads(keys_row["value"])["private"]
        subs = db.execute("SELECT id, subscription, strings FROM push_subscriptions").fetchall()
        logger.info(f"Found {len(subs)} push subscriptions, sending notifications")
        for row in subs:
            sub_info = json.loads(row["subscription"])
            strings = json.loads(row["strings"])
            body = strings["body_singular"] if days_away == 1 else strings["body_plural"].replace("{n}", str(days_away))
            result = send_push(sub_info, title=strings["title"], body=body, vapid_private=vapid_private)
            logger.info(f"Sent push to subscription id={row['id']} result={result}")
            if result == "expired":
                db.execute("DELETE FROM push_subscriptions WHERE id=?", (row["id"],))
                db.commit()
                logger.info(f"Removed expired push subscription id={row['id']}")
    finally:
        db.close()


# ── Lifespan ──────────────────────────────────────────────────────────────────

@asynccontextmanager
async def lifespan(app):
    FastAPICache.init(InMemoryBackend())

    db = get_db_conn()
    private_key, public_key = get_or_create_vapid_keys(db)
    db.close()

    app.state.vapid_private = private_key
    app.state.vapid_public = public_key

    scheduler.add_job(check_and_notify, "cron", hour=NOTIFY_HOUR, minute=0, id="period_reminder")
    scheduler.add_job(
        check_and_notify,
        "cron",
        hour=NOTIFY_HOUR,
        minute=0,
        id="period_reminder",
        replace_existing=True,
        timezone=os.environ.get("TZ", "UTC")
    )
    scheduler.start()
    logger.info("Scheduler started")

    yield

    scheduler.shutdown()
    logger.info("Scheduler stopped")


# ── Routes (register via router) ──────────────────────────────────────────────

from fastapi import APIRouter

router = APIRouter(prefix="/api/push", tags=["push"])


@router.get("/vapid-public-key")
@cache(expire=60)
def get_vapid_public_key(request: Request):
    return {"public_key": request.app.state.vapid_public}


@router.post("/subscribe", status_code=201)
def subscribe_push(sub: PushSubscription, request: Request):
    _db = get_db_conn()
    try:
        sub_json = json.dumps(sub.subscription)
        _db.execute(
            "INSERT OR REPLACE INTO push_subscriptions (subscription, strings) VALUES (?, ?)",
            (sub_json, json.dumps(sub.strings))
        )
        _db.commit()
    except Exception as e:
        logger.error(f"Subscribe error: {e}")
    finally:
        _db.close()
    return {"status": "subscribed"}

@router.post("/unsubscribe", status_code=200)
def unsubscribe_push(sub: PushSubscription):
    _db = get_db_conn()
    try:
        sub_json = json.dumps(sub.subscription)
        _db.execute("DELETE FROM push_subscriptions WHERE subscription=?", (sub_json,))
        _db.commit()
    except Exception as e:
        logger.error(f"Unsubscribe error: {e}")
    finally:
        _db.close()
    return {"status": "unsubscribed"}

# Avoid circular import — define model here
from pydantic import BaseModel

class PushSubscription(BaseModel):
    subscription: dict
    strings: dict = {
        "title": "Period reminder 🌸",
        "body_singular": "Your period is expected tomorrow.",
        "body_plural": "Your period is expected in {n} days."
    }