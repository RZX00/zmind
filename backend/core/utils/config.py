"""
Configuration management.

This module provides a centralized way to access configuration settings and
environment variables across the application. It supports different environment
modes (development, staging, production) and provides validation for required
values.

Usage:
    from core.utils.config import config
    
    # Access configuration values
    api_key = config.OPENAI_API_KEY
    env_mode = config.ENV_MODE
"""

import os
from enum import Enum
from re import S
from typing import Dict, Any, Optional, get_type_hints, Union
import json
from dotenv import load_dotenv
import logging
import secrets

logger = logging.getLogger(__name__)

class EnvMode(Enum):
    """Environment mode enumeration."""
    LOCAL = "local"
    STAGING = "staging"
    PRODUCTION = "production"

class Configuration:
    """
    Centralized configuration for the backend.
    
    This class loads environment variables and provides type checking and validation.
    Default values can be specified for optional configuration items.
    """
    
    # Environment mode
    ENV_MODE: EnvMode = EnvMode.LOCAL
    
    
    # Subscription tier IDs - Production
    STRIPE_FREE_TIER_ID_PROD: str = 'price_1RILb4G6l1KZGqIrK4QLrx9i'
    STRIPE_TIER_2_20_ID_PROD: str = 'price_1RILb4G6l1KZGqIrhomjgDnO'
    STRIPE_TIER_6_50_ID_PROD: str = 'price_1RILb4G6l1KZGqIr5q0sybWn'
    STRIPE_TIER_12_100_ID_PROD: str = 'price_1RILb4G6l1KZGqIr5Y20ZLHm'
    STRIPE_TIER_25_200_ID_PROD: str = 'price_1RILb4G6l1KZGqIrGAD8rNjb'
    STRIPE_TIER_50_400_ID_PROD: str = 'price_1RILb4G6l1KZGqIruNBUMTF1'
    STRIPE_TIER_125_800_ID_PROD: str = 'price_1RILb3G6l1KZGqIrbJA766tN'
    STRIPE_TIER_200_1000_ID_PROD: str = 'price_1RILb3G6l1KZGqIrmauYPOiN'
    
    # Yearly subscription tier IDs - Production (15% discount)
    STRIPE_TIER_2_20_YEARLY_ID_PROD: str = 'price_1ReHB5G6l1KZGqIrD70I1xqM'
    STRIPE_TIER_6_50_YEARLY_ID_PROD: str = 'price_1ReHAsG6l1KZGqIrlAog487C'
    STRIPE_TIER_12_100_YEARLY_ID_PROD: str = 'price_1ReHAWG6l1KZGqIrBHer2PQc'
    STRIPE_TIER_25_200_YEARLY_ID_PROD: str = 'price_1ReH9uG6l1KZGqIrsvMLHViC'
    STRIPE_TIER_50_400_YEARLY_ID_PROD: str = 'price_1ReH9fG6l1KZGqIrsPtu5KIA'
    STRIPE_TIER_125_800_YEARLY_ID_PROD: str = 'price_1ReH9GG6l1KZGqIrfgqaJyat'
    STRIPE_TIER_200_1000_YEARLY_ID_PROD: str = 'price_1ReH8qG6l1KZGqIrK1akY90q'

    # Yearly commitment prices - Production (15% discount, monthly payments with 12-month commitment via schedules)
    STRIPE_TIER_2_17_YEARLY_COMMITMENT_ID_PROD: str = 'price_1RqtqiG6l1KZGqIrhjVPtE1s'  # $17/month
    STRIPE_TIER_6_42_YEARLY_COMMITMENT_ID_PROD: str = 'price_1Rqtr8G6l1KZGqIrQ0ql0qHi'  # $42.50/month
    STRIPE_TIER_25_170_YEARLY_COMMITMENT_ID_PROD: str = 'price_1RqtrUG6l1KZGqIrEb8hLsk3'  # $170/month

    # Subscription tier IDs - Staging
    STRIPE_FREE_TIER_ID_STAGING: str = 'price_1RIGvuG6l1KZGqIrw14abxeL'
    STRIPE_TIER_2_20_ID_STAGING: str = 'price_1RIGvuG6l1KZGqIrCRu0E4Gi'
    STRIPE_TIER_6_50_ID_STAGING: str = 'price_1RIGvuG6l1KZGqIrvjlz5p5V'
    STRIPE_TIER_12_100_ID_STAGING: str = 'price_1RIGvuG6l1KZGqIrT6UfgblC'
    STRIPE_TIER_25_200_ID_STAGING: str = 'price_1RIGvuG6l1KZGqIrOVLKlOMj'
    STRIPE_TIER_50_400_ID_STAGING: str = 'price_1RIKNgG6l1KZGqIrvsat5PW7'
    STRIPE_TIER_125_800_ID_STAGING: str = 'price_1RIKNrG6l1KZGqIrjKT0yGvI'
    STRIPE_TIER_200_1000_ID_STAGING: str = 'price_1RIKQ2G6l1KZGqIrum9n8SI7'
    
    # Yearly subscription tier IDs - Staging (15% discount)
    STRIPE_TIER_2_20_YEARLY_ID_STAGING: str = 'price_1ReGogG6l1KZGqIrEyBTmtPk'
    STRIPE_TIER_6_50_YEARLY_ID_STAGING: str = 'price_1ReGoJG6l1KZGqIr0DJWtoOc'
    STRIPE_TIER_12_100_YEARLY_ID_STAGING: str = 'price_1ReGnZG6l1KZGqIr0ThLEl5S'
    STRIPE_TIER_25_200_YEARLY_ID_STAGING: str = 'price_1ReGmzG6l1KZGqIre31mqoEJ'
    STRIPE_TIER_50_400_YEARLY_ID_STAGING: str = 'price_1ReGmgG6l1KZGqIrn5nBc7e5'
    STRIPE_TIER_125_800_YEARLY_ID_STAGING: str = 'price_1ReGmMG6l1KZGqIrvE2ycrAX'
    STRIPE_TIER_200_1000_YEARLY_ID_STAGING: str = 'price_1ReGlXG6l1KZGqIrlgurP5GU'

    # Yearly commitment prices - Staging (15% discount, monthly payments with 12-month commitment via schedules)
    STRIPE_TIER_2_17_YEARLY_COMMITMENT_ID_STAGING: str = 'price_1RqYGaG6l1KZGqIrIzcdPzeQ'  # $17/month
    STRIPE_TIER_6_42_YEARLY_COMMITMENT_ID_STAGING: str = 'price_1RqYH1G6l1KZGqIrWDKh8xIU'  # $42.50/month
    STRIPE_TIER_25_170_YEARLY_COMMITMENT_ID_STAGING: str = 'price_1RqYHbG6l1KZGqIrAUVf8KpG'  # $170/month
    
    # Credit package price IDs - Production
    STRIPE_CREDITS_10_PRICE_ID_PROD: str = 'price_1RxmQUG6l1KZGqIru453O1zW'
    STRIPE_CREDITS_25_PRICE_ID_PROD: str = 'price_1RxmQlG6l1KZGqIr3hS5WtGg'
    STRIPE_CREDITS_50_PRICE_ID_PROD: str = 'price_1RxmQvG6l1KZGqIrLbMZ3D6r'
    STRIPE_CREDITS_100_PRICE_ID_PROD: str = 'price_1RxmR3G6l1KZGqIrpLwFCGac'
    STRIPE_CREDITS_250_PRICE_ID_PROD: str = 'price_1RxmRAG6l1KZGqIrtBIMsZAj'
    STRIPE_CREDITS_500_PRICE_ID_PROD: str = 'price_1RxmRGG6l1KZGqIrSyvl6w1G'
    
    # Credit package price IDs - Staging  
    STRIPE_CREDITS_10_PRICE_ID_STAGING: str = 'price_1RxXOvG6l1KZGqIrMqsiYQvk'
    STRIPE_CREDITS_25_PRICE_ID_STAGING: str = 'price_1RxXPNG6l1KZGqIrQprPgDme'
    STRIPE_CREDITS_50_PRICE_ID_STAGING: str = 'price_1RxmNhG6l1KZGqIrTq2zPtgi'
    STRIPE_CREDITS_100_PRICE_ID_STAGING: str = 'price_1RxmNwG6l1KZGqIrnliwPDM6'
    STRIPE_CREDITS_250_PRICE_ID_STAGING: str = 'price_1RxmO6G6l1KZGqIrBF8Kx87G'
    STRIPE_CREDITS_500_PRICE_ID_STAGING: str = 'price_1RxmOFG6l1KZGqIrn4wgORnH'
    
    # Computed subscription tier IDs based on environment
    @property
    def STRIPE_FREE_TIER_ID(self) -> str:   
        if self.ENV_MODE == EnvMode.STAGING:
            return self.STRIPE_FREE_TIER_ID_STAGING
        return self.STRIPE_FREE_TIER_ID_PROD
    
    @property
    def STRIPE_TIER_2_20_ID(self) -> str:
        if self.ENV_MODE == EnvMode.STAGING:
            return self.STRIPE_TIER_2_20_ID_STAGING
        return self.STRIPE_TIER_2_20_ID_PROD
    
    @property
    def STRIPE_TIER_6_50_ID(self) -> str:
        if self.ENV_MODE == EnvMode.STAGING:
            return self.STRIPE_TIER_6_50_ID_STAGING
        return self.STRIPE_TIER_6_50_ID_PROD
    
    @property
    def STRIPE_TIER_12_100_ID(self) -> str:
        if self.ENV_MODE == EnvMode.STAGING:
            return self.STRIPE_TIER_12_100_ID_STAGING
        return self.STRIPE_TIER_12_100_ID_PROD
    
    @property
    def STRIPE_TIER_25_200_ID(self) -> str:
        if self.ENV_MODE == EnvMode.STAGING:
            return self.STRIPE_TIER_25_200_ID_STAGING
        return self.STRIPE_TIER_25_200_ID_PROD
    
    @property
    def STRIPE_TIER_50_400_ID(self) -> str:
        if self.ENV_MODE == EnvMode.STAGING:
            return self.STRIPE_TIER_50_400_ID_STAGING
        return self.STRIPE_TIER_50_400_ID_PROD
    
    @property
    def STRIPE_TIER_125_800_ID(self) -> str:
        if self.ENV_MODE == EnvMode.STAGING:
            return self.STRIPE_TIER_125_800_ID_STAGING
        return self.STRIPE_TIER_125_800_ID_PROD
    
    @property
    def STRIPE_TIER_200_1000_ID(self) -> str:
        if self.ENV_MODE == EnvMode.STAGING:
            return self.STRIPE_TIER_200_1000_ID_STAGING
        return self.STRIPE_TIER_200_1000_ID_PROD
    
    # Yearly tier computed properties
    @property
    def STRIPE_TIER_2_20_YEARLY_ID(self) -> str:
        if self.ENV_MODE == EnvMode.STAGING:
            return self.STRIPE_TIER_2_20_YEARLY_ID_STAGING
        return self.STRIPE_TIER_2_20_YEARLY_ID_PROD
    
    @property
    def STRIPE_TIER_6_50_YEARLY_ID(self) -> str:
        if self.ENV_MODE == EnvMode.STAGING:
            return self.STRIPE_TIER_6_50_YEARLY_ID_STAGING
        return self.STRIPE_TIER_6_50_YEARLY_ID_PROD
    
    @property
    def STRIPE_TIER_12_100_YEARLY_ID(self) -> str:
        if self.ENV_MODE == EnvMode.STAGING:
            return self.STRIPE_TIER_12_100_YEARLY_ID_STAGING
        return self.STRIPE_TIER_12_100_YEARLY_ID_PROD
    
    @property
    def STRIPE_TIER_25_200_YEARLY_ID(self) -> str:
        if self.ENV_MODE == EnvMode.STAGING:
            return self.STRIPE_TIER_25_200_YEARLY_ID_STAGING
        return self.STRIPE_TIER_25_200_YEARLY_ID_PROD
    
    @property
    def STRIPE_TIER_50_400_YEARLY_ID(self) -> str:
        if self.ENV_MODE == EnvMode.STAGING:
            return self.STRIPE_TIER_50_400_YEARLY_ID_STAGING
        return self.STRIPE_TIER_50_400_YEARLY_ID_PROD
    
    @property
    def STRIPE_TIER_125_800_YEARLY_ID(self) -> str:
        if self.ENV_MODE == EnvMode.STAGING:
            return self.STRIPE_TIER_125_800_YEARLY_ID_STAGING
        return self.STRIPE_TIER_125_800_YEARLY_ID_PROD
    
    @property
    def STRIPE_TIER_200_1000_YEARLY_ID(self) -> str:
        if self.ENV_MODE == EnvMode.STAGING:
            return self.STRIPE_TIER_200_1000_YEARLY_ID_STAGING
        return self.STRIPE_TIER_200_1000_YEARLY_ID_PROD
    
    # Yearly commitment prices computed properties
    @property
    def STRIPE_TIER_2_17_YEARLY_COMMITMENT_ID(self) -> str:
        if self.ENV_MODE == EnvMode.STAGING:
            return self.STRIPE_TIER_2_17_YEARLY_COMMITMENT_ID_STAGING
        return self.STRIPE_TIER_2_17_YEARLY_COMMITMENT_ID_PROD

    @property
    def STRIPE_TIER_6_42_YEARLY_COMMITMENT_ID(self) -> str:
        if self.ENV_MODE == EnvMode.STAGING:
            return self.STRIPE_TIER_6_42_YEARLY_COMMITMENT_ID_STAGING
        return self.STRIPE_TIER_6_42_YEARLY_COMMITMENT_ID_PROD

    @property
    def STRIPE_TIER_25_170_YEARLY_COMMITMENT_ID(self) -> str:
        if self.ENV_MODE == EnvMode.STAGING:
            return self.STRIPE_TIER_25_170_YEARLY_COMMITMENT_ID_STAGING
        return self.STRIPE_TIER_25_170_YEARLY_COMMITMENT_ID_PROD
    
    # Credit package price ID properties
    @property
    def STRIPE_CREDITS_10_PRICE_ID(self) -> str:
        if self.ENV_MODE == EnvMode.STAGING:
            return self.STRIPE_CREDITS_10_PRICE_ID_STAGING
        return self.STRIPE_CREDITS_10_PRICE_ID_PROD
    
    @property
    def STRIPE_CREDITS_25_PRICE_ID(self) -> str:
        if self.ENV_MODE == EnvMode.STAGING:
            return self.STRIPE_CREDITS_25_PRICE_ID_STAGING
        return self.STRIPE_CREDITS_25_PRICE_ID_PROD
    
    @property
    def STRIPE_CREDITS_50_PRICE_ID(self) -> str:
        if self.ENV_MODE == EnvMode.STAGING:
            return self.STRIPE_CREDITS_50_PRICE_ID_STAGING
        return self.STRIPE_CREDITS_50_PRICE_ID_PROD
    
    @property
    def STRIPE_CREDITS_100_PRICE_ID(self) -> str:
        if self.ENV_MODE == EnvMode.STAGING:
            return self.STRIPE_CREDITS_100_PRICE_ID_STAGING
        return self.STRIPE_CREDITS_100_PRICE_ID_PROD
    
    @property
    def STRIPE_CREDITS_250_PRICE_ID(self) -> str:
        if self.ENV_MODE == EnvMode.STAGING:
            return self.STRIPE_CREDITS_250_PRICE_ID_STAGING
        return self.STRIPE_CREDITS_250_PRICE_ID_PROD
    
    @property
    def STRIPE_CREDITS_500_PRICE_ID(self) -> str:
        if self.ENV_MODE == EnvMode.STAGING:
            return self.STRIPE_CREDITS_500_PRICE_ID_STAGING
        return self.STRIPE_CREDITS_500_PRICE_ID_PROD
    
    # LLM API keys
    ANTHROPIC_API_KEY: Optional[str] = None
    OPENAI_API_KEY: Optional[str] = None
    GROQ_API_KEY: Optional[str] = None
    OPENROUTER_API_KEY: Optional[str] = None
    # LLM reliability and fallback settings
    LLM_REQUEST_TIMEOUT_SEC: int = 60
    LLM_STREAM_IDLE_TIMEOUT_SEC: int = 90
    LLM_FALLBACK_MODELS: Optional[str] = None
    # If true, force all LLM calls to go through OpenRouter only
    USE_ONLY_OPENROUTER: bool = False
    # If true, force all tool-calling to use XML (disable native function calling)
    FORCE_XML_TOOL_CALLING: bool = True
    XAI_API_KEY: Optional[str] = None
    MORPH_API_KEY: Optional[str] = None
    GEMINI_API_KEY: Optional[str] = None
    VERTEXAI_PROJECT: Optional[str] = None
    VERTEXAI_LOCATION: Optional[str] = None
    VERTEXAI_API_BASE: Optional[str] = None
    VERTEXAI_CREDENTIALS: Optional[str] = None
    AZURE_OPENAI_API_KEY: Optional[str] = None
    AZURE_OPENAI_ENDPOINT: Optional[str] = None
    AZURE_OPENAI_API_VERSION: str = "2024-06-01"
    AZURE_OPENAI_DEPLOYMENTS: Dict[str, str] = {}
    OPENROUTER_API_BASE: Optional[str] = "https://openrouter.ai/api/v1"
    OPENAI_COMPATIBLE_API_KEY: Optional[str] = None
    OPENAI_COMPATIBLE_API_BASE: Optional[str] = None
    HABITAT_API_KEY: Optional[str] = None
    HABITAT_API_BASE: Optional[str] = None
    # Ewo is the renamed Habitat gateway; legacy variables remain supported.
    EWO_API_KEY: Optional[str] = None
    EWO_API_BASE: Optional[str] = None
    AIPING_API_KEY: Optional[str] = None
    AIPING_API_BASE: Optional[str] = None
    OR_SITE_URL: Optional[str] = "https://zmind.so"
    OR_APP_NAME: Optional[str] = "Zmind"    

    # Brand/Company settings
    APP_NAME: str = "Zmind"
    COMPANY_NAME: str = "ZhenZhi Tech"
    SUPPORT_EMAIL: str = "team@zmind.so"
    LEGAL_EMAIL: str = "team@zmind.so"
    PRIMARY_DOMAIN: str = "zmind.so"
    SITE_URL: str = "https://zmind.so"
    
    # AWS Bedrock credentials
    AWS_ACCESS_KEY_ID: Optional[str] = None
    AWS_SECRET_ACCESS_KEY: Optional[str] = None
    AWS_REGION_NAME: Optional[str] = None
    

    
    # Supabase configuration
    SUPABASE_URL: str
    SUPABASE_ANON_KEY: str
    SUPABASE_SERVICE_ROLE_KEY: str
    SUPABASE_JWT_SECRET: str

    # 自建 Postgres 直连串。设了就走 core/services/db_client.py 的 asyncpg 实现，
    # 不设则退回 supabase-py 打 PostgREST —— 留这个开关是为了能秒级回滚。
    ZMIND_DATABASE_URL: Optional[str] = None
    
    # Redis configuration
    REDIS_HOST: str
    REDIS_PORT: int = 6379
    REDIS_PASSWORD: Optional[str] = None
    REDIS_SSL: bool = True
    REDIS_CLUSTER_ENABLED: bool = False
    REDIS_CLUSTER_NODES: Optional[str] = None
    
    
    # Search and other API keys
    TAVILY_API_KEY: str
    EXA_API_KEY: Optional[str] = None
    # Rapid API key is optional; enables Rapid-based data providers when set
    RAPID_API_KEY: Optional[str] = None
    SERPER_API_KEY: Optional[str] = None
    CLOUDFLARE_API_TOKEN: Optional[str] = None
    FIRECRAWL_API_KEY: str
    FIRECRAWL_URL: Optional[str] = "https://api.firecrawl.dev"
    
    # Stripe configuration
    STRIPE_SECRET_KEY: Optional[str] = None
    STRIPE_WEBHOOK_SECRET: Optional[str] = None
    STRIPE_DEFAULT_PLAN_ID: Optional[str] = None
    STRIPE_DEFAULT_TRIAL_DAYS: int = 14

    # Billing provider configuration
    # [DEPRECATED] Creem 退场(D7);默认切到新支付层(Alipay/Stripe via payments/*)。
    # 灰度回滚:临时改回 "creem" 即恢复旧路径(旧代码删除前可回退)。
    BILLING_PROVIDER_DEFAULT: str = "payments"
    CREEM_API_KEY: Optional[str] = None
    CREEM_WEBHOOK_SECRET: Optional[str] = None
    CREEM_API_BASE: str = "https://api.creem.io"
    CREEM_TIER_2_20_ID: Optional[str] = None
    CREEM_TIER_6_50_ID: Optional[str] = None
    CREEM_TIER_12_100_ID: Optional[str] = None
    CREEM_TIER_25_200_ID: Optional[str] = None
    CREEM_TIER_50_400_ID: Optional[str] = None
    CREEM_TIER_125_800_ID: Optional[str] = None
    CREEM_TIER_200_1000_ID: Optional[str] = None
    CREEM_TIER_2_20_YEARLY_ID: Optional[str] = None
    CREEM_TIER_6_50_YEARLY_ID: Optional[str] = None
    CREEM_TIER_12_100_YEARLY_ID: Optional[str] = None
    CREEM_TIER_25_200_YEARLY_ID: Optional[str] = None
    CREEM_TIER_50_400_YEARLY_ID: Optional[str] = None
    CREEM_TIER_125_800_YEARLY_ID: Optional[str] = None
    CREEM_TIER_200_1000_YEARLY_ID: Optional[str] = None
    CREEM_TIER_2_17_YEARLY_COMMITMENT_ID: Optional[str] = None
    CREEM_TIER_6_42_YEARLY_COMMITMENT_ID: Optional[str] = None
    CREEM_TIER_25_170_YEARLY_COMMITMENT_ID: Optional[str] = None
    CREEM_CREDITS_10_PRODUCT_ID: Optional[str] = None
    CREEM_CREDITS_25_PRODUCT_ID: Optional[str] = None
    CREEM_CREDITS_50_PRODUCT_ID: Optional[str] = None
    CREEM_CREDITS_100_PRODUCT_ID: Optional[str] = None
    CREEM_CREDITS_250_PRODUCT_ID: Optional[str] = None
    CREEM_CREDITS_500_PRODUCT_ID: Optional[str] = None
    CREEM_REFILL_TIER_2_20_ID: Optional[str] = None
    CREEM_REFILL_TIER_6_50_ID: Optional[str] = None
    CREEM_REFILL_TIER_25_200_ID: Optional[str] = None

    # --- Alipay (国内支付) ---
    ALIPAY_APP_ID: Optional[str] = None
    ALIPAY_PRIVATE_KEY: Optional[str] = None          # 应用私钥 PEM
    ALIPAY_PUBLIC_KEY: Optional[str] = None            # 支付宝公钥 PEM(公钥模式)
    ALIPAY_GATEWAY_URL: str = "https://openapi.alipay.com/gateway.do"
    ALIPAY_SIGN_TYPE: str = "RSA2"

    # --- 支付通用 ---
    PAYMENT_PUBLIC_BASE_URL: Optional[str] = None      # 后端公网基址,用于 notify/webhook 回调
    USD_CNY_RATE_STATIC: float = 7                     # 汇率兜底(仅在 payment_settings 无管理员设定值时使用;默认 7)

    # Invite-based access configuration
    INVITE_MODE_ENABLED: bool = False
    INVITE_REWARD_PRE_STRIPE_USD: int = 10
    INVITE_REWARD_POST_STRIPE_USD: int = 10
    INVITE_CREDIT_EXPIRE_DAYS: int = 30
    INVITE_ONLY_NEW_ACCOUNTS: bool = False

    # Canvas realtime write path
    CANVAS_REALTIME_WRITE_ENABLED: bool = True
    CANVAS_ENFORCE_CLIENT_IDS: bool = False
    # Emergency workspace-level override. Comma-separated IDs.
    CANVAS_FORCE_LEGACY_WORKSPACES: Optional[str] = None
    CANVAS_NATIVE_RUNTIME_ENABLED: bool = False
    CANVAS_NATIVE_RUNTIME_SHADOW: bool = False
    CANVAS_NATIVE_VERIFY_ENABLED: bool = False
    # AI-first: route canvas intents to the general AGENTIC lane (LangGraph loop, which
    # already has canvas_read/canvas_edit + canvas binding) instead of the zero-LLM regex
    # canvas core. Off by default; pending-plan preview resume still uses the canvas lane.
    CANVAS_AGENTIC_LANE_ENABLED: bool = False
    # Model the agentic canvas lane forces (independent of the user's tier/selection) so the
    # canvas agent always uses a known-good endpoint. Empty string = keep the request's model.
    CANVAS_AGENTIC_MODEL: str = "habitat/gpt-5.6-sol"
    CANVAS_NATIVE_MAX_REPAIR_ATTEMPTS: int = 2
    CANVAS_NATIVE_BEST_PATH_ENABLED: bool = True
    CANVAS_NATIVE_PLAN_BUDGET_MS: int = 20
    CANVAS_NATIVE_LAYOUT_BUDGET_MS: int = 24
    CANVAS_NATIVE_LAYOUT_COLLISION_PASS_LIMIT: int = 2

    # Unified knowledge model feature flags
    FEATURE_ITEM_MODEL_ON: bool = True
    FEATURE_ITEM_MODEL_WORKSPACES: Optional[str] = None
    FEATURE_DUAL_WRITE_ITEMS: bool = False
    FEATURE_DUAL_WRITE_ITEMS_WORKSPACES: Optional[str] = None
    FEATURE_DOCS_ON: bool = True
    FEATURE_DOCS_WORKSPACES: Optional[str] = None
    FEATURE_REFERENCES_ON: bool = True
    FEATURE_REFERENCES_WORKSPACES: Optional[str] = None
    FEATURE_DOC_IMAGES_ON: bool = True
    FEATURE_DOC_IMAGES_WORKSPACES: Optional[str] = None
    FEATURE_OBSIDIAN_COMPAT_ON: bool = True
    FEATURE_OBSIDIAN_COMPAT_WORKSPACES: Optional[str] = None
    
    # Stripe Product IDs
    STRIPE_PRODUCT_ID_PROD: str = 'prod_SCl7AQ2C8kK1CD'
    STRIPE_PRODUCT_ID_STAGING: str = 'prod_SCgIj3G7yPOAWY'
    
    # Sandbox configuration removed — legacy runtime no longer supported

    # LangFuse configuration
    LANGFUSE_PUBLIC_KEY: Optional[str] = None
    LANGFUSE_SECRET_KEY: Optional[str] = None
    LANGFUSE_HOST: str = "https://cloud.langfuse.com"

    # LangSmith configuration
    LANGCHAIN_TRACING_V2: bool = False
    LANGCHAIN_API_KEY: Optional[str] = None
    LANGCHAIN_PROJECT: Optional[str] = None
    LANGCHAIN_ENDPOINT: str = "https://api.smith.langchain.com"

    # Cloudflare R2 (S3-compatible storage)
    R2_ACCOUNT_ID: Optional[str] = None
    R2_ACCESS_KEY_ID: Optional[str] = None
    R2_SECRET_ACCESS_KEY: Optional[str] = None
    R2_ENDPOINT: Optional[str] = None
    R2_REGION: str = "auto"
    R2_FORCE_PATH_STYLE: bool = True
    R2_BUCKET_DEV: Optional[str] = None
    R2_BUCKET_PROD: Optional[str] = None
    R2_SIGNED_URL_TTL_SECONDS: int = 600
    R2_MULTIPART_THRESHOLD_BYTES: int = 10 * 1024 * 1024
    R2_MULTIPART_PART_SIZE_BYTES: int = 8 * 1024 * 1024

    # DeepSeek OCR (via AIPING OpenAI-compatible endpoint)
    DEEPSEEK_OCR_ENABLED: bool = True
    DEEPSEEK_OCR_MAX_PAGES: int = 6
    DEEPSEEK_OCR_DPI: int = 200
    DEEPSEEK_OCR_MAX_IMAGE_DIM: int = 1600
    DEEPSEEK_OCR_AUTO_ON_EMPTY_PDF: bool = False

    FILE_PROCESSING_MAX_BYTES: int = 50 * 1024 * 1024
    FILE_PROCESSING_TEXT_MAX_CHARS: int = 100_000

    # Agent run reliability controls
    AGENT_RUN_HEARTBEAT_INTERVAL_SEC: int = 15
    AGENT_RUN_STALE_THRESHOLD_SEC: int = 180
    AGENT_RUN_REAPER_INTERVAL_SEC: int = 60
    AGENT_RUN_REAPER_ENABLED: bool = True

    # Outbox reliability controls
    OUTBOX_RECORD_STRICT: bool = True

    # Admin API key for server-side operations
    ZMIND_ADMIN_API_KEY: Optional[str] = None

    
    # Agent execution limits (can be overridden via environment variable)
    _MAX_PARALLEL_AGENT_RUNS_ENV: Optional[str] = None

    # DISABLE_SANDBOX_TOOLS removed — sandbox tools deprecated
    
    # Agent limits per billing tier
    # Note: These limits are bypassed in local mode (ENV_MODE=local) where unlimited agents are allowed
    AGENT_LIMITS = {
        'free': 2,
        'standard': 100,
        'tier_2_20': 5,
        'tier_6_50': 20,
        'tier_12_100': 20,
        'tier_25_200': 100,
        'tier_50_400': 100,
        'tier_125_800': 100,
        'tier_200_1000': 100,
        # Yearly plans have same limits as monthly
        'tier_2_20_yearly': 5,
        'tier_6_50_yearly': 20,
        'tier_12_100_yearly': 20,
        'tier_25_200_yearly': 100,
        'tier_50_400_yearly': 100,
        'tier_125_800_yearly': 100,
        'tier_200_1000_yearly': 100,
        # Yearly commitment plans
        'tier_2_17_yearly_commitment': 5,
        'tier_6_42_yearly_commitment': 20,
        'tier_25_170_yearly_commitment': 100,
    }

    # Project limits per billing tier
    # Note: These limits are bypassed in local mode (ENV_MODE=local) where unlimited projects are allowed
    PROJECT_LIMITS = {
        'free': 3,
        'tier_2_20': 100,
        'tier_6_50': 500,
        'tier_12_100': 1000,
        'tier_25_200': 2500,
        'tier_50_400': 5000,
        'tier_125_800': 10000,
        'tier_200_1000': 25000,
        # Yearly plans have same limits as monthly
        'tier_2_20_yearly': 100,
        'tier_6_50_yearly': 500,
        'tier_12_100_yearly': 1000,
        'tier_25_200_yearly': 2500,
        'tier_50_400_yearly': 5000,
        'tier_125_800_yearly': 10000,
        'tier_200_1000_yearly': 25000,
        # Yearly commitment plans
        'tier_2_17_yearly_commitment': 100,
        'tier_6_42_yearly_commitment': 500,
        'tier_25_170_yearly_commitment': 2500,
    }

    @property
    def MAX_PARALLEL_AGENT_RUNS(self) -> int:
        """
        Get the maximum parallel agent runs limit.
        
        Can be overridden via MAX_PARALLEL_AGENT_RUNS environment variable.
        Defaults:
        - Production: 3
        - Local/Staging: 999999 (effectively infinite)
        """
        # Check for environment variable override first
        if self._MAX_PARALLEL_AGENT_RUNS_ENV is not None:
            try:
                return int(self._MAX_PARALLEL_AGENT_RUNS_ENV)
            except ValueError:
                logger.warning(f"Invalid MAX_PARALLEL_AGENT_RUNS value: {self._MAX_PARALLEL_AGENT_RUNS_ENV}, using default")
        
        # Environment-based defaults
        if self.ENV_MODE == EnvMode.PRODUCTION:
            return 3
        else:
            # Local and staging: effectively infinite
            return 999999
    
    @property
    def STRIPE_PRODUCT_ID(self) -> str:
        if self.ENV_MODE == EnvMode.STAGING:
            return self.STRIPE_PRODUCT_ID_STAGING
        return self.STRIPE_PRODUCT_ID_PROD
    
    def _generate_admin_api_key(self) -> str:
        """Generate a secure admin API key for Zmind administrative functions."""
        # Generate 32 random bytes and encode as hex for a readable API key
        key_bytes = secrets.token_bytes(32)
        return key_bytes.hex()

    def __init__(self):
        """Initialize configuration by loading from environment variables."""
        # Load environment variables from .env file if it exists
        load_dotenv()
        
        # Set environment mode first
        env_mode_str = os.getenv("ENV_MODE", EnvMode.LOCAL.value)
        try:
            self.ENV_MODE = EnvMode(env_mode_str.lower())
        except ValueError:
            logger.warning(f"Invalid ENV_MODE: {env_mode_str}, defaulting to LOCAL")
            self.ENV_MODE = EnvMode.LOCAL
            
        logger.debug(f"Environment mode: {self.ENV_MODE.value}")
        
        # Load configuration from environment variables
        self._load_from_env()
        self._normalize_ewo_config()
        self._normalize_azure_deployments()
        
        if not self.ZMIND_ADMIN_API_KEY:
            self.ZMIND_ADMIN_API_KEY = self._generate_admin_api_key()
            logger.info("Auto-generated ZMIND_ADMIN_API_KEY for administrative functions")
        
        # Perform validation
        self._validate()
        
    def _normalize_ewo_config(self) -> None:
        key = self.EWO_API_KEY or self.HABITAT_API_KEY
        base = (self.EWO_API_BASE or self.HABITAT_API_BASE or "https://eapi.site/v1").strip().rstrip("/")
        if base.endswith("/chat/completions"):
            base = base[:-len("/chat/completions")]
        if base in ("https://api.aihabitat.live", "https://api.aihabitat.live/v1"):
            base = "https://eapi.site/v1"
        if not base.endswith("/v1"):
            base += "/v1"
        self.EWO_API_KEY = self.HABITAT_API_KEY = key
        self.EWO_API_BASE = self.HABITAT_API_BASE = base

    def _load_from_env(self):
        """Load configuration values from environment variables."""
        for key, expected_type in get_type_hints(self.__class__).items():
            env_val = os.getenv(key)
            
            if env_val is not None:
                # Convert environment variable to the expected type
                if expected_type == bool:
                    # Handle boolean conversion
                    setattr(self, key, env_val.lower() in ('true', 't', 'yes', 'y', '1'))
                elif expected_type == int:
                    # Handle integer conversion
                    try:
                        setattr(self, key, int(env_val))
                    except ValueError:
                        logger.warning(f"Invalid value for {key}: {env_val}, using default")
                elif expected_type == EnvMode:
                    # Already handled for ENV_MODE
                    pass
                else:
                    # String or other type
                    setattr(self, key, env_val)
        
        # Custom handling for environment-dependent properties
        max_parallel_runs_env = os.getenv("MAX_PARALLEL_AGENT_RUNS")
        if max_parallel_runs_env is not None:
            self._MAX_PARALLEL_AGENT_RUNS_ENV = max_parallel_runs_env
    
    def _normalize_azure_deployments(self) -> None:
        """Ensure AZURE_OPENAI_DEPLOYMENTS is always a dict mapping canonical ids to deployment names."""
        raw_value = self.AZURE_OPENAI_DEPLOYMENTS
        if isinstance(raw_value, dict):
            # Normalize keys/values to strings and drop falsy entries
            normalized = {
                str(key).strip(): str(value).strip()
                for key, value in raw_value.items()
                if key and value
            }
            self.AZURE_OPENAI_DEPLOYMENTS = normalized
            return
        
        if isinstance(raw_value, str):
            self.AZURE_OPENAI_DEPLOYMENTS = self._parse_deployment_mapping(raw_value)
            return
        
        # Default to empty mapping if unset
        self.AZURE_OPENAI_DEPLOYMENTS = {}
    
    def _parse_deployment_mapping(self, raw_value: str) -> Dict[str, str]:
        """Parse JSON or comma-separated deployment mappings."""
        raw_value = (raw_value or "").strip()
        if not raw_value:
            return {}
        
        # Try JSON first
        if raw_value.startswith("{"):
            try:
                parsed = json.loads(raw_value)
                if isinstance(parsed, dict):
                    return {
                        str(key).strip(): str(value).strip()
                        for key, value in parsed.items()
                        if key and value
                    }
            except json.JSONDecodeError:
                logger.warning("Failed to parse AZURE_OPENAI_DEPLOYMENTS as JSON.")
        
        # Fallback to comma-separated list: model:deployment
        deployments: Dict[str, str] = {}
        for item in raw_value.split(","):
            segment = item.strip()
            if not segment:
                continue
            if ":" in segment:
                key, value = segment.split(":", 1)
            elif "=" in segment:
                key, value = segment.split("=", 1)
            else:
                logger.warning(f"Invalid AZURE_OPENAI_DEPLOYMENTS entry: '{segment}'")
                continue
            key = key.strip()
            value = value.strip()
            if key and value:
                deployments[key] = value
        return deployments
    
    def _validate(self):
        """Validate configuration based on type hints."""
        # Get all configuration fields and their type hints
        type_hints = get_type_hints(self.__class__)
        
        # Find missing required fields
        missing_fields = []
        for field, field_type in type_hints.items():
            # Check if the field is Optional
            is_optional = hasattr(field_type, "__origin__") and field_type.__origin__ is Union and type(None) in field_type.__args__
            
            # If not optional and value is None, add to missing fields
            if not is_optional and getattr(self, field) is None:
                missing_fields.append(field)
        
        if missing_fields:
            error_msg = f"Missing required configuration fields: {', '.join(missing_fields)}"
            logger.error(error_msg)
            raise ValueError(error_msg)
    
    def get(self, key: str, default: Any = None) -> Any:
        """Get a configuration value with an optional default."""
        return getattr(self, key, default)
    
    def as_dict(self) -> Dict[str, Any]:
        """Return configuration as a dictionary."""
        return {
            key: getattr(self, key) 
            for key in get_type_hints(self.__class__).keys()
            if not key.startswith('_')
        }

# Create a singleton instance
config = Configuration() 
