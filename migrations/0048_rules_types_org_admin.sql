-- ForiForeign — 0048 · rule types for attestation/licence/shortage; organisation-scoped audit; cleanup.
alter table if exists public.visa_rules drop constraint if exists visa_rules_rule_type_check;
alter table if exists public.visa_rules add constraint visa_rules_rule_type_check check (rule_type in ('eligibility','document','financial','language','fee','processing','work_rights','dependants','post_arrival','pr_path','note','attestation','licence','shortage'));
alter table if exists public.audit_log add column if not exists org_id uuid;
create index if not exists idx_audit_org on public.audit_log(org_id, created_at desc);
