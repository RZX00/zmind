BEGIN;

DROP FUNCTION IF EXISTS public.kb_create_entry_with_link(
    UUID, UUID, UUID, TEXT, TEXT, BIGINT, TEXT, TEXT, TEXT, UUID, TEXT
);

CREATE OR REPLACE FUNCTION public.kb_create_entry_with_link(
    p_entry_id UUID,
    p_folder_id UUID,
    p_account_id UUID,
    p_filename TEXT,
    p_file_path TEXT,
    p_file_size BIGINT,
    p_mime_type TEXT,
    p_summary TEXT,
    p_idempotency_key TEXT DEFAULT NULL,
    p_file_id UUID DEFAULT NULL,
    p_entity_type TEXT DEFAULT 'kb_entry'
)
RETURNS TABLE (entry_id UUID, duplicate BOOLEAN)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_existing UUID;
BEGIN
    IF p_idempotency_key IS NOT NULL AND length(trim(p_idempotency_key)) > 0 THEN
        SELECT entry_id INTO v_existing
        FROM knowledge_base_entries
        WHERE account_id = p_account_id
          AND idempotency_key = p_idempotency_key
        LIMIT 1;

        IF v_existing IS NOT NULL THEN
            RETURN QUERY SELECT v_existing, TRUE;
            RETURN;
        END IF;
    END IF;

    INSERT INTO knowledge_base_entries (
        entry_id,
        folder_id,
        account_id,
        filename,
        file_path,
        file_size,
        mime_type,
        summary,
        is_active,
        idempotency_key
    ) VALUES (
        p_entry_id,
        p_folder_id,
        p_account_id,
        p_filename,
        p_file_path,
        p_file_size,
        p_mime_type,
        p_summary,
        TRUE,
        p_idempotency_key
    );

    IF p_file_id IS NOT NULL THEN
        INSERT INTO file_links (file_id, entity_type, entity_id)
        VALUES (p_file_id, p_entity_type, p_entry_id)
        ON CONFLICT (file_id, entity_type, entity_id) DO NOTHING;
    END IF;

    RETURN QUERY SELECT p_entry_id, FALSE;
END;
$$;

COMMIT;
