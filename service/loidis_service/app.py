"""The HTTP API (docs/ENGINE_API.md). Errors are `{"error": "<plain message>"}`.

No request or response body is ever logged. Error messages carry counts, column names and
IDs only.
"""

from __future__ import annotations

import json
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse, Response
from starlette.exceptions import HTTPException as StarletteHTTPException

from . import config
from .bookings import monday_of, parse_bookings, require_valid
from .cll import fetch_api_data
from .continuity import parse_continuity
from .errors import ServiceError
from .matching import match_carers
from .result import allocation_csv, changes_csv, notes_csv
from .runs import RunStore
from .settings_file import SettingsFile

log = logging.getLogger("loidis_service")


def _json(body, status: int = 200) -> JSONResponse:
    return JSONResponse(body, status_code=status, headers={"Cache-Control": "no-store"})


def _download(text: str, filename: str, media: str, bom: bool = False) -> Response:
    return Response(
        text.encode("utf-8-sig" if bom else "utf-8"),  # BOM (exports only) so Excel shows names and pound signs
        media_type=f"{media}; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{filename}"', "Cache-Control": "no-store"},
    )


async def _read_form(request: Request):
    try:
        return await request.form()
    except Exception:  # noqa: BLE001
        raise ServiceError("Expected a multipart form.", 400) from None


async def _file(form, name: str, required: bool = False) -> bytes | None:
    f = form.get(name)
    if f is None or isinstance(f, str):
        if required:
            raise ServiceError(f"The {name} file is required.", 400)
        return None
    data = await f.read()
    if len(data) > config.MAX_UPLOAD_MB * 1024 * 1024:
        raise ServiceError(f"The {name} file is larger than {config.MAX_UPLOAD_MB:g} MB.", 413)
    if not data:
        if required:
            raise ServiceError(f"The {name} file is empty.", 400)
        return None
    return data


def create_app(store: RunStore | None = None) -> FastAPI:
    holder = {"store": store}

    @asynccontextmanager
    async def lifespan(_app: FastAPI):
        if holder["store"] is None:
            holder["store"] = RunStore()
        log.info("engine service started fake_api=%s", config.fake_api())
        yield
        holder["store"].shutdown()  # type: ignore[union-attr]
        log.info("engine service stopped")

    app = FastAPI(title="Loidis Connect engine service", lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None)

    def runs() -> RunStore:
        return holder["store"]  # type: ignore[return-value]

    @app.middleware("http")
    async def _never_leak(request: Request, call_next):
        """Any unexpected error becomes a plain 500 here, so a traceback (whose text could
        quote data) never reaches the server log. Only the error class is logged."""
        try:
            return await call_next(request)
        except Exception as e:  # noqa: BLE001
            log.error("unexpected error %s", type(e).__name__)
            return _json({"error": "The service hit an unexpected error."}, 500)

    # ---- errors: plain messages, no echoed input ---------------------------------------
    @app.exception_handler(ServiceError)
    async def _service_error(_r: Request, e: ServiceError):
        return _json({"error": e.message}, e.status)

    @app.exception_handler(StarletteHTTPException)
    async def _http_error(_r: Request, e: StarletteHTTPException):
        return _json({"error": "Not found." if e.status_code == 404 else "The request could not be handled."}, e.status_code)

    @app.exception_handler(RequestValidationError)
    async def _validation_error(_r: Request, _e: RequestValidationError):
        return _json({"error": "The request was not valid."}, 422)

    @app.exception_handler(Exception)
    async def _unexpected(_r: Request, e: Exception):
        log.error("unexpected error %s", type(e).__name__)
        return _json({"error": "The service hit an unexpected error."}, 500)

    # ---- endpoints ------------------------------------------------------------------------
    @app.get("/health")
    async def health():
        return _json({"ok": True, "mock": False, "fake_api": config.fake_api()})

    @app.post("/runs", status_code=201)
    async def create_run(request: Request):
        form = await _read_form(request)
        bookings = await _file(form, "bookings", required=True)
        settings = await _file(form, "settings")
        continuity = await _file(form, "continuity")
        mode = form.get("mode")
        if mode not in ("new", "improve"):
            raise ServiceError("mode must be 'new' or 'improve'.", 400)
        try:
            cost = int(float(form.get("change_cost_pence") or 1000))
        except (TypeError, ValueError):
            raise ServiceError("change_cost_pence must be a number.", 400) from None
        locks: dict[str, str] = {}
        raw_locks = form.get("locks")
        if isinstance(raw_locks, str) and raw_locks.strip():
            try:
                locks = json.loads(raw_locks)
                if not isinstance(locks, dict) or not all(isinstance(k, str) and isinstance(v, str) for k, v in locks.items()):
                    raise ValueError
            except ValueError:
                raise ServiceError("locks must be a JSON object of booking ID to carer ID.", 400) from None
        # cheap checks now, so a bad file is a 4xx at once rather than a failed run later
        require_valid(bookings)
        if settings:
            SettingsFile.from_json(settings)
        if continuity:
            parse_continuity(continuity)
        run = runs().create(
            {"bookings": bookings, "settings": settings, "continuity": continuity, "mode": mode,
             "change_cost_pence": cost, "locks": locks}
        )
        return _json({"run_id": run.id}, 201)

    @app.post("/validate")
    async def validate(request: Request):
        """Counts and problems for a bookings file (not in the contract; handy for tests)."""
        form = await _read_form(request)
        data = await _file(form, "bookings", required=True)
        _rows, info = parse_bookings(data)
        return _json(info.to_dict())

    def get_run(run_id: str):
        run = runs().get(run_id)
        if run is None:
            raise ServiceError("Run not found (it may have been deleted).", 404)
        return run

    @app.get("/runs/{run_id}")
    async def run_state(run_id: str):
        return _json(get_run(run_id).state())

    @app.delete("/runs/{run_id}")
    async def delete_run(run_id: str):
        if not runs().delete(run_id):
            raise ServiceError("Run not found (it may have been deleted).", 404)
        return _json({"deleted": True})

    @app.get("/runs/{run_id}/export/allocation.csv")
    async def export_allocation(run_id: str):
        run = get_run(run_id)
        if run.result is None:
            raise ServiceError("No result yet.", 409)
        return _download(allocation_csv(run.result), "allocation.csv", "text/csv", bom=True)

    @app.get("/runs/{run_id}/export/changes.csv")
    async def export_changes(run_id: str):
        run = get_run(run_id)
        if run.result is None:
            raise ServiceError("No result yet.", 409)
        return _download(changes_csv(run.result), "changes.csv", "text/csv", bom=True)

    @app.get("/runs/{run_id}/export/notes.csv")
    async def export_notes(run_id: str):
        run = get_run(run_id)
        if run.result is None:
            raise ServiceError("No result yet.", 409)
        return _download(notes_csv(run.result), "notes.csv", "text/csv", bom=True)

    @app.post("/sync")
    async def sync(request: Request):
        form = await _read_form(request)
        settings_raw = await _file(form, "settings")
        bookings_raw = await _file(form, "bookings")
        settings = SettingsFile.from_json(settings_raw) if settings_raw else None
        bookings = []
        if bookings_raw:
            rows, _info = parse_bookings(bookings_raw)
            bookings = [b for b in rows if not b.cancelled]
        api = fetch_api_data()
        api_carer_team = {c.id: c.teams for c in api.carers}

        ref_of: dict[str, str] = {}
        team_of: dict[str, str] = {}
        for b in bookings:
            ref_of.setdefault(b.client_id, b.client_ref)
            team_of.setdefault(b.client_id, b.team)
        clients_out = []
        for c in api.clients:
            sc = settings.client(c.id) if settings else None
            clients_out.append({
                "id": c.id,
                "ref": c.ref or ref_of.get(c.id) or (sc.ref if sc else "") or "",
                "team": c.team or team_of.get(c.id) or (sc.team if sc else "") or "",
            })
        client_label = {c["id"]: c["ref"] or c["id"] for c in clients_out}

        match_map: dict[str, str] = {}
        unmatched: list[str] = []
        if bookings:
            match_map, unmatched = match_carers({n for b in bookings for n in b.carer_names}, api, settings)
        teams_from_bookings: dict[str, list[str]] = {}
        for b in bookings:
            for n in b.carer_names:
                cid = match_map.get(n)
                if cid and b.team and b.team not in teams_from_bookings.setdefault(cid, []):
                    teams_from_bookings[cid].append(b.team)
        carers_out = []
        for c in api.carers:
            sc = settings.carer(c.id) if settings else None
            teams = (sc.teams if sc and sc.teams else None) or api_carer_team.get(c.id) or teams_from_bookings.get(c.id, [])
            carers_out.append({"id": c.id, "name": (sc.name if sc and sc.name else "") or c.display_name, "teams": list(teams)})

        in_week = {b.client_id for b in bookings}
        no_address = [
            client_label[c.id] for c in api.clients if not c.geo_ok and (not bookings or c.id in in_week)
        ]
        result = {
            "counts": {
                "carers": len(api.carers), "clients": len(api.clients),
                "addresses": sum(1 for c in api.clients if c.geo_ok), "leave": len(api.leaves),
            },
            "carers": carers_out,
            "clients": clients_out,
            "missing": {
                "addresses": no_address,
                "carers_not_in_settings": [c.id for c in api.carers if c.active and not (settings and settings.carer(c.id))],
                "clients_not_in_settings": [
                    client_label[c.id] for c in api.clients if not (settings and settings.client(c.id))
                    and (not bookings or c.id in in_week)
                ],
                "unmatched_booking_carers": unmatched,
            },
        }
        log.info("sync carers=%d clients=%d unmatched=%d", len(api.carers), len(api.clients), len(unmatched))
        return _json(result)

    @app.get("/sample/bookings.csv")
    async def sample_bookings():
        from . import fake_data

        return _download(fake_data.bookings_csv(), "sample-bookings.csv", "text/csv")

    @app.get("/sample/settings.json")
    async def sample_settings():
        from . import fake_data

        # without the nickname match, so the name-matching step has something to confirm
        return _download(json.dumps(fake_data.settings_dict(all_matches=False), indent=2), "sample-settings.json", "application/json")

    return app


app = create_app()
