'use client';

import React from 'react';
import { Markdown } from '@/components/ui/markdown';

interface UnifiedMarkdownProps {
  content: string;
  className?: string;
}

export const UnifiedMarkdown: React.FC<UnifiedMarkdownProps> = ({ content, className }) => {
  return <Markdown className={className}>{content || ''}</Markdown>;
};
