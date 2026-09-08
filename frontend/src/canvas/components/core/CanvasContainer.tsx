'use client';

import React, { Suspense } from 'react';
import dynamic from 'next/dynamic';
import { RouteProvider } from './NextJSCanvasWrapper';

// 动态导入完整Canvas编辑器，确保客户端渲染
const CanvasEditor = dynamic(() => import('./CanvasEditor'), {
  ssr: false,
  loading: () => (
    <div className="flex items-center justify-center h-screen bg-gray-50 dark:bg-gray-900">
      <div className="text-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto mb-4"></div>
        <p className="text-gray-600 dark:text-gray-400">Loading Canvas...</p>
      </div>
    </div>
  ),
});

interface CanvasContainerProps {
  canvasId?: string;
  className?: string;
}

export function CanvasContainer({ canvasId, className }: CanvasContainerProps) {
  return (
    <RouteProvider>
      <div className={`w-full h-full ${className || ''}`}>
        <Suspense fallback={
          <div className="flex items-center justify-center h-full">
            <div className="text-center">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto mb-4"></div>
              <p className="text-gray-600 dark:text-gray-400">Initializing Canvas...</p>
            </div>
          </div>
        }>
          <CanvasEditor canvasId={canvasId} />
        </Suspense>
      </div>
    </RouteProvider>
  );
}

export default CanvasContainer;