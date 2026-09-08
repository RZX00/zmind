from __future__ import annotations
from core.billing.payments.contract import PaymentGatewayId
from core.billing.payments.routing import route_gateway


def test_explicit_overrides_everything():
    assert route_gateway(account_region="US", explicit="alipay") == PaymentGatewayId.ALIPAY


def test_cny_hint_routes_alipay():
    assert route_gateway(currency_hint="CNY") == PaymentGatewayId.ALIPAY


def test_cn_region_routes_alipay():
    assert route_gateway(account_region="CN") == PaymentGatewayId.ALIPAY


def test_zh_locale_routes_alipay():
    assert route_gateway(accept_language="zh-CN,zh;q=0.9") == PaymentGatewayId.ALIPAY


def test_default_routes_stripe():
    assert route_gateway(account_region="US", accept_language="en-US") == PaymentGatewayId.STRIPE
    assert route_gateway() == PaymentGatewayId.STRIPE
