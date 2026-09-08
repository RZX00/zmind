#!/usr/bin/env python3
import os
import sys
from pathlib import Path
from typing import Dict, Tuple, List

import httpx


REQUIRED_COLUMNS = [
    "is_public",
    "is_listed",
    "listed_at",
    "timeline_enabled",
    "public_shows_timeline",
    "author_user_id",
    "author_display_name",
    "author_avatar_url",
]

OPTIONAL_COLUMNS = [
    "preview_url",
]


def load_env_file(path: Path) -> Dict[str, str]:
    if not path.exists():
        return {}
    data: Dict[str, str] = {}
    try:
        for raw in path.read_text().splitlines():
            line = raw.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            key = key.strip()
            value = value.strip().strip('"').strip("'")
            data[key] = value
    except Exception:
        return data
    return data


def resolve_config() -> Tuple[str, str]:
    url = os.getenv("SUPABASE_URL")
    key = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
    if url and key:
        return url, key

    backend_env = load_env_file(Path("backend") / ".env")
    url = url or backend_env.get("SUPABASE_URL")
    key = key or backend_env.get("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not key:
        raise RuntimeError("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY")
    return url, key


def check_column(base_url: str, service_key: str, column: str) -> Tuple[bool, str]:
    url = f"{base_url.rstrip('/')}/rest/v1/canvases"
    headers = {
        "apikey": service_key,
        "Authorization": f"Bearer {service_key}",
    }
    params = {"select": column, "limit": 1}
    resp = httpx.get(url, headers=headers, params=params, timeout=10.0)
    if resp.status_code < 400:
        return True, ""
    return False, resp.text.strip()


def main() -> int:
    try:
        base_url, service_key = resolve_config()
    except RuntimeError as exc:
        print(f"[schema-check] {exc}")
        return 2

    missing_required: List[str] = []
    missing_optional: List[str] = []

    for column in REQUIRED_COLUMNS:
        ok, err = check_column(base_url, service_key, column)
        if not ok:
            print(f"[schema-check] missing column: {column} ({err})")
            missing_required.append(column)

    for column in OPTIONAL_COLUMNS:
        ok, err = check_column(base_url, service_key, column)
        if not ok:
            print(f"[schema-check] optional column missing: {column} ({err})")
            missing_optional.append(column)

    if missing_required:
        print("[schema-check] canvas share schema incomplete.")
        print(f"[schema-check] missing required columns: {', '.join(missing_required)}")
        return 1

    print("[schema-check] canvas share schema OK.")
    if missing_optional:
        print(f"[schema-check] missing optional columns: {', '.join(missing_optional)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
