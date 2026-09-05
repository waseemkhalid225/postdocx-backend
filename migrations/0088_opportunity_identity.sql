-- ForiForeign — 0088 · Phase 4 · One identity per opportunity (DISC-002) and honest verification status.
alter table if exists public.opportunities add column if not exists url_key text;
alter table if exists public.opportunities add column if not exists verify_note text;
alter table if exists public.opportunities add column if not exists verify_attempts integer not null default 0;
create index if not exists idx_opportunities_url_key on public.opportunities(url_key);
create index if not exists idx_opportunities_fingerprint on public.opportunities(fingerprint);
