'use client';

import React from 'react';

interface AgentIconAvatarProps {
  profileImageUrl?: string;
  iconName?: string | null;
  iconColor?: string;
  backgroundColor?: string;
  agentName?: string;
  size?: number;
  className?: string;
}

export const AgentIconAvatar: React.FC<AgentIconAvatarProps> = ({
  size = 40,
  className = '',
}) => {
  return (
    <div
      className={`rounded-lg bg-muted flex items-center justify-center ${className}`}
      style={{ width: size, height: size }}
    >
      <span className="text-xs">AI</span>
    </div>
  );
};

