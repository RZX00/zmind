import sys
import types


if "core.utils.logger" not in sys.modules:
    logger_stub = types.ModuleType("core.utils.logger")

    class _Logger:  # pragma: no cover - test import shim
        def debug(self, *_args, **_kwargs):
            return None

        def info(self, *_args, **_kwargs):
            return None

        def warning(self, *_args, **_kwargs):
            return None

        def error(self, *_args, **_kwargs):
            return None

        def exception(self, *_args, **_kwargs):
            return None

    logger_stub.logger = _Logger()
    sys.modules["core.utils.logger"] = logger_stub


if "core.utils.config" not in sys.modules:
    config_stub = types.ModuleType("core.utils.config")

    class _Config:  # pragma: no cover - test import shim
        CANVAS_REALTIME_WRITE_ENABLED = False

    config_stub.config = _Config()
    sys.modules["core.utils.config"] = config_stub


if "core.services.supabase" not in sys.modules:
    supabase_service_stub = types.ModuleType("core.services.supabase")

    class DBConnection:  # pragma: no cover - test import shim
        pass

    supabase_service_stub.DBConnection = DBConnection
    sys.modules["core.services.supabase"] = supabase_service_stub


if "core.services.redis" not in sys.modules:
    redis_service_stub = types.ModuleType("core.services.redis")

    async def _get_client():  # pragma: no cover - test import shim
        return None

    redis_service_stub.get_client = _get_client
    sys.modules["core.services.redis"] = redis_service_stub

from core.langgraph_engine.tools.catalog import build_registry


def _by_name(schemas: list[dict], name: str) -> dict:
    for schema in schemas:
        fn = schema.get("function") if isinstance(schema, dict) else None
        if isinstance(fn, dict) and fn.get("name") == name:
            return schema
    raise AssertionError(f"tool schema not found: {name}")


def test_cac_canvas_edit_schema_advertises_special_keys():
    registry = build_registry()
    schemas = registry.openai_tools_schema()
    edit = _by_name(schemas, "canvas_edit")
    params = edit["function"]["parameters"]
    props = params.get("properties") or {}

    for key in ("delete", "select", "set_values", "transform", "operations", "connections", "canvas", "updates"):
        assert key in props, f"missing {key} in canvas_edit schema"


def test_cac_canvas_write_schema_advertises_temp_id_and_connections_shape():
    registry = build_registry()
    schemas = registry.openai_tools_schema()
    write = _by_name(schemas, "canvas_write")
    params = write["function"]["parameters"]
    props = params.get("properties") or {}

    assert "nodes" in props
    nodes = props["nodes"]
    assert nodes.get("type") == "array"
    node_items = nodes.get("items") or {}
    node_props = node_items.get("properties") or {}
    assert "$id" in node_props

    assert "connections" in props
    conn = props["connections"]
    # Canonical shape: { preset?, items? }
    assert conn.get("type") == "object"
    conn_props = conn.get("properties") or {}
    assert "preset" in conn_props
    assert "items" in conn_props


def test_workspace_list_canvases_tool_registered():
    registry = build_registry()
    schemas = registry.openai_tools_schema()
    listing = _by_name(schemas, "workspace_list_canvases")
    params = listing["function"]["parameters"]
    props = params.get("properties") or {}
    assert "query" in props
    assert "limit" in props
    assert "offset" in props
    assert "include_deleted" in props


def test_cac_read_write_edit_schemas_advertise_canvas_id():
    registry = build_registry()
    schemas = registry.openai_tools_schema()

    read = _by_name(schemas, "canvas_read")
    read_props = (read["function"]["parameters"].get("properties") or {})
    assert "canvas_id" in read_props
    assert "full" in read_props

    write = _by_name(schemas, "canvas_write")
    write_props = (write["function"]["parameters"].get("properties") or {})
    assert "canvas_id" in write_props

    edit = _by_name(schemas, "canvas_edit")
    edit_props = (edit["function"]["parameters"].get("properties") or {})
    assert "canvas_id" in edit_props


def test_only_cac_canvas_tools_registered():
    registry = build_registry()
    schemas = registry.openai_tools_schema()
    canvas_tools = {
        schema.get("function", {}).get("name")
        for schema in schemas
        if isinstance(schema, dict)
        and isinstance(schema.get("function"), dict)
        and str(schema["function"].get("name", "")).startswith("canvas_")
    }
    assert canvas_tools == {
        "canvas_read",
        "canvas_write",
        "canvas_edit",
        "canvas_generate_image",
    }
