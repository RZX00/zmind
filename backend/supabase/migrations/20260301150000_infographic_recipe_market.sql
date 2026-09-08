BEGIN;

CREATE TABLE IF NOT EXISTS public.infographic_recipes (
    recipe_id TEXT PRIMARY KEY,
    scope_type TEXT NOT NULL CHECK (scope_type IN ('system', 'workspace', 'user')),
    visibility TEXT NOT NULL CHECK (visibility IN ('official', 'workspace_private')),
    account_id TEXT NULL,
    owner_user_id TEXT NULL,
    slug TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT NULL,
    locale TEXT NOT NULL DEFAULT 'multi',
    tags JSONB NOT NULL DEFAULT '[]'::jsonb,
    cover_url TEXT NULL,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled', 'archived')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_infographic_recipes_scope
    ON public.infographic_recipes(scope_type);

CREATE INDEX IF NOT EXISTS idx_infographic_recipes_workspace
    ON public.infographic_recipes(account_id, status);

CREATE INDEX IF NOT EXISTS idx_infographic_recipes_visibility
    ON public.infographic_recipes(visibility, status);

CREATE UNIQUE INDEX IF NOT EXISTS ux_infographic_recipes_system_slug
    ON public.infographic_recipes(slug)
    WHERE scope_type = 'system';

CREATE UNIQUE INDEX IF NOT EXISTS ux_infographic_recipes_workspace_slug
    ON public.infographic_recipes(account_id, slug)
    WHERE scope_type = 'workspace';

CREATE UNIQUE INDEX IF NOT EXISTS ux_infographic_recipes_user_slug
    ON public.infographic_recipes(account_id, owner_user_id, slug)
    WHERE scope_type = 'user';

CREATE TABLE IF NOT EXISTS public.infographic_recipe_versions (
    version_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    recipe_id TEXT NOT NULL REFERENCES public.infographic_recipes(recipe_id) ON DELETE CASCADE,
    version INTEGER NOT NULL CHECK (version > 0),
    prompt_template TEXT NOT NULL,
    style_manifest JSONB NOT NULL DEFAULT '{}'::jsonb,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    is_published BOOLEAN NOT NULL DEFAULT TRUE,
    created_by TEXT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_infographic_recipe_versions_recipe_version
    ON public.infographic_recipe_versions(recipe_id, version);

CREATE INDEX IF NOT EXISTS idx_infographic_recipe_versions_latest
    ON public.infographic_recipe_versions(recipe_id, is_published, version DESC);

CREATE TABLE IF NOT EXISTS public.infographic_preferences (
    preference_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id TEXT NOT NULL,
    user_id TEXT NULL,
    default_recipe_id TEXT NULL REFERENCES public.infographic_recipes(recipe_id) ON DELETE SET NULL,
    default_custom_prompt TEXT NULL,
    default_merge_mode TEXT NOT NULL DEFAULT 'append' CHECK (default_merge_mode IN ('append', 'prepend', 'replace')),
    default_style_lock TEXT NOT NULL DEFAULT 'soft' CHECK (default_style_lock IN ('off', 'soft', 'strict')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_infographic_preferences_user_scope
    ON public.infographic_preferences(account_id, user_id)
    WHERE user_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS ux_infographic_preferences_workspace_scope
    ON public.infographic_preferences(account_id)
    WHERE user_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_infographic_preferences_lookup
    ON public.infographic_preferences(account_id, user_id);

CREATE TABLE IF NOT EXISTS public.infographic_market_listings (
    listing_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    recipe_id TEXT NOT NULL REFERENCES public.infographic_recipes(recipe_id) ON DELETE CASCADE,
    listing_type TEXT NOT NULL CHECK (listing_type IN ('official', 'workspace_private')),
    account_id TEXT NULL,
    badge TEXT NULL,
    rank INTEGER NOT NULL DEFAULT 1000,
    featured BOOLEAN NOT NULL DEFAULT FALSE,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_infographic_market_official
    ON public.infographic_market_listings(recipe_id, listing_type)
    WHERE account_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS ux_infographic_market_workspace
    ON public.infographic_market_listings(recipe_id, listing_type, account_id)
    WHERE account_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_infographic_market_query
    ON public.infographic_market_listings(listing_type, account_id, is_active, rank);

CREATE TABLE IF NOT EXISTS public.infographic_generations (
    generation_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    canvas_id TEXT NOT NULL,
    account_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    recipe_id TEXT NULL REFERENCES public.infographic_recipes(recipe_id) ON DELETE SET NULL,
    recipe_version INTEGER NULL,
    merge_mode TEXT NOT NULL CHECK (merge_mode IN ('append', 'prepend', 'replace')),
    style_lock TEXT NOT NULL CHECK (style_lock IN ('off', 'soft', 'strict')),
    fingerprint TEXT NOT NULL,
    selection_hash TEXT NULL,
    custom_prompt TEXT NULL,
    llm_model TEXT NOT NULL,
    image_model TEXT NOT NULL,
    aspect_ratio TEXT NOT NULL,
    image_prompt TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'succeeded' CHECK (status IN ('succeeded', 'failed')),
    error_message TEXT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_infographic_generations_account_created
    ON public.infographic_generations(account_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_infographic_generations_canvas_created
    ON public.infographic_generations(canvas_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_infographic_generations_fingerprint
    ON public.infographic_generations(fingerprint);

ALTER TABLE public.infographic_recipes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.infographic_recipe_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.infographic_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.infographic_market_listings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.infographic_generations ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'infographic_recipes'
          AND policyname = 'service_role_all_infographic_recipes'
    ) THEN
        CREATE POLICY "service_role_all_infographic_recipes"
            ON public.infographic_recipes
            FOR ALL
            TO service_role
            USING (true)
            WITH CHECK (true);
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'infographic_recipe_versions'
          AND policyname = 'service_role_all_infographic_recipe_versions'
    ) THEN
        CREATE POLICY "service_role_all_infographic_recipe_versions"
            ON public.infographic_recipe_versions
            FOR ALL
            TO service_role
            USING (true)
            WITH CHECK (true);
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'infographic_preferences'
          AND policyname = 'service_role_all_infographic_preferences'
    ) THEN
        CREATE POLICY "service_role_all_infographic_preferences"
            ON public.infographic_preferences
            FOR ALL
            TO service_role
            USING (true)
            WITH CHECK (true);
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'infographic_market_listings'
          AND policyname = 'service_role_all_infographic_market_listings'
    ) THEN
        CREATE POLICY "service_role_all_infographic_market_listings"
            ON public.infographic_market_listings
            FOR ALL
            TO service_role
            USING (true)
            WITH CHECK (true);
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'infographic_generations'
          AND policyname = 'service_role_all_infographic_generations'
    ) THEN
        CREATE POLICY "service_role_all_infographic_generations"
            ON public.infographic_generations
            FOR ALL
            TO service_role
            USING (true)
            WITH CHECK (true);
    END IF;
END $$;

INSERT INTO public.infographic_recipes (
    recipe_id,
    scope_type,
    visibility,
    account_id,
    owner_user_id,
    slug,
    name,
    description,
    locale,
    tags,
    cover_url,
    status
)
VALUES
    (
        'sys.editorial_balanced',
        'system',
        'official',
        NULL,
        NULL,
        'editorial-balanced',
        'Editorial Balanced',
        'Balanced editorial infographic with warm neutral background and vivid concept illustrations.',
        'multi',
        '["official", "balanced", "editorial"]'::jsonb,
        NULL,
        'active'
    ),
    (
        'sys.blueprint_precision',
        'system',
        'official',
        NULL,
        NULL,
        'blueprint-precision',
        'Blueprint Precision',
        'Structured blueprint style suitable for technical systems and process decomposition.',
        'multi',
        '["official", "technical", "blueprint"]'::jsonb,
        NULL,
        'active'
    ),
    (
        'sys.timeline_story',
        'system',
        'official',
        NULL,
        NULL,
        'timeline-story',
        'Timeline Story',
        'Narrative timeline style for chronological progression and milestone communication.',
        'multi',
        '["official", "timeline", "storytelling"]'::jsonb,
        NULL,
        'active'
    ),
    (
        'sys.concept_constellation',
        'system',
        'official',
        NULL,
        NULL,
        'concept-constellation',
        'Concept Constellation',
        'Concept map style for complex relationship networks with clear semantic grouping.',
        'multi',
        '["official", "concept-map", "relationships"]'::jsonb,
        NULL,
        'active'
    )
ON CONFLICT (recipe_id) DO UPDATE SET
    scope_type = EXCLUDED.scope_type,
    visibility = EXCLUDED.visibility,
    slug = EXCLUDED.slug,
    name = EXCLUDED.name,
    description = EXCLUDED.description,
    locale = EXCLUDED.locale,
    tags = EXCLUDED.tags,
    cover_url = EXCLUDED.cover_url,
    status = EXCLUDED.status,
    updated_at = NOW();

INSERT INTO public.infographic_recipe_versions (
    recipe_id,
    version,
    prompt_template,
    style_manifest,
    metadata,
    is_published,
    created_by
)
VALUES
    (
        'sys.editorial_balanced',
        1,
        $$Keep a polished editorial information design language. Use warm white background, moderate visual density, clear hierarchy, and vivid illustrative accents that remain professional and readable. Emphasize semantic grouping with subtle containers and deliberate whitespace. Typography should feel contemporary and calm.$$,
        '{"palette": ["#F7F4EE", "#1F3A5F", "#2F6B88", "#F28C45"], "line_style": "soft_curved", "illustration_density": "medium"}'::jsonb,
        '{"seed": "official-v1", "recommended_for": ["general", "strategy", "education"]}'::jsonb,
        TRUE,
        'system'
    ),
    (
        'sys.blueprint_precision',
        1,
        $$Use a technical blueprint visual style with precise grid rhythm, high contrast annotations, and disciplined spacing. Keep diagrams explicit and operational: label transitions clearly, emphasize system boundaries, and use restrained iconography with engineering clarity.$$,
        '{"palette": ["#F5F8FC", "#12355B", "#2A628F", "#27AE60"], "line_style": "orthogonal", "illustration_density": "low"}'::jsonb,
        '{"seed": "official-v1", "recommended_for": ["engineering", "architecture", "process"]}'::jsonb,
        TRUE,
        'system'
    ),
    (
        'sys.timeline_story',
        1,
        $$Render the content as a narrative timeline with emotionally legible milestones. Use sequential pacing, temporal anchors, and visual motifs that show cause and effect across phases. Maintain readability first while preserving a story-forward flow.$$,
        '{"palette": ["#FFF8F1", "#6B3E26", "#D96C3A", "#3C8DAD"], "line_style": "flowing", "illustration_density": "medium"}'::jsonb,
        '{"seed": "official-v1", "recommended_for": ["roadmap", "history", "transformation"]}'::jsonb,
        TRUE,
        'system'
    ),
    (
        'sys.concept_constellation',
        1,
        $$Compose a concept constellation map with a strong central thesis and orbiting supporting ideas. Highlight non-linear relationships using directional visual cues and clustered semantic zones. Keep each cluster visually distinct without sacrificing global coherence.$$,
        '{"palette": ["#F8F9FB", "#2B2D42", "#4E5D94", "#F4A261"], "line_style": "hybrid", "illustration_density": "medium"}'::jsonb,
        '{"seed": "official-v1", "recommended_for": ["conceptual", "systems-thinking", "research"]}'::jsonb,
        TRUE,
        'system'
    )
ON CONFLICT (recipe_id, version) DO UPDATE SET
    prompt_template = EXCLUDED.prompt_template,
    style_manifest = EXCLUDED.style_manifest,
    metadata = EXCLUDED.metadata,
    is_published = EXCLUDED.is_published,
    created_by = EXCLUDED.created_by;

INSERT INTO public.infographic_market_listings (
    recipe_id,
    listing_type,
    account_id,
    badge,
    rank,
    featured,
    is_active
)
VALUES
    ('sys.editorial_balanced', 'official', NULL, 'Recommended', 10, TRUE, TRUE),
    ('sys.blueprint_precision', 'official', NULL, 'Technical', 20, FALSE, TRUE),
    ('sys.timeline_story', 'official', NULL, 'Story', 30, FALSE, TRUE),
    ('sys.concept_constellation', 'official', NULL, 'Concept Map', 40, FALSE, TRUE)
ON CONFLICT (recipe_id, listing_type) WHERE account_id IS NULL DO UPDATE SET
    badge = EXCLUDED.badge,
    rank = EXCLUDED.rank,
    featured = EXCLUDED.featured,
    is_active = EXCLUDED.is_active,
    updated_at = NOW();

COMMIT;
