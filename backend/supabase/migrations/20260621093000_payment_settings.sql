-- backend/supabase/migrations/20260621093000_payment_settings.sql
-- 管理员可改的支付设置(当前仅 USD/CNY 汇率,默认 7)。单行表(id 恒 true)。
BEGIN;

CREATE TABLE IF NOT EXISTS public.payment_settings (
    id           BOOLEAN PRIMARY KEY DEFAULT true CHECK (id),
    usd_cny_rate DECIMAL(18,6) NOT NULL DEFAULT 7,
    updated_by   UUID,
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO public.payment_settings (id, usd_cny_rate)
VALUES (true, 7)
ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.payment_settings ENABLE ROW LEVEL SECURITY;

-- 仅 service_role 读写(管理员经服务端 RPC/端点);普通用户无需直读
CREATE POLICY payment_settings_service_role ON public.payment_settings
    FOR ALL USING (auth.role() = 'service_role');

COMMIT;
