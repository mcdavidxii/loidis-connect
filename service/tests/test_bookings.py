import csv
import io

import pytest

from loidis_service import fake_data
from loidis_service.bookings import KNOWN_COLUMNS, parse_bookings, require_valid
from loidis_service.errors import ServiceError

from conftest import fake_names


def rows_of(data: bytes):
    return list(csv.reader(io.StringIO(data.decode())))


def to_bytes(rows):
    buf = io.StringIO()
    csv.writer(buf, lineterminator="\r\n").writerows(rows)
    return buf.getvalue().encode()


def test_real_format_has_27_columns():
    assert len(KNOWN_COLUMNS) == 27
    assert rows_of(fake_data.bookings_csv().encode())[0] == KNOWN_COLUMNS


def test_good_file(files):
    rows, info = parse_bookings(files["bookings"])
    assert info.problems == []
    assert info.week_start.isoformat() == "2026-11-16" and info.week_start.weekday() == 0
    assert info.cancelled == 2 and info.visits == info.rows - 2
    assert info.clients == 20 and info.double_ups > 0 and info.carers > 0
    assert info.unallocated > 0


def test_wrong_week(files):
    r = rows_of(files["bookings"])
    r[1][KNOWN_COLUMNS.index("Date")] = "30/11/2026"
    _, info = parse_bookings(to_bytes(r))
    assert any("2 different weeks" in p for p in info.problems)
    with pytest.raises(ServiceError) as e:
        require_valid(to_bytes(r))
    assert e.value.status == 422
    assert not (fake_names() & set(e.value.message.replace(".", " ").split()))


def test_missing_booking_id_and_duplicate(files):
    r = rows_of(files["bookings"])
    c = KNOWN_COLUMNS.index("BookingId")
    r[1][c] = ""
    r[3][c] = r[2][c]
    _, info = parse_bookings(to_bytes(r))
    assert "1 row(s) have no BookingId." in info.problems
    assert "1 row(s) repeat a BookingId." in info.problems


def test_unknown_and_missing_columns(files):
    r = rows_of(files["bookings"])
    # extra columns are only noted
    r2 = [row + ["x"] for row in r]
    r2[0][-1] = "SomethingNew"
    _, info = parse_bookings(to_bytes(r2))
    assert info.problems == [] and any("not recognised" in n for n in info.notes)
    # the wrong report (other column names): a clear error that names the columns
    wrong = [["Booking ID", "Client Ref", "Date", "Start", "End", "Booking Type", "Team"],
             ["B1", "CL-1", "2026-11-16", "08:00", "08:30", "Morning Visit", "Leeds"]]
    _, info = parse_bookings(to_bytes(wrong))
    assert info.problems and "ClientId" in info.problems[0] and "Carers" in info.problems[0]


def test_empty_and_garbage():
    _, info = parse_bookings(b"")
    assert info.problems
    _, info = parse_bookings(b"a,b\r\n1,2\r\n")
    assert info.problems


def test_bad_values_give_counts_not_values(files):
    r = rows_of(files["bookings"])
    r[1][KNOWN_COLUMNS.index("Date")] = "not a date"
    r[2][KNOWN_COLUMNS.index("Duration")] = "abc"
    r[2][KNOWN_COLUMNS.index("Finish")] = ""
    _, info = parse_bookings(to_bytes(r))
    text = " ".join(info.problems)
    assert "Date" in text and "Duration" in text and "not a date" not in text
