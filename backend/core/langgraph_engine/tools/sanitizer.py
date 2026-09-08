from __future__ import annotations

import copy
from dataclasses import dataclass
from typing import Any, Dict, Iterable, List, Optional, Set, Tuple


# v1: assume most strict OpenAI-compatible gateway.
FORBIDDEN_KEYS: Set[str] = {
    "anyOf",
    "oneOf",
    "allOf",
    "not",
    "if",
    "then",
    "else",
    "dependentRequired",
    "$ref",
    "$defs",
    "definitions",
    "patternProperties",
    "unevaluatedProperties",
    "nullable",
}

# Bump when sanitizer rules materially change to invalidate caches (MCP, etc.).
SANITIZER_VERSION = "v1"

UNION_KEYS: Tuple[str, ...] = ("anyOf", "oneOf", "allOf")

# Keep the allowed set intentionally small and boring.
ALLOWED_SCHEMA_KEYS: Set[str] = {
    "type",
    "description",
    "title",
    "properties",
    "required",
    "items",
    "enum",
    "default",
    "minimum",
    "maximum",
    "minLength",
    "maxLength",
    "minItems",
    "maxItems",
    "additionalProperties",
    "format",
}


@dataclass(frozen=True)
class SchemaIssue:
    path: str
    message: str
    severity: str  # "error" | "warning"
    rule: str


def lint_json_schema(schema: Any, *, path: str = "$") -> List[SchemaIssue]:
    """Lint a JSON-schema-ish dict for v1 tool-schema compatibility."""
    issues: List[SchemaIssue] = []

    def walk(obj: Any, cur: str) -> None:
        if isinstance(obj, dict):
            for key, value in obj.items():
                if key in FORBIDDEN_KEYS:
                    issues.append(
                        SchemaIssue(
                            path=f"{cur}/{key}",
                            message=f"Forbidden key '{key}' (v1 schema subset).",
                            severity="error",
                            rule="forbidden_key",
                        )
                    )
                if key == "type" and isinstance(value, list):
                    issues.append(
                        SchemaIssue(
                            path=f"{cur}/{key}",
                            message="Forbidden multi-type 'type: [...]' (must be a single string type).",
                            severity="error",
                            rule="type_list",
                        )
                    )
                if key == "const":
                    issues.append(
                        SchemaIssue(
                            path=f"{cur}/{key}",
                            message="Forbidden 'const' (must be converted to single-value enum).",
                            severity="error",
                            rule="const",
                        )
                    )
                if key in ("$defs", "definitions"):
                    issues.append(
                        SchemaIssue(
                            path=f"{cur}/{key}",
                            message=f"Forbidden schema definitions '{key}' (must be fully inlined).",
                            severity="error",
                            rule="definitions",
                        )
                    )
                walk(value, f"{cur}/{key}")
        elif isinstance(obj, list):
            for idx, value in enumerate(obj):
                walk(value, f"{cur}/{idx}")

    walk(schema, path)
    return issues


def lint_openai_tool_schema(tool_schema: Any, *, path: str = "$") -> List[SchemaIssue]:
    """Lint an OpenAI 'tools' item: {'type':'function','function':{...}}."""
    issues: List[SchemaIssue] = []
    if not isinstance(tool_schema, dict):
        return [
            SchemaIssue(
                path=path,
                message="Tool schema must be an object.",
                severity="error",
                rule="shape",
            )
        ]

    if tool_schema.get("type") != "function":
        issues.append(
            SchemaIssue(
                path=f"{path}/type",
                message="Tool schema must have type='function'.",
                severity="error",
                rule="shape",
            )
        )

    fn = tool_schema.get("function")
    if not isinstance(fn, dict):
        issues.append(
            SchemaIssue(
                path=f"{path}/function",
                message="Tool schema must contain object 'function'.",
                severity="error",
                rule="shape",
            )
        )
        return issues

    if not isinstance(fn.get("name"), str) or not fn.get("name"):
        issues.append(
            SchemaIssue(
                path=f"{path}/function/name",
                message="Tool schema must contain non-empty string 'function.name'.",
                severity="error",
                rule="shape",
            )
        )

    params = fn.get("parameters")
    if params is None:
        issues.append(
            SchemaIssue(
                path=f"{path}/function/parameters",
                message="Tool schema is missing 'function.parameters'.",
                severity="error",
                rule="shape",
            )
        )
        return issues
    issues.extend(lint_json_schema(params, path=f"{path}/function/parameters"))
    return issues


def sanitize_openai_tool_schema(tool_schema: Dict[str, Any]) -> Tuple[Dict[str, Any], List[SchemaIssue]]:
    """Return a v1-compatible OpenAI tool schema + warnings emitted during downgrade."""
    cloned: Dict[str, Any] = copy.deepcopy(tool_schema)
    warnings: List[SchemaIssue] = []

    fn = cloned.get("function")
    if not isinstance(fn, dict):
        # Keep it minimally valid; linter will still flag shape issues if caller wants strictness.
        cloned["type"] = "function"
        cloned["function"] = {"name": str(cloned.get("name") or "tool"), "parameters": {"type": "object", "properties": {}}}
        warnings.append(
            SchemaIssue(
                path="$/function",
                message="Tool schema missing function object; replaced with minimal placeholder.",
                severity="warning",
                rule="shape_repair",
            )
        )
        return cloned, warnings

    params = fn.get("parameters")
    if not isinstance(params, dict):
        params = {"type": "object", "properties": {}, "required": []}
        fn["parameters"] = params
        warnings.append(
            SchemaIssue(
                path="$/function/parameters",
                message="Missing/invalid parameters; replaced with empty object schema.",
                severity="warning",
                rule="shape_repair",
            )
        )

    sanitized_params, param_warnings = sanitize_json_schema(params, root=params, path="$/function/parameters")
    fn["parameters"] = sanitized_params if isinstance(sanitized_params, dict) else {"type": "object", "properties": {}, "required": []}
    warnings.extend(param_warnings)

    # Ensure top-level shape is correct
    cloned["type"] = "function"
    return cloned, warnings


def sanitize_json_schema(
    schema: Any,
    *,
    root: Optional[Dict[str, Any]] = None,
    path: str = "$",
) -> Tuple[Any, List[SchemaIssue]]:
    """Sanitize a JSON schema to the v1 allowed subset.

    - Removes anyOf/oneOf/allOf/not/if/then/else/dependentRequired
    - Inlines $ref/$defs/definitions
    - Removes nullable and type lists (no 'null' union)
    - Converts const -> enum([const])
    - Drops patternProperties/unevaluatedProperties (keeps additionalProperties permissive)
    """
    warnings: List[SchemaIssue] = []

    root_schema = root if root is not None else (schema if isinstance(schema, dict) else {})
    defs = _collect_defs(root_schema)

    sanitized = _sanitize_any(schema, root_schema=root_schema, defs=defs, path=path, warnings=warnings, ref_stack=())
    if isinstance(sanitized, dict):
        sanitized.pop("$defs", None)
        sanitized.pop("definitions", None)
    return sanitized, warnings


def _collect_defs(root_schema: Dict[str, Any]) -> Dict[str, Any]:
    defs: Dict[str, Any] = {}
    for key in ("$defs", "definitions"):
        block = root_schema.get(key)
        if isinstance(block, dict):
            defs[key] = block
    return defs


def _sanitize_any(
    value: Any,
    *,
    root_schema: Dict[str, Any],
    defs: Dict[str, Any],
    path: str,
    warnings: List[SchemaIssue],
    ref_stack: Tuple[str, ...],
) -> Any:
    if isinstance(value, dict):
        return _sanitize_schema_dict(
            value,
            root_schema=root_schema,
            defs=defs,
            path=path,
            warnings=warnings,
            ref_stack=ref_stack,
        )
    if isinstance(value, list):
        return [
            _sanitize_any(v, root_schema=root_schema, defs=defs, path=f"{path}/{i}", warnings=warnings, ref_stack=ref_stack)
            for i, v in enumerate(value)
        ]
    return value


def _sanitize_schema_dict(
    schema: Dict[str, Any],
    *,
    root_schema: Dict[str, Any],
    defs: Dict[str, Any],
    path: str,
    warnings: List[SchemaIssue],
    ref_stack: Tuple[str, ...],
) -> Dict[str, Any]:
    working: Dict[str, Any] = copy.deepcopy(schema)

    # Inline local refs early.
    if "$ref" in working:
        ref = working.get("$ref")
        if isinstance(ref, str):
            if ref in ref_stack:
                warnings.append(
                    SchemaIssue(
                        path=f"{path}/$ref",
                        message=f"Recursive $ref detected ({ref}); downgraded to permissive object.",
                        severity="warning",
                        rule="ref_cycle",
                    )
                )
                return _permissive_object_schema(working, require_op=False)

            resolved = _resolve_local_ref(ref, root_schema=root_schema, defs=defs)
            if resolved is None:
                warnings.append(
                    SchemaIssue(
                        path=f"{path}/$ref",
                        message=f"Unresolvable $ref '{ref}'; downgraded to permissive object.",
                        severity="warning",
                        rule="ref_unresolved",
                    )
                )
                return _permissive_object_schema(working, require_op=False)

            # Merge overlay keys (e.g. description) on top of resolved schema.
            overlay = {k: v for k, v in working.items() if k != "$ref"}
            merged = copy.deepcopy(resolved)
            merged.update(overlay)
            return _sanitize_schema_dict(
                merged,
                root_schema=root_schema,
                defs=defs,
                path=path,
                warnings=warnings,
                ref_stack=ref_stack + (ref,),
            )

    # Convert const -> enum([const])
    if "const" in working:
        const_value = working.pop("const")
        working.setdefault("enum", [const_value])
        warnings.append(
            SchemaIssue(
                path=f"{path}/const",
                message="Converted const -> single-value enum for v1 compatibility.",
                severity="warning",
                rule="const_to_enum",
            )
        )

    # Remove nullable and type lists
    if "nullable" in working:
        working.pop("nullable", None)
        warnings.append(
            SchemaIssue(
                path=f"{path}/nullable",
                message="Removed nullable for v1 compatibility (use optional field semantics).",
                severity="warning",
                rule="remove_nullable",
            )
        )

    if isinstance(working.get("type"), list):
        original = list(working["type"])
        non_null = [t for t in original if t != "null"]
        if len(non_null) == 1:
            working["type"] = non_null[0]
        else:
            # Multi-type beyond null is not representable in v1 subset; downgrade.
            warnings.append(
                SchemaIssue(
                    path=f"{path}/type",
                    message=f"Downgraded multi-type {original} to permissive object (v1 forbids union types).",
                    severity="warning",
                    rule="type_list_downgrade",
                )
            )
            return _permissive_object_schema(working, require_op=_looks_like_canvas_op(working))

    # Drop forbidden conditional composition keys.
    for bad in ("not", "if", "then", "else", "dependentRequired"):
        if bad in working:
            working.pop(bad, None)
            warnings.append(
                SchemaIssue(
                    path=f"{path}/{bad}",
                    message=f"Removed forbidden key '{bad}' for v1 compatibility.",
                    severity="warning",
                    rule="drop_forbidden",
                )
            )

    # Drop schema-definition blocks from output (refs are inlined above).
    working.pop("$defs", None)
    working.pop("definitions", None)

    # Drop patternProperties / unevaluatedProperties (keep permissive additionalProperties)
    for bad in ("patternProperties", "unevaluatedProperties"):
        if bad in working:
            working.pop(bad, None)
            working["additionalProperties"] = True
            warnings.append(
                SchemaIssue(
                    path=f"{path}/{bad}",
                    message=f"Removed '{bad}' and set additionalProperties=true (v1 subset).",
                    severity="warning",
                    rule="drop_advanced_properties",
                )
            )

    # Handle anyOf/oneOf/allOf.
    for key in UNION_KEYS:
        if key not in working:
            continue
        variants = working.get(key)
        if isinstance(variants, list) and _is_conditional_required_union(working, variants):
            working.pop(key, None)
            warnings.append(
                SchemaIssue(
                    path=f"{path}/{key}",
                    message=f"Dropped '{key}' conditional requirements; enforce at runtime.",
                    severity="warning",
                    rule="drop_conditional_required",
                )
            )
            continue

        simplified = _collapse_union(
            key,
            variants if isinstance(variants, list) else [],
            warnings=warnings,
            path=f"{path}/{key}",
        )
        # Preserve helpful metadata if present.
        for meta_key in ("description", "title", "default", "format"):
            if meta_key in working and meta_key not in simplified:
                simplified[meta_key] = working[meta_key]
        return _sanitize_schema_dict(
            simplified,
            root_schema=root_schema,
            defs=defs,
            path=path,
            warnings=warnings,
            ref_stack=ref_stack,
        )

    # Recursively sanitize sub-schemas.
    out: Dict[str, Any] = {}
    for key, value in working.items():
        if key in FORBIDDEN_KEYS:
            # Should be handled above; keep defense-in-depth.
            warnings.append(
                SchemaIssue(
                    path=f"{path}/{key}",
                    message=f"Dropped forbidden key '{key}'.",
                    severity="warning",
                    rule="drop_forbidden",
                )
            )
            continue

        if key not in ALLOWED_SCHEMA_KEYS:
            # v1: keep schema minimal; drop unknown keys to reduce gateway variance.
            continue

        if key == "properties" and isinstance(value, dict):
            out[key] = {
                str(prop): _sanitize_any(
                    subschema,
                    root_schema=root_schema,
                    defs=defs,
                    path=f"{path}/properties/{prop}",
                    warnings=warnings,
                    ref_stack=ref_stack,
                )
                for prop, subschema in value.items()
            }
            continue

        if key == "items":
            out[key] = _sanitize_any(
                value,
                root_schema=root_schema,
                defs=defs,
                path=f"{path}/items",
                warnings=warnings,
                ref_stack=ref_stack,
            )
            continue

        if key == "additionalProperties":
            if isinstance(value, dict):
                # If it's complex/invalid after sanitization, fall back to true.
                sanitized_ap = _sanitize_any(
                    value,
                    root_schema=root_schema,
                    defs=defs,
                    path=f"{path}/additionalProperties",
                    warnings=warnings,
                    ref_stack=ref_stack,
                )
                out[key] = sanitized_ap if isinstance(sanitized_ap, dict) else True
            else:
                out[key] = bool(value)
            continue

        if key == "required" and isinstance(value, list):
            out[key] = [str(v) for v in value if isinstance(v, str)]
            continue

        if key == "enum" and isinstance(value, list):
            # Keep only JSON-serializable primitives.
            cleaned_enum: List[Any] = []
            for v in value:
                if v is None or isinstance(v, (str, int, float, bool)):
                    cleaned_enum.append(v)
            out[key] = cleaned_enum
            continue

        out[key] = _sanitize_any(
            value,
            root_schema=root_schema,
            defs=defs,
            path=f"{path}/{key}",
            warnings=warnings,
            ref_stack=ref_stack,
        )

    # If it's an object schema without explicit additionalProperties, keep it permissive by default (v1).
    if out.get("type") == "object" and "additionalProperties" not in out:
        out["additionalProperties"] = True

    # v1: do not force additionalProperties=false (some gateways reject strict objects).
    if out.get("type") == "object" and out.get("additionalProperties") is False:
        out["additionalProperties"] = True
        warnings.append(
            SchemaIssue(
                path=f"{path}/additionalProperties",
                message="Relaxed additionalProperties=false -> true for v1 gateway compatibility; validate at runtime.",
                severity="warning",
                rule="additional_properties_relaxed",
            )
        )

    # Avoid outputting default=null for non-nullable fields (common after dropping Optional[T]|null unions).
    if "default" in out and out.get("default") is None:
        out.pop("default", None)

    # Ensure required is present as a list for root-ish object schemas (helps reduce downstream shape variance).
    if out.get("type") == "object" and "required" not in out:
        out["required"] = []

    return out


def _resolve_local_ref(ref: str, *, root_schema: Dict[str, Any], defs: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    if not ref.startswith("#/"):
        return None

    # Fast-path: common cases.
    if ref.startswith("#/$defs/"):
        key = ref.split("/", 2)[2]
        block = defs.get("$defs")
        if isinstance(block, dict) and key in block and isinstance(block[key], dict):
            return block[key]
        return None

    if ref.startswith("#/definitions/"):
        key = ref.split("/", 2)[2]
        block = defs.get("definitions")
        if isinstance(block, dict) and key in block and isinstance(block[key], dict):
            return block[key]
        return None

    # Generic JSON pointer traversal within root_schema.
    cur: Any = root_schema
    for part in ref[2:].split("/"):
        if not isinstance(cur, dict) or part not in cur:
            return None
        cur = cur[part]
    return cur if isinstance(cur, dict) else None


def _is_conditional_required_union(schema: Dict[str, Any], variants: List[Any]) -> bool:
    """Detect patterns like: parameters{type=object,properties=... , anyOf=[{required:[...]}, ...]}."""
    if schema.get("type") != "object":
        return False
    if not isinstance(schema.get("properties"), dict):
        return False
    for variant in variants:
        if not isinstance(variant, dict):
            return False
        # Only allow required + nested unions (common "either A or B is required" patterns).
        allowed = {"required", "anyOf", "oneOf", "allOf"}
        if any(k not in allowed for k in variant.keys()):
            return False
        if "required" in variant and not isinstance(variant["required"], list):
            return False
    return True


def _collapse_union(key: str, variants: List[Any], *, warnings: List[SchemaIssue], path: str) -> Dict[str, Any]:
    """Collapse anyOf/oneOf/allOf into a v1-safe schema (best-effort)."""
    variant_schemas: List[Dict[str, Any]] = [v for v in variants if isinstance(v, dict)]

    # Common Pydantic v2 pattern: T | null expressed as anyOf=[T, {"type":"null"}].
    # Handle both 2-variant (T | null) and 3+-variant (A | B | null) cases.
    non_null = _union_drop_null(variant_schemas)
    if non_null is not None:
        warnings.append(
            SchemaIssue(
                path=path,
                message=f"Dropped '{key}' null branch (T|null) -> T; represent optionality via 'required'.",
                severity="warning",
                rule="drop_null_union",
            )
        )
        return non_null

    # For 3+ variant unions with null: strip null first, then continue processing.
    stripped = _union_strip_null(variant_schemas)
    if stripped is not None and len(stripped) < len(variant_schemas):
        warnings.append(
            SchemaIssue(
                path=path,
                message=f"Stripped '{key}' null branch from {len(variant_schemas)}-variant union; continuing with {len(stripped)} variants.",
                severity="warning",
                rule="strip_null_union",
            )
        )
        variant_schemas = stripped

    # Common v1-safe pattern: string OR array[string] -> array[string].
    if _union_is_string_or_string_array(variant_schemas):
        warnings.append(
            SchemaIssue(
                path=path,
                message=f"Collapsed '{key}' (string|array[string]) -> array[string]; accept single string at runtime.",
                severity="warning",
                rule="collapse_string_or_array",
            )
        )
        return {"type": "array", "items": {"type": "string"}, "minItems": 1}

    # Canvas op variants: keep 'op' required as a hint to the model.
    if _union_looks_like_canvas_ops(variant_schemas):
        warnings.append(
            SchemaIssue(
                path=path,
                message=f"Collapsed '{key}' (canvas op variants) -> permissive object with required op.",
                severity="warning",
                rule="collapse_canvas_ops",
            )
        )
        return _permissive_object_schema({}, require_op=True)

    warnings.append(
        SchemaIssue(
            path=path,
            message=f"Collapsed '{key}' -> permissive object; validate at runtime.",
            severity="warning",
            rule="collapse_union_fallback",
        )
    )
    return _permissive_object_schema({}, require_op=False)


def _union_drop_null(variants: List[Dict[str, Any]]) -> Dict[str, Any] | None:
    if len(variants) != 2:
        return None
    if _is_null_schema(variants[0]) and not _is_null_schema(variants[1]):
        return variants[1]
    if _is_null_schema(variants[1]) and not _is_null_schema(variants[0]):
        return variants[0]
    return None


def _union_strip_null(variants: List[Dict[str, Any]]) -> List[Dict[str, Any]] | None:
    """Strip null branches from a variant list, returning non-null variants.

    Returns None if no null branches were found (nothing to strip).
    """
    non_null = [v for v in variants if not _is_null_schema(v)]
    if len(non_null) == len(variants):
        return None  # No null branch present
    return non_null


def _is_null_schema(schema: Dict[str, Any]) -> bool:
    return schema.get("type") == "null"


def _union_is_string_or_string_array(variants: List[Dict[str, Any]]) -> bool:
    if len(variants) != 2:
        return False
    has_string = any(_is_string_schema(v) for v in variants)
    has_array_str = any(_is_array_of_strings_schema(v) for v in variants)
    return has_string and has_array_str


def _is_string_schema(schema: Dict[str, Any]) -> bool:
    return schema.get("type") == "string"


def _is_array_of_strings_schema(schema: Dict[str, Any]) -> bool:
    if schema.get("type") != "array":
        return False
    items = schema.get("items")
    return isinstance(items, dict) and items.get("type") == "string"


def _union_looks_like_canvas_ops(variants: List[Dict[str, Any]]) -> bool:
    for v in variants:
        props = v.get("properties")
        if not isinstance(props, dict):
            continue
        op = props.get("op")
        if isinstance(op, dict) and ("const" in op or "enum" in op):
            return True
    return False


def _looks_like_canvas_op(schema: Dict[str, Any]) -> bool:
    props = schema.get("properties")
    if not isinstance(props, dict):
        return False
    op = props.get("op")
    return isinstance(op, dict)


def _permissive_object_schema(source: Dict[str, Any], *, require_op: bool) -> Dict[str, Any]:
    out: Dict[str, Any] = {"type": "object", "additionalProperties": True, "properties": {}, "required": []}
    desc = source.get("description")
    if isinstance(desc, str) and desc:
        out["description"] = desc
    if require_op:
        out["properties"]["op"] = {"type": "string", "description": "Operation type"}
        out["required"] = ["op"]
    return out
