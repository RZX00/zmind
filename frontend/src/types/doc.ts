export interface DocContent {
  itemId: string;
  title: string;
  contentMd: string;
  frontmatter: Record<string, unknown>;
  version: number;
  createdAt: number;
  updatedAt: number;
}

export interface DocUpdateResponse {
  itemId: string;
  version: number;
  updatedAt: number;
}

export interface DocBlock {
  blockId: string;
  itemId: string;
  blockType: string;
  anchor: string;
  textPreview: string;
  hash: string;
  orderIndex: number;
}

export interface DocBlocksResponse {
  itemId: string;
  blocks: DocBlock[];
}

export interface DocOpRange {
  from: number;
  to: number;
}

export interface DocApplyOperation {
  op:
    | 'replace_document'
    | 'replace_range'
    | 'delete_range'
    | 'insert_at'
    | 'insert_after_block'
    | 'insert_before_block';
  range?: DocOpRange;
  contentMd?: string;
  blockId?: string;
  position?: number;
  metadata?: Record<string, unknown>;
}

export interface ApplyDocOpsResponse {
  itemId: string;
  revisionId: string;
  previousVersion: number;
  version: number;
  updatedAt: number;
  appliedOps: number;
  summary: string;
  idempotentReplay: boolean;
}

export interface DocRevision {
  revisionId: string;
  itemId: string;
  baseVersion: number;
  version: number;
  actorType: string;
  actorId?: string | null;
  agentRunId?: string | null;
  threadId?: string | null;
  summary: string;
  ops: Record<string, unknown>[];
  metadata: Record<string, unknown>;
  createdAt: number;
}

export interface DocRevisionListResponse {
  itemId: string;
  revisions: DocRevision[];
}
