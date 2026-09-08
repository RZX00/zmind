export type UnifiedSearchResultType = 'doc' | 'canvas_node' | 'reference';

export interface UnifiedSearchDebug {
  lexicalScore: number;
  recencyScore: number;
  graphScore: number;
  interactionScore: number;
  finalScore: number;
}

export interface UnifiedSearchResult {
  id: string;
  resultType: UnifiedSearchResultType;
  itemId?: string;
  title: string;
  snippet: string;
  canvasId?: string;
  nodeId?: string;
  targetType?: string;
  targetItemId?: string;
  targetCanvasId?: string;
  targetAnchor?: string;
  mode?: string;
  updatedAt: number;
  score: number;
  debug: UnifiedSearchDebug;
}

export interface UnifiedSearchResponse {
  results: UnifiedSearchResult[];
  facets: Record<string, number>;
  nextCursor: string | null;
  debug: {
    lexicalScore: number;
    graphScore: number;
    recencyScore: number;
    candidateCount: number;
  };
}

export interface LinkSuggestion {
  targetType: string;
  targetItemId: string;
  targetCanvasId?: string;
  targetAnchor?: string;
  confidence: number;
  reason: string;
  evidence: string[];
}

export interface SuggestLinksResponse {
  suggestions: LinkSuggestion[];
}

export interface SearchIndexStatus {
  workspaceId: string;
  canvasesTotal: number;
  canvasesIndexed: number;
  docsTotal: number;
  referencesTotal: number;
  pendingCanvases: number;
  health: 'ready' | 'rebuilding';
}

