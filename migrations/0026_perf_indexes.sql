-- Performance: app_settings is now read on every dashboard load (prefs:, profilex:,
-- licjourney:) and scanned by prefix for the admin demand report.
create index if not exists idx_app_settings_key on public.app_settings (key);

-- Applications are counted per user on every dashboard load.
create index if not exists idx_applications_user on public.applications (user_id);
create index if not exists idx_applications_user_stage on public.applications (user_id, stage);

-- Credit ledger notes are checked for promo idempotency.
create index if not exists idx_credit_ledger_user_note on public.credit_ledger (user_id, note);

-- Documents are looked up per user for the themed-CV and vault features.
create index if not exists idx_documents_user on public.documents (user_id);
create index if not exists idx_documents_user_generated on public.documents (user_id, generated);

-- Application documents are fetched per application repeatedly.
create index if not exists idx_appdocs_app on public.application_documents (application_id);
