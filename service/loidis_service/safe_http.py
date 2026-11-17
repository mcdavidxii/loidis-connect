"""urllib opener that refuses every redirect, so the bearer token is only ever sent to the
URL originally requested (urllib's default handler copies the Authorization header to the
redirect target). The error names the status code only, never a URL.

Same approach as tools/shadow_trial/safe_http.py."""

import urllib.request


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise RuntimeError(f"HTTP {code} redirect refused")


def build_opener():
    return urllib.request.build_opener(NoRedirect)
