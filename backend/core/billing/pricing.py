from __future__ import annotations
from decimal import Decimal
from core.ai_models import model_manager
from core.utils.logger import logger
from .config import TOKEN_PRICE_MULTIPLIER

DEFAULT_UNKNOWN_MODEL_COST = Decimal("0.01")


def calculate_token_cost(prompt_tokens: int, completion_tokens: int, model: str) -> Decimal:
    try:
        resolved_model = model_manager.resolve_model_id(model)
        model_obj = model_manager.get_model(resolved_model)
        if model_obj and model_obj.pricing:
            input_cost = Decimal(prompt_tokens) / Decimal("1000000") * Decimal(str(model_obj.pricing.input_cost_per_million_tokens))
            output_cost = Decimal(completion_tokens) / Decimal("1000000") * Decimal(str(model_obj.pricing.output_cost_per_million_tokens))
            return (input_cost + output_cost) * TOKEN_PRICE_MULTIPLIER
        logger.warning(f"[COST_CALC] No pricing for model '{model}' (resolved '{resolved_model}'), default ${DEFAULT_UNKNOWN_MODEL_COST}")
        return DEFAULT_UNKNOWN_MODEL_COST
    except Exception as e:
        logger.error(f"[COST_CALC] Error for model '{model}': {e}")
        return DEFAULT_UNKNOWN_MODEL_COST
