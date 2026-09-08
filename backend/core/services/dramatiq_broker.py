from __future__ import annotations

from typing import Dict, List, Optional
from urllib.parse import urlparse
import os

import dramatiq
import redis as redis_sync
from dramatiq.brokers.redis import RedisBroker
from redis.cluster import ClusterNode

from core.utils.logger import logger


_broker: RedisBroker | None = None


def _parse_bool(value: Optional[str], default: bool = False) -> bool:
    if value is None:
        return default
    return value.strip().lower() in ("1", "true", "yes", "on")


def _parse_cluster_nodes(raw: str) -> List[Dict[str, int | str]]:
    nodes: List[Dict[str, int | str]] = []
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
    nodes: List[Dict[str, int | str]],
) -> List[ClusterNode]:
    startup_nodes: List[ClusterNode] = []
    for node in nodes:
        host = node.get("host")
        if not host:
            continue
        port = int(node.get("port") or 6379)
        startup_nodes.append(ClusterNode(host, port))
    return startup_nodes


def _build_broker_namespace(cluster_mode: bool) -> str:
    namespace = os.getenv("REDIS_BROKER_NAMESPACE")
    if namespace:
        if cluster_mode and "{" not in namespace:
            logger.warning(
                "REDIS_BROKER_NAMESPACE missing hash tag for cluster; "
                "consider wrapping with {tag} to keep keys in one slot."
            )
        return namespace
    return "{dramatiq}" if cluster_mode else "dramatiq"


def _create_cluster_client(
    nodes: List[Dict[str, int | str]],
    password: Optional[str],
    ssl_enabled: bool,
    retry_on_timeout: bool,
):
    startup_nodes = _build_cluster_startup_nodes(nodes)
    cluster_kwargs = dict(
        startup_nodes=startup_nodes,
        password=password or None,
        ssl=ssl_enabled,
        socket_timeout=15.0,
        socket_connect_timeout=10.0,
        retry_on_timeout=retry_on_timeout,
    )
    try:
        return redis_sync.RedisCluster(**cluster_kwargs)
    except TypeError:
        first = nodes[0] if nodes else {"host": "redis", "port": 6379}
        return redis_sync.RedisCluster(
            host=first["host"],
            port=int(first["port"]),
            password=password or None,
            ssl=ssl_enabled,
            socket_timeout=15.0,
            socket_connect_timeout=10.0,
            retry_on_timeout=retry_on_timeout,
        )


def build_redis_broker() -> RedisBroker:
    redis_host = os.getenv("REDIS_HOST", "redis")
    redis_port = int(os.getenv("REDIS_PORT", 6379))
    redis_password = os.getenv("REDIS_PASSWORD", "") or None
    redis_ssl = _parse_bool(os.getenv("REDIS_SSL"), False)
    retry_on_timeout = not (os.getenv("REDIS_RETRY_ON_TIMEOUT", "True").lower() != "true")
    cluster_enabled_raw = os.getenv("REDIS_CLUSTER_ENABLED")
    cluster_enabled = _parse_bool(cluster_enabled_raw, False)
    cluster_nodes_raw = os.getenv("REDIS_CLUSTER_NODES", "").strip()
    cluster_nodes = _parse_cluster_nodes(cluster_nodes_raw)
    cluster_mode = cluster_enabled or (cluster_enabled_raw is None and bool(cluster_nodes))
    if not cluster_mode and cluster_nodes:
        logger.warning(
            "REDIS_CLUSTER_NODES set but REDIS_CLUSTER_ENABLED is false; "
            "falling back to standalone Redis.",
        )
    namespace = _build_broker_namespace(cluster_mode)
    broker_kwargs = dict(namespace=namespace, middleware=[dramatiq.middleware.AsyncIO()])

    if cluster_mode:
        if not cluster_nodes:
            cluster_nodes = [{"host": redis_host, "port": redis_port}]
        cluster_client = _create_cluster_client(
            cluster_nodes, redis_password, redis_ssl, retry_on_timeout
        )
        try:
            return RedisBroker(client=cluster_client, **broker_kwargs)
        except TypeError as exc:
            logger.error(
                "RedisBroker does not support custom client injection; "
                "upgrade dramatiq or run a standalone Redis broker.",
                error=str(exc),
            )
            raise

    return RedisBroker(
        host=redis_host,
        port=redis_port,
        password=redis_password,
        ssl=redis_ssl,
        **broker_kwargs,
    )


def configure_dramatiq() -> RedisBroker:
    global _broker
    if _broker is None:
        _broker = build_redis_broker()
        dramatiq.set_broker(_broker)
    return _broker
