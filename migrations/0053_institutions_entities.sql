-- ForiForeign — 0053 · institution / employer entities (the graph's first nodes) for all 54 destinations.
create table if not exists public.institutions (
  id uuid primary key default gen_random_uuid(),
  country_code text not null, name text not null, domain text, kind text not null default 'university' check (kind in ('university','college','employer','recruiter','funder','hospital','other')),
  website text, admissions_url text, careers_url text, contact_email text,
  partner_org_id uuid, verified boolean not null default false, source text not null default 'seed',
  created_at timestamptz not null default now(),
  unique (country_code, name)
);
create index if not exists idx_institutions_cc on public.institutions(country_code, kind);
create index if not exists idx_institutions_domain on public.institutions(domain);
alter table public.institutions enable row level security;
drop policy if exists institutions_public on public.institutions; create policy institutions_public on public.institutions for select using (true);
