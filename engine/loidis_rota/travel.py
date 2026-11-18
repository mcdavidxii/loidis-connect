"""Travel time estimates.

Prototype only: straight-line distance times a road factor, at a typical speed for each
travel mode, plus a fixed overhead (parking, waiting for a bus). Replace with road
routing (OSRM or Google Maps) before real use.
"""

from __future__ import annotations

import math

from .models import Location

ROAD_FACTOR = 1.35  # roads are longer than straight lines

# (speed in km/h, fixed overhead in minutes)
MODES = {
    "car": (28.0, 3),
    "bus": (14.0, 8),
    "foot": (4.5, 0),
}


def distance_km(a: Location, b: Location) -> float:
    r = 6371.0
    p1, p2 = math.radians(a.lat), math.radians(b.lat)
    dp = p2 - p1
    dl = math.radians(b.lon - a.lon)
    h = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(h)) * ROAD_FACTOR


def travel_minutes(a: Location, b: Location, mode: str) -> int:
    km = distance_km(a, b)
    if km < 0.05:
        return 0
    speed, overhead = MODES[mode]
    return int(round(km / speed * 60)) + overhead


def miles(a: Location, b: Location) -> float:
    return distance_km(a, b) / 1.609


# --- pluggable travel ---------------------------------------------------------------------
class TravelProvider:
    """Travel time and distance between two places for a mode of travel.

    The default (EstimateTravel) is the estimate above. A Problem carries one provider
    (`problem.travel`), used by the solver, the report and the scoring of a current rota, so
    every plan being compared uses the same travel figures. Providers are not part of the
    Problem JSON."""

    def minutes(self, a: Location, b: Location, mode: str) -> int:
        raise NotImplementedError

    def miles(self, a: Location, b: Location, mode: str = "car") -> float:
        raise NotImplementedError


class EstimateTravel(TravelProvider):
    """Straight line x road factor, at a typical speed per mode (the prototype default)."""

    def minutes(self, a, b, mode):
        return travel_minutes(a, b, mode)

    def miles(self, a, b, mode="car"):
        return miles(a, b)


class MatrixTravel(TravelProvider):
    """Precomputed car travel between places (for example from road routing), keyed by
    (from, to) location. Any pair not in the table, and every other mode of travel, falls back
    to `fallback` (the estimate by default), so a partial table is safe.

    table[(a, b)] = (minutes, miles) for driving. The fixed overhead (parking) of the car
    estimate is added to the table's driving minutes, as in the estimate."""

    def __init__(self, table: dict, fallback: TravelProvider | None = None):
        self.table = table
        self.fallback = fallback or EstimateTravel()

    def minutes(self, a, b, mode):
        if mode == "car":
            hit = self.table.get((a, b))
            if hit is not None:
                return 0 if hit[1] < 0.03 else int(round(hit[0])) + MODES["car"][1]
        return self.fallback.minutes(a, b, mode)

    def miles(self, a, b, mode="car"):
        if mode == "car":
            hit = self.table.get((a, b))
            if hit is not None:
                return hit[1]
        return self.fallback.miles(a, b, mode)
