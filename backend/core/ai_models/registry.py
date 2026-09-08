import json
from pathlib import Path
from typing import Dict, List, Optional, Set
from .ai_models import Model, ModelProvider, ModelCapability, ModelPricing

# Keep stored model IDs stable across the Habitat -> Ewo rename.
DEFAULT_FREE_MODEL = "habitat/gpt-5.6-sol"
DEFAULT_PREMIUM_MODEL = "habitat/gpt-5.6-sol"

class ModelRegistry:
    def __init__(self):
        self._models: Dict[str, Model] = {}
        self._aliases: Dict[str, str] = {}
        # Lowercase加速表：大小写无关匹配
        self._aliases_lower: Dict[str, str] = {}
        self._initialize_models()
    
    def _initialize_models(self):
        """Register available Vertex AI Gemini models."""
        # Defensive reset in case of reinitialisation
        self._models.clear()
        self._aliases.clear()
        self._aliases_lower.clear()

        self.register(Model(
            id="gemini-2.5-flash-lite",
            name="Gemini 2.5 Flash Lite",
            provider=ModelProvider.GOOGLE,
            aliases=[
                "google/gemini-2.5-flash-lite-preview-09-2025",
            ],
            context_window=1_000_000,
            capabilities=[
                ModelCapability.CHAT,
                ModelCapability.FUNCTION_CALLING,
                ModelCapability.VISION,
            ],
            pricing=ModelPricing(
                input_cost_per_million_tokens=0.12,
                output_cost_per_million_tokens=0.40,
            ),
            tier_availability=["free", "paid"],
            priority=90,
            enabled=False,
            metadata={"default_thinking": False},
        ))

        self.register(Model(
            id="gemini-2.5-flash",
            name="Gemini 2.5 Flash",
            provider=ModelProvider.GOOGLE,
            aliases=[
                "google/gemini-2.5-flash-preview-09-2025",
            ],
            context_window=1_000_000,
            capabilities=[
                ModelCapability.CHAT,
                ModelCapability.FUNCTION_CALLING,
                ModelCapability.VISION,
                ModelCapability.THINKING,
            ],
            pricing=ModelPricing(
                input_cost_per_million_tokens=0.35,
                output_cost_per_million_tokens=1.05,
            ),
            tier_availability=["free", "paid"],
            priority=95,
            recommended=True,
            enabled=False,
            metadata={"default_thinking": True},
        ))

        self.register(Model(
            id="gemini-3.1-pro-preview-customtools",
            name="Gemini 3.1 Pro",
            provider=ModelProvider.GOOGLE,
            aliases=[
                "gemini-3.1-pro-preview-thinking-high",
                "google/gemini-3.1-pro-preview-customtools",
                "google/gemini-3.1-pro-preview-thinking-high",
                "google/gemini-3.1-pro-preview",
                "google/gemini-3.1-pro",
                "gemini-3.1-pro-preview",
                "gemini-3-pro-preview",
                "google/gemini-3-pro-preview",
                "google/gemini-3-pro",
                "google/gemini-3.0-pro-preview",
                "google/gemini-2.5-pro",
                "gemini-3.0-pro-preview",
                "gemini-2.5-pro",
            ],
            context_window=2_000_000,
            capabilities=[
                ModelCapability.CHAT,
                ModelCapability.FUNCTION_CALLING,
                ModelCapability.VISION,
                ModelCapability.STRUCTURED_OUTPUT,
                ModelCapability.THINKING,
            ],
            pricing=ModelPricing(
                input_cost_per_million_tokens=3.50,
                output_cost_per_million_tokens=10.50,
            ),
            tier_availability=["paid"],
            priority=115,
            recommended=True,
            enabled=False,
            metadata={"default_thinking": True, "preview": True},
        ))

        self.register(Model(
            id="gemini-3-flash-preview",
            name="Gemini 3 Flash",
            provider=ModelProvider.GOOGLE,
            aliases=[
                "gemini-3-flash-preview",
                "google/gemini-3-flash-preview",
                "google/gemini-3-flash",
                "gemini-3-flash",
                "gemini-3.0-flash-preview",
            ],
            context_window=1_050_000,
            capabilities=[
                ModelCapability.CHAT,
                ModelCapability.FUNCTION_CALLING,
                ModelCapability.VISION,
            ],
            pricing=ModelPricing(
                input_cost_per_million_tokens=0.50,
                output_cost_per_million_tokens=3.00,
                audio_cost_per_million_tokens=1.00,
            ),
            tier_availability=["paid"],
            priority=799,
            recommended=True,
            enabled=False,
            metadata={"default_thinking": False, "preview": True},
        ))

        self.register(Model(
            id="gemini-2.5-flash-image",
            name="Gemini 2.5 Flash Image",
            provider=ModelProvider.GOOGLE,
            aliases=[
                "google/gemini-2.5-flash-image",
                "google/gemini-2.5-flash-image-preview",
            ],
            context_window=32_000,
            capabilities=[
                ModelCapability.VISION,
            ],
            pricing=None,
            tier_availability=["paid"],
            priority=80,
            enabled=False,
            metadata={
                "image_generator": True,
                "supports_edit": True,
                "prompt_adherence": "high",
            },
        ))

        self.register(Model(
            id="gemini-3-pro-image-preview",
            name="Gemini 3 Pro Image Preview",
            provider=ModelProvider.GOOGLE,
            aliases=[
                "google/gemini-3-pro-image-preview",
                "gemini-3-pro-image",
            ],
            context_window=64_000,
            capabilities=[
                ModelCapability.VISION,
            ],
            pricing=None,
            tier_availability=["paid"],
            priority=120,
            recommended=True,
            enabled=False,
            metadata={
                "image_generator": True,
                "supports_edit": True,
                "supports_reference_images": True,
                "max_reference_images": 14,
                "supports_grounding": True,
            },
        ))
        
        self.register(Model(
            id="gpt-5.4",
            name="GPT 5.4 (Azure)",
            provider=ModelProvider.AZURE,
            aliases=[
                "azure/gpt-5.4",
                "azure/gpt-5.4-high",
                "gpt-5.4-high",
                "azure/gpt-5.3-codex-high",
                "azure/gpt-5.3-codex",
                "gpt-5.3-codex-high",
                "gpt-5.3-codex",
            ],
            context_window=400_000,
            max_output_tokens=64_000,
            capabilities=[
                ModelCapability.CHAT,
                ModelCapability.FUNCTION_CALLING,
                ModelCapability.VISION,
                ModelCapability.STRUCTURED_OUTPUT,
                ModelCapability.THINKING,
            ],
            pricing=ModelPricing(
                input_cost_per_million_tokens=1.25,
                output_cost_per_million_tokens=10.00,
            ),
            tier_availability=["paid"],
            priority=155,
            recommended=True,
            enabled=False,
            metadata={
                "provider": "azure",
                "deployment_key": "gpt-5.4",
                "deployment_key_aliases": ["gpt-5.4-high", "gpt-5.3-codex-high", "gpt-5.3-codex"],
                "default_thinking": True,
            },
        ))

        # Ewo gateway models; retain the historical habitat namespace for saved data.
        self.register(Model(
            id="habitat/claude-sonnet-4-6",
            name="Claude Sonnet 4.6",
            provider=ModelProvider.HABITAT,
            aliases=[
                "claude-sonnet-4-6",
                "claude-sonnet-4",
                "habitat-claude-sonnet-4-6",
                "habitat:claude-sonnet-4-6",
                # Backward compatibility with prior Leaflow Sonnet identifiers.
                "leaflow/claude-sonnet-4-6",
                "leaflow-claude-sonnet-4-6",
                "leaflow:claude-sonnet-4-6",
                "leaflow/claude-sonnet-4-5-20250929",
                "claude-sonnet-4-5-20250929",
            ],
            context_window=1_000_000,
            capabilities=[
                ModelCapability.CHAT,
                ModelCapability.FUNCTION_CALLING,
                ModelCapability.THINKING,
            ],
            pricing=ModelPricing(
                input_cost_per_million_tokens=3.00,
                output_cost_per_million_tokens=15.00,
            ),
            tier_availability=["paid"],
            priority=700,
            recommended=True,
            enabled=True,
            metadata={
                "raw_model_name": "claude-sonnet-4-6",
                "default_thinking": True,
            },
        ))

        # GPT routed via Habitat (native OpenAI Responses API). Primary premium models
        # after Habitat dropped claude-sonnet-4-6 (2026-06). Note: the bare "gpt-5.4"
        # alias is owned by the Azure-routed entry above, so only habitat-prefixed
        # aliases are used here.
        self.register(Model(
            id="habitat/gpt-5.4",
            name="GPT-5.4 (Habitat)",
            provider=ModelProvider.HABITAT,
            aliases=[
                "habitat-gpt-5.4",
                "habitat:gpt-5.4",
            ],
            context_window=400_000,
            capabilities=[
                ModelCapability.CHAT,
                ModelCapability.FUNCTION_CALLING,
            ],
            pricing=ModelPricing(
                input_cost_per_million_tokens=1.25,
                output_cost_per_million_tokens=10.00,
            ),
            tier_availability=["paid"],
            priority=710,
            recommended=False,
            enabled=True,
            metadata={
                "raw_model_name": "gpt-5.4",
            },
        ))

        self.register(Model(
            id="habitat/gpt-5.5",
            name="GPT-5.5 (Habitat)",
            provider=ModelProvider.HABITAT,
            aliases=[
                "gpt-5.5",
                "habitat-gpt-5.5",
                "habitat:gpt-5.5",
            ],
            context_window=400_000,
            capabilities=[
                ModelCapability.CHAT,
                ModelCapability.FUNCTION_CALLING,
            ],
            pricing=ModelPricing(
                input_cost_per_million_tokens=2.50,
                output_cost_per_million_tokens=20.00,
            ),
            tier_availability=["paid"],
            priority=730,
            recommended=True,
            enabled=True,
            metadata={
                "raw_model_name": "gpt-5.5",
            },
        ))

        # === GPT-5.6 family (the only models exposed to users) ===
        # Pricing/context are placeholders mirroring gpt-5.5; adjust when the
        # Habitat gateway publishes real numbers.
        self.register(Model(
            id="habitat/gpt-5.6-sol",
            name="GPT-5.6 Sol",
            provider=ModelProvider.HABITAT,
            aliases=[
                "gpt-5.6-sol",
                "habitat-gpt-5.6-sol",
                "habitat:gpt-5.6-sol",
            ],
            context_window=400_000,
            capabilities=[
                ModelCapability.CHAT,
                ModelCapability.FUNCTION_CALLING,
            ],
            pricing=ModelPricing(
                input_cost_per_million_tokens=2.50,
                output_cost_per_million_tokens=20.00,
            ),
            tier_availability=["free", "paid"],
            priority=760,
            recommended=True,
            enabled=True,
            metadata={
                "raw_model_name": "gpt-5.6-sol",
            },
        ))

        self.register(Model(
            id="habitat/gpt-5.6-terra",
            name="GPT-5.6 Terra",
            provider=ModelProvider.HABITAT,
            aliases=[
                "gpt-5.6-terra",
                "habitat-gpt-5.6-terra",
                "habitat:gpt-5.6-terra",
            ],
            context_window=400_000,
            capabilities=[
                ModelCapability.CHAT,
                ModelCapability.FUNCTION_CALLING,
            ],
            pricing=ModelPricing(
                input_cost_per_million_tokens=2.50,
                output_cost_per_million_tokens=20.00,
            ),
            tier_availability=["free", "paid"],
            priority=750,
            recommended=False,
            enabled=True,
            metadata={
                "raw_model_name": "gpt-5.6-terra",
            },
        ))

        self.register(Model(
            id="habitat/gpt-5.6-luna",
            name="GPT-5.6 Luna",
            provider=ModelProvider.HABITAT,
            aliases=[
                "gpt-5.6-luna",
                "habitat-gpt-5.6-luna",
                "habitat:gpt-5.6-luna",
            ],
            context_window=400_000,
            capabilities=[
                ModelCapability.CHAT,
                ModelCapability.FUNCTION_CALLING,
            ],
            pricing=ModelPricing(
                input_cost_per_million_tokens=2.50,
                output_cost_per_million_tokens=20.00,
            ),
            tier_availability=["free", "paid"],
            priority=740,
            recommended=False,
            enabled=True,
            metadata={
                "raw_model_name": "gpt-5.6-luna",
            },
        ))

        self.register(Model(
            id="habitat/claude-opus-4-8",
            name="Claude Opus 4.8",
            provider=ModelProvider.HABITAT,
            aliases=[
                "claude-opus-4-8",
                "habitat-claude-opus-4-8",
                "habitat:claude-opus-4-8",
                # Backward compatibility: prior Opus identifiers now map to 4.8.
                "leaflow/claude-opus-4-6",
                "claude-opus-4-6",
                "leaflow-claude-opus-4-6",
                "leaflow:claude-opus-4-6",
            ],
            context_window=200_000,
            capabilities=[
                ModelCapability.CHAT,
                ModelCapability.FUNCTION_CALLING,
                ModelCapability.THINKING,
            ],
            pricing=ModelPricing(
                input_cost_per_million_tokens=5.00,
                output_cost_per_million_tokens=25.00,
            ),
            tier_availability=["paid"],
            priority=750,
            recommended=True,
            enabled=True,
            metadata={
                "raw_model_name": "claude-opus-4-8",
                "default_thinking": True,
            },
        ))

        self.register(Model(
            id="habitat/gemini-3.1-pro",
            name="Gemini 3.1 Pro",
            provider=ModelProvider.HABITAT,
            aliases=[
                "gemini-3.1-pro",
                "habitat-gemini-3.1-pro",
                "habitat:gemini-3.1-pro",
                # Backward compatibility with prior Leaflow Gemini Pro identifiers.
                "leaflow/gemini-3.1-pro-preview-customtools",
                "gemini-3.1-pro-preview-customtools",
                "leaflow/gemini-3.1-pro-preview",
                "gemini-3.1-pro-preview",
                "gemini-3-pro-preview",
                "gemini-2.5-pro",
            ],
            context_window=1_048_576,
            capabilities=[
                ModelCapability.CHAT,
                ModelCapability.FUNCTION_CALLING,
                ModelCapability.VISION,
                ModelCapability.STRUCTURED_OUTPUT,
                ModelCapability.THINKING,
            ],
            pricing=ModelPricing(
                input_cost_per_million_tokens=2.00,
                output_cost_per_million_tokens=12.00,
            ),
            tier_availability=["paid"],
            priority=800,
            recommended=True,
            enabled=True,
            metadata={
                "raw_model_name": "gemini-3.1-pro",
                "default_thinking": True,
            },
        ))

        self.register(Model(
            id="habitat/gemini-3.5-flash",
            name="Gemini 3.5 Flash",
            provider=ModelProvider.HABITAT,
            aliases=[
                "gemini-3.5-flash",
                "habitat-gemini-3.5-flash",
                "habitat:gemini-3.5-flash",
                # Backward compatibility with prior Leaflow Gemini Flash identifiers.
                "leaflow/gemini-3-flash-preview",
                "gemini-3-flash-preview",
                "gemini-3-flash",
                "gemini3flash",
            ],
            context_window=1_048_576,
            capabilities=[
                ModelCapability.CHAT,
                ModelCapability.FUNCTION_CALLING,
                ModelCapability.VISION,
            ],
            pricing=ModelPricing(
                input_cost_per_million_tokens=0.50,
                output_cost_per_million_tokens=3.00,
            ),
            tier_availability=["free", "paid"],
            priority=799,
            recommended=True,
            enabled=True,
            metadata={
                "raw_model_name": "gemini-3.5-flash",
                "default_thinking": False,
            },
        ))

        self.register(Model(
            id="habitat/gpt-5.4",
            name="GPT 5.4",
            provider=ModelProvider.HABITAT,
            aliases=[
                "habitat-gpt-5.4",
                "habitat:gpt-5.4",
                # Backward compatibility with prior Leaflow GPT identifiers.
                "leaflow/gpt-5.4",
                "leaflow-gpt-5.4",
                "openai/gpt-5.4",
            ],
            context_window=400_000,
            max_output_tokens=64_000,
            capabilities=[
                ModelCapability.CHAT,
                ModelCapability.FUNCTION_CALLING,
                ModelCapability.VISION,
                ModelCapability.STRUCTURED_OUTPUT,
                ModelCapability.THINKING,
            ],
            pricing=ModelPricing(
                input_cost_per_million_tokens=1.25,
                output_cost_per_million_tokens=10.00,
            ),
            tier_availability=["paid"],
            priority=300,
            recommended=False,
            enabled=True,
            metadata={
                "raw_model_name": "gpt-5.4",
                "default_thinking": True,
            },
        ))

        self.register(Model(
            id="habitat/gpt-image-2",
            name="GPT Image 2",
            provider=ModelProvider.HABITAT,
            aliases=[
                "gpt-image-2",
                "habitat-gpt-image-2",
                "habitat:gpt-image-2",
                # Backward compatibility: prior image-model identifiers now map to gpt-image-2.
                "leaflow/gemini-3.1-flash-image-preview",
                "gemini-3.1-flash-image-preview",
                "aiping/doubao-seedream-4.5",
                "doubao-seedream-4.5",
            ],
            context_window=64_000,
            capabilities=[
                ModelCapability.VISION,
            ],
            pricing=None,
            tier_availability=["free", "paid"],
            priority=860,
            recommended=True,
            enabled=True,
            metadata={
                "raw_model_name": "gpt-image-2",
                "image_generator": True,
                "supports_edit": True,
                "default_image_model": True,
            },
        ))

        # AIPING routed models (OpenAI-compatible gateway)
        self.register(Model(
            id="aiping/deepseek-v3.2",
            name="DeepSeek V3.2",
            provider=ModelProvider.AIPING,
            aliases=[
                "DeepSeek-V3.2",
                "deepseek-v3.2",
                "aiping-deepseek-v3.2",
            ],
            context_window=163_840,
            capabilities=[
                ModelCapability.CHAT,
                ModelCapability.FUNCTION_CALLING,
                ModelCapability.THINKING,
            ],
            pricing=ModelPricing(
                input_cost_per_million_tokens=0.26,
                output_cost_per_million_tokens=0.39,
            ),
            tier_availability=["paid"],
            priority=500,
            recommended=False,
            enabled=False,  # Disabled: uses text-based tool calls instead of OpenAI format
            metadata={
                "raw_model_name": "DeepSeek-V3.2",
                "default_thinking": True,
            },
        ))

        self.register(Model(
            id="aiping/kimi-k2.5",
            name="Kimi K2.5",
            provider=ModelProvider.AIPING,
            aliases=[
                "Kimi-K2.5",
                "kimi-k2.5",
                "aiping-kimi-k2.5",
            ],
            context_window=256_000,
            capabilities=[
                ModelCapability.CHAT,
                ModelCapability.FUNCTION_CALLING,
            ],
            pricing=ModelPricing(
                input_cost_per_million_tokens=4.00,   # currency as provided
                output_cost_per_million_tokens=21.00, # currency as provided
            ),
            tier_availability=["free", "paid"],
            priority=520,
            recommended=True,
            enabled=False,  # Temporarily hidden
            metadata={
                "raw_model_name": "Kimi-K2.5",
                "default_thinking": False,
            },
        ))

        self.register(Model(
            id="aiping/glm-4.7",
            name="GLM 4.7",
            provider=ModelProvider.AIPING,
            aliases=[
                "GLM-4.7",
                "glm-4.7",
                "aiping-glm-4.7",
            ],
            context_window=202_752,
            capabilities=[
                ModelCapability.CHAT,
                ModelCapability.FUNCTION_CALLING,
            ],
            pricing=ModelPricing(
                input_cost_per_million_tokens=0.40,
                output_cost_per_million_tokens=1.75,
            ),
            tier_availability=["paid"],
            priority=200,
            recommended=False,
            enabled=False,
            metadata={
                "raw_model_name": "GLM-4.7",
            },
        ))

        self.register(Model(
            id="aiping/minimax-m2.1",
            name="MiniMax M2.1",
            provider=ModelProvider.AIPING,
            aliases=[
                "MiniMax-M2.1",
                "minimax-m2.1",
                "aiping-minimax-m2.1",
            ],
            context_window=204_800,
            capabilities=[
                ModelCapability.CHAT,
                ModelCapability.FUNCTION_CALLING,
            ],
            pricing=ModelPricing(
                input_cost_per_million_tokens=0.255,
                output_cost_per_million_tokens=1.02,
            ),
            tier_availability=["paid"],
            priority=100,
            recommended=False,
            enabled=False,
            metadata={
                "raw_model_name": "MiniMax-M2.1",
            },
        ))

        # NOTE: The Doubao image model (formerly aiping/doubao-seedream-4.5) was
        # retired in the Habitat migration. Image generation now routes through
        # habitat/gpt-image-2; legacy doubao ids alias onto it for back-compat.

        # The gateway catalog is authoritative for enabled models. Keep older
        # definitions for saved IDs, pricing and aliases, without offering retired models.
        for _model in self._models.values():
            _model.enabled = False
        self._load_ewo_catalog()

    def _load_ewo_catalog(self) -> None:
        catalog = json.loads(Path(__file__).with_name("ewo_catalog.json").read_text(encoding="utf-8"))
        for entry in catalog["models"]:
            raw_id = entry["id"]
            model_id = f"habitat/{raw_id}"
            is_text = "text" in entry["capabilities"] or "chat" in entry["capabilities"]
            is_image = "image" in entry["capabilities"]
            model = self._models.get(model_id)
            if model is None:
                model = Model(
                    id=model_id,
                    name=raw_id,
                    provider=ModelProvider.HABITAT,
                    capabilities=[ModelCapability.CHAT] if is_text else [ModelCapability.IMAGE_GENERATION],
                    metadata={"raw_model_name": raw_id},
                )
            if is_image and not is_text:
                model.capabilities = [ModelCapability.IMAGE_GENERATION]
            model.enabled = is_text or is_image
            model.name = model.name.replace("(Habitat)", "(Ewo)")
            model.metadata.update(
                gateway_capabilities=entry["capabilities"],
                protocol_support=entry["protocol_support"],
                upstream_owner=entry["owned_by"],
            )
            for alias in (raw_id, f"ewo/{raw_id}", f"ewo:{raw_id}", f"ewo-{raw_id}"):
                # Preserve aliases explicitly owned by another legacy provider.
                if alias == raw_id and (alias in self._models or alias in self._aliases):
                    continue
                if alias not in model.aliases:
                    model.aliases.append(alias)
            self.register(model)

        # Also accept the new prefix for historical models used by saved sessions.
        for model in self._models.values():
            if model.provider == ModelProvider.HABITAT:
                alias = "ewo/" + model.id.split("/", 1)[-1]
                self._aliases[alias] = model.id
                self._aliases_lower[alias.lower()] = model.id

    def register(self, model: Model) -> None:
        self._models[model.id] = model
        # 1) 精确别名表
        for alias in model.aliases:
            self._aliases[alias] = model.id
            self._aliases_lower[alias.lower()] = model.id
        # 2) 将显示名也作为别名（用户常从控制台复制粘贴显示名）
        if model.name:
            self._aliases[model.name] = model.id
            self._aliases_lower[model.name.lower()] = model.id
        # 3) 也允许用真实 id 的无前缀/大小写轻度变化（防御性）
        self._aliases_lower[model.id.lower()] = model.id
    
    def get(self, model_id: str) -> Optional[Model]:
        # 精确 ID 命中
        if model_id in self._models:
            return self._models[model_id]
        # 精确别名命中
        if model_id in self._aliases:
            actual_id = self._aliases[model_id]
            return self._models.get(actual_id)
        # 大小写无关命中
        try:
            key_lower = model_id.lower()
            if key_lower in self._aliases_lower:
                actual_id = self._aliases_lower[key_lower]
                return self._models.get(actual_id)
        except Exception:
            pass
        # 未命中
        return None
    
    def get_all(self, enabled_only: bool = True) -> List[Model]:
        models = list(self._models.values())
        if enabled_only:
            models = [m for m in models if m.enabled]
        return models
    
    def get_by_tier(self, tier: str, enabled_only: bool = True) -> List[Model]:
        models = self.get_all(enabled_only)
        return [m for m in models if tier in m.tier_availability]
    
    def get_by_provider(self, provider: ModelProvider, enabled_only: bool = True) -> List[Model]:
        models = self.get_all(enabled_only)
        return [m for m in models if m.provider == provider]
    
    def get_by_capability(self, capability: ModelCapability, enabled_only: bool = True) -> List[Model]:
        models = self.get_all(enabled_only)
        return [m for m in models if capability in m.capabilities]
    
    def resolve_model_id(self, model_id: str) -> Optional[str]:
        model = self.get(model_id)
        return model.id if model else None
    
    def get_aliases(self, model_id: str) -> List[str]:
        model = self.get(model_id)
        return model.aliases if model else []
    
    def enable_model(self, model_id: str) -> bool:
        model = self.get(model_id)
        if model:
            model.enabled = True
            return True
        return False
    
    def disable_model(self, model_id: str) -> bool:
        model = self.get(model_id)
        if model:
            model.enabled = False
            return True
        return False
    
    def get_context_window(self, model_id: str, default: int = 31_000) -> int:
        model = self.get(model_id)
        return model.context_window if model else default
    
    def get_pricing(self, model_id: str) -> Optional[ModelPricing]:
        model = self.get(model_id)
        return model.pricing if model else None
    
    def to_legacy_format(self) -> Dict:
        models_dict = {}
        aliases_dict = {}
        pricing_dict = {}
        context_windows_dict = {}
        
        for model in self.get_all(enabled_only=True):
            models_dict[model.id] = {
                "aliases": model.aliases,
                "pricing": {
                    "input_cost_per_million_tokens": model.pricing.input_cost_per_million_tokens,
                    "output_cost_per_million_tokens": model.pricing.output_cost_per_million_tokens,
                    "audio_cost_per_million_tokens": model.pricing.audio_cost_per_million_tokens,
                } if model.pricing else None,
                "context_window": model.context_window,
                "tier_availability": model.tier_availability,
            }
            
            for alias in model.aliases:
                aliases_dict[alias] = model.id
            
            if model.pricing:
                pricing_dict[model.id] = {
                    "input_cost_per_million_tokens": model.pricing.input_cost_per_million_tokens,
                    "output_cost_per_million_tokens": model.pricing.output_cost_per_million_tokens,
                    "audio_cost_per_million_tokens": model.pricing.audio_cost_per_million_tokens,
                }
            
            context_windows_dict[model.id] = model.context_window
        
        free_models = [m.id for m in self.get_by_tier("free")]
        paid_models = [m.id for m in self.get_by_tier("paid")]
        
        # Debug logging
        from core.utils.logger import logger
        logger.debug(f"Legacy format generation: {len(free_models)} free models, {len(paid_models)} paid models")
        logger.debug(f"Free models: {free_models}")
        logger.debug(f"Paid models: {paid_models}")
        
        return {
            "MODELS": models_dict,
            "MODEL_NAME_ALIASES": aliases_dict,
            "HARDCODED_MODEL_PRICES": pricing_dict,
            "MODEL_CONTEXT_WINDOWS": context_windows_dict,
            "FREE_TIER_MODELS": free_models,
            "PAID_TIER_MODELS": paid_models,
        }

registry = ModelRegistry() 
