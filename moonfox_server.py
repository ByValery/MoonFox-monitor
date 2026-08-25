#!/usr/bin/env python3
# MoonFox monitor v0.7 backend: SQLite storage + lightweight API.

from __future__ import annotations

import argparse
import contextlib
import ipaddress
import json
import os
import platform
import random
import re
import shutil
import socket
import sqlite3
import ssl
import subprocess
import sys
import threading
import time
import traceback
import urllib.error
import urllib.parse
import urllib.request
import webbrowser
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


ROOT = Path(__file__).resolve().parent
DATA_DIR = ROOT / "data"
DB_PATH = DATA_DIR / "moonfox.db"
JSON_PATH = DATA_DIR / "db.json"
APP_TITLE = "MoonFox monitor"
APP_SUBTITLE = "Следит за системой, пока ты спишь."
APP_VERSION = "0.7.0"

DEFAULT_SETTINGS = {
    "title": APP_TITLE,
    "subtitle": APP_SUBTITLE,
    "version": APP_VERSION,
    "language": "ru",
    "interval": 30,
    "siteInterval": 30,
    "deviceInterval": 30,
    "timeout": 10,
    "showMs": True,
    "autoOpen": True,
    "telegramEnabled": True,
    "telegramToken": "",
    "telegramChat": "",
    "telegramCommandsEnabled": False,
    "telegramCommandInterval": 5,
    "telegramUpdateOffset": 0,
    "uiScale": 0.72,
    "textScale": 0.82,
    "autoRefresh": 5,
    "port": 8000,
    "siteWarn": 1000,
    "siteCrit": 3000,
    "deviceWarn": 150,
    "deviceCrit": 300,
    "failureConfirmChecks": 2,
    "historyRetentionMode": "days",
    "historyRetentionDays": 7,
    "historyMaxRecords": 100000,
    "siteOverviewGraphId": "__default",
    "deviceOverviewGraphId": "__default",
    "siteOverviewRangeMinutes": 60,
    "deviceOverviewRangeMinutes": 60,
    "siteOverviewYMax": 0,
    "deviceOverviewYMax": 0,
    "siteOverviewStyle": "line",
    "deviceOverviewStyle": "line",
    "notifyDown": True,
    "notifySlow": True,
    "notifyRecovered": True,
    "tgSiteDown": "Сайт недоступен",
    "tgSiteSlow": "Сайт отвечает медленно",
    "tgSiteRecovered": "Сайт снова доступен",
    "tgDeviceDown": "Устройство недоступно",
    "tgDeviceSlow": "Высокий ping",
    "tgDeviceRecovered": "Устройство снова доступно",
    "siteRepeatMinutes": 10,
    "deviceRepeatMinutes": 10,
    "themePreset": "dark",
    "themeAccent": "#7c5cff",
    "themeButton": "#24457f",
    "themeOk": "#20e68a",
    "themeBad": "#ff4d6d",
    "themeBg": "#080d1b",
    "themePanel": "#101a36",
}

SERVICE_TYPES = {
    "website": {"label": "Обычный сайт", "path": "/"},
    "jellyfin": {"label": "Jellyfin", "path": "/System/Info/Public"},
    "nextcloud": {"label": "Nextcloud", "path": "/status.php"},
    "homeassistant": {"label": "Home Assistant", "path": "/api/"},
    "grafana": {"label": "Grafana", "path": "/api/health"},
    "prometheus": {"label": "Prometheus", "path": "/-/healthy"},
}


def now_iso() -> str:
    return datetime.now().astimezone().isoformat()


def now_time() -> str:
    return datetime.now().strftime("%H:%M:%S")


def iso_to_ms(value: str | None) -> int:
    if not value:
        return 0
    try:
        text = str(value).replace("Z", "+00:00")
        return int(datetime.fromisoformat(text).timestamp() * 1000)
    except Exception:
        return 0


def new_id() -> str:
    alphabet = "0123456789abcdef"
    return "".join(random.choice(alphabet) for _ in range(10))


_SAFE_ID_RE = re.compile(r"^[A-Za-z0-9_-]{1,64}$")


def safe_id(value) -> str | None:
    """Every site/router/graph/topology-node id this app generates itself is a short
    alphanumeric token (new_id()/mapNewId()), and the frontend interpolates ids straight into
    inline event-handler attributes (onclick="fn('...')") in a number of places without JS-string
    escaping - safe for our own ids, but /api/import/config accepts arbitrary JSON, so an id field
    coming from an imported file is otherwise attacker-controlled and could carry a string built to
    break out of that JS string literal. Reject anything that isn't a plausible id and let the
    caller regenerate one instead."""
    if isinstance(value, str) and _SAFE_ID_RE.match(value):
        return value
    return None


def json_dumps(value) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


def json_loads(value: str | bytes | None, fallback=None):
    if value is None or value == "":
        return fallback
    try:
        return json.loads(value)
    except Exception:
        return fallback


def log(message: str) -> None:
    print(f"[{now_time()}] {message}", flush=True)


class Store:
    def __init__(self, path: Path):
        self.path = path
        self.lock = threading.RLock()
        self.last_maintenance = 0.0
        DATA_DIR.mkdir(parents=True, exist_ok=True)
        self.init_db()
        self.migrate_from_json_if_needed()

    def connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.path, timeout=30, check_same_thread=False)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("PRAGMA synchronous=NORMAL")
        conn.execute("PRAGMA busy_timeout=30000")
        conn.execute("PRAGMA wal_autocheckpoint=1000")
        conn.execute("PRAGMA temp_store=MEMORY")
        conn.execute("PRAGMA foreign_keys=ON")
        return conn

    @contextlib.contextmanager
    def session(self):
        # sqlite3.Connection's own context manager only commits/rolls back the
        # transaction on exit - it does NOT close the connection. Every call
        # site used to rely on CPython's reference counting to close the
        # connection once `db` went out of scope, which happens to work on
        # CPython today but isn't guaranteed and left every request opening a
        # brand new on-disk connection (with 6 PRAGMA statements) without ever
        # deterministically releasing it. This wrapper guarantees the close.
        conn = self.connect()
        try:
            with conn:
                yield conn
        finally:
            conn.close()

    def init_db(self) -> None:
        with self.session() as db:
            db.executescript(
                """
                CREATE TABLE IF NOT EXISTS meta(
                  key TEXT PRIMARY KEY,
                  value TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS sites(
                  id TEXT PRIMARY KEY,
                  position INTEGER NOT NULL DEFAULT 0,
                  data TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS routers(
                  id TEXT PRIMARY KEY,
                  position INTEGER NOT NULL DEFAULT 0,
                  data TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS graphs(
                  id TEXT PRIMARY KEY,
                  position INTEGER NOT NULL DEFAULT 0,
                  data TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS events(
                  id INTEGER PRIMARY KEY AUTOINCREMENT,
                  ts_ms INTEGER NOT NULL,
                  data TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS history(
                  id INTEGER PRIMARY KEY AUTOINCREMENT,
                  ts_ms INTEGER NOT NULL,
                  ts TEXT NOT NULL,
                  time TEXT NOT NULL,
                  kind TEXT NOT NULL,
                  object_id TEXT,
                  name TEXT,
                  value REAL DEFAULT 0,
                  ok INTEGER DEFAULT 0,
                  code INTEGER DEFAULT 0,
                  status TEXT,
                  observed_status TEXT,
                  data TEXT NOT NULL
                );
                CREATE INDEX IF NOT EXISTS idx_history_kind_ts ON history(kind, ts_ms);
                CREATE INDEX IF NOT EXISTS idx_history_kind_object_ts ON history(kind, object_id, ts_ms);
                CREATE INDEX IF NOT EXISTS idx_events_ts ON events(ts_ms DESC);
                """
            )
            if self.get_meta(db, "settings") is None:
                self.set_meta(db, "settings", DEFAULT_SETTINGS.copy())
            if self.get_meta(db, "migrated_from_json") is None:
                self.set_meta(db, "migrated_from_json", False)

    def migrate_from_json_if_needed(self) -> None:
        with self.lock, self.session() as db:
            if self.get_meta(db, "migrated_from_json") or not JSON_PATH.exists():
                return
            try:
                data = json.loads(JSON_PATH.read_text(encoding="utf-8"))
            except Exception as exc:
                log(f"JSON migration skipped: {exc}")
                self.set_meta(db, "migrated_from_json", True)
                return

            settings = DEFAULT_SETTINGS.copy()
            settings.update(data.get("settings") or {})
            settings["title"] = APP_TITLE
            settings["subtitle"] = APP_SUBTITLE
            settings["version"] = APP_VERSION
            self.set_meta(db, "settings", settings)

            for table in ("sites", "routers", "graphs"):
                db.execute(f"DELETE FROM {table}")
            db.execute("DELETE FROM events")
            db.execute("DELETE FROM history")

            for pos, item in enumerate(data.get("sites") or []):
                item.setdefault("id", new_id())
                item.setdefault("paused", False)
                db.execute("INSERT OR REPLACE INTO sites(id,position,data) VALUES(?,?,?)", (item["id"], pos, json_dumps(item)))
            for pos, item in enumerate(data.get("routers") or []):
                item.setdefault("id", new_id())
                item.setdefault("paused", False)
                item.setdefault("ports", [])
                item.setdefault("checkType", "ping")
                db.execute("INSERT OR REPLACE INTO routers(id,position,data) VALUES(?,?,?)", (item["id"], pos, json_dumps(item)))
            graphs = data.get("graphs") or [
                {"id": "main_graph", "title": "Общий график", "type": "site_response", "style": "line", "height": 260, "rangeMinutes": 60, "yMax": 0, "note": "", "objectIds": []}
            ]
            for pos, item in enumerate(graphs):
                item.setdefault("id", new_id())
                item.setdefault("objectIds", [])
                db.execute("INSERT OR REPLACE INTO graphs(id,position,data) VALUES(?,?,?)", (item["id"], pos, json_dumps(item)))
            for item in data.get("events") or []:
                ts_ms = iso_to_ms(item.get("ts")) or int(time.time() * 1000)
                db.execute("INSERT INTO events(ts_ms,data) VALUES(?,?)", (ts_ms, json_dumps(item)))
            for item in data.get("history") or []:
                self.insert_history_row(db, item)

            self.set_meta(db, "migrated_from_json", True)
            db.commit()
            log("Migrated data/db.json to data/moonfox.db")

    def get_meta(self, db: sqlite3.Connection, key: str):
        row = db.execute("SELECT value FROM meta WHERE key=?", (key,)).fetchone()
        return json_loads(row["value"], None) if row else None

    def set_meta(self, db: sqlite3.Connection, key: str, value) -> None:
        db.execute("INSERT OR REPLACE INTO meta(key,value) VALUES(?,?)", (key, json_dumps(value)))

    def settings(self) -> dict:
        with self.session() as db:
            settings = DEFAULT_SETTINGS.copy()
            settings.update(self.get_meta(db, "settings") or {})
            settings["title"] = APP_TITLE
            settings["subtitle"] = APP_SUBTITLE
            settings["version"] = APP_VERSION
            return settings

    def save_settings(self, patch: dict) -> dict:
        with self.lock, self.session() as db:
            settings = DEFAULT_SETTINGS.copy()
            settings.update(self.get_meta(db, "settings") or {})
            for key, value in patch.items():
                if key in ("title", "subtitle"):
                    continue
                settings[key] = value
            settings["title"] = APP_TITLE
            settings["subtitle"] = APP_SUBTITLE
            settings["version"] = APP_VERSION
            # siteInterval/deviceInterval/timeout drive int() conversions elsewhere (the
            # background monitor's own interval scheduling, request timeouts) with no
            # validation at those call sites - a non-numeric value saved here (bad manual
            # edit, corrupted import, a future API caller) would otherwise persist fine
            # here and only blow up later, permanently killing the monitor thread the next
            # time it recomputes its schedule. Clamp/validate the same way historyRetention*
            # already is, so a bad value falls back to a safe default instead of persisting.
            def clamp_int(key, default, lo, hi):
                try:
                    val = int(settings.get(key))
                except (TypeError, ValueError):
                    val = default
                settings[key] = max(lo, min(hi, val))
            clamp_int("siteInterval", 30, 1, 86400)
            clamp_int("deviceInterval", 30, 1, 86400)
            clamp_int("interval", 30, 1, 86400)
            clamp_int("timeout", 10, 1, 120)
            self.set_meta(db, "settings", settings)
            self.prune_history(db, settings)
            db.commit()
            return settings

    @staticmethod
    def sanitize_topology(raw_nodes: list, raw_edges: list) -> dict:
        # Shared with import_config() - see safe_id() for why node/edge ids from any external
        # payload (a saved-from-browser POST that bypassed the frontend's own id generation, or
        # an imported config file) need to be validated before they can ever reach the client
        # again, since the map UI interpolates them into inline event-handler attributes.
        node_id_remap: dict = {}
        nodes = []
        for node in raw_nodes:
            if not isinstance(node, dict):
                continue
            node = dict(node)
            old_id = node.get("id")
            fixed_id = safe_id(old_id) or new_id()
            if old_id is not None and fixed_id != old_id:
                node_id_remap[old_id] = fixed_id
            node["id"] = fixed_id
            nodes.append(node)
        edges = []
        for edge in raw_edges:
            if not isinstance(edge, dict):
                continue
            edge = dict(edge)
            edge["id"] = safe_id(edge.get("id")) or new_id()
            edge["from"] = node_id_remap.get(edge.get("from"), edge.get("from"))
            edge["to"] = node_id_remap.get(edge.get("to"), edge.get("to"))
            edges.append(edge)
        return {"nodes": nodes, "edges": edges}

    def save_topology(self, data: dict) -> dict:
        raw_nodes = data.get("nodes") if isinstance(data.get("nodes"), list) else []
        raw_edges = data.get("edges") if isinstance(data.get("edges"), list) else []
        topology = self.sanitize_topology(raw_nodes, raw_edges)
        with self.lock, self.session() as db:
            self.set_meta(db, "topology", topology)
            db.commit()
        return topology

    def list_table(self, table: str) -> list[dict]:
        with self.session() as db:
            return [json_loads(r["data"], {}) for r in db.execute(f"SELECT data FROM {table} ORDER BY position,id")]

    def get_object(self, table: str, object_id: str) -> dict | None:
        with self.session() as db:
            row = db.execute(f"SELECT data FROM {table} WHERE id=?", (object_id,)).fetchone()
            return json_loads(row["data"], None) if row else None

    def upsert_object(self, table: str, item: dict, position: int | None = None) -> dict:
        item = dict(item)
        item.setdefault("id", new_id())
        with self.lock, self.session() as db:
            if position is None:
                row = db.execute(f"SELECT COALESCE(MAX(position),-1)+1 AS pos FROM {table}").fetchone()
                position = int(row["pos"])
            db.execute(f"INSERT OR REPLACE INTO {table}(id,position,data) VALUES(?,?,?)", (item["id"], position, json_dumps(item)))
            db.commit()
        return item

    def update_object(self, table: str, object_id: str, patch: dict) -> dict | None:
        with self.lock, self.session() as db:
            row = db.execute(f"SELECT position,data FROM {table} WHERE id=?", (object_id,)).fetchone()
            if not row:
                return None
            item = json_loads(row["data"], {})
            item.update(patch)
            db.execute(f"UPDATE {table} SET data=? WHERE id=?", (json_dumps(item), object_id))
            db.commit()
            return item

    def delete_object(self, table: str, kind: str, object_id: str) -> None:
        with self.lock, self.session() as db:
            row = db.execute(f"SELECT data FROM {table} WHERE id=?", (object_id,)).fetchone()
            item = json_loads(row["data"], {}) if row else {}
            name = item.get("name")
            db.execute(f"DELETE FROM {table} WHERE id=?", (object_id,))
            # Every row written by a live check carries its own object_id, so match on that
            # alone - the name=? fallback below is only for legacy/imported history rows that
            # predate object_id and have it NULL. Matching on name whenever it's merely equal
            # (the original query) would also delete another site/device's history the moment
            # two objects happen to share a display name, which nothing prevents.
            db.execute("DELETE FROM history WHERE kind=? AND object_id=?", (kind, object_id))
            if name:
                db.execute("DELETE FROM history WHERE kind=? AND object_id IS NULL AND name=?", (kind, name))
            db.commit()

    def move_object(self, table: str, object_id: str, direction: str) -> None:
        with self.lock, self.session() as db:
            rows = db.execute(f"SELECT id,position FROM {table} ORDER BY position,id").fetchall()
            ids = [r["id"] for r in rows]
            if object_id not in ids:
                return
            idx = ids.index(object_id)
            target = idx - 1 if direction == "up" else idx + 1
            if target < 0 or target >= len(ids):
                return
            ids[idx], ids[target] = ids[target], ids[idx]
            for pos, oid in enumerate(ids):
                db.execute(f"UPDATE {table} SET position=? WHERE id=?", (pos, oid))
            db.commit()

    def insert_event(self, db: sqlite3.Connection, text: str, level: str = "ok") -> None:
        event = {"time": now_time(), "date": datetime.now().strftime("%d.%m.%Y %H:%M:%S"), "ts": now_iso(), "text": text, "level": level or "ok"}
        db.execute("INSERT INTO events(ts_ms,data) VALUES(?,?)", (iso_to_ms(event["ts"]), json_dumps(event)))
        db.execute("DELETE FROM events WHERE id NOT IN (SELECT id FROM events ORDER BY ts_ms DESC,id DESC LIMIT 80)")

    def insert_history_row(self, db: sqlite3.Connection, item: dict) -> None:
        ts = item.get("ts") or now_iso()
        item.setdefault("time", item.get("time") or now_time())
        item.setdefault("ts", ts)
        db.execute(
            """
            INSERT INTO history(ts_ms,ts,time,kind,object_id,name,value,ok,code,status,observed_status,data)
            VALUES(?,?,?,?,?,?,?,?,?,?,?,?)
            """,
            (
                iso_to_ms(ts) or int(time.time() * 1000),
                ts,
                item.get("time") or "",
                item.get("kind") or "",
                item.get("objectId") or item.get("object_id"),
                item.get("name"),
                float(item.get("value") or 0),
                1 if item.get("ok") else 0,
                int(item.get("code") or 0),
                item.get("status"),
                item.get("observedStatus") or item.get("observed_status"),
                json_dumps(item),
            ),
        )

    def prune_history(self, db: sqlite3.Connection, settings: dict) -> None:
        mode = settings.get("historyRetentionMode", "days")
        if mode == "records":
            max_records = int(settings.get("historyMaxRecords") or 100000)
            max_records = max(1000, min(1000000, max_records))
            db.execute("DELETE FROM history WHERE id NOT IN (SELECT id FROM history ORDER BY ts_ms DESC,id DESC LIMIT ?)", (max_records,))
        else:
            days = int(settings.get("historyRetentionDays") or 7)
            days = max(1, min(365, days))
            cutoff_ms = int((datetime.now().astimezone() - timedelta(days=days)).timestamp() * 1000)
            db.execute("DELETE FROM history WHERE ts_ms < ?", (cutoff_ms,))

    def maintenance(self, settings: dict | None = None, force: bool = False) -> None:
        now = time.time()
        if not force and now - self.last_maintenance < 15 * 60:
            return
        with self.lock, self.session() as db:
            settings = settings or self.settings()
            self.prune_history(db, settings)
            db.commit()
            try:
                db.execute("PRAGMA optimize")
            except Exception:
                pass
            wal_path = str(self.path) + "-wal"
            wal_size = os.path.getsize(wal_path) if os.path.exists(wal_path) else 0
            checkpoint = "TRUNCATE" if force or wal_size > 64 * 1024 * 1024 else "PASSIVE"
            try:
                db.execute(f"PRAGMA wal_checkpoint({checkpoint})")
            except Exception as exc:
                log(f"SQLite maintenance warning: {exc}")
        self.last_maintenance = now

    def state_payload(self) -> dict:
        with self.session() as db:
            settings = DEFAULT_SETTINGS.copy()
            settings.update(self.get_meta(db, "settings") or {})
            settings["title"] = APP_TITLE
            settings["subtitle"] = APP_SUBTITLE
            settings["version"] = APP_VERSION
            sites = [json_loads(r["data"], {}) for r in db.execute("SELECT data FROM sites ORDER BY position,id")]
            for site in sites:
                stype = service_type(site.get("serviceType"))
                site.setdefault("serviceType", stype)
                site.setdefault("checkPath", service_check_path(stype))
                site.setdefault("checkUrl", service_check_url(site.get("url", ""), stype))
            routers = [json_loads(r["data"], {}) for r in db.execute("SELECT data FROM routers ORDER BY position,id")]
            graphs = [json_loads(r["data"], {}) for r in db.execute("SELECT data FROM graphs ORDER BY position,id")]
            events = [json_loads(r["data"], {}) for r in db.execute("SELECT data FROM events ORDER BY ts_ms DESC,id DESC LIMIT 80")]
            history = [json_loads(r["data"], {}) for r in db.execute("SELECT data FROM history ORDER BY ts_ms DESC,id DESC LIMIT 500")]
            history.reverse()
            total = db.execute("SELECT COUNT(*) AS c FROM history").fetchone()["c"]
            topology = self.get_meta(db, "topology") or {"nodes": [], "edges": []}
            return {"settings": settings, "sites": sites, "routers": routers, "events": events, "graphs": graphs, "history": history, "historyTotal": total, "historyMode": "sqlite", "topology": topology}

    def history_query(self, kind: str, minutes: int, object_ids: list[str] | None = None, max_points: int = 2500, full: bool = False) -> dict:
        kind = "router" if kind == "router" else "site"
        minutes = max(1, min(10080, int(minutes or 60)))
        max_points = max(200, min(10000, int(max_points or 2500)))
        cutoff_ms = int((datetime.now().astimezone() - timedelta(minutes=minutes)).timestamp() * 1000)
        params = [kind, cutoff_ms]
        where = "kind=? AND ts_ms>=?"
        if object_ids:
            placeholders = ",".join("?" for _ in object_ids)
            where += f" AND object_id IN ({placeholders})"
            params.extend(object_ids)
        with self.session() as db:
            count = db.execute(f"SELECT COUNT(*) AS c FROM history WHERE {where}", params).fetchone()["c"]
            if full or count <= max_points:
                limit = 200000 if full else max_points
                rows = db.execute(
                    f"""
                    SELECT ts_ms,ts,time,kind,object_id,name,value,ok,code,status,observed_status
                    FROM history WHERE {where} ORDER BY ts_ms ASC,id ASC LIMIT ?
                    """,
                    params + [limit],
                ).fetchall()
                items = [self.history_item_from_row(r) for r in rows]
                return {"ok": True, "kind": kind, "minutes": minutes, "total": count, "returned": len(items), "compacted": False, "history": items}

            object_count = db.execute(f"SELECT COUNT(DISTINCT COALESCE(object_id,name,'')) AS c FROM history WHERE {where}", params).fetchone()["c"] or 1
            bucket_count = max(30, min(1200, max_points // max(1, int(object_count))))
            bucket_ms = max(1, int(minutes * 60000 / bucket_count))
            rows = db.execute(
                f"""
                SELECT
                  ((ts_ms - ?) / ?) AS bucket,
                  MIN(ts_ms) AS ts_ms,
                  kind,
                  object_id,
                  name,
                  MAX(value) AS value,
                  MIN(ok) AS ok,
                  MAX(code) AS code,
                  SUM(CASE WHEN status='BAD' THEN 1 ELSE 0 END) AS bad_count,
                  SUM(CASE WHEN status='SLOW' THEN 1 ELSE 0 END) AS slow_count
                FROM history
                WHERE {where}
                GROUP BY COALESCE(object_id,name,''), bucket
                ORDER BY ts_ms ASC
                LIMIT ?
                """,
                [cutoff_ms, bucket_ms] + params + [max_points],
            ).fetchall()
        items = [self.history_item_from_compact_row(r) for r in rows]
        return {"ok": True, "kind": kind, "minutes": minutes, "total": count, "returned": len(items), "compacted": True, "bucketMs": bucket_ms, "history": items}

    def history_item_from_row(self, row: sqlite3.Row) -> dict:
        return {
            "ts": row["ts"],
            "time": row["time"],
            "kind": row["kind"],
            "objectId": row["object_id"],
            "name": row["name"],
            "value": row["value"] or 0,
            "ok": bool(row["ok"]),
            "code": row["code"] or 0,
            "status": row["status"],
            "observedStatus": row["observed_status"] or row["status"],
        }

    def history_item_from_compact_row(self, row: sqlite3.Row) -> dict:
        ts_ms = int(row["ts_ms"] or 0)
        dt = datetime.fromtimestamp(ts_ms / 1000).astimezone()
        status = "BAD" if int(row["bad_count"] or 0) else ("SLOW" if int(row["slow_count"] or 0) else "OK")
        return {
            "ts": dt.isoformat(),
            "time": dt.strftime("%H:%M:%S"),
            "kind": row["kind"],
            "objectId": row["object_id"],
            "name": row["name"],
            "value": row["value"] or 0,
            "ok": bool(row["ok"]),
            "code": row["code"] or 0,
            "status": status,
            "observedStatus": status,
        }

    def export_config(self) -> dict:
        state = self.state_payload()
        with self.session() as db:
            state["history"] = [json_loads(r["data"], {}) for r in db.execute("SELECT data FROM history ORDER BY ts_ms ASC,id ASC")]
        return state

    def import_config(self, data: dict) -> None:
        with self.lock, self.session() as db:
            settings = DEFAULT_SETTINGS.copy()
            settings.update(data.get("settings") or {})
            self.set_meta(db, "settings", settings)
            topology = data.get("topology") or {}
            raw_nodes = topology.get("nodes") if isinstance(topology.get("nodes"), list) else []
            raw_edges = topology.get("edges") if isinstance(topology.get("edges"), list) else []
            self.set_meta(db, "topology", self.sanitize_topology(raw_nodes, raw_edges))
            for table in ("sites", "routers", "graphs"):
                db.execute(f"DELETE FROM {table}")
            db.execute("DELETE FROM events")
            db.execute("DELETE FROM history")
            for pos, item in enumerate(data.get("sites") or []):
                item["id"] = safe_id(item.get("id")) or new_id()
                db.execute("INSERT OR REPLACE INTO sites(id,position,data) VALUES(?,?,?)", (item["id"], pos, json_dumps(item)))
            for pos, item in enumerate(data.get("routers") or []):
                item["id"] = safe_id(item.get("id")) or new_id()
                db.execute("INSERT OR REPLACE INTO routers(id,position,data) VALUES(?,?,?)", (item["id"], pos, json_dumps(item)))
            for pos, item in enumerate(data.get("graphs") or []):
                item["id"] = safe_id(item.get("id")) or new_id()
                db.execute("INSERT OR REPLACE INTO graphs(id,position,data) VALUES(?,?,?)", (item["id"], pos, json_dumps(item)))
            for item in data.get("events") or []:
                db.execute("INSERT INTO events(ts_ms,data) VALUES(?,?)", (iso_to_ms(item.get("ts")) or int(time.time() * 1000), json_dumps(item)))
            for item in data.get("history") or []:
                self.insert_history_row(db, item)
            db.commit()

    def clear_history(self) -> None:
        with self.lock, self.session() as db:
            db.execute("DELETE FROM history")
            db.execute("DELETE FROM events")
            db.commit()

    def reset_all(self) -> None:
        with self.lock, self.session() as db:
            db.execute("DELETE FROM sites")
            db.execute("DELETE FROM routers")
            db.execute("DELETE FROM history")
            db.execute("DELETE FROM events")
            db.execute("DELETE FROM graphs")
            graph = {"id": "main_graph", "title": "Общий график", "type": "site_response", "style": "line", "height": 260, "rangeMinutes": 60, "yMax": 0, "note": "", "objectIds": []}
            db.execute("INSERT INTO graphs(id,position,data) VALUES(?,?,?)", (graph["id"], 0, json_dumps(graph)))
            db.commit()


def normalize_url(value: str) -> str:
    value = (value or "").strip()
    if value and not value.startswith(("http://", "https://")):
        value = "https://" + value
    return value


def service_type(value: str | None) -> str:
    value = str(value or "website").strip().lower()
    return value if value in SERVICE_TYPES else "website"


def service_check_path(value: str | None) -> str:
    return SERVICE_TYPES[service_type(value)]["path"]


def service_check_url(base_url: str, value: str | None) -> str:
    base_url = normalize_url(base_url)
    parsed = urllib.parse.urlparse(base_url)
    path = service_check_path(value)
    if path == "/":
        check_path = parsed.path or "/"
    else:
        check_path = path
    return urllib.parse.urlunparse((parsed.scheme, parsed.netloc, check_path, "", "", ""))


MAX_PORTS_PER_OBJECT = 32


def parse_ports(value) -> list[int]:
    if value is None:
        return []
    if isinstance(value, list):
        raw = value
    else:
        raw = str(value).replace(";", ",").replace(" ", ",").split(",")
    ports = []
    for part in raw:
        # Each port in the list gets its own sequential TCP connect attempt (up to the check
        # timeout each) every check cycle - a device saved with hundreds/thousands of ports (a
        # typo'd range, or a crafted API call) would otherwise make that single device's check
        # take minutes, on every cycle, indefinitely. Cap rather than reject so a slightly-too-
        # long paste still saves with its first MAX_PORTS_PER_OBJECT ports instead of erroring out.
        if len(ports) >= MAX_PORTS_PER_OBJECT:
            break
        try:
            p = int(part)
            if 1 <= p <= 65535 and p not in ports:
                ports.append(p)
        except Exception:
            pass
    return ports


def host_from_url(url: str) -> str:
    try:
        return urllib.parse.urlparse(url).hostname or url
    except Exception:
        return url


def dns_lookup(host: str) -> list[str]:
    try:
        return list(dict.fromkeys(socket.gethostbyname_ex(host)[2]))
    except Exception:
        return []


def ssl_info(host: str, port: int = 443, timeout: float = 5.0):
    try:
        ctx = ssl.create_default_context()
        with socket.create_connection((host, port), timeout=timeout) as sock:
            with ctx.wrap_socket(sock, server_hostname=host) as ssock:
                cert = ssock.getpeercert()
        not_after = cert.get("notAfter")
        expires = datetime.strptime(not_after, "%b %d %H:%M:%S %Y %Z").replace(tzinfo=timezone.utc)
        days = int((expires - datetime.now(timezone.utc)).total_seconds() // 86400)
        return {"ok": days >= 0, "validTo": expires.astimezone().strftime("%d.%m.%Y"), "daysLeft": days, "issuer": str(cert.get("issuer", ""))}
    except Exception as exc:
        return {"ok": False, "error": str(exc)}


def tcp_check(host: str, port: int, timeout: float = 3.0) -> bool:
    try:
        with socket.create_connection((host, int(port)), timeout=timeout):
            return True
    except Exception:
        return False


def ping_host(host: str, timeout_sec: int = 3) -> tuple[bool, int]:
    system = platform.system().lower()
    if system == "windows":
        cmd = ["ping", "-n", "1", "-w", str(timeout_sec * 1000), host]
    else:
        cmd = ["ping", "-c", "1", "-W", str(timeout_sec), host]
    started = time.perf_counter()
    try:
        proc = subprocess.run(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=timeout_sec + 2)
        ms = max(0, int((time.perf_counter() - started) * 1000))
        return proc.returncode == 0, ms
    except Exception:
        return False, 0


def send_telegram(settings: dict, text: str) -> dict:
    if settings.get("telegramEnabled") is False:
        return {"ok": False, "error": "Telegram notifications are disabled"}
    token = str(settings.get("telegramToken") or "").strip()
    chat = str(settings.get("telegramChat") or "").strip()
    if not token or not chat:
        return {"ok": False, "error": "Telegram token or chat ID is empty"}
    try:
        payload = urllib.parse.urlencode({"chat_id": chat, "text": text}).encode("utf-8")
        req = urllib.request.Request(f"https://api.telegram.org/bot{token}/sendMessage", data=payload)
        with urllib.request.urlopen(req, timeout=10) as resp:
            data = json_loads(resp.read().decode("utf-8"), {})
        return data if isinstance(data, dict) else {"ok": True}
    except Exception as exc:
        return {"ok": False, "error": str(exc)}


def local_network_suggestion() -> str:
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        parts = ip.split(".")
        if len(parts) == 4:
            return ".".join(parts[:3]) + ".0/24"
    except Exception:
        pass
    return "192.168.0.0/24"


def scan_network(subnet: str) -> dict:
    subnet = (subnet or local_network_suggestion()).strip()
    try:
        network = ipaddress.ip_network(subnet, strict=False)
    except Exception:
        network = ipaddress.ip_network(local_network_suggestion(), strict=False)
    hosts = list(network.hosts())
    if len(hosts) > 254:
        hosts = hosts[:254]
    devices = []
    lock = threading.Lock()

    def worker(ip):
        addr = str(ip)
        ok, ms = ping_host(addr, 1)
        if ok:
            name = ""
            try:
                name = socket.gethostbyaddr(addr)[0]
            except Exception:
                pass
            with lock:
                devices.append({"address": addr, "name": name, "mac": "", "ping": ms})

    threads = []
    for ip in hosts:
        t = threading.Thread(target=worker, args=(ip,), daemon=True)
        threads.append(t)
        t.start()
        while sum(1 for x in threads if x.is_alive()) >= 48:
            time.sleep(0.02)
    for t in threads:
        t.join(timeout=0.1)
    devices.sort(key=lambda x: tuple(int(p) for p in x["address"].split(".")))
    return {"subnet": str(network), "devices": devices, "scanned": len(hosts)}


class Monitor:
    def __init__(self, store: Store):
        self.store = store
        self.stop_event = threading.Event()
        self.thread = None
        self.next_site_check = time.time() + self.site_interval()
        self.next_device_check = time.time() + self.device_interval()

    def settings(self) -> dict:
        return self.store.settings()

    def site_interval(self) -> int:
        return max(1, int(self.settings().get("siteInterval") or self.settings().get("interval") or 30))

    def device_interval(self) -> int:
        return max(1, int(self.settings().get("deviceInterval") or self.settings().get("interval") or 30))

    def start(self) -> None:
        self.thread = threading.Thread(target=self.loop, name="MoonFoxMonitor", daemon=True)
        self.thread.start()

    def loop(self) -> None:
        while not self.stop_event.is_set():
            now = time.time()
            run_sites = now >= self.next_site_check
            run_devices = now >= self.next_device_check
            if run_sites or run_devices:
                try:
                    self.check_all(run_sites, run_devices)
                except Exception:
                    log("Background check error:\n" + traceback.format_exc())
                # site_interval()/device_interval() read a value that save_settings() now
                # validates, but this is intentionally defensive too - a bad value slipping
                # through by any other path (a hand-edited DB row, a future caller) must not
                # be allowed to raise here: that would escape the loop entirely and silently
                # stop all monitoring forever, since nothing outside restarts this thread.
                if run_sites:
                    try:
                        self.next_site_check = time.time() + self.site_interval()
                    except Exception:
                        log("Bad siteInterval, falling back to 30s:\n" + traceback.format_exc())
                        self.next_site_check = time.time() + 30
                if run_devices:
                    try:
                        self.next_device_check = time.time() + self.device_interval()
                    except Exception:
                        log("Bad deviceInterval, falling back to 30s:\n" + traceback.format_exc())
                        self.next_device_check = time.time() + 30
            self.stop_event.wait(0.5)

    def check_all(self, check_sites=True, check_devices=True) -> None:
        # Network I/O (ping/HTTP/SSL/DNS) happens outside self.store.lock so that
        # slow or unreachable hosts can no longer block the rest of the app (adding
        # a site, saving settings, loading the dashboard) for the whole check cycle.
        # Checks for independent sites/devices also run concurrently instead of
        # one-by-one, so a full cycle no longer scales linearly with object count.
        settings = self.settings()
        timeout = max(1, int(settings.get("timeout") or 10))

        with self.store.lock, self.store.session() as db:
            site_rows = db.execute("SELECT id,position,data FROM sites ORDER BY position,id").fetchall() if check_sites else []
            router_rows = db.execute("SELECT id,position,data FROM routers ORDER BY position,id").fetchall() if check_devices else []

        site_count = len(site_rows)
        device_count = len(router_rows)
        results = []
        site_jobs = []
        router_jobs = []

        for row in site_rows:
            site = json_loads(row["data"], {})
            site.setdefault("id", row["id"])
            if site.get("paused"):
                site["status"] = "PAUSED"
                site["checked"] = "Пауза"
                results.append(("sites", site, None, None))
            else:
                site_jobs.append(site)

        for row in router_rows:
            router = json_loads(row["data"], {})
            router.setdefault("id", row["id"])
            if router.get("paused"):
                router["status"] = "PAUSED"
                router["checked"] = "Пауза"
                results.append(("routers", router, None, None))
            else:
                router_jobs.append(router)

        total_jobs = len(site_jobs) + len(router_jobs)
        if total_jobs:
            with ThreadPoolExecutor(max_workers=min(32, total_jobs)) as pool:
                futures = [pool.submit(self.compute_site, site, settings, timeout) for site in site_jobs]
                futures += [pool.submit(self.compute_router, router, settings, timeout) for router in router_jobs]
                for fut in futures:
                    try:
                        results.append(fut.result())
                    except Exception:
                        # One bad object must not lose the results already computed
                        # for every other site/device in this cycle.
                        log("Check worker error:\n" + traceback.format_exc())

        with self.store.lock, self.store.session() as db:
            for table, item, hist, event in results:
                db.execute(f"UPDATE {table} SET data=? WHERE id=?", (json_dumps(item), item["id"]))
                if event:
                    self.store.insert_event(db, event[0], event[1])
                if hist:
                    self.store.insert_history_row(db, hist)
            db.commit()
        self.store.maintenance(settings)
        log(f"Check finished. Sites: {site_count}, devices: {device_count}")

    def compute_site(self, site: dict, settings: dict, timeout: int):
        hist, event = self.check_site_logic(site, settings, timeout)
        return ("sites", site, hist, event)

    def compute_router(self, router: dict, settings: dict, timeout: int):
        hist, event = self.check_router_logic(router, settings, timeout)
        return ("routers", router, hist, event)

    def check_site_logic(self, site: dict, settings: dict, timeout: int):
        prev = site.get("status", "WAIT")
        url = normalize_url(site.get("url", ""))
        service = service_type(site.get("serviceType"))
        check_url = service_check_url(url, service)
        site["url"] = url
        site["serviceType"] = service
        site["checkPath"] = service_check_path(service)
        site["checkUrl"] = check_url
        started = time.perf_counter()
        code = 0
        ok = False
        error = ""
        try:
            req = urllib.request.Request(check_url, headers={"User-Agent": "MoonFox monitor"})
            try:
                with urllib.request.urlopen(req, timeout=timeout) as resp:
                    code = int(getattr(resp, "status", 200))
                    resp.read(256)
            except urllib.error.HTTPError as exc:
                # urlopen raises for any 4xx/5xx status instead of returning it, but a site that
                # responds at all (even with an error page) is still "up" - only treat 500+ as down.
                code = int(getattr(exc, "code", 0) or 0)
            ok = 200 <= code < 500
        except Exception as exc:
            error = str(exc)
            ok = False
        ms = max(0, int((time.perf_counter() - started) * 1000))
        warn = int(settings.get("siteWarn") or 1000)
        crit = int(settings.get("siteCrit") or 3000)
        if not ok:
            status = "BAD"
        elif ms >= crit:
            status = "BAD"
        elif ms >= warn:
            status = "SLOW"
        else:
            status = "OK"
        host = host_from_url(url)
        site.update({"status": status, "code": code, "response": ms, "checked": now_time(), "ping": 0, "dns": dns_lookup(host)})
        if url.startswith("https://"):
            try:
                ssl_port = urllib.parse.urlparse(url).port or 443
            except ValueError:
                ssl_port = 443
            site["ssl"] = ssl_info(host, ssl_port, min(timeout, 5))
        event = None
        if status in ("BAD", "SLOW"):
            site["lastFailure"] = now_time()
            if prev != status:
                msg = f'Сайт "{site.get("name")}" {"недоступен" if status == "BAD" else "отвечает медленно"}'
                event = (msg, "bad" if status == "BAD" else "warn")
                send_telegram(settings, msg)
        elif prev in ("BAD", "SLOW"):
            msg = f'Сайт "{site.get("name")}" снова доступен'
            event = (msg, "recovered")
            send_telegram(settings, msg)
        hist = {"ts": now_iso(), "time": now_time(), "kind": "site", "objectId": site["id"], "name": site.get("name"), "value": ms, "ok": ok, "code": code, "status": status, "observedStatus": status}
        if error:
            hist["error"] = error
        return hist, event

    def check_router_logic(self, router: dict, settings: dict, timeout: int):
        prev = router.get("status", "WAIT")
        address = str(router.get("address") or "").strip()
        check_type = router.get("checkType") or "ping"
        ports = parse_ports(router.get("ports") or router.get("port"))
        ping_ok, ping_ms = (True, 0)
        if check_type in ("ping", "both"):
            ping_ok, ping_ms = ping_host(address, min(timeout, 5))
        port_results = []
        port_ok = True
        if check_type in ("tcp", "both") and ports:
            for port in ports:
                opened = tcp_check(address, port, min(timeout, 5))
                port_results.append({"port": port, "open": opened})
            port_ok = all(x["open"] for x in port_results)
        ok = (ping_ok if check_type in ("ping", "both") else True) and port_ok
        warn = int(settings.get("deviceWarn") or 150)
        crit = int(settings.get("deviceCrit") or 300)
        if not ok:
            status = "BAD"
        elif check_type in ("ping", "both") and ping_ms >= crit:
            status = "BAD"
        elif check_type in ("ping", "both") and ping_ms >= warn:
            status = "SLOW"
        else:
            status = "OK"
        router.update({"status": status, "ping": ping_ms, "checked": now_time(), "ports": ports, "port": ports[0] if ports else 0, "portOk": port_ok, "portResults": port_results, "checkType": check_type})
        event = None
        if status in ("BAD", "SLOW"):
            router["lastFailure"] = now_time()
            if prev != status:
                msg = f'Устройство "{router.get("name")}" {"недоступно" if status == "BAD" else "высокий ping"}'
                event = (msg, "bad" if status == "BAD" else "warn")
                send_telegram(settings, msg)
        elif prev in ("BAD", "SLOW"):
            msg = f'Устройство "{router.get("name")}" снова доступно'
            event = (msg, "recovered")
            send_telegram(settings, msg)
        hist = {"ts": now_iso(), "time": now_time(), "kind": "router", "objectId": router["id"], "name": router.get("name"), "value": ping_ms, "ok": ok, "code": 0, "status": status, "observedStatus": status, "port": router.get("port", 0), "ports": ports, "portOk": port_ok}
        return hist, event


STORE = Store(DB_PATH)
MONITOR = Monitor(STORE)


class Handler(BaseHTTPRequestHandler):
    server_version = "MoonFox/0.7.0"

    def log_message(self, fmt, *args):
        log(fmt % args)

    # 100 MB comfortably covers the largest realistic /api/import/config payload (a
    # long-running install's full history+events+settings export) while still bounding how much
    # memory a single malformed/oversized request body can force the process to allocate.
    MAX_REQUEST_BODY_BYTES = 100 * 1024 * 1024

    def read_json(self) -> dict:
        length = int(self.headers.get("Content-Length") or 0)
        if length <= 0:
            return {}
        if length > self.MAX_REQUEST_BODY_BYTES:
            raise ValueError(f"Тело запроса слишком большое ({length} байт)")
        raw = self.rfile.read(length).decode("utf-8")
        return json_loads(raw, {}) or {}

    def send_json(self, value, status=200):
        data = json_dumps(value).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def send_text(self, text: str, content_type="text/plain; charset=utf-8", status=200):
        data = text.encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        try:
            self.route("GET")
        except Exception as exc:
            traceback.print_exc()
            self.send_json({"error": str(exc)}, 500)

    def do_POST(self):
        try:
            self.route("POST")
        except Exception as exc:
            traceback.print_exc()
            self.send_json({"error": str(exc)}, 500)

    def check_origin(self) -> bool:
        # MoonFox listens on 127.0.0.1 and has no login of its own, so any page
        # open in the same browser (or an <img>/<link> tag with no script at all)
        # can otherwise make requests to it. Browsers always attach Origin (or,
        # failing that, Referer) to such requests and never let page script fake
        # them, including across DNS-rebinding attempts, so checking it here is
        # enough to stop a malicious site from silently resetting or wiping data.
        try:
            port = self.server.server_address[1]
        except Exception:
            port = None
        allowed = {f"http://127.0.0.1:{port}", f"http://localhost:{port}"} if port else set()
        origin = self.headers.get("Origin")
        if origin is not None:
            return origin in allowed
        referer = self.headers.get("Referer")
        if referer is not None:
            try:
                parsed = urllib.parse.urlparse(referer)
                return f"{parsed.scheme}://{parsed.netloc}" in allowed
            except Exception:
                return False
        # Neither header present (some non-browser client, or a browser stripping
        # both): reject rather than assume this is the app's own page.
        return False

    def route(self, method: str):
        path = urllib.parse.urlparse(self.path).path
        if path.startswith("/api/"):
            if not self.check_origin():
                return self.send_json({"error": "Forbidden: cross-origin request blocked"}, 403)
            return self.api(path, method)
        if path == "/":
            path = "/index.html"
        return self.static(path)

    def api(self, path: str, method: str):
        body = self.read_json() if method == "POST" else {}
        if path == "/api/state":
            return self.send_json(STORE.state_payload())
        if path == "/api/export/config":
            return self.send_json(STORE.export_config())
        if path == "/api/history/query":
            return self.send_json(STORE.history_query(body.get("kind", "site"), int(body.get("minutes") or 60), body.get("objectIds") or [], body.get("maxPoints") or 2500, bool(body.get("full"))))
        if path == "/api/check":
            MONITOR.check_all(True, True)
            return self.send_json(STORE.state_payload())
        if path == "/api/settings/save":
            STORE.save_settings(body)
            MONITOR.next_site_check = time.time() + MONITOR.site_interval()
            MONITOR.next_device_check = time.time() + MONITOR.device_interval()
            return self.send_json({"ok": True})
        if path == "/api/site/add":
            stype = service_type(body.get("serviceType"))
            item = {"id": new_id(), "name": body.get("name"), "url": normalize_url(body.get("url", "")), "serviceType": stype, "checkPath": service_check_path(stype), "checkUrl": service_check_url(body.get("url", ""), stype), "color": body.get("color") or "#35f0ff", "paused": False, "status": "WAIT", "code": 0, "response": 0, "ping": 0, "dns": [], "ssl": None, "checked": "-", "lastFailure": "Никогда"}
            STORE.upsert_object("sites", item)
            return self.send_json({"ok": True})
        if path == "/api/site/update":
            stype = service_type(body.get("serviceType"))
            patch = {"name": body.get("name"), "url": normalize_url(body.get("url", "")), "serviceType": stype, "checkPath": service_check_path(stype), "checkUrl": service_check_url(body.get("url", ""), stype), "color": body.get("color") or "#35f0ff", "paused": bool(body.get("paused", False))}
            if patch["paused"]:
                patch.update({"status": "PAUSED", "checked": "Пауза"})
            STORE.update_object("sites", body.get("id"), patch)
            return self.send_json({"ok": True})
        if path == "/api/site/delete":
            STORE.delete_object("sites", "site", body.get("id"))
            return self.send_json({"ok": True})
        if path == "/api/site/move":
            STORE.move_object("sites", body.get("id"), body.get("direction"))
            return self.send_json({"ok": True})
        if path == "/api/site/pause":
            patch = {"paused": bool(body.get("paused"))}
            patch.update({"status": "PAUSED", "checked": "Пауза"} if patch["paused"] else {"status": "WAIT", "checked": "-"})
            STORE.update_object("sites", body.get("id"), patch)
            return self.send_json({"ok": True})
        if path == "/api/router/add":
            ports = parse_ports(body.get("ports") or body.get("port"))
            item = {"id": new_id(), "name": body.get("name"), "address": body.get("address"), "type": body.get("type"), "color": body.get("color") or "#7c5cff", "paused": False, "status": "WAIT", "ping": 0, "port": ports[0] if ports else 0, "ports": ports, "portOk": True, "portResults": [], "checkType": body.get("checkType") or "ping", "checked": "-", "lastFailure": "Никогда"}
            STORE.upsert_object("routers", item)
            return self.send_json({"ok": True})
        if path == "/api/router/update":
            ports = parse_ports(body.get("ports") or body.get("port"))
            patch = {"name": body.get("name"), "address": body.get("address"), "color": body.get("color") or "#7c5cff", "paused": bool(body.get("paused", False)), "ports": ports, "port": ports[0] if ports else 0, "checkType": body.get("checkType") or "ping"}
            if patch["paused"]:
                patch.update({"status": "PAUSED", "checked": "Пауза"})
            STORE.update_object("routers", body.get("id"), patch)
            return self.send_json({"ok": True})
        if path == "/api/router/delete":
            STORE.delete_object("routers", "router", body.get("id"))
            return self.send_json({"ok": True})
        if path == "/api/router/move":
            STORE.move_object("routers", body.get("id"), body.get("direction"))
            return self.send_json({"ok": True})
        if path == "/api/router/pause":
            patch = {"paused": bool(body.get("paused"))}
            patch.update({"status": "PAUSED", "checked": "Пауза"} if patch["paused"] else {"status": "WAIT", "checked": "-"})
            STORE.update_object("routers", body.get("id"), patch)
            return self.send_json({"ok": True})
        if path == "/api/graph/add":
            graph = dict(body)
            graph["id"] = new_id()
            graph.setdefault("objectIds", [])
            STORE.upsert_object("graphs", graph)
            return self.send_json({"ok": True})
        if path == "/api/graph/update":
            graph = dict(body)
            gid = graph.get("id")
            old = STORE.get_object("graphs", gid) or {"id": gid}
            old.update(graph)
            STORE.upsert_object("graphs", old)
            return self.send_json({"ok": True})
        if path == "/api/graph/delete":
            STORE.delete_object("graphs", "graph", body.get("id"))
            return self.send_json({"ok": True})
        if path == "/api/topology/save":
            return self.send_json({"ok": True, "topology": STORE.save_topology(body)})
        if path == "/api/history/clear":
            STORE.clear_history()
            STORE.maintenance(force=True)
            return self.send_json({"ok": True})
        if path == "/api/events/clear":
            with STORE.lock, STORE.session() as db:
                db.execute("DELETE FROM events")
                db.commit()
            return self.send_json({"ok": True})
        if path == "/api/reset/all":
            STORE.reset_all()
            STORE.maintenance(force=True)
            return self.send_json({"ok": True})
        if path == "/api/import/config":
            STORE.import_config(body)
            return self.send_json({"ok": True})
        if path == "/api/port/check":
            port = int(body.get("port") or 0)
            free = False
            try:
                sock = socket.socket()
                sock.bind(("127.0.0.1", port))
                sock.close()
                free = True
            except Exception:
                free = False
            return self.send_json({"free": free, "port": port})
        if path == "/api/diagnostic":
            return self.send_json(self.diagnostic(body))
        if path == "/api/map/ping":
            # Single quick real ping used to drive the "signal travels along
            # the wire" animation on the network map - kept separate from
            # /api/diagnostic (which runs 4 rounds) so the map stays snappy.
            host = host_from_url(str(body.get("address") or ""))
            if not host:
                return self.send_json({"ok": False, "error": "Не указан адрес узла"})
            ok, ms = ping_host(host, 2)
            return self.send_json({"ok": ok, "ms": ms, "host": host})
        if path == "/api/network/info":
            return self.send_json({"suggested": local_network_suggestion()})
        if path == "/api/network/scan":
            return self.send_json(scan_network(body.get("subnet") or ""))
        if path == "/api/telegram/test":
            return self.send_json(send_telegram(STORE.settings(), "Тестовое сообщение от MoonFox monitor. Telegram уведомления работают."))
        if path == "/api/telegram/commands/test":
            return self.send_json({"ok": False, "error": "Telegram commands will be restored after the SQLite core is stabilized"})
        return self.send_json({"error": "unknown api"}, 404)

    def diagnostic(self, body: dict) -> dict:
        kind = body.get("kind")
        object_id = body.get("id")
        dtype = body.get("type")
        obj = None
        if kind == "map":
            # Ad-hoc diagnostics for a network-map node that isn't linked to a
            # stored site/router (or is, but the user just wants to probe the
            # raw address typed onto the node) - no STORE lookup involved.
            target = body.get("address") or ""
        else:
            obj = STORE.get_object("sites" if kind == "site" else "routers", object_id)
            if not obj:
                return {"error": "Object not found"}
            target = obj.get("url") if kind == "site" else obj.get("address")
        host = host_from_url(target or "")
        if not host:
            return {"error": "Не указан адрес для проверки"}
        if dtype == "dns":
            return {"type": "dns", "host": host, "records": dns_lookup(host)}
        if dtype == "ssl":
            return {"type": "ssl", "host": host, "certificate": ssl_info(host)}
        if dtype == "ports":
            if obj is not None:
                ports = parse_ports(obj.get("ports") or obj.get("port"))
                if kind == "site" and not ports:
                    ports = [443 if str(target).startswith("https://") else 80]
            else:
                ports = parse_ports(body.get("ports"))
            return {"type": "ports", "host": host, "ports": [{"port": p, "open": tcp_check(host, p)} for p in ports]}
        if dtype == "ping":
            values = []
            for i in range(4):
                ok, ms = ping_host(host, 3)
                values.append({"ok": ok, "ms": ms})
            return {"type": "ping", "host": host, "values": values}
        if dtype == "trace":
            cmd = ["tracert", "-d", "-h", "15", host] if platform.system().lower() == "windows" else ["traceroute", "-n", host]
            try:
                proc = subprocess.run(cmd, capture_output=True, text=True, timeout=20)
                return {"type": "trace", "host": host, "raw": proc.stdout or proc.stderr}
            except Exception as exc:
                return {"type": "trace", "host": host, "error": str(exc)}
        if dtype == "whois":
            return {"type": "whois", "host": host, "notFound": True, "error": "WHOIS/RDAP will be moved to a separate module"}
        return {"error": "Unsupported diagnostic type"}

    def static(self, path: str):
        rel = path.lstrip("/").replace("/", os.sep)
        full = (ROOT / rel).resolve()
        try:
            is_inside = full == ROOT or full.is_relative_to(ROOT)
        except Exception:
            is_inside = False
        if not is_inside or not full.exists() or not full.is_file():
            return self.send_text("Not found", status=404)
        content_types = {
            ".html": "text/html; charset=utf-8",
            ".js": "application/javascript; charset=utf-8",
            ".css": "text/css; charset=utf-8",
            ".png": "image/png",
            ".svg": "image/svg+xml",
            ".json": "application/json; charset=utf-8",
        }
        data = full.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", content_types.get(full.suffix.lower(), "application/octet-stream"))
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=None)
    parser.add_argument("--no-open", action="store_true")
    args = parser.parse_args()
    settings = STORE.settings()
    port = args.port or int(settings.get("port") or 8000)
    MONITOR.start()
    server = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    url = f"http://127.0.0.1:{port}/"
    log(f"MoonFox SQLite backend started: {url}")
    if settings.get("autoOpen", True) and not args.no_open:
        try:
            webbrowser.open(url)
        except Exception:
            pass
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        MONITOR.stop_event.set()
        STORE.maintenance(force=True)
        server.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
