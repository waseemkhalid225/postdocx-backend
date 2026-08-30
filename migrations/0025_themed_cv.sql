-- 12b: store a pointer to the theme-preserved tailored CV (.docx) per application document
alter table if exists application_documents add column if not exists themed_key text;
