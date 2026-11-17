"""Runs in its own process: the engine search for one region.

OR-Tools holds Python's global lock while it searches, so a thread would freeze the web
server; a process does not, can be stopped at once when a run is deleted, and lets two
regions search at the same time.
"""

from __future__ import annotations


def solve_region(index: int, problem, seconds_per_day: int, queue) -> None:
    from loidis_rota.solver import solve_week

    try:
        def progress(day, res):
            queue.put(("day", index, day))

        week = solve_week(problem, seconds_per_day, progress)
        queue.put(("done", index, week))
    except BaseException as e:  # noqa: BLE001 - only the class name is reported, never the text
        queue.put(("error", index, type(e).__name__))
