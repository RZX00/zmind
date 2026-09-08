from __future__ import annotations

from datetime import datetime, timedelta
from typing import Iterable

try:
    from croniter import croniter  # type: ignore
except Exception:  # pragma: no cover - optional dependency fallback
    croniter = None  # type: ignore[assignment]


def compute_retry_delay_ms(retry_count: int) -> int:
    schedule_ms = [60_000, 5 * 60_000, 15 * 60_000, 60 * 60_000, 2 * 60 * 60_000]
    index = max(0, min(retry_count - 1, len(schedule_ms) - 1))
    return schedule_ms[index]


def is_schedule_due(cron_expression: str, local_now: datetime) -> bool:
    if croniter is None:
        return _fallback_is_schedule_due(cron_expression, local_now)

    minute_mark = local_now.replace(second=0, microsecond=0)
    probe_base = minute_mark + timedelta(minutes=1)
    try:
        previous_fire = croniter(cron_expression, probe_base).get_prev(datetime)
    except Exception:
        return False
    return previous_fire.replace(second=0, microsecond=0) == minute_mark


def next_schedule_time(cron_expression: str, base_time: datetime) -> datetime | None:
    if croniter is not None:
        try:
            return croniter(cron_expression, base_time).get_next(datetime)
        except Exception:
            return None
    return _fallback_next_schedule_time(cron_expression, base_time)


def _fallback_is_schedule_due(cron_expression: str, local_now: datetime) -> bool:
    fields = cron_expression.strip().split()
    if len(fields) != 5:
        return False

    minute, hour, day_of_month, month, day_of_week = fields
    minute_val = local_now.minute
    hour_val = local_now.hour
    day_val = local_now.day
    month_val = local_now.month
    weekday_val = (local_now.weekday() + 1) % 7  # cron: Sunday=0, Python: Monday=0

    if not _field_matches(minute, minute_val, 0, 59):
        return False
    if not _field_matches(hour, hour_val, 0, 23):
        return False
    if not _field_matches(month, month_val, 1, 12):
        return False

    dom_match = _field_matches(day_of_month, day_val, 1, 31)
    dow_match = _field_matches(day_of_week, weekday_val, 0, 7)

    if day_of_month != "*" and day_of_week != "*":
        # Standard cron semantics: day-of-month and day-of-week are OR-ed.
        return dom_match or dow_match
    return dom_match and dow_match


def _fallback_next_schedule_time(cron_expression: str, base_time: datetime) -> datetime | None:
    cursor = base_time.replace(second=0, microsecond=0) + timedelta(minutes=1)
    horizon = cursor + timedelta(days=366)
    while cursor <= horizon:
        if _fallback_is_schedule_due(cron_expression, cursor):
            return cursor
        cursor += timedelta(minutes=1)
    return None


def _field_matches(field: str, value: int, min_value: int, max_value: int) -> bool:
    field = field.strip()
    if field == "*":
        return True
    if field.startswith("*/"):
        try:
            step = int(field[2:])
        except Exception:
            return False
        if step <= 0:
            return False
        return (value - min_value) % step == 0

    candidates = _expand_field(field, min_value, max_value)
    return value in candidates


def _expand_field(field: str, min_value: int, max_value: int) -> set[int]:
    results: set[int] = set()
    for part in field.split(","):
        token = part.strip()
        if not token:
            continue
        if "-" in token:
            try:
                start_s, end_s = token.split("-", 1)
                start = int(start_s)
                end = int(end_s)
            except Exception:
                continue
            for item in _range_inclusive(start, end):
                if min_value <= item <= max_value:
                    # Cron allows 7 for Sunday; normalize to 0.
                    results.add(0 if item == 7 and max_value == 7 else item)
            continue
        try:
            numeric = int(token)
        except Exception:
            continue
        if numeric == 7 and max_value == 7:
            numeric = 0
        if min_value <= numeric <= max_value:
            results.add(numeric)
    return results


def _range_inclusive(start: int, end: int) -> Iterable[int]:
    if start <= end:
        return range(start, end + 1)
    return ()
