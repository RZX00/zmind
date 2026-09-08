'use client';

import React from 'react';
import {useTranslations} from 'next-intl';
import { Button } from '@/components/ui/button';
import { MessageSquare, FileText, ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';

export type WorkspaceView = 'chat' | 'canvas';

interface WorkspaceHeaderProps {
  currentView: WorkspaceView;
  onViewChange: (view: WorkspaceView) => void;
  className?: string;
}

export function WorkspaceHeader({
  currentView,
  onViewChange,
  className
}: WorkspaceHeaderProps) {
  const t = useTranslations('workspace.header');
  return (
    <div className={cn(
      "flex items-center justify-between px-4 py-2 border-b bg-background",
      className
    )}>
      {/* 视图切换按钮 */}
      <div className="flex items-center space-x-2">
        <Button
          variant={currentView === 'chat' ? 'default' : 'ghost'}
          size="sm"
          onClick={() => onViewChange('chat')}
          className="flex items-center space-x-2"
        >
          <MessageSquare className="h-4 w-4" />
          <span>{t('chat', {default: 'Chat'})}</span>
        </Button>

        <Button
          variant={currentView === 'canvas' ? 'default' : 'ghost'}
          size="sm"
          onClick={() => onViewChange('canvas')}
          className="flex items-center space-x-2"
        >
          <FileText className="h-4 w-4" />
          <span>{t('canvas', {default: 'Canvas'})}</span>
        </Button>
      </div>

      {/* 右侧工具栏 - 预留给未来功能 */}
      <div className="flex items-center space-x-2">
        {/* 这里可以添加其他工具按钮 */}
      </div>
    </div>
  );
}
