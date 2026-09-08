from __future__ import annotations
from alipay import AliPay  # python-alipay-sdk
from core.utils.config import config


class RealAlipayClient:
    """alipay-sdk 的窄封装,实现 AlipayClient Protocol。"""

    def __init__(self) -> None:
        self._ali = AliPay(
            appid=config.ALIPAY_APP_ID,
            app_notify_url=None,
            app_private_key_string=config.ALIPAY_PRIVATE_KEY,
            alipay_public_key_string=config.ALIPAY_PUBLIC_KEY,
            sign_type=config.ALIPAY_SIGN_TYPE,
            debug=False,
        )
        self._gateway = config.ALIPAY_GATEWAY_URL

    def precreate(self, *, out_trade_no, total_amount, subject, notify_url) -> dict:
        return self._ali.api_alipay_trade_precreate(
            out_trade_no=out_trade_no, total_amount=total_amount, subject=subject, notify_url=notify_url)

    def page_pay(self, *, out_trade_no, total_amount, subject, notify_url, return_url) -> str:
        query = self._ali.api_alipay_trade_page_pay(
            out_trade_no=out_trade_no, total_amount=total_amount, subject=subject,
            notify_url=notify_url, return_url=return_url)
        return f"{self._gateway}?{query}"

    def query(self, *, out_trade_no) -> dict:
        return self._ali.api_alipay_trade_query(out_trade_no=out_trade_no)

    def verify(self, params: dict) -> bool:
        data = dict(params)
        signature = data.pop("sign", None)
        data.pop("sign_type", None)
        if not signature:
            return False
        return bool(self._ali.verify(data, signature))
