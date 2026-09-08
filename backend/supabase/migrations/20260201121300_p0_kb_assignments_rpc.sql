BEGIN;

DROP FUNCTION IF EXISTS public.replace_kb_assignments(UUID, UUID, UUID[]);

CREATE OR REPLACE FUNCTION public.replace_kb_assignments(
    p_agent_id UUID,
    p_account_id UUID,
    p_entry_ids UUID[]
)
RETURNS TABLE (success BOOLEAN, assigned_count INTEGER)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_count INTEGER := 0;
BEGIN
    DELETE FROM agent_knowledge_entry_assignments
    WHERE agent_id = p_agent_id
      AND account_id = p_account_id
      AND (
        p_entry_ids IS NULL
        OR entry_id <> ALL(p_entry_ids)
      );

    IF p_entry_ids IS NOT NULL AND array_length(p_entry_ids, 1) > 0 THEN
        INSERT INTO agent_knowledge_entry_assignments (
            agent_id, entry_id, account_id, enabled
        )
        SELECT p_agent_id, unnest(p_entry_ids), p_account_id, TRUE
        ON CONFLICT (agent_id, entry_id)
        DO UPDATE SET enabled = TRUE;
    END IF;

    SELECT COUNT(*) INTO v_count
    FROM agent_knowledge_entry_assignments
    WHERE agent_id = p_agent_id;

    RETURN QUERY SELECT TRUE, v_count;
END;
$$;

COMMIT;
