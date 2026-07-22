-- ═══════════════════════════════════════════════════════════════════════════
-- Web Clone AI — Módulos + Banner da área de membros
-- Rode DEPOIS do 001_lessons.sql. Supabase → SQL Editor → cole → Run.
-- ═══════════════════════════════════════════════════════════════════════════

-- 1) Módulos (agrupam as aulas)
create table if not exists public.modules (
  id         uuid primary key default gen_random_uuid(),
  title      text not null unique,
  position   int  not null default 0,
  created_at timestamptz not null default now()
);
alter table public.modules enable row level security;
drop policy if exists "modules_select_auth" on public.modules;
create policy "modules_select_auth" on public.modules
  for select to authenticated using (true);

-- 2) Vínculo aula → módulo
alter table public.lessons
  add column if not exists module_id uuid references public.modules(id) on delete set null;

-- 3) Banner / config da área de membros (linha única, id = 1)
create table if not exists public.members_settings (
  id               int primary key default 1,
  banner_title     text default 'Bem-vindo à Área de Membros',
  banner_subtitle  text default 'Baixe a extensão e siga os tutoriais para começar.',
  banner_image_url text,
  updated_at       timestamptz not null default now(),
  constraint members_settings_single check (id = 1)
);
alter table public.members_settings enable row level security;
drop policy if exists "members_settings_select_auth" on public.members_settings;
create policy "members_settings_select_auth" on public.members_settings
  for select to authenticated using (true);
insert into public.members_settings (id) values (1) on conflict (id) do nothing;

-- 4) Seed dos módulos e vínculo das aulas já existentes
insert into public.modules (title, position) values
  ('Instalação', 1),
  ('Clonando na prática', 2)
on conflict (title) do nothing;

update public.lessons l set module_id = m.id
  from public.modules m
  where m.title = 'Instalação' and l.position in (1, 2);

update public.lessons l set module_id = m.id
  from public.modules m
  where m.title = 'Clonando na prática' and l.position in (3, 4, 5);

-- Escrita (insert/update/delete) só pelo backend (service_role bypassa RLS).
