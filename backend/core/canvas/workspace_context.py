from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any, Dict, Iterable, List, Optional, Sequence, Tuple


GLOBAL_READ_PHRASES: tuple[str, ...] = (
    "所有画布",
    "全部画布",
    "全局画布",
    "整个工作区",
    "全部工作区",
    "跨画布",
    "workspace-wide",
    "workspace wide",
    "all canvases",
    "across canvases",
    "entire workspace",
    "whole workspace",
)

WRITE_INTENT_PHRASES: tuple[str, ...] = (
    "创建",
    "新建",
    "新增",
    "写入",
    "写到",
    "编辑",
    "修改",
    "更新",
    "删除",
    "重命名",
    "移动到",
    "复制到",
    "create",
    "add",
    "write",
    "edit",
    "update",
    "delete",
    "rename",
    "move",
    "copy",
)

CANVAS_HINT_PHRASES: tuple[str, ...] = (
    "画布",
    "canvas",
)

_EN_STOPWORDS = {
    "the",
    "and",
    "for",
    "with",
    "from",
    "into",
    "this",
    "that",
    "these",
    "those",
    "please",
    "about",
    "current",
    "default",
    "canvas",
    "canvases",
    "workspace",
    "across",
    "global",
    "read",
    "search",
    "find",
    "info",
    "information",
}

_ZH_STOPWORDS = {
    "请",
    "帮我",
    "一下",
    "当前",
    "默认",
    "所有",
    "全部",
    "全局",
    "整个",
    "工作区",
    "跨画布",
    "画布",
    "读取",
    "搜索",
    "查找",
    "信息",
    "内容",
    "相关",
    "然后",
    "后续",
    "可以",
    "需要",
}


@dataclass(frozen=True)
class WorkspaceMessageIntent:
    mode: str
    explicit_global_read: bool
    write_intent: bool
    has_canvas_reference: bool
    query_keywords: List[str]

    def to_metadata(self) -> Dict[str, Any]:
        data: Dict[str, Any] = {
            "mode": self.mode,
            "explicit_global_read": self.explicit_global_read,
            "write_intent": self.write_intent,
            "has_canvas_reference": self.has_canvas_reference,
        }
        if self.query_keywords:
            data["query_keywords"] = list(self.query_keywords)
        return data


def _normalize_text(value: Optional[str]) -> str:
    text = str(value or "")
    text = text.replace("\u3000", " ")
    text = re.sub(r"\s+", " ", text)
    return text.strip()


def _contains_any_phrase(text: str, phrases: Iterable[str]) -> bool:
    lowered = text.casefold()
    for phrase in phrases:
        if phrase and phrase.casefold() in lowered:
            return True
    return False


def detect_explicit_global_read(message_text: Optional[str]) -> bool:
    normalized = _normalize_text(message_text)
    if not normalized:
        return False
    return _contains_any_phrase(normalized, GLOBAL_READ_PHRASES)


def detect_write_intent(message_text: Optional[str]) -> bool:
    normalized = _normalize_text(message_text)
    if not normalized:
        return False
    return _contains_any_phrase(normalized, WRITE_INTENT_PHRASES)


def detect_canvas_reference_hint(message_text: Optional[str]) -> bool:
    normalized = _normalize_text(message_text)
    if not normalized:
        return False
    return _contains_any_phrase(normalized, CANVAS_HINT_PHRASES)


def extract_workspace_query_keywords(
    message_text: Optional[str],
    *,
    max_keywords: int = 8,
) -> List[str]:
    normalized = _normalize_text(message_text)
    if not normalized:
        return []

    tokens: List[str] = []
    seen: set[str] = set()

    for match in re.finditer(r"[A-Za-z][A-Za-z0-9_-]{1,31}|[\u4e00-\u9fff]{2,20}", normalized):
        raw = match.group(0)
        token = raw.casefold()
        if token in seen:
            continue
        if re.fullmatch(r"[A-Za-z][A-Za-z0-9_-]{1,31}", raw):
            if token in _EN_STOPWORDS:
                continue
        else:
            if token in _ZH_STOPWORDS:
                continue
        seen.add(token)
        tokens.append(raw)
        if len(tokens) >= max_keywords:
            break

    return tokens


def build_workspace_scope_metadata(message_text: Optional[str]) -> Dict[str, Any]:
    explicit_global_read = detect_explicit_global_read(message_text)
    intent = WorkspaceMessageIntent(
        mode="global_read" if explicit_global_read else "local",
        explicit_global_read=explicit_global_read,
        write_intent=detect_write_intent(message_text),
        has_canvas_reference=detect_canvas_reference_hint(message_text),
        query_keywords=extract_workspace_query_keywords(message_text),
    )
    return intent.to_metadata()


def _normalize_title(value: Optional[str]) -> str:
    if not isinstance(value, str):
        return ""
    text = value.strip().casefold()
    text = re.sub(r"\s+", " ", text)
    return text


def resolve_target_canvas_from_message(
    message_text: Optional[str],
    canvases: Sequence[Dict[str, Any]],
) -> Tuple[Optional[Dict[str, str]], List[str]]:
    text = _normalize_text(message_text)
    if not text:
        return (None, [])
    text_norm = text.casefold()

    candidates: Dict[str, str] = {}

    def _register(canvas: Dict[str, Any]) -> None:
        canvas_id = str(canvas.get("id") or "").strip()
        title = str(canvas.get("title") or canvas.get("name") or "").strip()
        if not canvas_id or not title:
            return
        candidates.setdefault(canvas_id, title)

    for canvas in canvases:
        canvas_id = str(canvas.get("id") or "").strip()
        if canvas_id and canvas_id in text:
            _register(canvas)

    title_index: Dict[str, List[Dict[str, Any]]] = {}
    for canvas in canvases:
        title = str(canvas.get("title") or canvas.get("name") or "").strip()
        norm = _normalize_title(title)
        if not norm:
            continue
        title_index.setdefault(norm, []).append(canvas)

    quote_pattern = r"[\"“”'‘’《》「」『』]([^\"“”'‘’《》「」『』]{1,80})[\"“”'‘’《》「」『』]"
    for match in re.finditer(quote_pattern, text):
        quoted_norm = _normalize_title(match.group(1))
        if not quoted_norm:
            continue
        for canvas in title_index.get(quoted_norm, []):
            _register(canvas)

    for canvas in canvases:
        title = str(canvas.get("title") or canvas.get("name") or "").strip()
        norm = _normalize_title(title)
        if len(norm) < 2:
            continue
        if norm in text_norm:
            _register(canvas)

    if not candidates:
        for match in re.finditer(r"([\u4e00-\u9fffA-Za-z0-9 _-]{2,40})画布", text):
            mention = _normalize_title(match.group(1))
            if len(mention) < 2:
                continue
            mention_terms = [mention]
            for marker in ("在", "到", "给", "把", "将", "里", "上", "中", "的", "to"):
                if marker in mention:
                    tail = _normalize_title(mention.split(marker)[-1])
                    if len(tail) >= 2 and tail not in mention_terms:
                        mention_terms.append(tail)
            if len(mention) >= 3:
                for n in (3, 4, 5, 6):
                    if len(mention) > n:
                        suffix = _normalize_title(mention[-n:])
                        if len(suffix) >= 2 and suffix not in mention_terms:
                            mention_terms.append(suffix)

            for canvas in canvases:
                title = str(canvas.get("title") or canvas.get("name") or "").strip()
                norm = _normalize_title(title)
                if len(norm) < 2:
                    continue
                if any(term in norm for term in mention_terms):
                    _register(canvas)

    if len(candidates) == 1:
        canvas_id, title = next(iter(candidates.items()))
        return ({"canvas_id": canvas_id, "title": title}, [])

    if len(candidates) > 1:
        ambiguous_titles = list(dict.fromkeys(candidates.values()))
        return (None, ambiguous_titles[:8])

    return (None, [])
