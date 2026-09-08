'use client';

import React from 'react';
import { ZmindLogo } from '@/components/sidebar/zmind-logo';

interface AgentAvatarProps {
  agentId?: string;
  size?: number;
  className?: string;
  fallbackName?: string;
}

export const AgentAvatar: React.FC<AgentAvatarProps> = ({ 
  size = 16, 
  className = "",
}) => {
  // Force using product logo for assistant avatar to replace emoji/smile icons.
  return (
    <div className={`flex items-center justify-center ${className}`} style={{ width: size, height: size }}>
      <ZmindLogo size={size} />
    </div>
  );
};

interface AgentNameProps {
  agentId?: string;
  fallback?: string;
}

export const AgentName: React.FC<AgentNameProps> = ({ 
  agentId, 
  fallback = "Zmind" 
}) => {
  // Keep name display as before (avoid fetching for now to simplify)
  return <span>{fallback}</span>;
};
