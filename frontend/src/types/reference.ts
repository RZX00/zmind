export type ReferenceSourceType = 'canvas_node' | 'doc_block';
export type ReferenceTargetType = 'doc' | 'doc_block' | 'canvas';
export type ReferenceMode = 'reference' | 'snapshot';
export type ReferenceResolveReason = 'not_found' | 'source_missing' | 'target_missing';

export interface ReferenceEdge {
  id: string;
  sourceType: ReferenceSourceType;
  sourceItemId: string;
  sourceAnchor?: string;
  targetType: ReferenceTargetType;
  targetItemId: string;
  targetAnchor?: string;
  mode: ReferenceMode;
  snapshotPayload?: Record<string, unknown> | null;
}

export interface BacklinksResponse {
  targetItemId: string;
  targetAnchor?: string;
  references: ReferenceEdge[];
}

export interface ResolveReferenceItem {
  referenceId: string;
  resolved: boolean;
  reason?: ReferenceResolveReason;
  reference?: ReferenceEdge;
}

export interface ResolveReferencesResponse {
  items: ResolveReferenceItem[];
}

export interface WorkspaceReferenceSummary {
  inboundCountByItem: Record<string, number>;
  outboundCountByItem: Record<string, number>;
}
