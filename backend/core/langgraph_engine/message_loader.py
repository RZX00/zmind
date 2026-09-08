from __future__ import annotations

import asyncio
import json
import os
import re
import uuid
from typing import Any, Dict, List, Optional

from litellm.utils import token_counter

from core.langgraph_engine.context_manager import ContextManager
from core.langgraph_engine.tool_message_truncation import truncate_tool_message_content
from core.services.supabase import DBConnection
from core.services.r2_storage import get_object_bytes
from core.utils.logger import logger

INLINE_ATTACHMENT_MAX_BYTES = int(os.getenv("INLINE_ATTACHMENT_MAX_BYTES", 200 * 1024))
INLINE_ATTACHMENT_MAX_CHARS = int(os.getenv("INLINE_ATTACHMENT_MAX_CHARS", 100_000))


async def load_thread_messages(
    *,
    thread_id: str,
    llm_model: str,
    llm_max_tokens: Optional[int],
    db: DBConnection,
) -> List[Dict[str, Any]]:
    """Load bounded, token-trimmed messages for a thread."""
    client = await db.client

    max_context_messages = int(os.getenv("MAX_CONTEXT_MESSAGES", 200))
    min_recent_messages = int(os.getenv("MIN_RECENT_MESSAGES", 10))

    try:
        current_session_index = 0
        account_id: Optional[str] = None
        try:
            meta_row = await client.table("threads").select("metadata, account_id").eq("thread_id", thread_id).limit(1).execute()
            if meta_row.data:
                tmeta = meta_row.data[0].get("metadata") or {}
                if isinstance(tmeta, str):
                    try:
                        tmeta = json.loads(tmeta)
                    except Exception:
                        tmeta = {}
                current_session_index = int(tmeta.get("current_session_index", 0) or 0)
                account_id = meta_row.data[0].get("account_id")
        except Exception:
            current_session_index = 0

        collected: List[Dict[str, Any]] = []
        offset = 0
        batch_size = max_context_messages

        while len(collected) < max_context_messages:
            result = (
                await client.table("messages")
                .select("message_id, type, content, metadata, created_at")
                .eq("thread_id", thread_id)
                .eq("is_llm_message", True)
                .order("created_at", desc=True)
                .range(offset, offset + batch_size - 1)
                .execute()
            )

            rows = result.data or []
            if not rows:
                break

            for row in rows:
                metadata = row.get("metadata") or {}
                if isinstance(metadata, str):
                    try:
                        metadata = json.loads(metadata)
                    except Exception:
                        metadata = {}
                sess = metadata.get("session_index")
                if sess is None:
                    sess = 0
                try:
                    sess = int(sess)
                except Exception:
                    sess = 0
                if sess == current_session_index:
                    collected.append(row)
                    if len(collected) >= max_context_messages:
                        break

            if len(rows) < batch_size:
                break
            offset += batch_size

        if not collected:
            return []

        collected = list(reversed(collected))
        messages: List[Dict[str, Any]] = []

        for item in collected:
            base_metadata = item.get("metadata") or {}
            if isinstance(base_metadata, str):
                try:
                    base_metadata = json.loads(base_metadata)
                except Exception:
                    base_metadata = {}

            content = item.get("content")
            msg_obj: Dict[str, Any] = {}

            if isinstance(content, str):
                try:
                    parsed_item = json.loads(content)
                    msg_obj.update(parsed_item if isinstance(parsed_item, dict) else {"content": parsed_item})
                except json.JSONDecodeError:
                    msg_obj["content"] = content
            elif isinstance(content, dict):
                msg_obj.update(content)
            else:
                msg_obj["content"] = content

            if msg_obj.get("content") is None:
                msg_obj["content"] = ""

            msg_obj["message_id"] = item.get("message_id")
            msg_obj.setdefault("type", item.get("type"))
            msg_obj.setdefault("metadata", base_metadata)

            if "role" not in msg_obj:
                inferred_role = item.get("type") if item.get("type") in ("user", "assistant", "tool") else "assistant"
                msg_obj["role"] = inferred_role

            if msg_obj.get("role") == "user":
                try:
                    msg_obj = await _append_inline_attachments(msg_obj, base_metadata, account_id, client)
                except Exception as exc:
                    logger.warning("Failed to inline attachments", error=str(exc))

            messages.append(msg_obj)

        messages = normalize_tool_calls_for_llm(messages)
        messages = compress_tool_messages(messages)
        messages = truncate_tool_messages_for_context(messages)

        ctx = ContextManager()
        messages = ctx.compress_user_messages(messages, llm_model, llm_max_tokens)
        messages = ctx.compress_assistant_messages(messages, llm_model, llm_max_tokens)

        budget = resolve_context_budget(llm_model, llm_max_tokens)
        return trim_by_tokens(messages, llm_model, budget, min_recent=min_recent_messages)

    except Exception as exc:
        logger.error(f"Failed to get messages for thread {thread_id}: {exc}", exc_info=True)
        return []


def truncate_tool_messages_for_context(messages: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    if not messages:
        return []

    out: List[Dict[str, Any]] = []
    for msg in messages:
        if not isinstance(msg, dict) or msg.get("role") != "tool":
            out.append(msg)
            continue
        content = msg.get("content")
        if not isinstance(content, str):
            out.append(msg)
            continue
        message_id = msg.get("message_id")
        if not isinstance(message_id, str) or not message_id.strip():
            out.append(msg)
            continue
        tool_name = msg.get("name") if isinstance(msg.get("name"), str) else None
        truncated, was_truncated = truncate_tool_message_content(
            content,
            message_id=message_id,
            tool_name=tool_name,
        )
        if not was_truncated:
            out.append(msg)
            continue

        new_msg = dict(msg)
        new_msg["content"] = truncated
        metadata = new_msg.get("metadata")
        if not isinstance(metadata, dict):
            metadata = {}
        metadata = dict(metadata)
        metadata.setdefault("truncated", True)
        new_msg["metadata"] = metadata
        out.append(new_msg)

    return out


def _looks_like_uuid(value: str) -> bool:
    try:
        uuid.UUID(value)
        return True
    except Exception:
        return False


def _is_text_attachment(content_type: str, filename: str) -> bool:
    ct = (content_type or "").lower()
    if ct.startswith("text/"):
        return True
    if ct in (
        "application/json",
        "application/xml",
        "application/x-yaml",
        "application/yaml",
        "text/csv",
        "application/csv",
    ):
        return True
    ext = os.path.splitext(filename or "")[1].lower()
    return ext in (
        ".md",
        ".markdown",
        ".txt",
        ".csv",
        ".tsv",
        ".json",
        ".yaml",
        ".yml",
        ".xml",
    )


async def _fetch_attachment_record(
    file_id: str,
    account_id: Optional[str],
    client,
) -> Optional[dict]:
    if not _looks_like_uuid(file_id):
        return None
    query = client.table("file_uploads") \
        .select("storage_provider, storage_bucket, storage_path, content_type, original_filename, file_size, status, metadata") \
        .eq("id", file_id)
    if account_id:
        query = query.eq("account_id", account_id)
    resp = await query.limit(1).execute()
    if not resp.data:
        return None
    return resp.data[0]


async def _download_attachment_bytes(record: dict, client) -> Optional[bytes]:
    provider = record.get("storage_provider") or "supabase"
    key = record.get("storage_path")
    if not key:
        return None
    if provider == "r2":
        return await asyncio.to_thread(get_object_bytes, key)
    return None


async def _append_inline_attachments(
    msg_obj: Dict[str, Any],
    metadata: Dict[str, Any],
    account_id: Optional[str],
    client,
) -> Dict[str, Any]:
    attachments = metadata.get("attachments")
    if not isinstance(attachments, list):
        return msg_obj

    blocks: List[str] = []
    for att in attachments:
        if not isinstance(att, dict):
            continue
        file_id = att.get("file_id") or att.get("id")
        if not isinstance(file_id, str) or not file_id.strip():
            continue
        record = await _fetch_attachment_record(file_id.strip(), account_id, client)
        if not record:
            continue
        if record.get("status") not in (None, "uploaded", "processing", "ready"):
            continue

        filename = record.get("original_filename") or att.get("name") or "file"
        content_type = record.get("content_type") or att.get("content_type") or ""
        file_size = record.get("file_size") or att.get("size") or 0
        meta = record.get("metadata") or {}
        if isinstance(meta, str):
            meta = {}
        extracted_text = meta.get("extracted_text")
        extracted_type = meta.get("extracted_text_type") or "text"
        if isinstance(extracted_text, str) and extracted_text.strip():
            text = extracted_text
            if INLINE_ATTACHMENT_MAX_CHARS and len(text) > INLINE_ATTACHMENT_MAX_CHARS:
                text = text[:INLINE_ATTACHMENT_MAX_CHARS] + "\n... (truncated)"
            label = "transcript" if extracted_type == "transcript" else "extracted text"
            blocks.append(f"[Attachment: {filename} ({label})]\n{text}")
            continue

        if file_size and int(file_size) > INLINE_ATTACHMENT_MAX_BYTES:
            blocks.append(f"[Attachment: {filename}] (not inlined: file too large)")
            continue
        if not _is_text_attachment(content_type, filename):
            proc_status = meta.get("processing_status")
            if proc_status == "processing":
                blocks.append(f"[Attachment: {filename}] (processing)")
            elif proc_status == "failed":
                blocks.append(f"[Attachment: {filename}] (processing failed)")
            else:
                blocks.append(f"[Attachment: {filename}] (not inlined: non-text file)")
            continue

        data = await _download_attachment_bytes(record, client)
        if not data:
            blocks.append(f"[Attachment: {filename}] (not inlined: unable to read)")
            continue
        text = data.decode("utf-8", errors="replace")
        if INLINE_ATTACHMENT_MAX_CHARS and len(text) > INLINE_ATTACHMENT_MAX_CHARS:
            text = text[:INLINE_ATTACHMENT_MAX_CHARS] + "\n... (truncated)"
        blocks.append(f"[Attachment: {filename}]\n{text}")

    if not blocks:
        return msg_obj

    content = msg_obj.get("content") or ""
    if isinstance(content, dict):
        try:
            content = json.dumps(content, ensure_ascii=False)
        except Exception:
            content = str(content)
    elif not isinstance(content, str):
        content = str(content)

    msg_obj["content"] = f"{content}\n\n" + "\n\n".join(blocks)
    return msg_obj


def normalize_tool_calls_for_llm(messages: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Normalize tool_calls to OpenAI format for token counting and providers."""
    if not messages:
        return messages

    normalized: List[Dict[str, Any]] = []
    for msg in messages:
        tool_calls = msg.get("tool_calls")
        if not tool_calls:
            normalized.append(msg)
            continue

        if isinstance(tool_calls, str):
            try:
                tool_calls = json.loads(tool_calls)
            except Exception:
                normalized.append(msg)
                continue

        if not isinstance(tool_calls, list):
            normalized.append(msg)
            continue

        rebuilt: List[Dict[str, Any]] = []
        for call in tool_calls:
            if not isinstance(call, dict):
                continue

            fn = call.get("function") if isinstance(call.get("function"), dict) else None
            name = (fn or {}).get("name") or call.get("name") or call.get("function_name")

            args = (fn or {}).get("arguments")
            if args is None:
                args = call.get("arguments")
            if args is None and isinstance(call.get("raw"), dict):
                raw = call.get("raw") or {}
                args = raw.get("arguments_str") or raw.get("arguments")
            if args is None:
                args = {}
            if not isinstance(args, str):
                try:
                    args = json.dumps(args)
                except Exception:
                    args = str(args)

            call_id = call.get("id") or call.get("tool_call_id") or call.get("toolCallId")
            normalized_call = {
                "type": "function",
                "function": {"name": name or "tool", "arguments": args},
            }
            if call_id:
                normalized_call["id"] = str(call_id)

            rebuilt.append(normalized_call)

        new_msg = dict(msg)
        new_msg["tool_calls"] = rebuilt or None
        normalized.append(new_msg)

    return normalized


def compress_tool_messages(
    messages: List[Dict[str, Any]],
    *,
    max_chars: int = 2000,
    keep_latest: int = 1,
    keep_latest_canvas: int = 3,
    search_top_k: int = 3,
) -> List[Dict[str, Any]]:
    """Keep latest tool results verbatim; older ones are summarized/truncated."""
    if not messages:
        return []

    def _extract_info(msg: Dict[str, Any]) -> Dict[str, Any]:
        name = None
        result = None
        content = msg.get("content")
        if isinstance(content, dict) and "tool_execution" in content:
            tx = content.get("tool_execution") or {}
            name = tx.get("name")
            result = tx.get("result")
        elif isinstance(content, dict):
            name = content.get("function_name") or content.get("name")
            result = content.get("result")
        elif isinstance(content, str):
            pass
        if not name and isinstance(content, dict) and content.get("tool"):
            name = content.get("tool")
        return {"name": name or "tool", "result": result}

    def _shrink(msg: Dict[str, Any], info: Dict[str, Any], is_search: bool) -> Dict[str, Any]:
        mid = msg.get("message_id") or "unknown"
        name = info.get("name") or "tool"
        new_msg = dict(msg)
        summary = f"[{name}] previous result truncated; message_id={mid}"

        if is_search:
            res = info.get("result") or {}
            top = []
            if isinstance(res, dict):
                items = res.get("results") or res.get("data") or []
            elif isinstance(res, list):
                items = res
            else:
                items = []
            for item in items[:search_top_k]:
                if isinstance(item, dict):
                    title = item.get("title") or item.get("name") or ""
                    url = item.get("url") or item.get("link") or ""
                    top.append({"title": title, "url": url})
                else:
                    top.append(str(item))
            summary_payload = {"role": "assistant", "content": {"tool": name, "top_results": top}}
            new_msg["content"] = summary_payload
            return new_msg

        result = info.get("result")
        if isinstance(result, str):
            truncated = result[:max_chars] + ("..." if len(result) > max_chars else "")
            summary_payload = {"role": "assistant", "content": truncated}
        else:
            summary_payload = {"role": "assistant", "content": summary}
        new_msg["content"] = summary_payload
        return new_msg

    latest_tool_kept = 0
    canvas_kept = 0
    out: List[Dict[str, Any]] = []

    for msg in reversed(messages):
        if msg.get("type") != "tool":
            out.append(msg)
            continue

        info = _extract_info(msg)
        name = (info.get("name") or "").lower()
        is_canvas = name.startswith("canvas_")
        is_search = "search" in name

        if is_canvas and canvas_kept < keep_latest_canvas:
            canvas_kept += 1
            out.append(msg)
            continue
        if (not is_canvas) and latest_tool_kept < keep_latest:
            latest_tool_kept += 1
            out.append(msg)
            continue

        out.append(_shrink(msg, info, is_search))

    return list(reversed(out))


def resolve_context_budget(llm_model: str, llm_max_tokens: Optional[int]) -> int:
    if llm_max_tokens:
        return int(llm_max_tokens)
    per_model_raw = os.getenv("MAX_CONTEXT_TOKENS_PER_MODEL", "")
    try:
        if per_model_raw:
            mapping = json.loads(per_model_raw)
            if llm_model in mapping:
                return int(mapping[llm_model])
    except Exception:
        logger.debug("Failed to parse MAX_CONTEXT_TOKENS_PER_MODEL; using default")
    return int(os.getenv("MAX_CONTEXT_TOKENS_DEFAULT", 32000))


def trim_by_tokens(
    messages: List[Dict[str, Any]],
    llm_model: str,
    budget: int,
    *,
    min_recent: int = 10,
    always_keep_system: bool = True,
) -> List[Dict[str, Any]]:
    if not messages:
        return []

    min_set = set()
    for msg in reversed(messages):
        min_set.add(id(msg))
        if len(min_set) >= min_recent:
            break

    kept = []
    total = 0
    for msg in reversed(messages):
        msg_id = id(msg)
        role = msg.get("role") or msg.get("type")
        tokens = token_counter(model=llm_model, messages=[msg])
        if always_keep_system and role == "system":
            kept.append(msg)
            continue
        if msg_id in min_set:
            kept.append(msg)
            total += tokens
            continue
        if total + tokens > budget:
            continue
        kept.append(msg)
        total += tokens

    return list(reversed(kept))


def augment_messages_with_image_urls(messages: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Append image_url parts for markdown links in user messages."""
    if not messages:
        return messages

    md_link_re = re.compile(r"\[([^\]]+)\]\(([^)]+)\)")
    new_messages: List[Dict[str, Any]] = []
    for msg in messages:
        role = msg.get("role") or msg.get("type")
        content = msg.get("content")
        if role == "user" and isinstance(content, str):
            text = content
            image_urls: List[str] = []
            for match in md_link_re.finditer(text):
                url = (match.group(2) or "").strip()
                if not url:
                    continue
                if not url.lower().startswith("http"):
                    continue
                image_urls.append(url)

            if image_urls:
                parts: List[Dict[str, Any]] = [{"type": "text", "text": text}]
                for url in image_urls:
                    parts.append({"type": "image_url", "image_url": {"url": url}})
                new_msg = dict(msg)
                new_msg["content"] = parts
                new_messages.append(new_msg)
                continue

        new_messages.append(msg)

    return new_messages
