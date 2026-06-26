-- ═══════════════════════════════════════════════════════════════════════════
--  Web Clone AI — Schema Supabase
--  Execute no SQL Editor do painel Supabase (Database → SQL Editor)
-- ═══════════════════════════════════════════════════════════════════════════

-- ─── Tabela de assinaturas ───────────────────────────────────────────────────
create table if not exists public.subscriptions (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references auth.users(id) on delete cascade,
  status              text not null default 'inactive'
                        check (status in ('active', 'inactive', 'refunded', 'expired')),
  plan                text not null default 'monthly'
                        check (plan in ('monthly', 'lifetime')),
  asaas_customer_id   text,
  asaas_payment_id    text,
  asaas_sub_id        text,   -- preenchido para planos mensais (subscription Asaas)
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

-- Índices
create unique index if not exists idx_subscriptions_user_id
  on public.subscriptions (user_id);

create index if not exists idx_subscriptions_asaas_customer
  on public.subscriptions (asaas_customer_id);

create index if not exists idx_subscriptions_status
  on public.subscriptions (status);

-- Atualiza updated_at automaticamente
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger trg_subscriptions_updated_at
  before update on public.subscriptions
  for each row execute function public.set_updated_at();

-- ─── Row Level Security ──────────────────────────────────────────────────────

-- Habilitar RLS
alter table public.subscriptions enable row level security;

-- Usuário só lê a própria assinatura
create policy "users_read_own_subscription"
  on public.subscriptions for select
  using (auth.uid() = user_id);

-- Service role tem acesso total (usado pelo backend)
create policy "service_role_all"
  on public.subscriptions for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

-- ─── Verificação rápida de status (helper function) ──────────────────────────
create or replace function public.get_subscription_status(p_user_id uuid)
returns text
language sql stable security definer as $$
  select status
  from public.subscriptions
  where user_id = p_user_id
  limit 1;
$$;

-- ─── Comentários ─────────────────────────────────────────────────────────────
comment on table  public.subscriptions                   is 'Assinaturas Web Clone AI';
comment on column public.subscriptions.user_id           is 'FK para auth.users';
comment on column public.subscriptions.status            is 'active | inactive | refunded | expired';
comment on column public.subscriptions.plan              is 'monthly (R$29,90/mês) | lifetime (R$67,00)';
comment on column public.subscriptions.asaas_customer_id is 'ID do customer no Asaas';
comment on column public.subscriptions.asaas_payment_id  is 'ID do pagamento no Asaas';
comment on column public.subscriptions.asaas_sub_id      is 'ID da subscription Asaas (somente plano mensal)';
