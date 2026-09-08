import dotenv

dotenv.load_dotenv(".env")

import asyncio
import os

from core.infrastructure.outbox.outbox_relay import run_default_outbox_relay


def _parse_float(value: str | None, default: float) -> float:
    if not value:
        return default
    try:
        return float(value)
    except ValueError:
        return default


def _parse_int(value: str | None, default: int) -> int:
    if not value:
        return default
    try:
        return int(value)
    except ValueError:
        return default


if __name__ == "__main__":
    interval_sec = _parse_float(os.getenv("OUTBOX_RELAY_INTERVAL_SEC"), 2.0)
    batch_size = _parse_int(os.getenv("OUTBOX_RELAY_BATCH_SIZE"), 100)
    asyncio.run(run_default_outbox_relay(interval_sec=interval_sec, batch_size=batch_size))
