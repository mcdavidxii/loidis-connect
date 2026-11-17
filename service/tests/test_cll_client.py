"""The CareLineLive client: GET only, redirects refused, token never shown. A local server on
127.0.0.1 stands in for CareLineLive; there is no network and no real token."""

import threading
from http.server import BaseHTTPRequestHandler, HTTPServer

import pytest

from loidis_service import config
from loidis_service.cll import CareLineLive, load_env
from loidis_service.errors import ServiceError

TOKEN = "FAKE-TEST-TOKEN-123"
seen: list[tuple[str, str, str | None]] = []


class H(BaseHTTPRequestHandler):
    def _handle(self):
        seen.append((self.command, self.path, self.headers.get("Authorization")))
        if self.path.startswith("/api/v2/clients"):
            self.send_response(302)
            self.send_header("Location", "/api/v2/elsewhere")
            self.end_headers()
        elif self.path.startswith("/api/v2/boom"):
            self.send_response(500)
            self.end_headers()
        else:
            self.send_response(200)
            self.end_headers()
            self.wfile.write(b'{"data": []}')

    do_GET = do_POST = do_PUT = do_PATCH = do_DELETE = _handle

    def log_message(self, *a):
        pass


@pytest.fixture()
def server(monkeypatch):
    srv = HTTPServer(("127.0.0.1", 0), H)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    seen.clear()
    monkeypatch.setenv("CARELINE_API", TOKEN)
    monkeypatch.setenv("CARELINE_DOMAIN", f"http://127.0.0.1:{srv.server_port}")
    yield srv
    srv.shutdown()


def test_get_works_and_only_gets_are_sent(server):
    c = CareLineLive()
    assert c.get("/ok") == {"data": []}
    assert c.get_all("/ok") == []
    assert {m for m, _, _ in seen} == {"GET"}
    assert seen[0][2] == f"Bearer {TOKEN}"


def test_redirects_are_refused_and_the_token_stays_out_of_errors(server):
    c = CareLineLive()
    with pytest.raises(ServiceError) as e:
        c.get("/clients")
    assert "redirect refused" in e.value.message and TOKEN not in e.value.message
    assert [p for _, p, _ in seen] == ["/api/v2/clients"]  # the redirect target was never requested


def test_http_errors_name_the_status_only(server):
    c = CareLineLive()
    with pytest.raises(ServiceError) as e:
        c.get("/boom", retries=0)
    assert "HTTP 500" in e.value.message and TOKEN not in e.value.message


def test_not_configured(monkeypatch):
    monkeypatch.delenv("CARELINE_API", raising=False)
    monkeypatch.delenv("CARELINE_DOMAIN", raising=False)
    monkeypatch.delenv("CARELINE_ENV_FILE", raising=False)
    with pytest.raises(ServiceError) as e:
        CareLineLive()
    assert e.value.status == 503


def test_env_file_path(monkeypatch, tmp_path):
    p = tmp_path / "env"
    p.write_text(f"CARELINE_API={TOKEN}\nCARELINE_DOMAIN=example\n")
    monkeypatch.delenv("CARELINE_API", raising=False)
    monkeypatch.delenv("CARELINE_DOMAIN", raising=False)
    monkeypatch.setenv("CARELINE_ENV_FILE", str(p))
    c = CareLineLive()
    assert c._base == "https://example.carelinelive.app/api/v2"
    assert load_env(str(p), {"careline_api"}) == {"careline_api": TOKEN}


def test_no_write_methods_in_the_client():
    import inspect

    from loidis_service import cll

    src = inspect.getsource(cll)
    for verb in ("POST", "PUT", "PATCH", "DELETE"):
        assert f'method="{verb}"' not in src and f"method='{verb}'" not in src


def test_fake_api_mode_never_builds_the_real_client(monkeypatch):
    from loidis_service import cll

    def boom(*a, **k):
        raise AssertionError("the real client must not be used in fake mode")

    monkeypatch.setattr(cll.CareLineLive, "__init__", boom)
    assert config.fake_api()
    assert len(cll.fetch_api_data().carers) == 13
