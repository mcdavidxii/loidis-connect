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
