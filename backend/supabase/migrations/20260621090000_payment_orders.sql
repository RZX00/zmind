-- backend/supabase/migrations/20260621090000_payment_orders.sql
BEGIN;

CREATE TABLE IF NOT EXISTS public.payment_orders (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id      UUID NOT NULL REFERENCES basejump.accounts(id) ON DELETE CASCADE,
    gateway         TEXT NOT NULL CHECK (gateway IN ('alipay','stripe')),
    status          TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending','paid','failed','cancelled','expired')),
    pay_currency    TEXT NOT NULL CHECK (pay_currency IN ('CNY','USD')),
    pay_amount      DECIMAL(18,2) NOT NULL,
    credit_amount_usd DECIMAL(18,4) NOT NULL,
    fx_rate_usd_cny DECIMAL(18,6),
    catalog_id      TEXT NOT NULL,
    catalog_version TEXT NOT NULL,
    price_snapshot  DECIMAL(18,2) NOT NULL,
    gateway_payment_id TEXT,
    trade_no        TEXT,
    gateway_status  TEXT,
    notify_payload  JSONB,
    credited_at     TIMESTAMPTZ,
    fulfilled_at    TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at      TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_payment_orders_account ON public.payment_orders(account_id);
CREATE INDEX IF NOT EXISTS idx_payment_orders_status ON public.payment_orders(status);
CREATE INDEX IF NOT EXISTS idx_payment_orders_gateway_payment_id ON public.payment_orders(gateway_payment_id);
CREATE INDEX IF NOT EXISTS idx_payment_orders_pending ON public.payment_orders(status, created_at)
    WHERE status = 'pending';

ALTER TABLE public.payment_orders ENABLE ROW LEVEL SECURITY;

-- 账户成员可读自己/团队的订单;写入仅 service_role(经 RPC/服务端)
CREATE POLICY payment_orders_select ON public.payment_orders
    FOR SELECT USING (basejump.has_role_on_account(account_id));

COMMIT;
