from __future__ import annotations

import json
import re
from typing import Any


def normalize_message_content(content: Any) -> str:
    if content is None:
        return ""
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts: list[str] = []
        for item in content:
            if isinstance(item, str):
                parts.append(item)
            elif isinstance(item, dict):
                text = item.get("text") or item.get("content")
                if isinstance(text, str):
                    parts.append(text)
        return "".join(parts)
    if isinstance(content, dict):
        inner = content.get("content")
        if isinstance(inner, str):
            return inner
    return str(content)


def extract_research_topic(messages: list[dict[str, Any]]) -> str:
    fallback = ""
    for msg in reversed(messages):
        if not isinstance(msg, dict):
            continue
        if msg.get("role") != "user":
            continue
        text = normalize_message_content(msg.get("content")).strip()
        if text:
            fallback = text
            break

    if not fallback:
        return "Research the user's request."

    lines = [line.strip() for line in fallback.splitlines() if line.strip()]
    if not lines:
        return fallback

    def _pick(prefixes: tuple[str, ...]) -> str | None:
        for line in lines:
            for prefix in prefixes:
                if line.lower().startswith(prefix.lower()):
                    return line.split(":", 1)[-1].strip()
        return None

    task = _pick(("Task:",))
    latest = _pick(("Latest user message:",))
    context = _pick(("Context:",))

    if task and context and context not in task:
        return f"{task}. {context}"
    if task:
        return task
    if latest:
        return latest
    return fallback


def extract_json_payload(text: str) -> Any:
    if not text:
        return None
    try:
        return json.loads(text)
    except Exception:
        pass
    match = re.search(r"\{.*\}", text, re.DOTALL)
    if match:
        snippet = match.group(0)
        try:
            return json.loads(snippet)
        except Exception:
            return None
    return None


def normalize_query_list(raw: Any) -> list[str]:
    if raw is None:
        return []
    if isinstance(raw, str):
        text = raw.strip()
        if not text:
            return []
        if "\n" in text:
            lines = []
            for line in text.splitlines():
                cleaned = line.strip().lstrip("-*•").strip()
                if cleaned:
                    lines.append(cleaned)
            if len(lines) > 1:
                return lines
        return [text]
    if isinstance(raw, list):
        out: list[str] = []
        for item in raw:
            if isinstance(item, str) and item.strip():
                out.append(item.strip())
            elif isinstance(item, dict):
                candidate = item.get("query") or item.get("text")
                if isinstance(candidate, str) and candidate.strip():
                    out.append(candidate.strip())
        return out
    if isinstance(raw, dict):
        query = raw.get("query")
        return normalize_query_list(query)
    return []


def normalize_search_response(output: Any) -> dict[str, Any]:
    payload = output
    if isinstance(payload, str):
        try:
            payload = json.loads(payload)
        except Exception:
            return {"results": [], "answer": None, "insights": []}

    if isinstance(payload, dict) and "data" in payload:
        data = payload.get("data")
    else:
        data = payload

    if not isinstance(data, dict):
        return {"results": [], "answer": None, "insights": []}

    results = data.get("results") or []
    answer = data.get("answer")
    insights = payload.get("insights") if isinstance(payload, dict) else None

    return {
        "results": results if isinstance(results, list) else [],
        "answer": answer if isinstance(answer, str) else None,
        "insights": insights if isinstance(insights, list) else [],
    }


def normalize_extract_response(output: Any) -> list[dict[str, Any]]:
    payload = output
    if isinstance(payload, str):
        try:
            payload = json.loads(payload)
        except Exception:
            return []

    if isinstance(payload, dict) and "data" in payload:
        data = payload.get("data")
    else:
        data = payload

    if not isinstance(data, dict):
        return []

    extracted = data.get("extracted_content")
    if not isinstance(extracted, list):
        return []

    items: list[dict[str, Any]] = []
    for item in extracted:
        if not isinstance(item, dict):
            continue
        url = (item.get("url") or "").strip()
        title = (item.get("title") or "").strip()
        summary = (item.get("summary") or "").strip()
        content = (item.get("content") or "").strip()
        items.append(
            {
                "url": url,
                "title": title or "Source",
                "summary": summary or content[:400],
            }
        )
    return items


def format_search_summary(query: str, response: dict[str, Any], max_items: int = 6) -> str:
    lines: list[str] = [f'Query: "{query}"']
    answer = response.get("answer")
    if isinstance(answer, str) and answer.strip():
        lines.append(f"Search answer: {answer.strip()}")

    results = response.get("results") or []
    if isinstance(results, list) and results:
        lines.append("Top results:")
        for item in results[:max_items]:
            if not isinstance(item, dict):
                continue
            title = (item.get("title") or "Source").strip()
            url = (item.get("url") or "").strip()
            snippet = (item.get("content") or item.get("snippet") or "").strip()
            snippet = snippet[:280] + "..." if len(snippet) > 280 else snippet
            if url:
                lines.append(f"- {title} ({url}) — {snippet}")
            else:
                lines.append(f"- {title} — {snippet}")

    insights = response.get("insights")
    if isinstance(insights, list) and insights:
        lines.append("Insights: " + " | ".join(str(item) for item in insights[:5]))

    return "\n".join(lines).strip()


def collect_sources(query: str, response: dict[str, Any]) -> list[dict[str, Any]]:
    sources: list[dict[str, Any]] = []
    results = response.get("results") or []
    for item in results:
        if not isinstance(item, dict):
            continue
        url = (item.get("url") or "").strip()
        title = (item.get("title") or "").strip() or "Source"
        snippet = (item.get("content") or item.get("snippet") or "").strip()
        published_at = (item.get("published_date") or item.get("published_at") or "").strip()
        if not url:
            continue
        sources.append(
            {
                "title": title,
                "url": url,
                "snippet": snippet[:360],
                "query": query,
                "published_at": published_at,
            }
        )
    return sources


def dedupe_sources(sources: list[dict[str, Any]], max_sources: int = 12) -> list[dict[str, Any]]:
    seen: set[str] = set()
    out: list[dict[str, Any]] = []
    for source in sources:
        url = source.get("url")
        if not isinstance(url, str) or not url:
            continue
        if url in seen:
            continue
        seen.add(url)
        out.append(source)
        if len(out) >= max_sources:
            break
    return out


def assign_source_ids(sources: list[dict[str, Any]]) -> list[dict[str, Any]]:
    assigned: list[dict[str, Any]] = []
    for idx, source in enumerate(sources, start=1):
        entry = dict(source)
        entry["source_id"] = f"S{idx}"
        assigned.append(entry)
    return assigned


def format_extracted_summary(items: list[dict[str, Any]], max_items: int = 4) -> str:
    if not items:
        return ""
    lines = ["Deep extraction highlights:"]
    for item in items[:max_items]:
        title = item.get("title") or "Source"
        url = item.get("url") or ""
        summary = (item.get("summary") or "").strip()
        summary = summary[:320] + "..." if len(summary) > 320 else summary
        if url:
            lines.append(f"- {title} ({url}) — {summary}")
        else:
            lines.append(f"- {title} — {summary}")
    return "\n".join(lines).strip()


def apply_source_links(text: str, sources: list[dict[str, Any]]) -> str:
    updated = text
    for source in sources:
        source_id = source.get("source_id")
        title = source.get("title") or "Source"
        url = source.get("url") or ""
        if not source_id or not url:
            continue
        marker = f"[{source_id}]"
        link = f"[{title}]({url})"
        updated = updated.replace(marker, link)
    return updated


def append_sources_section(text: str, sources: list[dict[str, Any]]) -> str:
    if not sources:
        return text
    has_url = any(source.get("url") for source in sources)
    if not has_url:
        return text
    lines = [text.rstrip(), "", "Sources:"]
    for source in sources:
        source_id = source.get("source_id")
        title = source.get("title") or "Source"
        url = source.get("url") or ""
        if not url:
            continue
        label = f"[{source_id}]" if source_id else "-"
        lines.append(f"- {label} [{title}]({url})")
    return "\n".join(lines).strip()


def extract_top_urls(response: dict[str, Any], limit: int = 3) -> list[str]:
    results = response.get("results") or []
    urls: list[str] = []
    for item in results:
        if not isinstance(item, dict):
            continue
        url = (item.get("url") or "").strip()
        if not url:
            continue
        urls.append(url)
        if len(urls) >= limit:
            break
    return urls
