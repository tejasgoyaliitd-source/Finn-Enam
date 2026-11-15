-- Private Storage buckets for everything too big for Postgres rows.
--
--   documents    extracted page text of annual reports, transcripts and results PDFs,
--                stored as gzip JSON at <sha256>.json.gz (documents.storage_path).
--                Original PDFs are NOT stored: we keep the source URL and re-download if needed.
--   llm-outputs  model outputs over 8 KB, at <cache key>.json.gz (llm_cache.storage_path).
--
-- Both are private. storage.objects already has RLS enabled by Supabase; we add no policies,
-- so only the service role (finn-api, refresher) can read or write. Free tier: 1 GB total.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('documents',   'documents',   false, 20971520, array['application/gzip', 'application/json']), -- 20 MB
  ('llm-outputs', 'llm-outputs', false,  5242880, array['application/gzip', 'application/json'])  --  5 MB
on conflict (id) do update set
  public             = excluded.public,
  file_size_limit    = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;
