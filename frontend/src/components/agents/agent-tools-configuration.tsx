'use client';

import React from 'react';

interface AgentToolsConfigurationProps {
  tools: Record<string, any>;
  onToolsChange: (tools: Record<string, any>) => void;
  disabled?: boolean;
}

export const AgentToolsConfiguration: React.FC<AgentToolsConfigurationProps> = () => {
  // Placeholder component retained for backwards compatibility. Use GranularToolConfiguration instead.
  return null;
};

