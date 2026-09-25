-- Fix the Graph API version validator introduced in migration 053.
-- `[.]` expresses a literal period without relying on SQL string escaping.
BEGIN;

ALTER TABLE public.meta_capi_connections
  DROP CONSTRAINT IF EXISTS meta_capi_connections_graph_version_format;

ALTER TABLE public.meta_capi_connections
  ADD CONSTRAINT meta_capi_connections_graph_version_format
  CHECK (graph_api_version ~ '^v[0-9]+[.][0-9]+$');

COMMIT;
