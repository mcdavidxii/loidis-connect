"""Runs: kept in memory only, one worker thread per run, one search process per region.

Nothing is written to disk. A run (its uploaded files and its result) is deleted by
`DELETE /runs/{id}`, when it is older than RUN_TTL_MINUTES, and on shutdown. Logs name the
run ID, counts, timings and status only.
"""

from __future__ import annotations

import logging
import multiprocessing as mp
import queue as queue_mod
import threading
import time
import traceback
import uuid
from dataclasses import dataclass, field

from . import config
from .bookings import require_valid
from .build import build
from .cll import fetch_api_data
from .draftcheck import apply_draft, parse_draft
from .errors import ServiceError
from .result import build_result
from .schedules import parse_client_list, scheduled_bookings
from .settings_file import SettingsFile
from .worker import solve_region

log = logging.getLogger("loidis_service")


@dataclass
class Run:
    id: str
    created: float
    status: str = "queued"
    progress: float = 0.0
    message: str = "Waiting to start"
    result: dict | None = None
    inputs: dict | None = None  # uploaded files; cleared when the run ends
    cancel: threading.Event = field(default_factory=threading.Event)
    procs: list = field(default_factory=list)
    thread: threading.Thread | None = None

    def state(self) -> dict:
        out = {"status": self.status, "progress": round(self.progress, 3), "message": self.message}
        if self.status == "done" and self.result is not None:
            out["result"] = self.result
        return out


class RunStore:
    def __init__(self, ttl_minutes: float | None = None) -> None:
        self.ttl = (config.RUN_TTL_MINUTES if ttl_minutes is None else ttl_minutes) * 60
        self._runs: dict[str, Run] = {}
        self._lock = threading.Lock()
        self._stop = threading.Event()
        self._janitor = threading.Thread(target=self._sweep, name="run-expiry", daemon=True)
        self._janitor.start()

    # ---- lifecycle --------------------------------------------------------------------
    def create(self, inputs: dict) -> Run:
        run = Run(id=uuid.uuid4().hex, created=time.time(), inputs=inputs)
        with self._lock:
            self._runs[run.id] = run
        log.info("run %s created mode=%s", run.id[:8], inputs["mode"])
        run.thread = threading.Thread(target=self._execute, args=(run,), name=f"run-{run.id[:8]}", daemon=True)
        run.thread.start()
        return run

    def get(self, run_id: str) -> Run | None:
        with self._lock:
            return self._runs.get(run_id)

    def ids(self) -> list[str]:
        with self._lock:
            return list(self._runs)

    def delete(self, run_id: str) -> bool:
        with self._lock:
            run = self._runs.pop(run_id, None)
        if run is None:
            return False
        self._discard(run)
        log.info("run %s deleted", run.id[:8])
        return True

    @staticmethod
    def _discard(run: Run) -> None:
        run.cancel.set()
        for p in list(run.procs):
            try:
                if p.is_alive():
                    p.terminate()
                p.join(timeout=5)
            except Exception:  # noqa: BLE001
                pass
        run.procs.clear()
        run.inputs = None
        run.result = None

    @staticmethod
    def _discard_procs(run: Run) -> None:
        for p in list(run.procs):
            try:
                if p.is_alive():
                    p.terminate()
                p.join(timeout=5)
            except Exception:  # noqa: BLE001
                pass
        run.procs.clear()

    def _sweep(self) -> None:
        while not self._stop.wait(15):
            self.purge_expired()

    def purge_expired(self) -> int:
        now = time.time()
        with self._lock:
            old = [r for r in self._runs.values() if now - r.created > self.ttl]
            for r in old:
                self._runs.pop(r.id, None)
        for r in old:
            self._discard(r)
            log.info("run %s expired", r.id[:8])
        return len(old)

    def shutdown(self) -> None:
        self._stop.set()
        with self._lock:
            runs = list(self._runs.values())
            self._runs.clear()
        for r in runs:
            self._discard(r)
        log.info("all runs discarded (%d)", len(runs))

    # ---- the run itself ------------------------------------------------------------------
    def _set(self, run: Run, progress: float, message: str, status: str = "running") -> None:
        if run.cancel.is_set():
            return
        run.status, run.progress, run.message = status, progress, message

    def _execute(self, run: Run) -> None:
        t0 = time.time()
        try:
            inp = run.inputs
            assert inp is not None
            self._set(run, 0.02, "Reading the bookings and settings")
            settings = SettingsFile.from_json(inp["settings"]) if inp.get("settings") else None
            draft_check = None
            sched_info = None
            if inp.get("source") == "schedules":
                if settings is None:
                    raise ServiceError("A draft from client schedules needs the settings file (it holds the schedules).", 422)
                rows = parse_client_list(inp["client_list"]) if inp.get("client_list") else []
                suspended = {r["ref"] for r in rows if r["suspended"]}
                bookings, sched_info = scheduled_bookings(
                    settings, inp["week_start"], suspended, {r["ref"]: r["name"] for r in rows if r["name"]})
                if not bookings:
                    raise ServiceError("No confirmed client schedule has a visit in that week.", 422)
            else:
                bookings, _info = require_valid(inp["bookings"])
                if inp.get("draft"):
                    draft_check = apply_draft(bookings, parse_draft(inp["draft"]))
            self._set(run, 0.08, "Reading carers and clients from CareLineLive")
            api = fetch_api_data()
            if sched_info is not None:
                team_of = {c.id: c.team for c in api.clients}
                ref_of = {c.id: c.ref for c in api.clients}
                for b in bookings:
                    if not b.teams and team_of.get(b.client_id):
                        b.teams = [team_of[b.client_id]]
                    b.client_ref = b.client_ref or ref_of.get(b.client_id, "")
                sched_info["suspended_ids"] |= {
                    c.id for c in api.clients if c.ref and c.ref in {r["ref"] for r in rows if r["suspended"]}}
            self._set(run, 0.14, "Building travel times and rules")
            b = build(bookings, api, settings, inp["mode"], inp["change_cost_pence"], inp["locks"], inp.get("continuity"),
                      sched_info)
            cost = int(inp["change_cost_pence"])
            inp.clear()  # the uploaded files are no longer needed

            weeks = self._search(run, b)
            if weeks is None:
                return  # cancelled
            self._set(run, 0.96, "Checking the result")
            result = build_result(b, weeks, cost)
            result["draft_check"] = draft_check
            if run.cancel.is_set():
                return
            run.result = result
            run.status, run.progress, run.message = "done", 1.0, "Done"
            log.info(
                "run %s done in %.1fs visits=%d changes=%d warnings=%d", run.id[:8], time.time() - t0,
                result["comparison"]["engine"]["visits"], len(result["changes"]), len(result["warnings"]),
            )
        except ServiceError as e:
            self._fail(run, e.message, f"ServiceError({e.status})")
        except Exception as e:  # noqa: BLE001
            tb = traceback.extract_tb(e.__traceback__)[-1] if e.__traceback__ else None
            where = f"{tb.filename.split('/')[-1].split(chr(92))[-1]}:{tb.lineno}" if tb else "?"
            self._fail(run, "The run failed because of an internal error. Nothing was changed.", f"{type(e).__name__} at {where}")
        finally:
            run.inputs = None

    def _fail(self, run: Run, message: str, detail: str) -> None:
        if run.cancel.is_set():
            return
        run.status, run.message = "failed", message
        log.warning("run %s failed: %s", run.id[:8], detail)

    def _search(self, run: Run, b):
        regions = b.regions
        ctx = mp.get_context("spawn")
        q = ctx.Queue()
        for i, rb in enumerate(regions):
            p = ctx.Process(target=solve_region, args=(i, rb.problem, b.seconds_per_day, q), daemon=True)
            p.start()
            run.procs.append(p)  # only started processes are listed, so a DELETE can always stop them
            if run.cancel.is_set():
                break
        if run.cancel.is_set():
            self._discard_procs(run)
            return None
        total = 7 * len(regions)
        days_done = 0
        weeks: dict[str, list] = {}
        self._set(run, 0.18, f"Planning {regions[0].name}, day 1 of 7" if len(regions) == 1 else "Planning day 1 of 7")
        while len(weeks) < len(regions):
            if run.cancel.is_set():
                self._discard_procs(run)
                return None
            try:
                kind, idx, payload = q.get(timeout=0.5)
            except queue_mod.Empty:
                if any(not p.is_alive() and p.exitcode not in (0, None) for p in run.procs):
                    raise ServiceError("The planning process stopped unexpectedly.", 500)
                continue
            if kind == "error":
                raise ServiceError(f"The plan could not be made for {regions[idx].name} ({payload}).", 500)
            if kind == "day":
                days_done += 1
                shown = min(7, days_done // len(regions) + 1)
                self._set(run, 0.18 + 0.76 * days_done / total, f"Planning day {shown} of 7")
            else:
                weeks[regions[idx].name] = payload
        for p in run.procs:
            p.join(timeout=10)
        run.procs.clear()
        return weeks
