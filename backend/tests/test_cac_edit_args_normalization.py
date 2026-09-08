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


from core.canvas.cac.types import CanvasEditPayload
from core.langgraph_engine.tools.adapters.native_tool_adapter import CaCEditArgs


def test_cac_edit_args_accepts_nested_updates_delete_list():
    args = CaCEditArgs.model_validate(
        {
            "updates": {
                "$delete": ["n1", "n2"],
            }
        }
    )

    assert args.delete == ["n1", "n2"]
    assert args.updates is None


def test_cac_edit_args_keeps_updates_and_extracts_nested_delete():
    args = CaCEditArgs.model_validate(
        {
            "updates": {
                "$delete": ["n1"],
                "n2": {"content": "updated"},
            }
        }
    )

    assert args.delete == ["n1"]
    assert args.updates == {"n2": {"content": "updated"}}


def test_canvas_edit_payload_extracts_nested_updates_delete():
    payload = CanvasEditPayload.from_dict(
        {
            "updates": {
                "$delete": ["n1", "n2"],
            }
        }
    )

    assert payload.delete == ["n1", "n2"]
    assert payload.updates is None

