"""Match carer names in the bookings CSV (names only, no IDs) to CareLineLive carers.

Order: the settings file's saved matches first, then the API names (first or preferred name
with the last name, either way round), then the name saved for the carer in the settings
file. A name that fits more than one carer is left unmatched for the coordinator to confirm.
"""

from __future__ import annotations

from .cll import ApiCarer, ApiData
from .settings_file import SettingsFile, norm_name


def name_variants(c: ApiCarer) -> set[str]:
    out = set()
    for first in (c.first_name, c.preferred_name):
        if first and c.last_name:
            out |= {norm_name(f"{first} {c.last_name}"), norm_name(f"{c.last_name} {first}")}
    return out


def match_carers(
    booking_names: set[str], api: ApiData, settings: SettingsFile | None
) -> tuple[dict[str, str], list[str]]:
    """Returns ({booking name: carer id}, [booking names that could not be matched])."""
    saved = settings.saved_matches() if settings else {}
    api_ids = {c.id for c in api.carers}
    by_variant: dict[str, set[str]] = {}
    for c in api.carers:
        for v in name_variants(c):
            by_variant.setdefault(v, set()).add(c.id)
    if settings:
        for sc in settings.carers:
            if sc.name:
                by_variant.setdefault(norm_name(sc.name), set()).add(sc.id)

    matched: dict[str, str] = {}
    unmatched: list[str] = []
    for name in sorted(booking_names):
        key = norm_name(name)
        cid = saved.get(key)
        if cid and (cid in api_ids or (settings and settings.carer(cid))):
            matched[name] = cid
            continue
        hits = by_variant.get(key, set())
        if len(hits) == 1:
            matched[name] = next(iter(hits))
        else:
            unmatched.append(name)
    return matched, unmatched


def carer_name_sets(api: ApiData, settings: SettingsFile | None, matches: dict[str, str]) -> dict[str, set[str]]:
    """carer id -> normalised names that identify them (for the Continuity report)."""
    out: dict[str, set[str]] = {c.id: name_variants(c) for c in api.carers}
    if settings:
        for sc in settings.carers:
            if sc.name:
                out.setdefault(sc.id, set()).add(norm_name(sc.name))
    for name, cid in matches.items():
        out.setdefault(cid, set()).add(norm_name(name))
    return out
