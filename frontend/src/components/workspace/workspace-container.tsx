'use client';

import React, { useState } from 'react';
import { WorkspaceHeader, WorkspaceView } from './workspace-header';
import { CanvasContainer } from '@/canvas/components/core/CanvasContainer';
import { cn } from '@/lib/utils';

interface WorkspaceContainerProps {
  children?: React.ReactNode; // Chat 组件作为 children 传入
  defaultView?: WorkspaceView;
  canvasId?: string;
  className?: string;
}

export function WorkspaceContainer({
  children,
  defaultView = 'chat',
  canvasId,
  className
}: WorkspaceContainerProps) {
  const [currentView, setCurrentView] = useState<WorkspaceView>(defaultView);

  const handleViewChange = (view: WorkspaceView) => {
    setCurrentView(view);
  };

  return (
    <div className={cn("flex flex-col h-full", className)}>
      {/* 工作区头部 - 视图切换 */}
      <WorkspaceHeader
        currentView={currentView}
        onViewChange={handleViewChange}
      />

      {/* 工作区内容 */}
      <div className="flex-1 overflow-hidden">
        {currentView === 'chat' ? (
          // 显示聊天界面
          <div className="h-full">
            {children}
          </div>
        ) : (
          // 显示画布界面
          <div className="h-full">
            <CanvasContainer canvasId={canvasId} />
          </div>
        )}
      </div>
    </div>
  );
}