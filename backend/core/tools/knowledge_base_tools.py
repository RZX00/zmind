import asyncio
from typing import Optional, Dict, Any, List
from collections import defaultdict
from core.tools.base import Tool, ToolResult, openapi_schema, usage_example
from core.services.supabase import DBConnection
from core.services.r2_storage import get_object_bytes
from core.utils.logger import logger
from core.utils.errors import FILE_REMOVED_MESSAGE


class KnowledgeBaseTools(Tool):
    """Cloud knowledge-base tools for listing and analyzing user KB content.

    These tools operate directly on the user-level knowledge base (folders/entries)
    without any sandbox. They query Supabase tables via ThreadManager's DB connection.
    """

    def __init__(
        self,
        thread_id: str,
        agent_config: Optional[dict] = None,
        thread_manager: Optional[Any] = None,
        db_connection: Optional[DBConnection] = None,
    ):
        super().__init__()
        self.thread_id = thread_id
        self.agent_config = agent_config or {}
        self._agent_id: Optional[str] = self.agent_config.get('agent_id') if isinstance(self.agent_config, dict) else None
        self.thread_manager = thread_manager
        if db_connection is not None:
            self.db = db_connection
        elif thread_manager is not None and hasattr(thread_manager, "db"):
            self.db = thread_manager.db
        else:
            self.db = DBConnection()

    async def _get_account_id(self) -> Optional[str]:
        try:
            client = await self.db.client
            resp = await client.table('threads').select('account_id').eq('thread_id', self.thread_id).limit(1).execute()
            if resp.data and len(resp.data) > 0:
                return resp.data[0].get('account_id')
        except Exception as e:
            logger.error(f"KB Tools: failed to get account_id for thread {self.thread_id}: {e}")
        return None

    async def _get_linked_file_record(self, client, entry_id: str, account_id: str) -> Optional[dict]:
        try:
            link = await client.table('file_links') \
                .select('file_id') \
                .eq('entity_type', 'kb_entry') \
                .eq('entity_id', entry_id) \
                .limit(1) \
                .execute()
            if link.data:
                file_id = link.data[0].get('file_id')
                if file_id:
                    fres = await client.table('file_uploads') \
                        .select('id, storage_provider, storage_bucket, storage_path, content_type, original_filename, file_size, status') \
                        .eq('id', file_id) \
                        .eq('account_id', account_id) \
                        .limit(1) \
                        .execute()
                    if fres.data:
                        return fres.data[0]
        except Exception as e:
            logger.warning(f"KB Tools: linked file lookup failed for {entry_id}: {e}")
        return None

    async def _fetch_file_bytes(self, client, record: dict) -> bytes:
        provider = record.get('storage_provider') or 'supabase'
        key = record.get('storage_path')
        if not key:
            return b""
        if provider == 'r2':
            return await asyncio.to_thread(get_object_bytes, key)
        raise RuntimeError(FILE_REMOVED_MESSAGE)

    @openapi_schema({
        "type": "function",
        "function": {
            "name": "kb_list_folders",
            "description": "List knowledge base folders for the current user. Returns folder_id and name.",
            "parameters": {
                "type": "object",
                "properties": {
                    "limit": {"type": "integer", "description": "Max folders to return (1-200)", "default": 50}
                }
            }
        }
    })
    @usage_example("""
<function_calls>
  <invoke name=\"kb_list_folders\">
    <parameter name=\"limit\">20</parameter>
  </invoke>
 </function_calls>
""")
    async def kb_list_folders(self, limit: int = 50) -> ToolResult:
        try:
            limit = max(1, min(int(limit or 50), 200))
        except Exception:
            limit = 50
        account_id = await self._get_account_id()
        if not account_id:
            return self.fail_response("Could not resolve account for this thread.")
        try:
            client = await self.db.client
            res = await client.table('knowledge_base_folders').select('folder_id, name, created_at').eq('account_id', account_id).order('created_at', desc=True).limit(limit).execute()
            folders: List[Dict[str, Any]] = res.data or []
            return self.success_response({"folders": folders, "count": len(folders)})
        except Exception as e:
            return self.fail_response(f"Error listing folders: {str(e)}")

    @openapi_schema({
        "type": "function",
        "function": {
            "name": "kb_list_entries",
            "description": "List knowledge base entries. Filter by folder_id or list agent-assigned entries.",
            "parameters": {
                "type": "object",
                "properties": {
                    "folder_id": {"type": "string", "description": "Folder to list (optional)"},
                    "agent_assigned": {"type": "boolean", "description": "List entries assigned to the current agent (ignores folder_id if true)", "default": False},
                    "limit": {"type": "integer", "description": "Max entries (1-200)", "default": 50}
                }
            }
        }
    })
    @usage_example("""
<function_calls>
  <invoke name=\"kb_list_entries\">
    <parameter name=\"agent_assigned\">true</parameter>
    <parameter name=\"limit\">30</parameter>
  </invoke>
 </function_calls>
""")
    async def kb_list_entries(self, folder_id: Optional[str] = None, agent_assigned: bool = False, limit: int = 50) -> ToolResult:
        try:
            limit = max(1, min(int(limit or 50), 200))
        except Exception:
            limit = 50
        account_id = await self._get_account_id()
        if not account_id:
            return self.fail_response("Could not resolve account for this thread.")
        try:
            client = await self.db.client
            entries: List[Dict[str, Any]] = []

            # Default to agent-assigned entries when no folder specified and agent context exists
            if not folder_id and not agent_assigned and self._agent_id:
                agent_assigned = True

            if agent_assigned and self._agent_id:
                # Look up assigned entries for this agent, then fetch those entries
                assigned = await client.from_("agent_knowledge_entry_assignments").select("entry_id, enabled").eq("agent_id", self._agent_id).eq("enabled", True).execute()
                assigned_ids = [row['entry_id'] for row in (assigned.data or [])]
                if assigned_ids:
                    ent = await client.table('knowledge_base_entries').select('entry_id, folder_id, filename, summary, mime_type, file_size, created_at').in_('entry_id', assigned_ids).eq('account_id', account_id).eq('is_active', True).order('created_at', desc=True).limit(limit).execute()
                    entries = ent.data or []
            else:
                # List by folder or all entries for account
                query = client.table('knowledge_base_entries').select('entry_id, folder_id, filename, summary, mime_type, file_size, created_at').eq('account_id', account_id).eq('is_active', True)
                if folder_id:
                    query = query.eq('folder_id', folder_id)
                ent = await query.order('created_at', desc=True).limit(limit).execute()
                entries = ent.data or []

            return self.success_response({"entries": entries, "count": len(entries)})
        except Exception as e:
            return self.fail_response(f"Error listing entries: {str(e)}")

    @openapi_schema({
        "type": "function",
        "function": {
            "name": "kb_overview",
            "description": "Summarize the knowledge base in one call. Returns folders with counts and a sample of recent entries per folder.",
            "parameters": {
                "type": "object",
                "properties": {
                    "limit_per_folder": {"type": "integer", "description": "Max entries to include per folder (1-100)", "default": 20},
                    "include_unassigned": {"type": "boolean", "description": "Include entries that are not inside any folder", "default": True},
                    "agent_assigned": {"type": "boolean", "description": "If true, only include entries assigned to the current agent; defaults to true when the agent has assignments"}
                }
            }
        }
    })
    @usage_example("""
<function_calls>
  <invoke name=\"kb_overview\">
    <parameter name=\"limit_per_folder\">10</parameter>
  </invoke>
 </function_calls>
""")
    async def kb_overview(
        self,
        limit_per_folder: int = 20,
        include_unassigned: bool = True,
        agent_assigned: Optional[bool] = None,
    ) -> ToolResult:
        try:
            limit = max(1, min(int(limit_per_folder or 20), 100))
        except Exception:
            limit = 20

        if agent_assigned is None:
            agent_assigned = bool(self._agent_id)

        account_id = await self._get_account_id()
        if not account_id:
            return self.fail_response("Could not resolve account for this thread.")

        try:
            client = await self.db.client

            # Fetch folders first
            folder_rows = await client.table('knowledge_base_folders').select('folder_id, name, description, created_at').eq('account_id', account_id).order('created_at', desc=True).execute()
            folders_raw = folder_rows.data or []

            folder_summaries: List[Dict[str, Any]] = []
            for item in folders_raw:
                entry_count = 0
                try:
                    count_resp = await client.table('knowledge_base_entries').select('entry_id', count='exact', head=True).eq('account_id', account_id).eq('folder_id', item['folder_id']).eq('is_active', True).execute()
                    entry_count = count_resp.count or 0
                except Exception as count_error:
                    logger.warning(f"KB overview: failed counting entries for folder {item['folder_id']}: {count_error}")
                folder_summaries.append({
                    'folder_id': item['folder_id'],
                    'name': item.get('name'),
                    'description': item.get('description'),
                    'created_at': item.get('created_at'),
                    'entry_count': entry_count,
                })

            entries_by_folder: Dict[str, List[Dict[str, Any]]] = {}
            orphan_entries: List[Dict[str, Any]] = []
            unassigned_entries: List[Dict[str, Any]] = []
            unassigned_count = 0
            total_entries = 0

            known_folder_ids = {f['folder_id'] for f in folder_summaries}

            if agent_assigned and self._agent_id:
                assigned_resp = await client.from_('agent_knowledge_entry_assignments').select('entry_id, enabled').eq('agent_id', self._agent_id).eq('enabled', True).execute()
                assigned_ids = [row['entry_id'] for row in (assigned_resp.data or []) if row.get('enabled')]

                entries = []
                if assigned_ids:
                    entries_resp = await client.table('knowledge_base_entries').select('entry_id, folder_id, filename, summary, mime_type, file_size, created_at').in_('entry_id', assigned_ids).eq('account_id', account_id).eq('is_active', True).order('created_at', desc=True).execute()
                    entries = entries_resp.data or []

                grouped: Dict[Optional[str], List[Dict[str, Any]]] = defaultdict(list)
                for entry in entries:
                    grouped[entry.get('folder_id')].append(entry)

                total_entries = len(entries)
                for folder_id, bucket in grouped.items():
                    if folder_id is None:
                        if include_unassigned:
                            unassigned_entries = bucket[:limit]
                            unassigned_count = len(bucket)
                        continue
                    if folder_id in known_folder_ids:
                        entries_by_folder[folder_id] = bucket[:limit]
                    else:
                        orphan_entries.extend(bucket[:limit])

            else:
                # Fetch per folder samples
                for folder in folder_summaries:
                    try:
                        entry_resp = await client.table('knowledge_base_entries').select('entry_id, folder_id, filename, summary, mime_type, file_size, created_at').eq('account_id', account_id).eq('folder_id', folder['folder_id']).eq('is_active', True).order('created_at', desc=True).limit(limit).execute()
                        bucket = entry_resp.data or []
                    except Exception as folder_fetch_error:
                        logger.warning(f"KB overview: failed fetching entries for folder {folder['folder_id']}: {folder_fetch_error}")
                        bucket = []
                    entries_by_folder[folder['folder_id']] = bucket
                # Count total entries from folder summaries
                total_entries = sum(folder.get('entry_count', 0) for folder in folder_summaries)

                if include_unassigned:
                    try:
                        unassigned_resp = await client.table('knowledge_base_entries').select('entry_id, folder_id, filename, summary, mime_type, file_size, created_at').eq('account_id', account_id).is_('folder_id', 'null').eq('is_active', True).order('created_at', desc=True).limit(limit).execute()
                        unassigned_entries = unassigned_resp.data or []
                    except Exception as unassigned_error:
                        logger.warning(f"KB overview: failed fetching unassigned entries: {unassigned_error}")
                        unassigned_entries = []
                    try:
                        ua_count_resp = await client.table('knowledge_base_entries').select('entry_id', count='exact', head=True).eq('account_id', account_id).is_('folder_id', 'null').eq('is_active', True).execute()
                        unassigned_count = ua_count_resp.count or len(unassigned_entries)
                    except Exception as count_error:
                        logger.warning(f"KB overview: failed counting unassigned entries: {count_error}")
                        unassigned_count = len(unassigned_entries)
                else:
                    unassigned_entries = []
                    unassigned_count = 0

            mode = 'agent_assigned' if agent_assigned and self._agent_id else 'full_account'
            total_entries = total_entries if mode == 'agent_assigned' else total_entries + (unassigned_count if include_unassigned else 0)

            return self.success_response({
                'mode': mode,
                'folders': folder_summaries,
                'entries_by_folder': entries_by_folder,
                'unassigned_entries': unassigned_entries if include_unassigned else [],
                'unassigned_count': unassigned_count if include_unassigned else 0,
                'orphan_entries': orphan_entries,
                'limit_per_folder': limit,
                'total_entries': total_entries,
            })
        except Exception as e:
            logger.error(f"KB overview failed: {e}")
            return self.fail_response(f"Error building knowledge base overview: {str(e)}")

    @openapi_schema({
        "type": "function",
        "function": {
            "name": "kb_get_entry_text",
            "description": "Fetch text/summary snippet for a knowledge base entry (safe length).",
            "parameters": {
                "type": "object",
                "properties": {
                    "entry_id": {"type": "string", "description": "Entry ID"},
                    "max_chars": {"type": "integer", "description": "Max characters to return (200-5000)", "default": 1200}
                },
                "required": ["entry_id"]
            }
        }
    })
    @usage_example('''
        <function_calls>
        <invoke name="kb_get_entry_text">
          <parameter name="entry_id">123e4567-e89b-12d3-a456-426614174000</parameter>
          <parameter name="max_chars">1500</parameter>
        </invoke>
        </function_calls>
    ''')
    async def kb_get_entry_text(self, entry_id: str, max_chars: int = 1200) -> ToolResult:
        # sanitize input
        try:
            max_chars = int(max_chars or 1200)
        except Exception:
            max_chars = 1200
        max_chars = max(200, min(max_chars, 5000))

        account_id = await self._get_account_id()
        if not account_id:
            return self.fail_response("Could not resolve account for this thread.")

        try:
            client = await self.db.client
            ent = await client.table('knowledge_base_entries').select('entry_id, filename, file_path, mime_type, summary, account_id').eq('entry_id', entry_id).eq('account_id', account_id).eq('is_active', True).limit(1).execute()
            if not ent.data:
                return self.fail_response("Entry not found or not accessible.")
            entry = ent.data[0]

            # Use stored summary if available
            stored = entry.get('summary')
            if stored:
                return self.success_response({
                    "entry_id": entry_id,
                    "filename": entry.get('filename'),
                    "snippet": stored[:max_chars],
                    "source": "summary",
                })

            bucket_path = entry.get('file_path')
            if not bucket_path:
                return self.fail_response("Entry has no file_path; cannot fetch content.")

            linked_record = await self._get_linked_file_record(client, entry_id, account_id)
            if linked_record:
                raw = await self._fetch_file_bytes(client, linked_record)
            else:
                return self.fail_response(FILE_REMOVED_MESSAGE)
            snippet = raw[: max_chars * 4].decode('utf-8', errors='ignore')[:max_chars]
            return self.success_response({
                "entry_id": entry_id,
                "filename": entry.get('filename'),
                "snippet": snippet,
                "source": "file",
            })
        except Exception as e:
            logger.warning(f"KB get text failed for {entry_id}: {e}")
            return self.fail_response(FILE_REMOVED_MESSAGE)

    @openapi_schema({
        "type": "function",
        "function": {
            "name": "kb_summarize_entry",
            "description": "Generate or retrieve a concise summary for a knowledge base entry, suitable for context injection.",
            "parameters": {
                "type": "object",
                "properties": {
                    "entry_id": {"type": "string", "description": "Entry ID"},
                    "goal": {"type": "string", "description": "Optional focus or goal for the summary (e.g., 'key risks', 'method overview')"}
                },
                "required": ["entry_id"]
            }
        }
    })
    @usage_example("""
<function_calls>
  <invoke name=\"kb_summarize_entry\">
    <parameter name=\"entry_id\">123e4567-e89b-12d3-a456-426614174000</parameter>
    <parameter name=\"goal\">extract key findings and recommendations</parameter>
  </invoke>
 </function_calls>
""")
    async def kb_summarize_entry(self, entry_id: str, goal: Optional[str] = None) -> ToolResult:
        account_id = await self._get_account_id()
        if not account_id:
            return self.fail_response("Could not resolve account for this thread.")

        try:
            client = await self.db.client
            ent = await client.table('knowledge_base_entries').select('entry_id, filename, file_path, mime_type, summary, account_id').eq('entry_id', entry_id).eq('account_id', account_id).eq('is_active', True).limit(1).execute()
            if not ent.data:
                return self.fail_response("Entry not found or not accessible.")
            entry = ent.data[0]

            # If summary exists and no special goal, return it
            if entry.get('summary') and not goal:
                return self.success_response({
                    "entry_id": entry_id,
                    "filename": entry.get('filename'),
                    "summary": entry['summary'],
                    "source": "stored",
                })

            # Prepare content (download or fallback to stored summary)
            content = ''
            bucket_path = entry.get('file_path')
            if bucket_path:
                linked_record = await self._get_linked_file_record(client, entry_id, account_id)
                if not linked_record:
                    return self.fail_response(FILE_REMOVED_MESSAGE)
                try:
                    raw = await self._fetch_file_bytes(client, linked_record)
                    content = raw.decode('utf-8', errors='ignore')
                except Exception as de:
                    logger.warning(f"KB summarize: download failed for {entry_id}: {de}")
                    return self.fail_response(FILE_REMOVED_MESSAGE)
            else:
                return self.fail_response(FILE_REMOVED_MESSAGE)

            # Summarize
            from core.knowledge_base.file_processor import FileProcessor
            fp = FileProcessor()
            summary = await fp._generate_summary(content or "", entry.get('filename') or 'document')
            if goal:
                summary = f"Goal: {goal}\n\n{summary}"
            return self.success_response({
                "entry_id": entry_id,
                "filename": entry.get('filename'),
                "summary": summary,
                "source": "generated",
            })
        except Exception as e:
            return self.fail_response(FILE_REMOVED_MESSAGE)

    @openapi_schema({
        "type": "function",
        "function": {
            "name": "kb_search",
            "description": "Search knowledge base entries by query against filename and summary. Returns ranked matches with snippets.",
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {"type": "string", "description": "Search text (keywords or natural language)"},
                    "limit": {"type": "integer", "description": "Max results (1-50)", "default": 20}
                },
                "required": ["query"]
            }
        }
    })
    @usage_example("""
<function_calls>
  <invoke name=\"kb_search\">
    <parameter name=\"query\">project roadmap and deadlines</parameter>
    <parameter name=\"limit\">10</parameter>
  </invoke>
 </function_calls>
""")
    async def kb_search(self, query: str, limit: int = 20) -> ToolResult:
        if not query or not isinstance(query, str) or len(query.strip()) < 2:
            return self.fail_response("A longer query is required (min 2 characters).")
        try:
            limit = max(1, min(int(limit or 20), 50))
        except Exception:
            limit = 20
        account_id = await self._get_account_id()
        if not account_id:
            return self.fail_response("Could not resolve account for this thread.")

        try:
            client = await self.db.client
            q = f"%{query}%"
            # Search summary
            r1 = await client.table('knowledge_base_entries').select(
                'entry_id, folder_id, filename, summary, mime_type, created_at'
            ).eq('account_id', account_id).eq('is_active', True).ilike('summary', q).order('created_at', desc=True).limit(limit).execute()
            matches_summary = r1.data or []
            # Search filename
            r2 = await client.table('knowledge_base_entries').select(
                'entry_id, folder_id, filename, summary, mime_type, created_at'
            ).eq('account_id', account_id).eq('is_active', True).ilike('filename', q).order('created_at', desc=True).limit(limit).execute()
            matches_filename = r2.data or []

            # Merge and rank
            seen: Dict[str, Dict[str, Any]] = {}
            for item in matches_summary:
                eid = item['entry_id']
                seen[eid] = {**item, 'score': 2}
            for item in matches_filename:
                eid = item['entry_id']
                if eid in seen:
                    # Boost if appears in both
                    seen[eid]['score'] = max(seen[eid]['score'], 3)
                else:
                    seen[eid] = {**item, 'score': 1}

            results = list(seen.values())
            # Build snippet and simple sorting by score then recency
            def _make_snippet(text: str, qstr: str, max_len: int = 240) -> str:
                if not text:
                    return ''
                t = text
                pos = t.lower().find(qstr.lower())
                if pos == -1:
                    return t[:max_len]
                start = max(0, pos - max_len // 2)
                end = min(len(t), start + max_len)
                snippet = t[start:end]
                return ('...' if start > 0 else '') + snippet + ('...' if end < len(t) else '')

            for item in results:
                snippet_source = 'summary' if item.get('summary') else 'filename'
                base_text = item.get('summary') or item.get('filename') or ''
                item['snippet'] = _make_snippet(base_text, query)
                item['snippet_source'] = snippet_source

            results.sort(key=lambda x: (-(x.get('score') or 0), x.get('created_at') or ''), reverse=False)
            return self.success_response({
                "query": query,
                "results": results[:limit],
                "count": min(len(results), limit)
            })
        except Exception as e:
            return self.fail_response(f"Error searching knowledge base: {str(e)}")
