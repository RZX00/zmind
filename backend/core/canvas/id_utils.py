from __future__ import annotations

"""
Canvas entity ID utilities.

Canonical format (shared with frontend):
  - 16 chars Base62: time(8) + random(8)
  - Alphabet: 0-9A-Z a-z
  - time part: ms since epoch -> Base62, left-padded to 8 chars
  - random part: uniformly sampled below 62^8, left-padded to 8 chars
"""

import re
import secrets
import time
from typing import Optional


BASE62_ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"
BASE62_BASE = len(BASE62_ALPHABET)
TIME_LEN = 8
RAND_LEN = 8
ID_LEN = TIME_LEN + RAND_LEN

_SHORT_ID_RE = re.compile(r"^[0-9A-Za-z]{16}$")
_LEGACY_SEMANTIC_RE = re.compile(r"^[a-z][\w-]*-\d+$", re.IGNORECASE)
_LEGACY_UNIQUE_RE = re.compile(r"^[a-z][\w-]*_[a-z0-9]+_[a-z0-9]+$", re.IGNORECASE)


def _encode_base62(value: int) -> str:
    if value <= 0:
        return "0"
    out = []
    v = value
    while v > 0:
        v, rem = divmod(v, BASE62_BASE)
        out.append(BASE62_ALPHABET[rem])
    return "".join(reversed(out))


def _pad_base62(value: int, length: int) -> str:
    s = _encode_base62(value)
    if len(s) < length:
        s = ("0" * (length - len(s))) + s
    elif len(s) > length:
        # Safe for millennia, but keep length stable if it ever overflows.
        s = s[-length:]
    return s


def _random_base62(length: int) -> str:
    max_value = BASE62_BASE ** length
    bits = max_value.bit_length()
    byte_len = (bits + 7) // 8
    while True:
        val = int.from_bytes(secrets.token_bytes(byte_len), "big")
        if val < max_value:
            return _pad_base62(val, length)


def generate_canvas_entity_id(now_ms: Optional[int] = None) -> str:
    """Generate a 16-char Base62 time-ordered id."""
    ts = int(now_ms if now_ms is not None else time.time() * 1000)
    time_part = _pad_base62(ts, TIME_LEN)
    rand_part = _random_base62(RAND_LEN)
    return f"{time_part}{rand_part}"


def is_canvas_entity_id(value: str) -> bool:
    return bool(_SHORT_ID_RE.fullmatch(value or ""))


def is_legacy_entity_id(value: str) -> bool:
    if not value:
        return False
    return bool(_LEGACY_SEMANTIC_RE.fullmatch(value) or _LEGACY_UNIQUE_RE.fullmatch(value))
