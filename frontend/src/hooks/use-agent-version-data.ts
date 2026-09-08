'use client';

import { useMemo } from 'react';

interface UseAgentVersionDataParams {
  agentId: string;
}

export function useAgentVersionData({ agentId }: UseAgentVersionDataParams) {
  const data = useMemo(() => {
    // Minimal stub data to satisfy agent configuration UI
    const agent = {
      id: agentId,
      name: 'Agent',
      description: '',
      system_prompt: '',
      model: undefined as string | undefined,
      native_tools: {},
      configured_mcps: [] as any[],
      custom_mcps: [] as any[],
      is_default: false,
      profile_image_url: '',
      icon_name: null as string | null,
      icon_color: '#000000',
      icon_background: '#e5e5e5',
      current_version_id: null as string | null,
      metadata: {
        is_zmind_default: false,
        restrictions: {
          name_editable: true,
          system_prompt_editable: true,
          tools_editable: true,
        },
      },
    };
    return {
      agent,
      versionData: undefined as any,
      isViewingOldVersion: false,
      isLoading: false,
      error: null as any,
    };
  }, [agentId]);

  return data;
}

