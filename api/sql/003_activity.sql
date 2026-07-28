-- ═══════════════════════════════════════════════════════════════════════════
--  003 — Atividade do assinante
--  Rode no SQL Editor do Supabase (Database → SQL Editor → New query).
--  Seguro rodar mais de uma vez: tudo é "if not exists".
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.subscriptions
  add column if not exists last_seen_at   timestamptz,
  add column if not exists last_export_at timestamptz,
  add column if not exists exports_count  integer not null default 0;

comment on column public.subscriptions.last_seen_at
  is 'Última vez que a extensão validou o acesso (popup aberto)';
comment on column public.subscriptions.last_export_at
  is 'Última clonagem iniciada pela extensão';
comment on column public.subscriptions.exports_count
  is 'Total de clonagens iniciadas';

-- Ordenar o painel por "quem usou por último" sem varrer a tabela toda
create index if not exists idx_subscriptions_last_seen
  on public.subscriptions (last_seen_at desc nulls last);

-- ─── Rastreio de pedidos (UTMify) ────────────────────────────────────────────
-- O PIX fica pendente até o cliente pagar, e nesse meio-tempo não existe linha
-- em subscriptions. Sem guardar o pedido aqui, quando o webhook de "pago"
-- chegasse a gente já teria perdido as UTMs que vieram do anúncio.
create table if not exists public.orders_tracking (
  payment_id text primary key,
  payload    jsonb not null,
  created_at timestamptz not null default now()
);

alter table public.orders_tracking enable row level security;

-- Só o backend (service_role) toca nisso. Sem policy para anon/authenticated:
-- é dado de atribuição de anúncio, não tem por que ficar exposto ao navegador.
drop policy if exists "service_role_all_orders" on public.orders_tracking;
create policy "service_role_all_orders"
  on public.orders_tracking for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');
