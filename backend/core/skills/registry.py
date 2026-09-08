"""
Skills registry.

Supported paths:
- Zmind project: {repo}/.zmind/skills/ (or ZMIND_SKILLS_PATH)
- Claude project: {repo}/.claude/skills/ (optional)
- Claude personal: ~/.claude/skills/ (optional)
- Zmind global: ~/.config/zmind/skills/ (optional)
- Builtin: backend/core/skills/builtin/
"""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any, Iterable, Optional

import yaml

from core.services.supabase import DBConnection
from core.utils.logger import logger
from core.prompts.prompt_files import read_prompt_file

from .types import SkillDefinition, HookEntry, HookMatcherGroup, SkillHooks


def _env_flag(value: Optional[str], default: bool) -> bool:
    """Parse boolean-like environment flags."""
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


def _resolve_path(path_str: str, repo_root: Path) -> Path:
    """Resolve a path, treating relative paths as repo-rooted."""
    expanded = os.path.expanduser(path_str)
    path = Path(expanded)
    return path if path.is_absolute() else (repo_root / path)


def _normalize_list(value: Any) -> list[str]:
    """Normalize list values from skill definitions."""
    if value is None:
        return []
    if isinstance(value, list):
        return [str(item).strip() for item in value if str(item).strip()]
    if isinstance(value, str):
        text = value.strip()
        if not text:
            return []
        if "," in text:
            return [part.strip() for part in text.split(",") if part.strip()]
        return [text]
    return []


def _parse_hooks(hooks_data: Any) -> Optional[SkillHooks]:
    """Parse hooks configuration (official 3-layer structure + legacy support)."""
    if not isinstance(hooks_data, dict):
        return None

    try:
        hooks_dict = {}
        for hook_name in ["PreToolUse", "PostToolUse", "Stop"]:
            if hook_name not in hooks_data:
                continue

            hook_val = hooks_data[hook_name]

            # Case 1: official format (list of matcher groups)
            if isinstance(hook_val, list):
                matcher_groups = []
                for item in hook_val:
                    if not isinstance(item, dict):
                        continue
                    if "matcher" not in item or "hooks" not in item:
                        logger.warning(
                            f"Invalid hook matcher group in {hook_name}: missing 'matcher' or 'hooks'"
                        )
                        continue

                    hooks_list = []
                    for hook_entry in item.get("hooks", []):
                        if not isinstance(hook_entry, dict):
                            continue
                        try:
                            hooks_list.append(HookEntry(**hook_entry))
                        except Exception as e:
                            logger.warning(f"Invalid hook entry: {e}")
                            continue

                    if hooks_list:
                        matcher_groups.append(
                            HookMatcherGroup(
                                matcher=item["matcher"],
                                hooks=hooks_list,
                            )
                        )

                if matcher_groups:
                    hooks_dict[hook_name] = matcher_groups

            # Case 2: legacy dict format {command: "...", once: ...}
            elif isinstance(hook_val, dict) and "command" in hook_val:
                try:
                    hook_entry = HookEntry(
                        type="command",
                        command=hook_val["command"],
                        once=hook_val.get("once", False),
                        timeout=hook_val.get("timeout", 5),
                    )
                    matcher_group = HookMatcherGroup(
                        matcher=".*",
                        hooks=[hook_entry],
                    )
                    hooks_dict[hook_name] = [matcher_group]
                except Exception as e:
                    logger.warning(f"Failed to convert legacy hook format: {e}")

            # Case 3: legacy string format "echo test"
            elif isinstance(hook_val, str):
                hook_entry = HookEntry(
                    type="command",
                    command=hook_val,
                    once=False,
                    timeout=5,
                )
                matcher_group = HookMatcherGroup(
                    matcher=".*",
                    hooks=[hook_entry],
                )
                hooks_dict[hook_name] = [matcher_group]

        return SkillHooks(**hooks_dict) if hooks_dict else None

    except Exception as exc:
        logger.warning("Failed to parse hooks", error=str(exc))
        return None


def _load_skill_payload(payload: dict[str, Any], source: str, *, location: str | None = None) -> SkillDefinition | None:
    """Load skill from payload."""
    if not isinstance(payload, dict):
        return None
    try:
        if "name" not in payload or "description" not in payload or "prompt" not in payload:
            logger.warning("Skill missing required fields", location=location)
            return None
        skill = SkillDefinition.model_validate(payload)
        skill.source = source  # type: ignore
        if location:
            skill.location = location
        _apply_prompt_override(skill)
        return skill
    except Exception as exc:
        logger.warning("Invalid skill definition", error=str(exc), location=location)
        return None


def _normalize_skill_name(name: str) -> str:
    return str(name or "").strip().replace("-", "_")


def _apply_prompt_override(skill: SkillDefinition) -> None:
    """Override skill prompt from prompts/skills if available."""
    base = _normalize_skill_name(skill.name)
    candidates = [
        f"skills/{base}.prompt.md",
        f"skills/builtin.{base}.prompt.md",
    ]
    for rel_path in candidates:
        content = read_prompt_file(rel_path)
        if content and content.strip():
            skill.prompt = content.strip()
            return


def _repo_root() -> Path:
    """Get repository root."""
    return Path(__file__).resolve().parents[3]


def _parse_markdown_frontmatter(text: str) -> tuple[dict[str, Any], str]:
    """Parse Markdown frontmatter."""
    if not text.startswith("---"):
        return {}, text
    lines = text.splitlines()
    if not lines or lines[0].strip() != "---":
        return {}, text
    for idx in range(1, len(lines)):
        if lines[idx].strip() == "---":
            frontmatter_raw = "\n".join(lines[1:idx]).strip()
            body = "\n".join(lines[idx + 1 :]).lstrip("\n")
            try:
                parsed = yaml.safe_load(frontmatter_raw) if frontmatter_raw else {}
            except Exception:
                parsed = {}
            return (parsed if isinstance(parsed, dict) else {}), body
    return {}, text


def _load_skill_markdown_file(path: Path, *, source: str) -> SkillDefinition | None:
    """Load SKILL.md file (official format)."""
    try:
        raw_text = path.read_text(encoding="utf-8")
    except Exception as exc:
        logger.warning("Failed to read SKILL.md", file=str(path), error=str(exc))
        return None

    frontmatter, body = _parse_markdown_frontmatter(raw_text)
    payload: dict[str, Any] = {"prompt": (body or "").strip()}

    # Required fields
    payload["name"] = frontmatter.get("name") or path.parent.name
    if "description" not in frontmatter:
        logger.warning("Skill missing 'description'", file=str(path))
        return None
    payload["description"] = frontmatter["description"]

    # Optional fields
    if "allowed-tools" in frontmatter:
        payload["allowed-tools"] = _normalize_list(frontmatter["allowed-tools"])
    elif "allowed_tools" in frontmatter:
        payload["allowed-tools"] = _normalize_list(frontmatter["allowed_tools"])

    for field in ["model", "context", "agent", "license"]:
        if field in frontmatter:
            payload[field] = frontmatter[field]

    if "hooks" in frontmatter:
        hooks = _parse_hooks(frontmatter["hooks"])
        if hooks:
            payload["hooks"] = hooks

    if "user-invocable" in frontmatter:
        payload["user-invocable"] = bool(frontmatter["user-invocable"])
    elif "user_invocable" in frontmatter:
        payload["user-invocable"] = bool(frontmatter["user_invocable"])

    if "disable-model-invocation" in frontmatter:
        payload["disable-model-invocation"] = bool(frontmatter["disable-model-invocation"])
    elif "disable_model_invocation" in frontmatter:
        payload["disable-model-invocation"] = bool(frontmatter["disable_model_invocation"])

    if "argument-hint" in frontmatter:
        payload["argument-hint"] = frontmatter["argument-hint"]
    elif "argument_hint" in frontmatter:
        payload["argument-hint"] = frontmatter["argument_hint"]

    if "metadata" in frontmatter and isinstance(frontmatter["metadata"], dict):
        payload["metadata"] = frontmatter["metadata"]

    return _load_skill_payload(payload, source=source, location=str(path))


def _load_builtin_file(path: Path) -> SkillDefinition | None:
    """Load builtin skill file."""
    try:
        if path.name == "SKILL.md":
            return _load_skill_markdown_file(path, source="builtin")

        # Legacy YAML/JSON formats
        raw: Any = None
        if path.suffix.lower() in {".yaml", ".yml"}:
            raw = yaml.safe_load(path.read_text(encoding="utf-8"))
        elif path.suffix.lower() == ".json":
            raw = json.loads(path.read_text(encoding="utf-8"))
        else:
            return None

        if not isinstance(raw, dict):
            return None

        payload: dict[str, Any] = {}
        payload["name"] = raw.get("name") or raw.get("id", "")
        if "description" in raw:
            payload["description"] = raw["description"]
        if "prompt" in raw:
            payload["prompt"] = raw["prompt"]

        if "allowed-tools" in raw:
            payload["allowed-tools"] = _normalize_list(raw["allowed-tools"])
        elif "tools_allowlist" in raw:
            payload["allowed-tools"] = _normalize_list(raw["tools_allowlist"])

        for field in ["model", "context", "agent"]:
            if field in raw:
                payload[field] = raw[field]

        if "hooks" in raw:
            hooks = _parse_hooks(raw["hooks"])
            if hooks:
                payload["hooks"] = hooks

        if "user-invocable" in raw:
            payload["user-invocable"] = bool(raw["user-invocable"])

        if "argument-hint" in raw:
            payload["argument-hint"] = raw["argument-hint"]
        elif "argument_hint" in raw:
            payload["argument-hint"] = raw["argument_hint"]

        return _load_skill_payload(payload, source="builtin", location=str(path))
    except Exception as exc:
        logger.warning("Failed to load builtin file", file=str(path), error=str(exc))
        return None


def resolve_builtin_path() -> Path:
    """Get builtin skills directory."""
    override = os.getenv("LANGGRAPH_SKILLS_PATH")
    if override:
        return Path(override)
    return Path(__file__).resolve().parent / "builtin"


def load_builtin_skills(path: Path | None = None) -> list[SkillDefinition]:
    """Load builtin skills."""
    root = path or resolve_builtin_path()
    if not root.exists():
        return []
    skills: list[SkillDefinition] = []

    for skill_path in sorted(root.rglob("SKILL.md")):
        skill = _load_builtin_file(skill_path)
        if skill:
            skills.append(skill)

    for file_path in sorted(root.glob("*.y*ml")) + sorted(root.glob("*.json")):
        skill = _load_builtin_file(file_path)
        if skill:
            skills.append(skill)

    return skills


def _resolve_file_skill_roots() -> list[tuple[str, Path]]:
    """Resolve skill directories (low -> high priority)."""
    roots: list[tuple[str, Path]] = []
    repo_root = _repo_root()

    # Zmind project skills (default .zmind/skills or ZMIND_SKILLS_PATH)
    zmind_path_env = os.getenv("ZMIND_SKILLS_PATH", "").strip()
    zmind_root = _resolve_path(zmind_path_env, repo_root) if zmind_path_env else (repo_root / ".zmind" / "skills")
    if zmind_root.exists():
        roots.append(("zmind_project", zmind_root))

    enable_claude = _env_flag(os.getenv("ZMIND_ENABLE_CLAUDE_SKILLS"), True)
    if enable_claude:
        project_root = repo_root / ".claude" / "skills"
        if project_root.exists():
            roots.append(("claude_project", project_root))

    enable_global = _env_flag(os.getenv("ZMIND_ENABLE_GLOBAL_SKILLS"), False)
    if enable_global:
        global_path_env = os.getenv("ZMIND_GLOBAL_SKILLS_PATH", "").strip()
        global_root = _resolve_path(global_path_env, repo_root) if global_path_env else (Path.home() / ".config" / "zmind" / "skills")
        if global_root.exists():
            roots.append(("zmind_global", global_root))

    if enable_claude:
        personal_root = Path.home() / ".claude" / "skills"
        if personal_root.exists():
            roots.append(("claude_personal", personal_root))

    return roots


def load_file_skills() -> list[SkillDefinition]:
    """Load file-based skills."""
    roots = _resolve_file_skill_roots()
    if not roots:
        return []

    skills_by_name: dict[str, SkillDefinition] = {}
    for source, root in roots:
        for skill_path in sorted(root.rglob("SKILL.md")):
            skill = _load_skill_markdown_file(skill_path, source="file")
            if skill:
                if source:
                    metadata = dict(skill.metadata or {})
                    metadata["file_source"] = source
                    skill.metadata = metadata
                skills_by_name[skill.name] = skill
                logger.debug("Loaded file skill", name=skill.name, source=source)

    return list(skills_by_name.values())


async def _safe_execute(query, *, context: str) -> Any | None:
    """Execute a Supabase query with defensive error handling."""
    try:
        result = await query.execute()
    except Exception as exc:
        logger.warning("Skills query failed", context=context, error=str(exc))
        return None
    error = getattr(result, "error", None)
    if error:
        logger.warning("Skills query failed", context=context, error=str(error))
        return None
    return result


async def _load_user_skills_rows(
    client: Any,
    *,
    account_id: str,
    include_disabled: bool,
    select_fields: str,
    fallback_select_fields: str | None = None,
) -> list[dict[str, Any]]:
    """Load user skill rows with resilient enabled/user_invocable filtering."""

    def build_query():
        return (
            client.table("user_skills")
            .select(select_fields)
            .eq("account_id", account_id)
        )

    result = None
    if include_disabled:
        result = await _safe_execute(build_query(), context="user_skills:all")
    else:
        result = await _safe_execute(
            build_query().eq("user_invocable", True),
            context="user_skills:user_invocable",
        )
        if result is None:
            result = await _safe_execute(
                build_query().eq("enabled", True),
                context="user_skills:enabled_fallback",
            )
        if result is None:
            result = await _safe_execute(
                build_query(),
                context="user_skills:unfiltered_fallback",
            )

    if not result and fallback_select_fields:
        select_fields = fallback_select_fields
        result = None
        if include_disabled:
            result = await _safe_execute(build_query(), context="user_skills:all_fallback")
        else:
            result = await _safe_execute(
                build_query().eq("user_invocable", True),
                context="user_skills:user_invocable_fallback",
            )
            if result is None:
                result = await _safe_execute(
                    build_query().eq("enabled", True),
                    context="user_skills:enabled_fallback_legacy",
                )
            if result is None:
                result = await _safe_execute(
                    build_query(),
                    context="user_skills:unfiltered_fallback_legacy",
                )

    if not result:
        return []

    return result.data or []


async def load_user_skills(
    db: DBConnection,
    *,
    account_id: str,
    include_disabled: bool = False,
) -> list[SkillDefinition]:
    """Load user-defined skills from database."""
    try:
        client = await db.client
        rows = await _load_user_skills_rows(
            client,
            account_id=account_id,
            include_disabled=include_disabled,
            select_fields="name, description, prompt, allowed_tools, model, context, agent, hooks, user_invocable, disable_model_invocation, argument_hint, license, metadata, source_type, source_url",
            fallback_select_fields="name, description, prompt, allowed_tools, model, context, agent, hooks, disable_model_invocation, license, metadata",
        )
    except Exception as exc:
        logger.warning("Failed to load user skills", error=str(exc))
        return []

    skills: list[SkillDefinition] = []
    for row in rows:
        payload: dict[str, Any] = {
            "name": row.get("name") or "",
            "description": row.get("description") or "",
            "prompt": row.get("prompt") or "",
        }
        if row.get("allowed_tools"):
            payload["allowed-tools"] = _normalize_list(row["allowed_tools"])
        for field in ["model", "context", "agent", "license"]:
            if row.get(field):
                payload[field] = row[field]
        if row.get("hooks"):
            hooks = _parse_hooks(row["hooks"])
            if hooks:
                payload["hooks"] = hooks
        if "user_invocable" in row:
            payload["user-invocable"] = bool(row.get("user_invocable", True))
        if "disable_model_invocation" in row:
            payload["disable-model-invocation"] = bool(row.get("disable_model_invocation", False))
        if "argument_hint" in row and row.get("argument_hint"):
            payload["argument-hint"] = row.get("argument_hint")
        metadata = dict(row.get("metadata") or {})
        source_type = row.get("source_type")
        source_url = row.get("source_url")
        if source_type:
            metadata["zmind_source_type"] = source_type
        if source_url:
            metadata["zmind_source_url"] = source_url
        if metadata:
            payload["metadata"] = metadata

        skill = _load_skill_payload(payload, source="user")
        if skill:
            skills.append(skill)

    return skills


async def load_all_skills(
    *,
    db: Optional[DBConnection],
    account_id: Optional[str],
    include_disabled: bool = False,
) -> list[SkillDefinition]:
    """Load skills from all sources."""
    builtin = load_builtin_skills()
    file_skills = load_file_skills()
    if not db or not account_id:
        return _merge_skills(builtin, file_skills)
    user_skills = await load_user_skills(
        db,
        account_id=account_id,
        include_disabled=include_disabled,
    )
    return _merge_skills(builtin, file_skills, user_skills)


def _merge_skills(*groups: Iterable[SkillDefinition]) -> list[SkillDefinition]:
    """Merge skills by name; later groups win."""
    merged: dict[str, SkillDefinition] = {}
    for group in groups:
        for skill in group:
            if isinstance(skill, SkillDefinition):
                merged[skill.name] = skill
    return list(merged.values())


async def get_skill_by_name(name: str, *, db: Optional[DBConnection], account_id: Optional[str]) -> SkillDefinition | None:
    """Get skill by name (priority: user > file > builtin)."""
    name = (name or "").strip()
    if not name:
        return None

    if db and account_id:
        user_skills = await load_user_skills(db, account_id=account_id)
        for skill in user_skills:
            if skill.name == name:
                return skill

    for skill in load_file_skills():
        if skill.name == name:
            return skill

    for skill in load_builtin_skills():
        if skill.name == name:
            return skill

    return None


async def get_skill_by_id(skill_id: str, *, db: Optional[DBConnection], account_id: Optional[str]) -> SkillDefinition | None:
    """Backward-compatible alias for get_skill_by_name."""
    return await get_skill_by_name(skill_id, db=db, account_id=account_id)
