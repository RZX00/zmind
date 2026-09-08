BEGIN;

-- Enable pg_trgm for trigram search (safe if already installed)
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Add archived flags to canvases (default hidden from search)
ALTER TABLE IF EXISTS public.canvases
  ADD COLUMN IF NOT EXISTS is_archived boolean NOT NULL DEFAULT false;
ALTER TABLE IF EXISTS public.canvases
  ADD COLUMN IF NOT EXISTS archived_at timestamptz NULL;

CREATE INDEX IF NOT EXISTS idx_canvases_archived
  ON public.canvases(is_archived, archived_at);

-- Node-level search index
CREATE TABLE IF NOT EXISTS public.canvas_node_search (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES basejump.accounts(id) ON DELETE CASCADE,
  canvas_id text NOT NULL REFERENCES public.canvases(id) ON DELETE CASCADE,
  node_id text NOT NULL,
  node_type text NOT NULL,
  node_subtype text NULL,
  title_text text NULL,
  search_text text NOT NULL,
  search_text_tsv tsvector GENERATED ALWAYS AS (
    to_tsvector('simple', COALESCE(search_text, ''))
  ) STORED,
  preview_text text NULL,
  folder_id text NULL,
  canvas_title text NULL,
  node_x double precision NULL,
  node_y double precision NULL,
  node_width double precision NULL,
  node_height double precision NULL,
  node_updated_at timestamptz NULL,
  source_hash text NULL,
  is_active boolean NOT NULL DEFAULT true,
  indexed_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_canvas_node_search_canvas_node
  ON public.canvas_node_search(canvas_id, node_id);

CREATE INDEX IF NOT EXISTS idx_canvas_node_search_account_updated
  ON public.canvas_node_search(account_id, node_updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_canvas_node_search_account_canvas
  ON public.canvas_node_search(account_id, canvas_id);

CREATE INDEX IF NOT EXISTS idx_canvas_node_search_folder
  ON public.canvas_node_search(account_id, folder_id);

CREATE INDEX IF NOT EXISTS idx_canvas_node_search_tsv
  ON public.canvas_node_search USING gin(search_text_tsv);

CREATE INDEX IF NOT EXISTS idx_canvas_node_search_trgm
  ON public.canvas_node_search USING gin(search_text gin_trgm_ops);

-- RLS
ALTER TABLE public.canvas_node_search ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'canvas_node_search'
      AND policyname = 'canvas_node_search_workspace_access'
  ) THEN
    CREATE POLICY canvas_node_search_workspace_access
      ON public.canvas_node_search
      FOR ALL
      USING (basejump.has_role_on_account(account_id) = true)
      WITH CHECK (basejump.has_role_on_account(account_id) = true);
  END IF;
END
$$;

-- Search RPC
CREATE OR REPLACE FUNCTION public.search_canvas_nodes(
  p_account_id uuid,
  p_query text,
  p_limit integer DEFAULT 20,
  p_offset integer DEFAULT 0,
  p_scope text DEFAULT 'workspace',
  p_canvas_ids text[] DEFAULT NULL,
  p_node_types text[] DEFAULT NULL,
  p_folder_ids text[] DEFAULT NULL,
  p_include_archived boolean DEFAULT false
)
RETURNS TABLE (
  canvas_id text,
  canvas_title text,
  folder_id text,
  node_id text,
  node_type text,
  node_subtype text,
  title_text text,
  search_text text,
  preview_text text,
  node_x double precision,
  node_y double precision,
  node_width double precision,
  node_height double precision,
  node_updated_at timestamptz,
  score double precision
)
LANGUAGE plpgsql
AS $$
BEGIN
  IF p_query IS NULL OR length(trim(p_query)) = 0 THEN
    RETURN QUERY
    SELECT
      s.canvas_id,
      s.canvas_title,
      s.folder_id,
      s.node_id,
      s.node_type,
      s.node_subtype,
      s.title_text,
      s.search_text,
      s.preview_text,
      s.node_x,
      s.node_y,
      s.node_width,
      s.node_height,
      s.node_updated_at,
      0.0 AS score
    FROM public.canvas_node_search s
    JOIN public.canvases c ON c.id = s.canvas_id
    WHERE s.account_id = p_account_id
      AND s.is_active = true
      AND c.is_deleted = false
      AND (p_include_archived OR c.is_archived = false)
      AND (
        p_scope <> 'canvas'
        OR (p_canvas_ids IS NOT NULL AND s.canvas_id = ANY(p_canvas_ids))
      )
      AND (p_node_types IS NULL OR s.node_type = ANY(p_node_types))
      AND (p_folder_ids IS NULL OR s.folder_id = ANY(p_folder_ids))
    ORDER BY s.node_updated_at DESC NULLS LAST, s.node_id ASC
    OFFSET GREATEST(p_offset, 0)
    LIMIT LEAST(GREATEST(p_limit, 1), 50);
    RETURN;
  END IF;

  RETURN QUERY
  WITH input AS (
    SELECT trim(p_query) AS q,
           websearch_to_tsquery('simple', trim(p_query)) AS tsq
  ),
  base AS (
    SELECT s.*
    FROM public.canvas_node_search s
    JOIN public.canvases c ON c.id = s.canvas_id
    WHERE s.account_id = p_account_id
      AND s.is_active = true
      AND c.is_deleted = false
      AND (p_include_archived OR c.is_archived = false)
      AND (
        p_scope <> 'canvas'
        OR (p_canvas_ids IS NOT NULL AND s.canvas_id = ANY(p_canvas_ids))
      )
      AND (p_node_types IS NULL OR s.node_type = ANY(p_node_types))
      AND (p_folder_ids IS NULL OR s.folder_id = ANY(p_folder_ids))
  ),
  ranked AS (
    SELECT
      b.*,
      ts_rank_cd(b.search_text_tsv, input.tsq) AS rank_tsv,
      similarity(b.search_text, input.q) AS rank_trgm,
      CASE WHEN b.title_text ILIKE '%' || input.q || '%' THEN 0.2 ELSE 0 END AS title_boost
    FROM base b, input
    WHERE
      (b.search_text_tsv @@ input.tsq)
      OR (b.search_text % input.q)
      OR (b.search_text ILIKE '%' || input.q || '%')
  )
  SELECT
    canvas_id,
    canvas_title,
    folder_id,
    node_id,
    node_type,
    node_subtype,
    title_text,
    search_text,
    preview_text,
    node_x,
    node_y,
    node_width,
    node_height,
    node_updated_at,
    (rank_tsv * 0.6 + rank_trgm * 0.3 + title_boost) AS score
  FROM ranked
  ORDER BY score DESC, node_updated_at DESC NULLS LAST, node_id ASC
  OFFSET GREATEST(p_offset, 0)
  LIMIT LEAST(GREATEST(p_limit, 1), 50);
END;
$$;

GRANT EXECUTE ON FUNCTION public.search_canvas_nodes(uuid, text, integer, integer, text, text[], text[], text[], boolean)
  TO authenticated, service_role;

COMMIT;
