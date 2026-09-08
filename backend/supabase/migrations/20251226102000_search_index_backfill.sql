BEGIN;

ALTER TABLE IF EXISTS public.canvases
  ADD COLUMN IF NOT EXISTS search_indexed_at timestamptz NULL;

CREATE INDEX IF NOT EXISTS idx_canvases_search_indexed_at
  ON public.canvases(search_indexed_at);

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
      0.0::double precision AS score
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
    ranked.canvas_id,
    ranked.canvas_title,
    ranked.folder_id,
    ranked.node_id,
    ranked.node_type,
    ranked.node_subtype,
    ranked.title_text,
    ranked.search_text,
    ranked.preview_text,
    ranked.node_x,
    ranked.node_y,
    ranked.node_width,
    ranked.node_height,
    ranked.node_updated_at,
    (
      ranked.rank_tsv * 0.6::double precision
      + ranked.rank_trgm * 0.3::double precision
      + ranked.title_boost::double precision
    ) AS score
  FROM ranked
  ORDER BY (
      ranked.rank_tsv * 0.6::double precision
      + ranked.rank_trgm * 0.3::double precision
      + ranked.title_boost::double precision
    ) DESC,
    ranked.node_updated_at DESC NULLS LAST,
    ranked.node_id ASC
  OFFSET GREATEST(p_offset, 0)
  LIMIT LEAST(GREATEST(p_limit, 1), 50);
END;
$$;

COMMIT;
