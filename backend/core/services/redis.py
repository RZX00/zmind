import asyncio
import os
from typing import Any, AsyncIterator, Iterable, List, Optional
from urllib.parse import urlparse

import redis.asyncio as redis
from redis.asyncio.cluster import ClusterNode as AsyncClusterNode
from redis.asyncio.connection import SSLConnection
from dotenv import load_dotenv

from core.utils.logger import logger
from core.utils.retry import retry

# Redis client and connection pool
client: redis.Redis | redis.RedisCluster | None = None
pool: redis.ConnectionPool | None = None
_cluster_mode = False
_cluster_nodes: list[dict[str, int | str]] = []
_initialized = False
_init_lock = asyncio.Lock()

# Constants
REDIS_KEY_TTL = 3600 * 24  # 24 hour TTL as safety mechanism


def _parse_bool(value: Optional[str], default: bool = False) -> bool:
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


def _parse_cluster_nodes(raw: str) -> list[dict[str, int | str]]:
    nodes: list[dict[str, int | str]] = []
    for entry in (raw or "").split(","):
        entry = entry.strip()
        if not entry:
            continue
        host = entry
        port = None
        if "://" in entry:
            parsed = urlparse(entry)
            if parsed.hostname:
                host = parsed.hostname
                port = parsed.port
        else:
            if ":" in entry:
                host, port_str = entry.split(":", 1)
                host = host.strip()
                try:
                    port = int(port_str)
                except ValueError:
                    port = None
        if not host:
            continue
        nodes.append({"host": host, "port": port or 6379})
    return nodes


def _build_cluster_startup_nodes(
    nodes: list[dict[str, int | str]],
) -> list[AsyncClusterNode]:
    startup_nodes: list[AsyncClusterNode] = []
    for node in nodes:
        host = node.get("host")
        if not host:
            continue
        port = int(node.get("port") or 6379)
        startup_nodes.append(AsyncClusterNode(host, port))
    return startup_nodes


def _create_cluster_client(
    *,
    nodes: list[dict[str, int | str]],
    password: Optional[str],
    ssl_enabled: bool,
    socket_timeout: float,
    connect_timeout: float,
    retry_on_timeout: bool,
    max_connections: int,
) -> redis.RedisCluster:
    startup_nodes = _build_cluster_startup_nodes(nodes)
    cluster_kwargs = dict(
        startup_nodes=startup_nodes,
        password=password or None,
        decode_responses=True,
        socket_timeout=socket_timeout,
        socket_connect_timeout=connect_timeout,
        socket_keepalive=True,
        retry_on_timeout=retry_on_timeout,
        health_check_interval=30,
        ssl=ssl_enabled,
    )
    try:
        return redis.RedisCluster(max_connections=max_connections, **cluster_kwargs)
    except TypeError:
        return redis.RedisCluster(**cluster_kwargs)


def initialize():
    """Initialize Redis connection pool and client using environment variables."""
    global client, pool, _cluster_mode, _cluster_nodes

    # Load environment variables if not already loaded
    load_dotenv()

    # Get Redis configuration
    redis_host = os.getenv("REDIS_HOST", "redis")
    redis_port = int(os.getenv("REDIS_PORT", 6379))
    redis_password = os.getenv("REDIS_PASSWORD", "")
    redis_ssl = _parse_bool(os.getenv("REDIS_SSL"), False)
    max_connections = int(os.getenv("REDIS_MAX_CONNECTIONS", 512))
    cluster_enabled_raw = os.getenv("REDIS_CLUSTER_ENABLED")
    cluster_enabled = _parse_bool(cluster_enabled_raw, False)
    cluster_nodes_raw = os.getenv("REDIS_CLUSTER_NODES", "").strip()
    cluster_nodes = _parse_cluster_nodes(cluster_nodes_raw)
    
    # Connection pool configuration - optimized for production
    socket_timeout = 15.0            # 15 seconds socket timeout
    connect_timeout = 10.0           # 10 seconds connection timeout
    retry_on_timeout = not (os.getenv("REDIS_RETRY_ON_TIMEOUT", "True").lower() != "true")

    _cluster_mode = cluster_enabled or (cluster_enabled_raw is None and bool(cluster_nodes))
    _cluster_nodes = cluster_nodes
    if not _cluster_mode and cluster_nodes:
        logger.warning(
            "REDIS_CLUSTER_NODES set but REDIS_CLUSTER_ENABLED is false; "
            "falling back to standalone Redis."
        )

    if _cluster_mode:
        if not cluster_nodes:
            cluster_nodes = [{"host": redis_host, "port": redis_port}]
        nodes_display = ", ".join(
            f"{node['host']}:{node['port']}" for node in cluster_nodes
        )
        logger.info(f"Initializing Redis cluster connection to {nodes_display}")
        client = _create_cluster_client(
            nodes=cluster_nodes,
            password=redis_password,
            ssl_enabled=redis_ssl,
            socket_timeout=socket_timeout,
            connect_timeout=connect_timeout,
            retry_on_timeout=retry_on_timeout,
            max_connections=max_connections,
        )
        pool = None
        return client

    logger.info(
        f"Initializing Redis connection pool to {redis_host}:{redis_port} with max {max_connections} connections"
    )

    # Create connection pool with production-optimized settings (ASYNC)
    pool_kwargs: dict[str, Any] = {
        "host": redis_host,
        "port": redis_port,
        "password": redis_password,
        "decode_responses": True,
        "socket_timeout": socket_timeout,
        "socket_connect_timeout": connect_timeout,
        "socket_keepalive": True,
        "retry_on_timeout": retry_on_timeout,
        "health_check_interval": 30,
        "max_connections": max_connections,
    }
    if redis_ssl:
        pool_kwargs["connection_class"] = SSLConnection
    pool = redis.ConnectionPool(**pool_kwargs)

    # Create ASYNC Redis client from connection pool
    client = redis.Redis(connection_pool=pool)

    return client


async def initialize_async():
    """Initialize Redis connection asynchronously."""
    global client, _initialized

    async with _init_lock:
        if not _initialized:
            # logger.debug("Initializing Redis connection")
            initialize()

        try:
            # Test connection with timeout
            await asyncio.wait_for(client.ping(), timeout=5.0)
            logger.info("Successfully connected to Redis")
            _initialized = True
        except asyncio.TimeoutError:
            logger.error("Redis connection timeout during initialization")
            client = None
            _initialized = False
            raise ConnectionError("Redis connection timeout")
        except Exception as e:
            logger.error(f"Failed to connect to Redis: {e}")
            client = None
            _initialized = False
            raise

    return client


async def close():
    """Close Redis connection and connection pool."""
    global client, pool, _initialized
    if client:
        # logger.debug("Closing Redis connection")
        try:
            await asyncio.wait_for(client.aclose(), timeout=5.0)
        except asyncio.TimeoutError:
            logger.warning("Redis close timeout, forcing close")
        except Exception as e:
            logger.warning(f"Error closing Redis client: {e}")
        finally:
            client = None
    
    if pool:
        # logger.debug("Closing Redis connection pool")
        try:
            await asyncio.wait_for(pool.aclose(), timeout=5.0)
        except asyncio.TimeoutError:
            logger.warning("Redis pool close timeout, forcing close")
        except Exception as e:
            logger.warning(f"Error closing Redis pool: {e}")
        finally:
            pool = None
    
    _initialized = False
    logger.info("Redis connection and pool closed")


async def get_client():
    """Get the Redis client, initializing if necessary."""
    global client, _initialized
    if client is None or not _initialized:
        await retry(lambda: initialize_async())
    return client


def is_cluster_mode() -> bool:
    return _cluster_mode


async def scan_iter(match: Optional[str] = None) -> AsyncIterator[str]:
    redis_client = await get_client()
    if _cluster_mode:
        for target_nodes in ("all", "primaries", "masters"):
            try:
                async for key in redis_client.scan_iter(
                    match=match, target_nodes=target_nodes
                ):
                    yield key
                return
            except TypeError:
                break
            except ValueError:
                continue
    async for key in redis_client.scan_iter(match=match):
        yield key


# Basic Redis operations
async def set(key: str, value: str, ex: int = None, nx: bool = False):
    """Set a Redis key."""
    redis_client = await get_client()
    return await redis_client.set(key, value, ex=ex, nx=nx)


async def get(key: str, default: str = None):
    """Get a Redis key."""
    redis_client = await get_client()
    result = await redis_client.get(key)
    return result if result is not None else default


async def delete(key: str):
    """Delete a Redis key."""
    redis_client = await get_client()
    return await redis_client.delete(key)


async def publish(channel: str, message: str):
    """Publish a message to a Redis channel."""
    redis_client = await get_client()
    return await redis_client.publish(channel, message)


async def create_pubsub():
    """Create a Redis pubsub object."""
    redis_client = await get_client()
    return redis_client.pubsub()


# List operations
async def rpush(key: str, *values: Any):
    """Append one or more values to a list."""
    redis_client = await get_client()
    return await redis_client.rpush(key, *values)


async def lrange(key: str, start: int, end: int) -> List[str]:
    """Get a range of elements from a list."""
    redis_client = await get_client()
    return await redis_client.lrange(key, start, end)


# Key management


async def keys(pattern: str) -> List[str]:
    # Prefer SCAN-based iteration to avoid blocking Redis with KEYS on large keyspaces.
    return [key async for key in scan_iter(match=pattern)]


async def expire(key: str, seconds: int):
    redis_client = await get_client()
    return await redis_client.expire(key, seconds)


async def mget(keys: List[str]) -> List[Optional[str]]:
    if not keys:
        return []
    redis_client = await get_client()
    if _cluster_mode:
        results: List[Optional[str]] = []
        for key in keys:
            results.append(await redis_client.get(key))
        return results
    return await redis_client.mget(keys)


async def delete_many(keys: Iterable[str]) -> int:
    redis_client = await get_client()
    key_list = list(keys)
    if not key_list:
        return 0
    if _cluster_mode:
        deleted = 0
        for key in key_list:
            deleted += await redis_client.delete(key)
        return deleted
    return await redis_client.delete(*key_list)
