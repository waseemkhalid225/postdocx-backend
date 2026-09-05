-- ForiForeign — 0087 · Phase 3 · Traceable facts and document versions.
-- profile_provenance: for every profile column filled by extraction or by the person: {field: {source: 'cv'|'document'|'user'|'intent', doc_id, at}}.
alter table if exists public.profiles add column if not exists profile_provenance jsonb not null default '{}'::jsonb;
-- Document versions (DISC-001): a replacement CV supersedes the previous one; nothing is deleted.
alter table if exists public.documents add column if not exists version integer not null default 1;
alter table if exists public.documents add column if not exists supersedes_id uuid;
alter table if exists public.documents add column if not exists superseded_at timestamptz;
create index if not exists idx_documents_user_type_live on public.documents(user_id, doc_type) where superseded_at is null;
