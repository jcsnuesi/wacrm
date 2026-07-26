-- ============================================================
-- 039_ai_knowledge_accent_insensitive_fts.sql
--
-- Make lexical knowledge retrieval accent-insensitive. WhatsApp users
-- commonly omit diacritics ("donde estan ubicados"), while curated KB
-- documents normally include them ("dónde están ubicados"). PostgreSQL's
-- `simple` text-search configuration preserves those accents, so the old
-- index returned no rows even for otherwise exact Spanish phrases.
--
-- Keep the existing `fts` column for backward compatibility and add a
-- normalized, indexed search vector. `translate` is immutable and avoids
-- depending on where a hosted/self-hosted Supabase instance installs the
-- optional `unaccent` extension.
-- ============================================================

CREATE OR REPLACE FUNCTION public.normalize_ai_knowledge_text(input text)
RETURNS text AS $$
  SELECT translate(
    lower(input),
    'áàäâãåéèëêíìïîóòöôõúùüûñç',
    'aaaaaaeeeeiiiiooooouuuunc'
  );
$$ LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT
   SET search_path = pg_catalog;

ALTER TABLE public.ai_knowledge_chunks
  ADD COLUMN IF NOT EXISTS fts_normalized tsvector
  GENERATED ALWAYS AS (
    to_tsvector('simple', public.normalize_ai_knowledge_text(content))
  ) STORED;

CREATE INDEX IF NOT EXISTS ai_knowledge_chunks_fts_normalized_idx
  ON public.ai_knowledge_chunks USING gin (fts_normalized);

-- Preserve SECURITY INVOKER from migration 032 so authenticated Draft
-- requests remain governed by ai_knowledge_chunks RLS. The service-role
-- Auto-reply path continues to bypass RLS normally.
CREATE OR REPLACE FUNCTION public.match_ai_knowledge_fts(
  p_account_id  uuid,
  p_query       text,
  p_match_count integer
)
RETURNS TABLE (id uuid, content text, rank real) AS $$
  SELECT c.id,
         c.content,
         ts_rank(
           c.fts_normalized,
           plainto_tsquery(
             'simple',
             public.normalize_ai_knowledge_text(p_query)
           )
         ) AS rank
  FROM public.ai_knowledge_chunks c
  WHERE c.account_id = p_account_id
    AND c.fts_normalized @@ plainto_tsquery(
      'simple',
      public.normalize_ai_knowledge_text(p_query)
    )
  ORDER BY rank DESC
  LIMIT GREATEST(p_match_count, 0);
$$ LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public;

REVOKE ALL ON FUNCTION public.match_ai_knowledge_fts(uuid, text, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.match_ai_knowledge_fts(uuid, text, integer) FROM anon;
GRANT EXECUTE ON FUNCTION public.match_ai_knowledge_fts(uuid, text, integer)
  TO authenticated, service_role;
