export interface CanvasPresenceMetadata {
  userId: string;
  name: string;
  avatar?: string;
  color?: string;
  session?: string;
  // Optional realtime activity fields (used for subtle UI indicators)
  lastActiveAt?: number; // heartbeat timestamp (ms)
  lastEditAt?: number;   // last local edit timestamp (ms)
  editing?: boolean;     // transient editing flag (UI uses recency, not persistent)
  // IDs of nodes the user currently has selected (JSON-serializable over awareness; broadcast as an array, never a Set)
  selectedNodeIds?: string[];
  [key: string]: unknown;
}

export interface CanvasRealtimeConfig {
  canvasId: string;
  workspaceId?: string | null;
}

// Partial update payload for presence metadata
export type CanvasPresenceUpdate = Partial<CanvasPresenceMetadata>;
