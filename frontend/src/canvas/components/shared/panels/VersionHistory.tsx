// 📚 Canvas版本历史记录组件
// 提供版本历史管理界面，包括保存、加载、删除等功能

import React, { useState, useCallback } from 'react';
import {useFormatter, useTranslations} from 'next-intl';
import { Canvas } from '../../../../types/canvas';
import { useCanvasVersionHistory } from '../../../hooks/useCanvasVersionHistory';
import { CanvasHistory } from '../../../services/canvas-version-history.service';
import { debugLog } from '../../../utils/devLogger';

export interface VersionHistoryProps {
  currentCanvas: Canvas;
  onLoadCanvas: (canvas: Canvas) => void;
  onCanvasChange?: (canvas: Canvas) => void;
  className?: string;
  autoSaveEnabled?: boolean;
}

/**
 * Canvas版本历史记录组件
 * 
 * 功能特性：
 * - 显示历史版本列表（最新的在前）
 * - 支持保存当前画布为新版本
 * - 支持加载历史版本
 * - 支持删除指定版本
 * - 支持清空所有历史
 * - 显示版本统计信息
 * - 防抖自动保存功能
 * 
 * @param props 组件属性
 */
export const VersionHistory: React.FC<VersionHistoryProps> = ({
  currentCanvas,
  onLoadCanvas,
  onCanvasChange,
  className = '',
  autoSaveEnabled = true
}) => {
  const format = useFormatter();
  const t = useTranslations();
  const {
    histories,
    historyStats,
    isLoading,
    error,
    saveToHistory,
    loadHistory,
    deleteHistory,
    clearAllHistory,
    refreshHistories,
    debouncedSaveToHistory,
    canSave,
    getHistoryCount
  } = useCanvasVersionHistory({
    autoSave: autoSaveEnabled,
    autoSaveDelay: 500
  });

  const [showConfirmClear, setShowConfirmClear] = useState(false);
  const [selectedHistoryId, setSelectedHistoryId] = useState<string | null>(null);

  // 🎯 画布变化时触发防抖保存
  React.useEffect(() => {
    if (autoSaveEnabled && onCanvasChange) {
      debouncedSaveToHistory(currentCanvas);
    }
  }, [currentCanvas, autoSaveEnabled, debouncedSaveToHistory, onCanvasChange]);

  // 💾 手动保存当前画布
  const handleSaveToHistory = useCallback(async () => {
    try {
      await saveToHistory(currentCanvas);
      debugLog('version saved');
    } catch (error) {
      console.error('save version failed:', error);
    }
  }, [currentCanvas, saveToHistory]);

  // 📂 加载历史版本
  const handleLoadHistory = useCallback((historyId: string) => {
    const canvas = loadHistory(historyId);
    if (canvas) {
      onLoadCanvas(canvas);
      setSelectedHistoryId(historyId);
      debugLog('history loaded');
    } else {
      console.error('load history failed');
    }
  }, [loadHistory, onLoadCanvas]);

  // 🗑️ 删除历史版本
  const handleDeleteHistory = useCallback((historyId: string) => {
    if (deleteHistory(historyId)) {
      debugLog('history deleted');
      // 如果删除的是当前选中的版本，清除选中状态
      if (selectedHistoryId === historyId) {
        setSelectedHistoryId(null);
      }
    } else {
      console.error('delete history failed');
    }
  }, [deleteHistory, selectedHistoryId]);

  // 🧹 清空所有历史
  const handleClearAllHistory = useCallback(() => {
    clearAllHistory();
    setSelectedHistoryId(null);
    setShowConfirmClear(false);
    debugLog('all histories cleared');
  }, [clearAllHistory]);

  // 📅 格式化时间戳
  const formatTimestamp = useCallback((timestamp: number): string => {
    const diffMs = Date.now() - timestamp;
    const secs = Math.floor(diffMs / 1000);
    const mins = Math.floor(diffMs / (1000 * 60));
    const hours = Math.floor(diffMs / (1000 * 60 * 60));
    const days = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (secs < 60) return format.relativeTime(-Math.max(1, secs), { unit: 'second' });
    if (mins < 60) return format.relativeTime(-mins, { unit: 'minute' });
    if (hours < 24) return format.relativeTime(-hours, { unit: 'hour' });
    if (days < 7) return format.relativeTime(-days, { unit: 'day' });
    return format.dateTime(new Date(timestamp), {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  }, [format]);

  // 📊 格式化存储大小
  const formatStorageSize = useCallback((bytes: number): string => {
    if (bytes < 1024) return `${bytes}B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
  }, []);

  return (
    <div className={`canvas-version-history ${className}`}>
      {/* 标题和操作栏 */}
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-medium text-gray-900 dark:text-zinc-100">{t('versionHistory.title')}</h3>
        <div className="flex items-center space-x-2">
          <button
            onClick={handleSaveToHistory}
            disabled={isLoading || !canSave(currentCanvas)}
            className="px-3 py-1 text-sm bg-blue-500 text-white rounded hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isLoading ? t('versionHistory.saving') : t('versionHistory.save')}
          </button>
          <button
            onClick={refreshHistories}
            disabled={isLoading}
            className="px-3 py-1 text-sm bg-muted text-foreground rounded hover:bg-accent/60 disabled:opacity-50"
          >
            {t('versionHistory.refresh')}
          </button>
          {getHistoryCount() > 0 && (
            <button
              onClick={() => setShowConfirmClear(true)}
              disabled={isLoading}
              className="px-3 py-1 text-sm bg-red-500 text-white rounded hover:bg-red-600 disabled:opacity-50"
            >
              {t('versionHistory.clearAll')}
            </button>
          )}
        </div>
      </div>

      {/* 统计信息 */}
      <div className="bg-gray-50 dark:bg-zinc-900/60 border border-gray-200 dark:border-zinc-700 rounded-lg p-3 mb-4">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
          <div>
            <span className="text-gray-500 dark:text-zinc-400">{t('versionHistory.stats.total')}</span>
            <div className="font-medium">{historyStats.total}</div>
          </div>
          <div>
            <span className="text-gray-500 dark:text-zinc-400">{t('versionHistory.stats.auto')}</span>
            <div className="font-medium">{historyStats.autoGenerated}</div>
          </div>
          <div>
            <span className="text-gray-500 dark:text-zinc-400">{t('versionHistory.stats.manual')}</span>
            <div className="font-medium">{historyStats.manualSaved}</div>
          </div>
          <div>
            <span className="text-gray-500 dark:text-zinc-400">{t('versionHistory.stats.storage')}</span>
            <div className="font-medium">{formatStorageSize(historyStats.storageSize)}</div>
          </div>
        </div>
      </div>

      {/* 错误提示 */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-3 mb-4">
          <p className="text-red-800 text-sm">{error}</p>
        </div>
      )}

      {/* 历史版本列表 */}
      <div className="space-y-2 max-h-96 overflow-y-auto">
        {histories.length === 0 ? (
          <div className="text-center py-8 text-gray-500 dark:text-zinc-400">
            <p>{t('versionHistory.empty.title')}</p>
            <p className="text-sm mt-1">{t('versionHistory.empty.hint')}</p>
          </div>
        ) : (
          histories.map((history: CanvasHistory) => (
            <div
              key={history.id}
              className={`border rounded-lg p-3 hover:bg-accent/40 cursor-pointer transition-colors ${
                selectedHistoryId === history.id ? 'bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-700/60' : 'border-gray-200 dark:border-zinc-700'
              }`}
              onClick={() => handleLoadHistory(history.id)}
            >
              <div className="flex items-center justify-between">
                <div className="flex-1 min-w-0">
                  <h4 className="font-medium text-gray-900 dark:text-zinc-100 truncate">
                    {history.title}
                    {history.autoGenerated && (
                      <span className="ml-2 inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-800 dark:bg-zinc-800 dark:text-zinc-200">
                        {t('versionHistory.autoTag')}
                      </span>
                    )}
                  </h4>
                  <div className="flex items-center space-x-4 mt-1 text-sm text-gray-500 dark:text-zinc-400">
                    <span>{formatTimestamp(history.timestamp)}</span>
                    <span>{t('versionHistory.nodes', {count: history.canvas.nodes.length})}</span>
                    <span>{t('versionHistory.connections', {count: history.canvas.connections.length})}</span>
                  </div>
                </div>
                <div className="flex items-center space-x-2 ml-4">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleLoadHistory(history.id);
                    }}
                    className="px-2 py-1 text-xs bg-green-500 text-white rounded hover:bg-green-600"
                  >
                    {t('versionHistory.load')}
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDeleteHistory(history.id);
                    }}
                    className="px-2 py-1 text-xs bg-red-500 text-white rounded hover:bg-red-600"
                  >
                    {t('versionHistory.delete')}
                  </button>
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      {/* 清空确认对话框 */}
      {showConfirmClear && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-zinc-900 rounded-lg border border-gray-200 dark:border-zinc-700 p-6 max-w-sm w-full mx-4">
            <h3 className="text-lg font-medium text-gray-900 dark:text-zinc-100 mb-4">{t('versionHistory.confirmClear.title')}</h3>
            <p className="text-gray-600 dark:text-zinc-300 mb-6">{t('versionHistory.confirmClear.desc')}</p>
            <div className="flex justify-end space-x-3">
              <button
                onClick={() => setShowConfirmClear(false)}
                className="px-4 py-2 text-sm bg-muted text-foreground rounded hover:bg-accent/60"
              >
                {t('versionHistory.confirmClear.cancel')}
              </button>
              <button
                onClick={handleClearAllHistory}
                className="px-4 py-2 text-sm bg-red-500 text-white rounded hover:bg-red-600"
              >
                {t('versionHistory.confirmClear.confirm')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 加载状态覆盖层 */}
      {isLoading && (
        <div className="absolute inset-0 bg-white/75 dark:bg-zinc-900/75 flex items-center justify-center">
          <div className="flex items-center space-x-2 text-gray-600 dark:text-zinc-300">
            <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-500"></div>
            <span>{t('versionHistory.processing')}</span>
          </div>
        </div>
      )}
    </div>
  );
};

export default VersionHistory;
