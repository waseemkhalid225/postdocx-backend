-- ForiForeign — 0093 · BYOC AI: one private AI connection per consultancy (encrypted at rest), usage attribution, fixed platform plans.
create table if not exists public.org_ai_connections (
  org_id uuid primary key, status text not null default 'connected',          -- connected | disconnected
  gemini_key_enc text, anthropic_key_enc text, openai_key_enc text,           -- AES-256-GCM via FF_DATA_KEY; never returned
  gemini_last4 text, anthropic_last4 text, openai_last4 text,
  health text not null default 'healthy', health_note text, last_ok_at timestamptz, last_error_at timestamptz,
  connected_by uuid, connected_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
alter table public.org_ai_connections enable row level security;
-- the cost ledger was written by the router but never created by a migration; created here so metering exists on every database
create table if not exists public.ai_cost_ledger (
  id uuid primary key default gen_random_uuid(), org_id uuid, user_id uuid, application_id uuid,
  provider text, model text, purpose text, input_tokens integer, output_tokens integer, thinking text,
  cost_usd numeric, est_cost_usd numeric, created_at timestamptz not null default now()
);
alter table public.ai_cost_ledger enable row level security;
alter table if exists public.ai_cost_ledger add column if not exists org_id uuid;
alter table if exists public.ai_cost_ledger add column if not exists est_cost_usd numeric;
alter table if exists public.ai_cost_ledger add column if not exists cost_usd numeric;
alter table if exists public.ai_cost_ledger add column if not exists thinking text;
create index if not exists idx_ai_cost_ledger_user_day on public.ai_cost_ledger(user_id, created_at);
create index if not exists idx_ai_cost_ledger_org_day on public.ai_cost_ledger(org_id, created_at);
