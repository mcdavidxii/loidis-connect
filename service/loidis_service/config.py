"""Settings from environment variables. Nothing here is a secret except the CareLineLive
token, which is read at the moment of use and never stored in a variable that is logged."""

import os

RUN_TTL_MINUTES = float(os.environ.get("RUN_TTL_MINUTES", "60"))
MAX_UPLOAD_MB = float(os.environ.get("MAX_UPLOAD_MB", "25"))
# Which CareLineLive team belongs to which planning region. Overridden by agency.team_regions
# in the settings file.
DEFAULT_TEAM_REGIONS = {"Leeds": "Leeds", "Dorchester": "Dorset", "Weymouth": "Dorset"}


def fake_api() -> bool:
    """True when ENGINE_FAKE_API is 1/true/yes: serve made-up CareLineLive data, no network."""
    return os.environ.get("ENGINE_FAKE_API", "").strip().lower() in {"1", "true", "yes"}
