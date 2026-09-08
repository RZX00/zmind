from __future__ import annotations

from pathlib import PurePosixPath


def normalize_resource_key(path_like: str) -> str:
    text = (path_like or "").strip().replace("\\", "/").lstrip("/")
    if not text:
        return ""
    normalized = str(PurePosixPath(text).as_posix())
    return "" if normalized == "." else normalized


def normalize_note_key(note: str) -> str:
    text = normalize_resource_key(note)
    if not text:
        return ""
    if not text.lower().endswith(".md"):
        text = f"{text}.md"
    return normalize_resource_key(text)


def resolve_note_target(
    *,
    source_doc_path: str,
    target_note: str,
    path_to_item_id: dict[str, str],
) -> str | None:
    note_key = normalize_note_key(target_note)
    if not note_key:
        return None

    # 1) direct path lookup
    if note_key in path_to_item_id:
        return note_key

    # 2) same-directory resolution
    src_parent = str(PurePosixPath(source_doc_path).parent)
    sibling_candidate = normalize_resource_key(str(PurePosixPath(src_parent, note_key).as_posix()))
    if sibling_candidate in path_to_item_id:
        return sibling_candidate

    # 3) fuzzy by stem (first deterministic match by lexical path order)
    wanted_stem = PurePosixPath(note_key).stem.lower()
    for existing_path in sorted(path_to_item_id.keys()):
        if PurePosixPath(existing_path).stem.lower() == wanted_stem:
            return existing_path

    return None


def resolve_asset_target(
    *,
    source_doc_path: str,
    target_asset: str,
    asset_path_to_file: dict[str, dict],
) -> str | None:
    asset_key = normalize_resource_key(target_asset)
    if not asset_key:
        return None

    # 1) direct path lookup
    if asset_key in asset_path_to_file:
        return asset_key

    # 2) same-directory resolution
    src_parent = str(PurePosixPath(source_doc_path).parent)
    sibling_candidate = normalize_resource_key(str(PurePosixPath(src_parent, asset_key).as_posix()))
    if sibling_candidate in asset_path_to_file:
        return sibling_candidate

    # 3) suffix match by full relative tail (deterministic lexical order)
    tail = f"/{asset_key.lower()}"
    for existing_path in sorted(asset_path_to_file.keys()):
        lower = existing_path.lower()
        if lower == asset_key.lower() or lower.endswith(tail):
            return existing_path

    # 4) unique basename fallback
    wanted_name = PurePosixPath(asset_key).name.lower()
    if not wanted_name:
        return None
    matched = [p for p in sorted(asset_path_to_file.keys()) if PurePosixPath(p).name.lower() == wanted_name]
    if len(matched) == 1:
        return matched[0]

    return None
