-- ═══════════════════════════════════════════════════════════════════════════
-- Web Clone AI — Tabela de aulas da área de membros (CMS)
-- Rode no Supabase: SQL Editor → New query → cole tudo → Run.
-- Projeto: cygvhqggcqsemtrfltfk
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.lessons (
  id           uuid primary key default gen_random_uuid(),
  position     int         not null default 0,          -- ordem de exibição (1,2,3…)
  title        text        not null,
  description  text,
  duration     text,                                    -- ex.: "3:45"
  status       text        not null default 'available' -- 'available' | 'soon'
                 check (status in ('available','soon')),
  video_url    text,                                    -- link/embed do vídeo da aula
  material_url text,                                    -- material de apoio (opcional)
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- RLS: leitura só para usuários logados (a área de membros exige login);
-- escrita fica apenas para o backend (service_role bypassa RLS).
alter table public.lessons enable row level security;

drop policy if exists "lessons_select_authenticated" on public.lessons;
create policy "lessons_select_authenticated"
  on public.lessons for select
  to authenticated
  using (true);

-- Seed: as 5 aulas que hoje estão fixas no HTML da área de membros
insert into public.lessons (position, title, description, duration, status) values
  (1, 'Como instalar a extensão no Chrome',
      'Passo a passo para carregar a extensão no modo desenvolvedor e fixar na barra do Chrome.',
      '3:45', 'available'),
  (2, 'Como instalar no Edge e no Brave',
      'Instalação do Web Clone AI em outros navegadores baseados no Chromium.',
      '4:20', 'available'),
  (3, 'Clonando seu primeiro site',
      'Demonstração completa clonando uma landing page real e abrindo no Claude Code.',
      '8:00', 'available'),
  (4, 'Personalizando o site clonado com IA',
      'Como usar o PROMPT.md gerado para adaptar qualquer site para o seu projeto.',
      null, 'soon'),
  (5, 'Publicando o site no Vercel',
      'Do ZIP exportado ao site online em menos de 5 minutos com a Vercel.',
      null, 'soon')
on conflict do nothing;
