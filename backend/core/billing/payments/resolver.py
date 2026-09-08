from __future__ import annotations
from collections.abc import Iterable
from .contract import PaymentGateway, PaymentGatewayId, PaymentGatewayNotConfigured


class PaymentGatewayResolver:
    """纯查表 registry。路由/币种逻辑放在 routing.py(此处保持 dumb)。"""

    def __init__(self, gateways: Iterable[PaymentGateway]) -> None:
        self._by_id: dict[PaymentGatewayId, PaymentGateway] = {}
        for g in gateways:
            self._by_id[PaymentGatewayId(g.gateway_id)] = g  # last-wins

    def resolve(self, gateway_id: PaymentGatewayId | str) -> PaymentGateway:
        gid = PaymentGatewayId(gateway_id)
        try:
            return self._by_id[gid]
        except KeyError as exc:
            raise PaymentGatewayNotConfigured(gid) from exc

    def has(self, gateway_id: PaymentGatewayId | str) -> bool:
        return PaymentGatewayId(gateway_id) in self._by_id

    def available(self) -> tuple[PaymentGatewayId, ...]:
        return tuple(self._by_id.keys())
