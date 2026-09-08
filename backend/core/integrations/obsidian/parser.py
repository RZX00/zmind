from __future__ import annotations

import base64
from dataclasses import dataclass
import mimetypes
from pathlib import PurePosixPath
import re
from typing import Any
from zipfile import ZipFile
from io import BytesIO

WIKILINK_PATTERN = re.compile(r"(?<!!)\[\[([^\]]+)\]\]")
EMBED_LINK_PATTERN = re.compile(r"!\[\[([^\]]+)\]\]")
IMAGE_LINK_PATTERN = re.compile(r"!\[[^\]]*]\(([^)]+)\)")


@dataclass
class VaultMarkdownFile:
    path: str
    content: str


@dataclass
class VaultAssetFile:
    path: str
    content_base64: str
    content_type: str | None = None
    original_filename: str | None = None


@dataclass
class WikilinkRef:
    raw: str
    target_note: str
    target_anchor: str | None = None
    target_block: str | None = None
    alias: str | None = None


def normalize_path(path: str) -> str:
    text = (path or "").replace("\\", "/").strip().lstrip("/")
    if not text:
        return ""
    normalized = str(PurePosixPath(text))
    if normalized == ".":
        return ""
    return normalized


def file_name_to_title(path: str) -> str:
    stem = PurePosixPath(path).stem.strip()
    return stem or "Untitled"


def _guess_content_type(path: str, fallback: str = "application/octet-stream") -> str:
    guessed, _ = mimetypes.guess_type(path)
    return guessed or fallback


def parse_zip_payload(zip_base64: str) -> tuple[list[VaultMarkdownFile], list[VaultAssetFile]]:
    if not zip_base64:
        return [], []
    raw = base64.b64decode(zip_base64)
    stream = BytesIO(raw)
    files: list[VaultMarkdownFile] = []
    assets: list[VaultAssetFile] = []
    with ZipFile(stream, "r") as archive:
        for member in archive.infolist():
            if member.is_dir():
                continue
            normalized = normalize_path(member.filename)
            if not normalized:
                continue
            if not normalized.lower().endswith(".md"):
                blob = archive.read(member.filename)
                assets.append(
                    VaultAssetFile(
                        path=normalized,
                        content_base64=base64.b64encode(blob).decode("utf-8"),
                        content_type=_guess_content_type(normalized),
                        original_filename=PurePosixPath(normalized).name,
                    )
                )
                continue
            content = archive.read(member.filename).decode("utf-8", errors="replace")
            files.append(VaultMarkdownFile(path=normalized, content=content))
    return files, assets


def parse_zip_base64(zip_base64: str) -> list[VaultMarkdownFile]:
    files, _ = parse_zip_payload(zip_base64)
    return files


def parse_files_payload(files_payload: list[dict[str, Any]] | None) -> list[VaultMarkdownFile]:
    if not files_payload:
        return []
    out: list[VaultMarkdownFile] = []
    for file_row in files_payload:
        raw_path = str(file_row.get("path") or "")
        normalized = normalize_path(raw_path)
        if not normalized:
            continue
        if not normalized.lower().endswith(".md"):
            continue
        content = str(file_row.get("content") or "")
        out.append(VaultMarkdownFile(path=normalized, content=content))
    return out


def parse_assets_payload(assets_payload: list[dict[str, Any]] | None) -> list[VaultAssetFile]:
    if not assets_payload:
        return []
    out: list[VaultAssetFile] = []
    for asset_row in assets_payload:
        normalized = normalize_path(str(asset_row.get("path") or ""))
        if not normalized:
            continue
        if normalized.lower().endswith(".md"):
            continue
        content_base64 = str(asset_row.get("base64") or asset_row.get("contentBase64") or "").strip()
        if not content_base64:
            continue
        out.append(
            VaultAssetFile(
                path=normalized,
                content_base64=content_base64,
                content_type=str(asset_row.get("contentType") or _guess_content_type(normalized)),
                original_filename=str(asset_row.get("originalFilename") or PurePosixPath(normalized).name),
            )
        )
    return out


def _parse_wikilink_raw(raw_text: str) -> WikilinkRef | None:
    raw = (raw_text or "").strip()
    if not raw:
        return None

    if "|" in raw:
        core, alias = raw.split("|", 1)
    else:
        core, alias = raw, None

    target_note = core
    target_anchor = None
    target_block = None

    if "^" in target_note:
        target_note, target_block = target_note.split("^", 1)
        target_note = target_note.strip()
        target_block = target_block.strip() or None

    if "#" in target_note:
        target_note, target_anchor = target_note.split("#", 1)
        target_note = target_note.strip()
        target_anchor = target_anchor.strip() or None

    return WikilinkRef(
        raw=raw,
        target_note=target_note.strip(),
        target_anchor=target_anchor,
        target_block=target_block,
        alias=alias.strip() if isinstance(alias, str) and alias.strip() else None,
    )


def parse_wikilinks(markdown: str) -> list[WikilinkRef]:
    refs: list[WikilinkRef] = []
    for match in WIKILINK_PATTERN.finditer(markdown or ""):
        parsed = _parse_wikilink_raw(match.group(1))
        if parsed:
            refs.append(parsed)
    return refs


def parse_embed_links(markdown: str) -> list[WikilinkRef]:
    refs: list[WikilinkRef] = []
    for match in EMBED_LINK_PATTERN.finditer(markdown or ""):
        parsed = _parse_wikilink_raw(match.group(1))
        if parsed:
            refs.append(parsed)
    return refs


def parse_image_links(markdown: str) -> list[str]:
    links: list[str] = []
    for match in IMAGE_LINK_PATTERN.finditer(markdown or ""):
        target = match.group(1).strip()
        if target:
            links.append(target)
    return links
