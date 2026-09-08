#!/usr/bin/env python3
"""
Env switcher for frontend/backend.

Features:
- apply <profile>: merge preset(s) into place (only preset keys updated; use --backup to enable file backups)
- save <profile>: capture current envs into presets
- list: list available profiles
- diff <profile>: show diff between current and preset(s)

Presets live under .env-presets/ with filenames:
  - frontend.<profile>.env
  - backend.<profile>.env

Targets and paths:
  - frontend -> frontend/.env.local
  - backend  -> backend/.env

All preset files and env files should be kept out of git history.
This script only copies (no symlinks) for portability.
"""

from __future__ import annotations

import argparse
import difflib
import os
import shutil
import sys
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Iterable, List, Optional, Set, Tuple


ROOT = Path(__file__).resolve().parents[1]
PRESETS_DIR = ROOT / ".env-presets"


@dataclass(frozen=True)
class Target:
    name: str
    dest: Path
    preset_pattern: str  # e.g. "frontend.{profile}.env"
    partial: bool = True  # When True only keys in preset are updated on apply

    def preset_path(self, profile: str) -> Path:
        return PRESETS_DIR / self.preset_pattern.format(profile=profile)


TARGETS = {
    "frontend": Target(
        name="frontend",
        dest=ROOT / "frontend/.env.local",
        preset_pattern="frontend.{profile}.env",
        partial=True,
    ),
    "backend": Target(
        name="backend",
        dest=ROOT / "backend/.env",
        preset_pattern="backend.{profile}.env",
        partial=True,
    ),
}


def eprint(*args, **kwargs):
    print(*args, file=sys.stderr, **kwargs)


def ensure_presets_dir() -> None:
    PRESETS_DIR.mkdir(parents=True, exist_ok=True)


def list_profiles() -> Set[str]:
    ensure_presets_dir()
    profiles: Set[str] = set()
    for p in PRESETS_DIR.glob("*.env"):
        # expect names like frontend.<profile>.env or backend.<profile>.env
        parts = p.name.split(".")
        if len(parts) >= 3 and parts[0] in TARGETS and parts[-1] == "env":
            # join middle parts as profile (support dots inside profile)
            profile = ".".join(parts[1:-1])
            profiles.add(profile)
    return profiles


def env_flag(name: str, default: bool = False) -> bool:
    val = os.environ.get(name)
    if val is None:
        return default
    return val.strip().lower() in {"1", "true", "yes", "on"}


def backup_path(path: Path) -> Path:
    ts = datetime.now().strftime("%Y%m%d-%H%M%S")
    return path.with_name(path.name + f".bak-{ts}")


def copy_with_backup(src: Path, dest: Path, *, backup: bool = True) -> Path:
    dest.parent.mkdir(parents=True, exist_ok=True)
    if backup and dest.exists():
        bak = backup_path(dest)
        shutil.copy2(dest, bak)
    shutil.copy2(src, dest)
    return dest


def parse_env_lines(path: Path) -> List[str]:
    if not path.exists():
        return []
    return path.read_text(encoding="utf-8").splitlines(keepends=True)


def extract_key(line: str) -> Optional[str]:
    stripped = line.strip()
    if not stripped or stripped.startswith("#"):
        return None
    if "=" not in line:
        return None
    key, _ = line.split("=", 1)
    key = key.strip()
    if not key:
        return None
    return key


def load_env_map(path: Path) -> dict:
    env_map = {}
    for line in parse_env_lines(path):
        key = extract_key(line)
        if key:
            env_map[key] = line if line.endswith("\n") else f"{line}\n"
    return env_map


def apply_partial_env(dest: Path, updates: dict, *, backup: bool = True) -> None:
    dest.parent.mkdir(parents=True, exist_ok=True)
    if backup and dest.exists():
        shutil.copy2(dest, backup_path(dest))

    existing_lines = parse_env_lines(dest)
    applied_keys: Set[str] = set()
    new_lines: List[str] = []

    for line in existing_lines:
        key = extract_key(line)
        if key and key in updates:
            new_lines.append(updates[key])
            applied_keys.add(key)
        else:
            new_lines.append(line)

    for key, line in updates.items():
        if key not in applied_keys:
            new_lines.append(line)

    dest.write_text("".join(new_lines), encoding="utf-8")


def load_text(path: Path) -> List[str]:
    try:
        return path.read_text(encoding="utf-8").splitlines(keepends=True)
    except FileNotFoundError:
        return []


def show_diff(current_path: Path, preset_path: Path, title: str) -> None:
    current = load_text(current_path)
    preset = load_text(preset_path)
    if not preset:
        eprint(f"[skip] No preset: {preset_path}")
        return
    diff = difflib.unified_diff(
        current,
        preset,
        fromfile=str(current_path),
        tofile=str(preset_path),
        lineterm="",
    )
    text = "\n".join(diff)
    if text:
        print(f"\n# {title}")
        print(text)
    else:
        print(f"\n# {title}\n(no changes)")


def confirm(prompt: str) -> bool:
    ans = input(f"{prompt} [y/N]: ").strip().lower()
    return ans in {"y", "yes"}


def cmd_list(_: argparse.Namespace) -> int:
    profiles = sorted(list_profiles())
    if not profiles:
        print("No presets found in .env-presets/. Create one with 'save'.")
        return 0
    print("Available profiles:")
    for p in profiles:
        print(f"- {p}")
    return 0


def cmd_diff(args: argparse.Namespace) -> int:
    profile = args.profile
    names = [args.only] if args.only else list(TARGETS.keys())
    for n in names:
        tgt = TARGETS[n]
        show_diff(tgt.dest, tgt.preset_path(profile), f"{n} -> {profile}")
    return 0


def cmd_apply(args: argparse.Namespace) -> int:
    profile = args.profile
    ensure_presets_dir()
    names = [args.only] if args.only else list(TARGETS.keys())
    planned: List[Tuple[Target, Path]] = []  # (target, preset)
    missing = []
    for n in names:
        tgt = TARGETS[n]
        p = tgt.preset_path(profile)
        if p.exists():
            planned.append((tgt, p))
        else:
            missing.append((n, p))

    if missing and not args.allow_partial:
        eprint("Missing preset files:")
        for n, p in missing:
            eprint(f"- {n}: {p}")
        eprint("Tip: use 'save' to capture current envs or create files under .env-presets/")
        return 1

    print(f"Applying profile '{profile}'...")
    for tgt, preset in planned:
        print(f"- {preset.name} -> {tgt.dest}")
    if missing:
        print("(Some targets skipped due to missing presets)")

    if not args.yes and not confirm("Proceed and overwrite destination files?"):
        print("Aborted.")
        return 130

    for target, preset in planned:
        updates = load_env_map(preset)
        if target.partial:
            apply_partial_env(target.dest, updates, backup=args.backup)
        else:
            copy_with_backup(preset, target.dest, backup=args.backup)
        print(f"Wrote {target.dest}")

    return 0


def cmd_save(args: argparse.Namespace) -> int:
    profile = args.profile
    ensure_presets_dir()
    names = [args.only] if args.only else list(TARGETS.keys())
    to_write: List[Tuple[Path, Path]] = []  # (src_current, dest_preset)

    for n in names:
        tgt = TARGETS[n]
        src = tgt.dest
        dest = tgt.preset_path(profile)
        if dest.exists() and not args.overwrite:
            eprint(f"Preset already exists, skip (use --overwrite): {dest}")
            continue
        if not src.exists():
            eprint(f"Current env missing, skip: {src}")
            continue
        to_write.append((src, dest))

    if not to_write:
        eprint("Nothing to save.")
        return 1

    print(f"Saving current envs as profile '{profile}'...")
    for src, dest in to_write:
        print(f"- {src} -> {dest}")

    if not args.yes and not confirm("Proceed to write preset files?"):
        print("Aborted.")
        return 130

    for src, dest in to_write:
        dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(src, dest)
        print(f"Wrote {dest}")

    print("Done. Remember: .env-presets/ should be git-ignored.")
    return 0


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        description="Quickly switch frontend/backend env files using private presets.",
    )
    sub = p.add_subparsers(dest="cmd", required=True)

    p_list = sub.add_parser("list", help="List available profiles")
    p_list.set_defaults(func=cmd_list)

    common = {
        "only": {
            "flags": ["--only"],
            "kwargs": {
                "choices": list(TARGETS.keys()),
                "help": "Limit to a single target",
            },
        }
    }

    p_diff = sub.add_parser("diff", help="Show diff between current env and preset")
    p_diff.add_argument("profile", help="Profile name (e.g. local, cloud)")
    p_diff.add_argument(*common["only"]["flags"], **common["only"]["kwargs"])  # type: ignore[arg-type]
    p_diff.set_defaults(func=cmd_diff)

    p_apply = sub.add_parser("apply", help="Apply preset to env files")
    p_apply.add_argument("profile", help="Profile name (e.g. local, cloud)")
    p_apply.add_argument("--yes", "-y", action="store_true", help="Do not prompt for confirmation")
    p_apply.add_argument("--allow-partial", action="store_true", help="Apply for targets with existing presets, skip missing")
    p_apply.add_argument(
        "--backup",
        action="store_true",
        default=env_flag("ENVSWITCH_BACKUP", False),
        help="Create timestamped backups before overwrite (or set ENVSWITCH_BACKUP=1)",
    )
    p_apply.add_argument(*common["only"]["flags"], **common["only"]["kwargs"])  # type: ignore[arg-type]
    p_apply.set_defaults(func=cmd_apply)

    p_save = sub.add_parser("save", help="Save current env files as a preset")
    p_save.add_argument("profile", help="Profile name (e.g. local, cloud)")
    p_save.add_argument("--overwrite", action="store_true", help="Overwrite existing preset files")
    p_save.add_argument("--yes", "-y", action="store_true", help="Do not prompt for confirmation")
    p_save.add_argument(*common["only"]["flags"], **common["only"]["kwargs"])  # type: ignore[arg-type]
    p_save.set_defaults(func=cmd_save)

    return p


def main(argv: Optional[List[str]] = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    raise SystemExit(main())
