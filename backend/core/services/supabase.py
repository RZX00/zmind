"""
集中式数据库连接管理。

历史上这里返回 supabase-py 的 AsyncClient（HTTP 打 PostgREST）。现在优先返回
core/services/db_client.py 里的 asyncpg 实现——它把同一套 `.table().select().eq()`
API 直接翻成 SQL，700 个调用点一行不用改，还省掉一跳 HTTP。

用 ZMIND_DATABASE_URL 是否设置来决定走哪条路：
  设了   -> asyncpg 直连（默认，生产）
  没设   -> 退回 supabase-py（回滚用；把环境变量删掉重启即可）
两条路的等价性由 scripts/verify_db_client_parity.py 的差分测试保证（24/24 一致）。
"""

from typing import Optional
from core.utils.logger import logger
from core.utils.config import config
import base64
import uuid
from datetime import datetime
import threading

class DBConnection:
    """Thread-safe singleton database connection manager using Supabase."""
    
    _instance: Optional['DBConnection'] = None
    _lock = threading.Lock()

    def __new__(cls):
        if cls._instance is None:
            with cls._lock:
                # Double-check locking pattern
                if cls._instance is None:
                    cls._instance = super().__new__(cls)
                    cls._instance._initialized = False
                    cls._instance._client = None
        return cls._instance

    def __init__(self):
        """No initialization needed in __init__ as it's handled in __new__"""
        pass

    async def initialize(self):
        """Initialize the database connection."""
        if self._initialized:
            return
                
        try:
            dsn = getattr(config, "ZMIND_DATABASE_URL", None)

            if dsn:
                from core.services.db_client import create_client as create_pg_client

                self._client = await create_pg_client(dsn)
                self._initialized = True
                logger.info("Database connection initialized: asyncpg 直连自建 Postgres")
                return

            # --- 回滚路径：仍走 supabase-py + PostgREST ---
            from supabase import create_async_client

            supabase_url = config.SUPABASE_URL
            # Use service role key preferentially for backend operations
            supabase_key = config.SUPABASE_SERVICE_ROLE_KEY or config.SUPABASE_ANON_KEY

            if not supabase_url or not supabase_key:
                logger.error("Missing required environment variables for Supabase connection")
                raise RuntimeError("SUPABASE_URL and a key (SERVICE_ROLE_KEY or ANON_KEY) environment variables must be set.")

            self._client = await create_async_client(
                supabase_url,
                supabase_key,
            )

            self._initialized = True
            key_type = "SERVICE_ROLE_KEY" if config.SUPABASE_SERVICE_ROLE_KEY else "ANON_KEY"
            logger.info(f"Database connection initialized with Supabase using {key_type}")

        except Exception as e:
            logger.error(f"Database initialization error: {e}")
            raise RuntimeError(f"Failed to initialize database connection: {str(e)}")

    @classmethod
    async def disconnect(cls):
        """Disconnect from the database."""
        if cls._instance and cls._instance._client:
            # logger.debug("Disconnecting from Supabase database")
            try:
                # Close Supabase client
                if hasattr(cls._instance._client, 'close'):
                    await cls._instance._client.close()
                    
            except Exception as e:
                logger.warning(f"Error during disconnect: {e}")
            finally:
                cls._instance._initialized = False
                cls._instance._client = None
                logger.info("Database disconnected successfully")

    @property
    async def client(self):
        """返回数据库客户端。

        类型随 ZMIND_DATABASE_URL 而定：AsyncPGClient（默认）或 supabase.AsyncClient。
        两者对外暴露的 .table()/.from_()/.schema()/.rpc() 形状一致，调用方无需区分，
        所以这里不再标注具体类型——标了反而是假承诺。
        """
        if not self._initialized:
            await self.initialize()
        if not self._client:
            logger.error("Database client is None after initialization")
            raise RuntimeError("Database not initialized")
        return self._client
