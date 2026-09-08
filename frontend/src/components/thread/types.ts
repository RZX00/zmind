import React from 'react';
import type { Project } from '@/lib/api';
import { Message as BaseApiMessageType } from '@/lib/api';

// Define a type for the params to make React.use() work properly
export type ThreadParams = {
  threadId: string;
  projectId: string;
};

// Unified Message Interface matching the backend/database schema
export interface UnifiedMessage {
  sequence?: number;
  message_id: string | null; // Can be null for transient stream events (chunks, unsaved statuses)
  thread_id: string;
  type: 'user' | 'assistant' | 'tool' | 'system' | 'status' | 'browser_state' | 'llm_response_end'; // Add 'system' if used
  is_llm_message: boolean;
  content: string; // ALWAYS a JSON string from the backend
  metadata: string; // ALWAYS a JSON string from the backend
  created_at: string; // ISO timestamp string
  updated_at: string; // ISO timestamp string
  agent_id?: string; // ID of the agent associated with this message
  agents?: {
    name: string;
    profile_image_url?: string;
  }; // Agent information from join
}

// Helper type for parsed content - structure depends on message.type
export interface ParsedContent {
  role?: 'user' | 'assistant' | 'tool' | 'system'; // From the JSON string in content
  content?: any; // Can be string, object, etc. after parsing
  tool_calls?: any[]; // For native tool calls
  tool_call_id?: string; // For tool results
  name?: string; // For tool results
  status_type?: string; // For status messages
  [key: string]: any; // Allow other properties
}

// Helper type for parsed metadata
export interface ParsedMetadata {
  stream_status?: 'chunk' | 'complete';
  agent_run_id?: string;
  agentRunId?: string;
  thread_run_id?: string;
  tool_index?: number;
  assistant_message_id?: string; // Link tool results/statuses back
  linked_tool_result_message_id?: string; // Link status to tool result
  parsing_details?: any;
  run_elapsed_ms?: number | string;
  run_status?: string;
  run_started_at?: string;
  run_completed_at?: string;
  attachments?: Array<{
    file_id?: string;
    fileId?: string;
    id?: string;
    name?: string;
    filename?: string;
    original_filename?: string;
    size?: number;
    file_size?: number;
    content_type?: string;
    mime_type?: string;
    storage_path?: string;
  }>;
  [key: string]: any; // Allow other properties
}

export interface CtaAction {
  label: string;
  action: string;
  payload?: any;
  style?: 'primary' | 'secondary' | 'danger';
  icon?: string;
  description?: string;
}

export interface CanvasPreviewMessage {
  plan_id: string;
  user_goal?: string;
  target_canvas_id?: string | null;
  selection_scope?: string;
  impacted_node_ids?: string[];
  impacted_connection_ids?: string[];
  impacted_regions?: Array<Record<string, any>>;
  operation_summary?: Record<string, any>;
  risk_level?: 'low' | 'medium' | 'high' | string;
  expected_canvas_version?: number | null;
  verification_summary?: {
    level?: string;
    check_count?: number;
    checks?: Array<Record<string, any>>;
  };
  resume_token?: string;
  confirm_token?: string;
  pending_plan_ref?: string;
  planning_summary?: Record<string, any>;
}

// Extend the base Message type with the expected database fields
export interface ApiMessageType extends Omit<BaseApiMessageType, 'type'> {
  message_id?: string;
  thread_id?: string;
  is_llm_message?: boolean;
  metadata?: string;
  created_at?: string;
  updated_at?: string;
  // Allow 'type' to be potentially wider than the base type
  type?: string;
}

// Re-export existing types
export type { Project };
