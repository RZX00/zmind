from decimal import Decimal
from typing import Optional, Dict, Tuple
from core.billing.credit_manager import credit_manager
from core.billing.config import MINIMUM_CREDIT_FOR_RUN
from core.utils.config import config, EnvMode
from core.utils.logger import logger


def _load_provider_policy_service():
    from core.billing.provider_policy_service import provider_policy_service
    return provider_policy_service


class BillingIntegration:
    @staticmethod
    async def check_and_reserve_credits(account_id: str, estimated_tokens: int = 10000) -> Tuple[bool, str, Optional[str]]:
        if config.ENV_MODE == EnvMode.LOCAL:
            return True, "Local mode", None

        balance_info = await credit_manager.get_balance(account_id)
        balance = Decimal(str(balance_info.get('total', 0)))

        if balance < MINIMUM_CREDIT_FOR_RUN:
            return False, (
                f"Insufficient credits. Balance: ${balance:.2f}, "
                f"Required: >= ${MINIMUM_CREDIT_FOR_RUN}"
            ), None

        return True, f"Credits available: ${balance:.2f}", None

    @staticmethod
    async def check_model_and_billing_access(
        account_id: str,
        model_name: str,
        client=None
    ) -> Tuple[bool, str, Dict]:
        """Provider-policy 检查(D9)+ 余额阈值。模型/tier/unlimited 门控已移除(D4)。"""
        if config.ENV_MODE == EnvMode.LOCAL:
            logger.debug("Local development mode - skipping billing and model access checks")
            return True, "Local development mode", {"local_mode": True}

        try:
            from core.ai_models import model_manager
            from core.ai_models.provider_policy import provider_display_name

            resolved_model = model_manager.resolve_model_id(model_name) or model_name
            model_obj = model_manager.get_model(resolved_model)
            provider_id = None
            if model_obj and model_obj.provider:
                provider_id = model_obj.provider.value
            elif "/" in resolved_model:
                provider_id = resolved_model.split("/", 1)[0].strip().lower()

            if provider_id:
                provider_policy_service = _load_provider_policy_service()
                policy = await provider_policy_service.get_policy(account_id, client=client)
                enabled_providers = set(policy.enabled_providers)
                if provider_id not in enabled_providers:
                    return False, (
                        f"Provider '{provider_display_name(provider_id)}' is disabled "
                        f"in your AI provider settings."
                    ), {
                        "error_type": "model_access_denied",
                        "disabled_provider": provider_id,
                        "enabled_providers": sorted(enabled_providers),
                    }

            can_run, message, reservation_id = await BillingIntegration.check_and_reserve_credits(account_id)
            if not can_run:
                return False, f"Billing check failed: {message}", {
                    "error_type": "insufficient_credits"
                }

            return True, "Access granted", {"reservation_id": reservation_id}

        except Exception as e:
            logger.error(f"Error in billing check for user {account_id}: {e}")
            return False, f"Error checking access: {str(e)}", {"error_type": "system_error"}


billing_integration = BillingIntegration()
