"""
高性能缓存服务层
基于 Redis 实现毫秒级响应的缓存系统
"""
import orjson
import time
import asyncio
from typing import Any, Optional, Dict, List, Union, Tuple
from core.utils.logger import logger
from core.services import redis
from datetime import datetime, timedelta
from dataclasses import is_dataclass, asdict


class CacheService:
    """高性能缓存服务"""

    def __init__(self):
        self.default_ttl = 300  # 5分钟默认TTL
        self.hit_count = 0
        self.miss_count = 0

        # TTL 配置策略
        self.ttl_config = {
            # 用户数据 (相对稳定)
            "user:profile": 3600,       # 1小时
            "user:settings": 1800,      # 30分钟
            "user:permissions": 900,    # 15分钟

            # 业务数据 (频繁变化)
            "dashboard": 300,           # 5分钟
            "projects": 600,            # 10分钟
            "threads": 180,             # 3分钟
            "agent_runs": 60,           # 1分钟

            # 系统状态 (实时性要求高)
            "system:health": 30,        # 30秒
            "system:maintenance": 60,   # 1分钟
            "system:models": 3600,      # 1小时
        }

    def get_ttl_for_key(self, key: str) -> int:
        """根据键名获取合适的TTL"""
        for pattern, ttl in self.ttl_config.items():
            if pattern in key:
                return ttl
        return self.default_ttl

    def _to_jsonable(self, value: Any) -> Any:
        """将值转换为可 JSON 序列化的形式。

        - 支持 Pydantic BaseModel（通过 model_dump）
        - 支持 dataclass（asdict）
        - 递归处理 list / dict 内的复杂对象
        """
        try:
            # Pydantic v2
            if hasattr(value, 'model_dump') and callable(getattr(value, 'model_dump')):
                return value.model_dump()
            # Pydantic v1
            if hasattr(value, 'dict') and callable(getattr(value, 'dict')):
                return value.dict()
            # Dataclass
            if is_dataclass(value):
                return asdict(value)
            # Containers
            if isinstance(value, list):
                return [self._to_jsonable(v) for v in value]
            if isinstance(value, tuple):
                return [self._to_jsonable(v) for v in value]
            if isinstance(value, dict):
                return {k: self._to_jsonable(v) for k, v in value.items()}
            # Fallback: 原样返回，交给 orjson 处理（如 str/int/float/bool/None）
            return value
        except Exception as e:
            logger.debug(f"_to_jsonable fallback for value of type {type(value)}: {e}")
            return str(value)

    async def get(self, key: str) -> Optional[Any]:
        """获取缓存数据"""
        try:
            start_time = time.time()
            data = await redis.get(key)
            response_time = (time.time() - start_time) * 1000

            if data:
                self.hit_count += 1
                result = orjson.loads(data)
                logger.info(f"✅ 缓存命中 {key} ({response_time:.2f}ms)")
                return result
            else:
                self.miss_count += 1
                logger.info(f"❌ 缓存未命中 {key}")
                return None

        except Exception as e:
            logger.warning(f"缓存读取失败 {key}: {e}")
            self.miss_count += 1
            return None

    async def set(self, key: str, value: Any, ttl: Optional[int] = None) -> bool:
        """设置缓存数据"""
        try:
            ttl = ttl or self.get_ttl_for_key(key)
            jsonable = self._to_jsonable(value)
            serialized = orjson.dumps(jsonable)

            start_time = time.time()
            await redis.set(key, serialized.decode('utf-8'), ex=ttl)
            response_time = (time.time() - start_time) * 1000

            logger.info(f"💾 缓存写入 {key} TTL={ttl}s ({response_time:.2f}ms)")
            return True

        except Exception as e:
            logger.error(f"缓存写入失败 {key}: {e}")
            return False

    async def delete(self, key: str) -> bool:
        """删除缓存"""
        try:
            result = await redis.delete(key)
            logger.debug(f"缓存删除 {key}")
            return bool(result)
        except Exception as e:
            logger.error(f"缓存删除失败 {key}: {e}")
            return False

    async def delete_pattern(self, pattern: str) -> int:
        """批量删除缓存"""
        try:
            keys = await redis.keys(pattern)
            if keys:
                deleted = await redis.delete_many(keys)
                logger.debug(f"批量删除缓存 {pattern}: {deleted} keys")
                return deleted
            return 0
        except Exception as e:
            logger.error(f"批量删除失败 {pattern}: {e}")
            return 0

    async def mget(self, keys: List[str]) -> Dict[str, Any]:
        """批量获取缓存"""
        try:
            start_time = time.time()
            values = await redis.mget(keys)
            response_time = (time.time() - start_time) * 1000

            result = {}
            hits = 0

            for key, value in zip(keys, values):
                if value:
                    result[key] = orjson.loads(value)
                    hits += 1

            self.hit_count += hits
            self.miss_count += len(keys) - hits

            logger.debug(f"批量读取 {len(keys)} keys, {hits} hits ({response_time:.2f}ms)")
            return result

        except Exception as e:
            logger.error(f"批量读取失败: {e}")
            self.miss_count += len(keys)
            return {}

    async def pipeline_set(self, data: Dict[str, Tuple[Any, Optional[int]]]) -> bool:
        """批量设置缓存"""
        try:
            start_time = time.time()
            if redis.is_cluster_mode():
                for key, (value, ttl) in data.items():
                    ttl = ttl or self.get_ttl_for_key(key)
                    jsonable = self._to_jsonable(value)
                    serialized = orjson.dumps(jsonable)
                    await redis.set(key, serialized.decode('utf-8'), ex=ttl)
            else:
                client = await redis.get_client()
                pipe = client.pipeline()

                for key, (value, ttl) in data.items():
                    ttl = ttl or self.get_ttl_for_key(key)
                    jsonable = self._to_jsonable(value)
                    serialized = orjson.dumps(jsonable)
                    pipe.setex(key, ttl, serialized.decode('utf-8'))

                await pipe.execute()
            response_time = (time.time() - start_time) * 1000

            logger.debug(f"批量写入 {len(data)} keys ({response_time:.2f}ms)")
            return True

        except Exception as e:
            logger.error(f"批量写入失败: {e}")
            return False

    async def exists(self, key: str) -> bool:
        """检查键是否存在"""
        try:
            client = await redis.get_client()
            return bool(await client.exists(key))
        except Exception as e:
            logger.error(f"检查键存在失败 {key}: {e}")
            return False

    async def ttl(self, key: str) -> int:
        """获取键的剩余存活时间"""
        try:
            client = await redis.get_client()
            return await client.ttl(key)
        except Exception as e:
            logger.error(f"获取TTL失败 {key}: {e}")
            return -1

    async def expire(self, key: str, seconds: int) -> bool:
        """设置键的过期时间"""
        try:
            client = await redis.get_client()
            return bool(await client.expire(key, seconds))
        except Exception as e:
            logger.error(f"设置过期时间失败 {key}: {e}")
            return False

    def get_hit_rate(self) -> float:
        """获取缓存命中率"""
        total = self.hit_count + self.miss_count
        if total == 0:
            return 0.0
        return self.hit_count / total

    def get_stats(self) -> Dict[str, Any]:
        """获取缓存统计信息"""
        return {
            "hit_count": self.hit_count,
            "miss_count": self.miss_count,
            "hit_rate": self.get_hit_rate(),
            "total_requests": self.hit_count + self.miss_count
        }

    async def flush_stats(self):
        """重置统计信息"""
        self.hit_count = 0
        self.miss_count = 0

    async def health_check(self) -> Dict[str, Any]:
        """健康检查"""
        try:
            start_time = time.time()
            client = await redis.get_client()
            await client.ping()
            response_time = (time.time() - start_time) * 1000

            # 获取Redis信息
            info = await client.info()
            if isinstance(info, dict) and "redis_version" not in info and info:
                first = next(iter(info.values()))
                if isinstance(first, dict):
                    info = first

            return {
                "status": "healthy",
                "ping_time_ms": round(response_time, 2),
                "connected_clients": info.get("connected_clients", 0),
                "used_memory_human": info.get("used_memory_human", "unknown"),
                "hit_rate": self.get_hit_rate(),
                "redis_version": info.get("redis_version", "unknown")
            }

        except Exception as e:
            logger.error(f"缓存健康检查失败: {e}")
            return {
                "status": "unhealthy",
                "error": str(e),
                "hit_rate": self.get_hit_rate()
            }


# 全局缓存服务实例
cache_service = CacheService()


# 装饰器：自动缓存函数结果
def cached(ttl: Optional[int] = None, key_prefix: str = "func"):
    """缓存装饰器"""
    def decorator(func):
        async def wrapper(*args, **kwargs):
            # 生成缓存键
            import hashlib
            cache_key = f"{key_prefix}:{func.__name__}:{hashlib.md5(str(args).encode() + str(kwargs).encode()).hexdigest()}"

            # 尝试从缓存获取
            cached_result = await cache_service.get(cache_key)
            if cached_result is not None:
                return cached_result

            # 执行函数
            result = await func(*args, **kwargs)

            # 缓存结果
            await cache_service.set(cache_key, result, ttl)

            return result
        return wrapper
    return decorator


# 辅助函数
async def get_cache_service() -> CacheService:
    """获取缓存服务实例"""
    return cache_service


async def warm_cache(keys_and_values: Dict[str, Tuple[Any, Optional[int]]]):
    """缓存预热"""
    logger.info(f"开始缓存预热，{len(keys_and_values)} 个键")
    start_time = time.time()

    success = await cache_service.pipeline_set(keys_and_values)

    if success:
        elapsed = time.time() - start_time
        logger.info(f"缓存预热完成，耗时 {elapsed:.2f}s")
    else:
        logger.error("缓存预热失败")
