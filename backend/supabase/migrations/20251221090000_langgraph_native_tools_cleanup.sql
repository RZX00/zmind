BEGIN;

-- ---------------------------------------------------------------------------
-- Ensure config columns exist (backfill from legacy columns when needed)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION column_exists(p_table_name text, p_column_name text)
RETURNS boolean AS $$
BEGIN
    RETURN EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = p_table_name
          AND column_name = p_column_name
    );
END;
$$ LANGUAGE plpgsql;

DO $$
BEGIN
    IF NOT column_exists('agents', 'config') THEN
        ALTER TABLE agents ADD COLUMN config JSONB DEFAULT '{}'::jsonb;
    END IF;

    IF NOT column_exists('agent_versions', 'config') THEN
        ALTER TABLE agent_versions ADD COLUMN config JSONB DEFAULT '{}'::jsonb;
    END IF;

    IF NOT column_exists('agent_templates', 'config') THEN
        ALTER TABLE agent_templates ADD COLUMN config JSONB DEFAULT '{}'::jsonb;
    END IF;
END $$;

DO $$
DECLARE
    agent_configured_mcps_expr TEXT;
    agent_custom_mcps_expr TEXT;
    agent_avatar_expr TEXT;
    agent_avatar_color_expr TEXT;
BEGIN
    IF column_exists('agents', 'system_prompt') AND column_exists('agents', 'agentpress_tools') THEN
        agent_configured_mcps_expr := CASE
            WHEN column_exists('agents', 'configured_mcps') THEN 'COALESCE(configured_mcps, ''[]''::jsonb)'
            ELSE '''[]''::jsonb'
        END;
        agent_custom_mcps_expr := CASE
            WHEN column_exists('agents', 'custom_mcps') THEN 'COALESCE(custom_mcps, ''[]''::jsonb)'
            ELSE '''[]''::jsonb'
        END;
        agent_avatar_expr := CASE
            WHEN column_exists('agents', 'avatar') THEN 'avatar'
            ELSE 'NULL'
        END;
        agent_avatar_color_expr := CASE
            WHEN column_exists('agents', 'avatar_color') THEN 'avatar_color'
            ELSE 'NULL'
        END;

        EXECUTE format(
            'UPDATE agents SET config = jsonb_build_object(
                ''system_prompt'', COALESCE(system_prompt, ''''),
                ''tools'', jsonb_build_object(
                    ''native'', (
                        SELECT jsonb_object_agg(
                            key,
                            CASE
                                WHEN value IS NULL OR value = ''null''::jsonb THEN ''false''::jsonb
                                WHEN jsonb_typeof(value) = ''boolean'' THEN value
                                WHEN jsonb_typeof(value) = ''object'' AND value ? ''enabled'' THEN value->''enabled''
                                ELSE ''false''::jsonb
                            END
                        )
                        FROM jsonb_each(COALESCE(agentpress_tools, ''{}''::jsonb))
                    ),
                    ''mcp'', %s,
                    ''custom_mcp'', %s
                ),
                ''metadata'', jsonb_build_object(
                    ''avatar'', %s,
                    ''avatar_color'', %s
                )
            )
            WHERE config IS NULL OR config = ''{}''::jsonb',
            agent_configured_mcps_expr,
            agent_custom_mcps_expr,
            agent_avatar_expr,
            agent_avatar_color_expr
        );
    END IF;
END $$;

DO $$
DECLARE
    version_configured_mcps_expr TEXT;
    version_custom_mcps_expr TEXT;
BEGIN
    IF column_exists('agent_versions', 'system_prompt') AND column_exists('agent_versions', 'agentpress_tools') THEN
        version_configured_mcps_expr := CASE
            WHEN column_exists('agent_versions', 'configured_mcps') THEN 'COALESCE(configured_mcps, ''[]''::jsonb)'
            ELSE '''[]''::jsonb'
        END;
        version_custom_mcps_expr := CASE
            WHEN column_exists('agent_versions', 'custom_mcps') THEN 'COALESCE(custom_mcps, ''[]''::jsonb)'
            ELSE '''[]''::jsonb'
        END;

        EXECUTE format(
            'UPDATE agent_versions SET config = jsonb_build_object(
                ''system_prompt'', COALESCE(system_prompt, ''''),
                ''tools'', jsonb_build_object(
                    ''native'', (
                        SELECT jsonb_object_agg(
                            key,
                            CASE
                                WHEN value IS NULL OR value = ''null''::jsonb THEN ''false''::jsonb
                                WHEN jsonb_typeof(value) = ''boolean'' THEN value
                                WHEN jsonb_typeof(value) = ''object'' AND value ? ''enabled'' THEN value->''enabled''
                                ELSE ''false''::jsonb
                            END
                        )
                        FROM jsonb_each(COALESCE(agentpress_tools, ''{}''::jsonb))
                    ),
                    ''mcp'', %s,
                    ''custom_mcp'', %s
                )
            )
            WHERE config IS NULL OR config = ''{}''::jsonb',
            version_configured_mcps_expr,
            version_custom_mcps_expr
        );
    END IF;
END $$;

DO $$
DECLARE
    template_mcp_requirements_expr TEXT;
BEGIN
    IF column_exists('agent_templates', 'system_prompt') AND column_exists('agent_templates', 'agentpress_tools') THEN
        template_mcp_requirements_expr := CASE
            WHEN column_exists('agent_templates', 'mcp_requirements') THEN 'COALESCE(mcp_requirements, ''[]''::jsonb)'
            ELSE '''[]''::jsonb'
        END;

        EXECUTE format(
            'UPDATE agent_templates SET config = jsonb_build_object(
                ''system_prompt'', COALESCE(system_prompt, ''''),
                ''tools'', jsonb_build_object(
                    ''native'', (
                        SELECT jsonb_object_agg(
                            key,
                            CASE
                                WHEN value IS NULL OR value = ''null''::jsonb THEN ''false''::jsonb
                                WHEN jsonb_typeof(value) = ''boolean'' THEN value
                                WHEN jsonb_typeof(value) = ''object'' AND value ? ''enabled'' THEN value->''enabled''
                                ELSE ''false''::jsonb
                            END
                        )
                        FROM jsonb_each(COALESCE(agentpress_tools, ''{}''::jsonb))
                    ),
                    ''mcp'', ''[]''::jsonb,
                    ''custom_mcp'', %s
                ),
                ''metadata'', jsonb_build_object(
                    ''avatar'', avatar,
                    ''avatar_color'', avatar_color
                )
            )
            WHERE config IS NULL OR config = ''{}''::jsonb',
            template_mcp_requirements_expr
        );
    END IF;
END $$;

-- ---------------------------------------------------------------------------
-- Normalize config.tools key to native (drop legacy agentpress key)
-- ---------------------------------------------------------------------------

UPDATE agents
SET config = jsonb_set(
    config,
    '{tools}',
    ((config->'tools')::jsonb - 'agentpress'::text) || jsonb_build_object(
        'native',
        COALESCE(config->'tools'->'native', config->'tools'->'agentpress', '{}'::jsonb)
    )
)
WHERE config ? 'tools' AND config->'tools' ? 'agentpress';

UPDATE agent_versions
SET config = jsonb_set(
    config,
    '{tools}',
    ((config->'tools')::jsonb - 'agentpress'::text) || jsonb_build_object(
        'native',
        COALESCE(config->'tools'->'native', config->'tools'->'agentpress', '{}'::jsonb)
    )
)
WHERE config ? 'tools' AND config->'tools' ? 'agentpress';

UPDATE agent_templates
SET config = jsonb_set(
    config,
    '{tools}',
    ((config->'tools')::jsonb - 'agentpress'::text) || jsonb_build_object(
        'native',
        COALESCE(config->'tools'->'native', config->'tools'->'agentpress', '{}'::jsonb)
    )
)
WHERE config ? 'tools' AND config->'tools' ? 'agentpress';

-- ---------------------------------------------------------------------------
-- Drop legacy columns that are no longer used
-- ---------------------------------------------------------------------------

ALTER TABLE agents DROP COLUMN IF EXISTS agentpress_tools;
ALTER TABLE agent_versions DROP COLUMN IF EXISTS agentpress_tools;
ALTER TABLE agent_templates DROP COLUMN IF EXISTS agentpress_tools;

-- ---------------------------------------------------------------------------
-- Template constraints/indexes aligned with native tools
-- ---------------------------------------------------------------------------

ALTER TABLE agent_templates DROP CONSTRAINT IF EXISTS agent_templates_tools_structure_check;
ALTER TABLE agent_templates ADD CONSTRAINT agent_templates_tools_structure_check
CHECK (
    config->'tools' ? 'native' AND
    config->'tools' ? 'mcp' AND
    config->'tools' ? 'custom_mcp'
);

DROP INDEX IF EXISTS idx_agent_templates_config_agentpress;
CREATE INDEX IF NOT EXISTS idx_agent_templates_config_native
    ON agent_templates USING gin((config->'tools'->'native'));

-- ---------------------------------------------------------------------------
-- Sanitize template config with native tools
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION sanitize_config_for_template(input_config JSONB)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
    sanitized_config JSONB;
    custom_mcp_array JSONB;
    custom_mcp_item JSONB;
    sanitized_mcp JSONB;
    result_array JSONB := '[]'::jsonb;
    native_tools JSONB := '{}'::jsonb;
    tool_name TEXT;
    tool_config JSONB;
BEGIN
    IF input_config->'tools'->'native' IS NOT NULL THEN
        FOR tool_name IN SELECT jsonb_object_keys(input_config->'tools'->'native')
        LOOP
            tool_config := input_config->'tools'->'native'->tool_name;

            IF jsonb_typeof(tool_config) = 'boolean' THEN
                native_tools := jsonb_set(native_tools, ARRAY[tool_name], tool_config);
            ELSIF jsonb_typeof(tool_config) = 'object' AND tool_config ? 'enabled' THEN
                native_tools := jsonb_set(native_tools, ARRAY[tool_name], tool_config->'enabled');
            ELSE
                native_tools := jsonb_set(native_tools, ARRAY[tool_name], 'false'::jsonb);
            END IF;
        END LOOP;
    END IF;

    sanitized_config := jsonb_build_object(
        'system_prompt', COALESCE(input_config->>'system_prompt', ''),
        'tools', jsonb_build_object(
            'native', native_tools,
            'mcp', COALESCE(input_config->'tools'->'mcp', '[]'::jsonb),
            'custom_mcp', '[]'::jsonb
        ),
        'metadata', jsonb_build_object(
            'avatar', input_config->'metadata'->>'avatar',
            'avatar_color', input_config->'metadata'->>'avatar_color'
        )
    );

    custom_mcp_array := COALESCE(input_config->'tools'->'custom_mcp', '[]'::jsonb);

    FOR custom_mcp_item IN SELECT jsonb_array_elements(custom_mcp_array)
    LOOP
        sanitized_mcp := jsonb_build_object(
            'name', custom_mcp_item->>'name',
            'type', custom_mcp_item->>'type',
            'display_name', COALESCE(custom_mcp_item->>'display_name', custom_mcp_item->>'name'),
            'enabledTools', COALESCE(custom_mcp_item->'enabledTools', '[]'::jsonb)
        );

        IF custom_mcp_item->>'type' = 'pipedream' THEN
            sanitized_mcp := jsonb_set(
                sanitized_mcp,
                '{config}',
                jsonb_build_object(
                    'url', custom_mcp_item->'config'->>'url',
                    'headers', COALESCE(custom_mcp_item->'config'->'headers', '{}'::jsonb) - 'profile_id'
                )
            );
        ELSE
            sanitized_mcp := jsonb_set(sanitized_mcp, '{config}', '{}'::jsonb);
        END IF;

        result_array := result_array || sanitized_mcp;
    END LOOP;

    sanitized_config := jsonb_set(
        sanitized_config,
        '{tools,custom_mcp}',
        result_array
    );

    RETURN sanitized_config;
END;
$$;

-- ---------------------------------------------------------------------------
-- Template helper functions (config-based)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION create_template_from_agent(
    p_agent_id UUID,
    p_creator_id UUID
)
RETURNS UUID
SECURITY DEFINER
LANGUAGE plpgsql
AS $$
DECLARE
    v_template_id UUID;
    v_agent agents%ROWTYPE;
    v_mcp_requirements JSONB := '[]'::jsonb;
    v_mcp_config JSONB;
    v_agent_config JSONB;
    v_agent_tools JSONB;
    v_mcp_list JSONB;
    v_native_tools JSONB;
    v_system_prompt TEXT;
    v_agent_metadata JSONB;
BEGIN
    SELECT * INTO v_agent FROM agents WHERE agent_id = p_agent_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Agent not found';
    END IF;

    IF NOT basejump.has_role_on_account(v_agent.account_id, 'owner') THEN
        RAISE EXCEPTION 'Access denied';
    END IF;

    v_agent_config := COALESCE(v_agent.config, '{}'::jsonb);
    v_agent_tools := COALESCE(v_agent_config->'tools', '{}'::jsonb);
    v_mcp_list := COALESCE(v_agent_tools->'mcp', '[]'::jsonb);
    v_native_tools := COALESCE(v_agent_tools->'native', '{}'::jsonb);
    v_system_prompt := COALESCE(v_agent_config->>'system_prompt', '');
    v_agent_metadata := COALESCE(v_agent_config->'metadata', '{}'::jsonb);

    FOR v_mcp_config IN SELECT * FROM jsonb_array_elements(v_mcp_list)
    LOOP
        v_mcp_requirements := v_mcp_requirements || jsonb_build_object(
            'qualifiedName', v_mcp_config->>'qualifiedName',
            'name', v_mcp_config->>'name',
            'enabledTools', v_mcp_config->'enabledTools',
            'requiredConfig', (
                SELECT jsonb_agg(key)
                FROM jsonb_object_keys(v_mcp_config->'config') AS key
            )
        );
    END LOOP;

    INSERT INTO agent_templates (
        creator_id,
        name,
        description,
        config,
        tags,
        icon_name,
        icon_color,
        icon_background,
        avatar,
        avatar_color,
        metadata
    ) VALUES (
        p_creator_id,
        v_agent.name,
        v_agent.description,
        jsonb_build_object(
            'system_prompt', v_system_prompt,
            'tools', jsonb_build_object(
                'native', v_native_tools,
                'mcp', '[]'::jsonb,
                'custom_mcp', v_mcp_requirements
            ),
            'metadata', jsonb_build_object(
                'avatar', v_agent_metadata->>'avatar',
                'avatar_color', v_agent_metadata->>'avatar_color'
            )
        ),
        v_agent.tags,
        v_agent.icon_name,
        v_agent.icon_color,
        v_agent.icon_background,
        v_agent_metadata->>'avatar',
        v_agent_metadata->>'avatar_color',
        COALESCE(v_agent.metadata, '{}'::jsonb)
    ) RETURNING template_id INTO v_template_id;

    RETURN v_template_id;
END;
$$;

CREATE OR REPLACE FUNCTION install_template_as_instance(
    p_template_id UUID,
    p_account_id UUID,
    p_instance_name VARCHAR(255) DEFAULT NULL
)
RETURNS UUID
SECURITY DEFINER
LANGUAGE plpgsql
AS $$
DECLARE
    v_instance_id UUID;
    v_template agent_templates%ROWTYPE;
    v_instance_name VARCHAR(255);
    v_credential_mappings JSONB := '{}'::jsonb;
    v_mcp_req JSONB;
    v_credential_id UUID;
    v_template_tools JSONB;
    v_mcp_requirements JSONB;
BEGIN
    SELECT * INTO v_template FROM agent_templates WHERE template_id = p_template_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Template not found';
    END IF;

    IF NOT (v_template.is_public OR basejump.has_role_on_account(v_template.creator_id)) THEN
        RAISE EXCEPTION 'Access denied to template';
    END IF;

    v_instance_name := COALESCE(p_instance_name, v_template.name || ' (from marketplace)');
    v_template_tools := COALESCE(v_template.config->'tools', '{}'::jsonb);
    v_mcp_requirements := COALESCE(
        v_template_tools->'custom_mcp',
        v_template_tools->'mcp',
        '[]'::jsonb
    );

    FOR v_mcp_req IN SELECT * FROM jsonb_array_elements(v_mcp_requirements)
    LOOP
        SELECT credential_id INTO v_credential_id
        FROM user_mcp_credentials
        WHERE account_id = p_account_id
          AND mcp_qualified_name = (v_mcp_req->>'qualifiedName')
          AND is_active = true;

        IF v_credential_id IS NOT NULL THEN
            v_credential_mappings := v_credential_mappings ||
                jsonb_build_object(v_mcp_req->>'qualifiedName', v_credential_id);
        END IF;
    END LOOP;

    INSERT INTO agent_instances (
        template_id,
        account_id,
        name,
        description,
        credential_mappings,
        avatar,
        avatar_color
    ) VALUES (
        p_template_id,
        p_account_id,
        v_instance_name,
        v_template.description,
        v_credential_mappings,
        v_template.avatar,
        v_template.avatar_color
    ) RETURNING instance_id INTO v_instance_id;

    UPDATE agent_templates
    SET download_count = download_count + 1
    WHERE template_id = p_template_id;

    RETURN v_instance_id;
END;
$$;

CREATE OR REPLACE FUNCTION get_missing_credentials_for_template(
    p_template_id UUID,
    p_account_id UUID
)
RETURNS TABLE (
    qualified_name VARCHAR(255),
    display_name VARCHAR(255),
    required_config TEXT[]
)
SECURITY DEFINER
LANGUAGE plpgsql
AS $$
BEGIN
    RETURN QUERY
    SELECT
        (mcp_req->>'qualifiedName')::VARCHAR(255) as qualified_name,
        (mcp_req->>'name')::VARCHAR(255) as display_name,
        ARRAY(SELECT jsonb_array_elements_text(mcp_req->'requiredConfig')) as required_config
    FROM agent_templates t,
         jsonb_array_elements(
             COALESCE(
                 t.config->'tools'->'custom_mcp',
                 t.config->'tools'->'mcp',
                 '[]'::jsonb
             )
         ) as mcp_req
    WHERE t.template_id = p_template_id
      AND NOT EXISTS (
        SELECT 1 FROM user_mcp_credentials c
        WHERE c.account_id = p_account_id
          AND c.mcp_qualified_name = (mcp_req->>'qualifiedName')
          AND c.is_active = true
    );
END;
$$;

-- ---------------------------------------------------------------------------
-- Default agent helper functions (native tools + config source of truth)
-- ---------------------------------------------------------------------------

DROP FUNCTION IF EXISTS find_zmind_default_agent_for_account(UUID);
CREATE FUNCTION find_zmind_default_agent_for_account(p_account_id UUID)
RETURNS TABLE (
    agent_id UUID,
    account_id UUID,
    name VARCHAR(255),
    description TEXT,
    system_prompt TEXT,
    configured_mcps JSONB,
    custom_mcps JSONB,
    native_tools JSONB,
    is_default BOOLEAN,
    avatar VARCHAR(10),
    avatar_color VARCHAR(7),
    metadata JSONB,
    created_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ,
    is_active BOOLEAN,
    is_public BOOLEAN,
    marketplace_published_at TIMESTAMPTZ,
    download_count INTEGER,
    tags TEXT[],
    current_version_id UUID,
    version_count INTEGER
)
SECURITY DEFINER
LANGUAGE plpgsql
AS $$
BEGIN
    RETURN QUERY
    SELECT
        a.agent_id,
        a.account_id,
        a.name,
        a.description,
        COALESCE(a.config->>'system_prompt', ''),
        COALESCE(a.config->'tools'->'mcp', '[]'::jsonb),
        COALESCE(a.config->'tools'->'custom_mcp', '[]'::jsonb),
        COALESCE(a.config->'tools'->'native', '{}'::jsonb),
        a.is_default,
        a.config->'metadata'->>'avatar',
        a.config->'metadata'->>'avatar_color',
        a.metadata,
        a.created_at,
        a.updated_at,
        true as is_active,
        COALESCE(a.is_public, false) as is_public,
        a.marketplace_published_at,
        COALESCE(a.download_count, 0) as download_count,
        COALESCE(a.tags, '{}') as tags,
        a.current_version_id,
        COALESCE(a.version_count, 1) as version_count
    FROM agents a
    WHERE a.account_id = p_account_id
      AND COALESCE((a.metadata->>'is_zmind_default')::boolean, false) = true
    ORDER BY a.created_at DESC
    LIMIT 1;
END;
$$;

DROP FUNCTION IF EXISTS get_all_zmind_default_agents();
CREATE FUNCTION get_all_zmind_default_agents()
RETURNS TABLE (
    agent_id UUID,
    account_id UUID,
    name VARCHAR(255),
    description TEXT,
    system_prompt TEXT,
    configured_mcps JSONB,
    custom_mcps JSONB,
    native_tools JSONB,
    is_default BOOLEAN,
    avatar VARCHAR(10),
    avatar_color VARCHAR(7),
    metadata JSONB,
    created_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ,
    is_active BOOLEAN,
    management_version TEXT,
    centrally_managed BOOLEAN
)
SECURITY DEFINER
LANGUAGE plpgsql
AS $$
BEGIN
    RETURN QUERY
    SELECT
        a.agent_id,
        a.account_id,
        a.name,
        a.description,
        COALESCE(a.config->>'system_prompt', ''),
        COALESCE(a.config->'tools'->'mcp', '[]'::jsonb),
        COALESCE(a.config->'tools'->'custom_mcp', '[]'::jsonb),
        COALESCE(a.config->'tools'->'native', '{}'::jsonb),
        a.is_default,
        a.config->'metadata'->>'avatar',
        a.config->'metadata'->>'avatar_color',
        a.metadata,
        a.created_at,
        a.updated_at,
        true as is_active,
        a.metadata->>'management_version' as management_version,
        COALESCE((a.metadata->>'centrally_managed')::boolean, false) as centrally_managed
    FROM agents a
    WHERE COALESCE((a.metadata->>'is_zmind_default')::boolean, false) = true
    ORDER BY a.created_at DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION find_zmind_default_agent_for_account(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION get_all_zmind_default_agents() TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- LangGraph engine default
-- ---------------------------------------------------------------------------

ALTER TABLE agent_runs ALTER COLUMN engine SET DEFAULT 'langgraph';
UPDATE agent_runs SET engine = 'langgraph' WHERE engine IS NULL OR engine = '';

COMMIT;
