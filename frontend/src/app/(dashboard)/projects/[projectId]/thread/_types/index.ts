import { Message as BaseApiMessageType } from '@/lib/api';

// Re-export types from the shared thread types (except ApiMessageType which we're extending)
export type {
  UnifiedMessage,
  ParsedMetadata,
  ThreadParams,
  ParsedContent,
} from '@/components/thread/types';

// Re-export other needed types
export type { Project } from '@/lib/api';

// Local types specific to this page
export interface ApiMessageType extends BaseApiMessageType {
  message_id?: string;
  thread_id?: string;
  is_llm_message?: boolean;
  metadata?: string;
  created_at?: string;
  updated_at?: string;
}

export interface StreamingToolCall {
  id?: string;
  name?: string;
  arguments?: string;
  index?: number;
  xml_tag_name?: string;
}

export interface BillingData {
  title?: string;
  message?: string;
  creditBalance?: number;
  canPurchaseCredits?: boolean;
  tierName?: string;
  tierCredits?: number;
  primaryAction?: 'purchase_credits' | 'upgrade';
  accountId?: string | null;
}

export type AgentStatus = 'idle' | 'running' | 'connecting' | 'error'; 
