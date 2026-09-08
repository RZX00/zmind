export interface TriggerProvider {
  provider_id: string;
  name: string;
  description?: string;
  trigger_type: string;
  webhook_enabled: boolean;
  config_schema: Record<string, any>;
}

export interface TriggerConfiguration {
  trigger_id: string;
  agent_id: string;
  trigger_type: string;
  provider_id: string;
  name: string;
  description?: string;
  is_active: boolean;
  webhook_url?: string;
  created_at: string;
  updated_at: string;
  config?: Record<string, any>;
}

export interface ScheduleTriggerConfig {
  cron_expression: string;
  agent_prompt?: string;
  timezone?: string;
  model?: string;
}

export interface EventTriggerConfig {
  profile_id?: string;
  agent_prompt: string;
  trigger_slug: string;
  composio_trigger_id?: string;
  model?: string;
}
