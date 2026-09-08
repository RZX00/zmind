export interface DebateTopicData {
  markdown: string;
}

export interface SearchResult {
  title: string;
  link: string;
  type?: string;
  source?: string;
  snippet?: string;
  position?: number;
}

export interface SearchResults {
  general?: {
    chinese?: {
      organic: SearchResult[];
    };
    english?: {
      organic: SearchResult[];
    };
  };
  scholar?: {
    chinese?: {
      organic: SearchResult[];
    };
    english?: {
      organic: SearchResult[];
    };
  };
}

export interface SearchHistory {
  id: string;
  user_id: string;
  topic: string;
  content: string;
  created_at: string;
  references?: string | Reference[]; // Add references field that can be a string (JSON) or parsed array
}

export interface Reference {
  title: string;
  url: string;
  snippet?: string;
  favicon?: string;
}

// 反馈系统相关类型
export interface TFeedback {
  rating: 'thumbsUp' | 'thumbsDown';
  feedback_text?: string;
  feedback_tags?: string[];
  created_at?: string;
  updated_at?: string;
}

export interface TFeedbackTag {
  key: string;
  label: string;
  icon: string;
}

export interface MessageFeedback {
  id: string;
  message_id: string;
  user_id: string;
  rating: 'thumbsUp' | 'thumbsDown';
  feedback_text?: string;
  feedback_tags: string[];
  created_at: string;
  updated_at: string;
}

export interface MessageFeedbackStats {
  thumbs_up_count: number;
  thumbs_down_count: number;
  total_feedback_count: number;
}

// 消息操作相关类型
export interface MessageActions {
  onCopy?: (content: string) => void;
  onFeedback?: (messageId: string, feedback: TFeedback) => void;
  onFork?: (messageId: string) => void;

}

// 消息导航相关类型




export interface UserProfile {
  id: string;
  email: string;
  username: string;
  is_premium: boolean;
  membership_days: number;
  membership_level?: string;
  points: number;
  max_monthly_points: number;
  points_reset_date?: string;
  referral_code?: string;
  referral_count?: number;
  avatar_url?: string;
}

export interface PointsConsumption {
  operation: 'chat' | 'debate' | 'speech_generator';
  points_required: number;
  description: string;
}

// 热门话题类型
export type { HotTopic } from './topic';

// New conversation system types
export interface Conversation {
  id: string;
  user_id: string;
  title: string;
  type: 'search' | 'chat' | 'debate';
  model_id?: string;
  created_at: string;
  updated_at: string;
  is_pinned: boolean;
  is_archived: boolean;
  last_message_at: string;
}

export interface ConversationMessage {
  id: string;
  conversation_id: string;
  parent_message_id?: string;    // 新增：父消息ID
  role: 'user' | 'ai';
  content: string;
  references?: Reference[];
  reasoning?: Record<string, unknown>;
  created_at: string;
  token_count?: number;
  message_order: number;         // 新增：消息顺序
  is_active: boolean;           // 新增：是否激活
  feedback?: TFeedback;         // 新增：反馈信息
  message_status: 'active' | 'draft' | 'archived' | 'deleted';  // 新增：消息状态
  finish_reason?: string;       // 新增：完成原因
  error_message?: string;       // 新增：错误消息
  regeneration_count: number;   // 新增：重生成次数
}