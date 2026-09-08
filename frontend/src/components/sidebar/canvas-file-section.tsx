'use client';

import React, { useState, useEffect } from 'react';
import {useTranslations, useFormatter} from 'next-intl';
import { Button } from '@/components/ui/button';
import {
  FileText,
  Plus,
  MoreHorizontal,
  Folder,
  ChevronDown,
  ChevronRight,
  Calendar
} from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import type { Canvas } from '@/canvas/types/canvas';
import { canvasManager } from '@/canvas/services/canvas-manager.service';
import { fetchCanvasMeta, type CanvasMetaItem } from '@/canvas/services/canvas-meta.service';

// 运行时 Canvas 文件视图模型
interface CanvasFileVM {
  id: string;
  title: string;
  lastUpdated: Date;
  folderId?: string;
}

interface CanvasFolder {
  id: string;
  name: string;
  isExpanded: boolean;
  files: CanvasFileVM[];
}

interface CanvasFileSectionProps {
  onCanvasSelect?: (canvasId: string) => void;
  currentCanvasId?: string;
  className?: string;
}

export function CanvasFileSection({
  onCanvasSelect,
  currentCanvasId,
  className
}: CanvasFileSectionProps) {
  const t = useTranslations();
  const format = useFormatter();
  const [folders, setFolders] = useState<CanvasFolder[]>([]);
  const [recentFiles, setRecentFiles] = useState<CanvasFileVM[]>([]);

  // 加载画布列表（最近更新）
  useEffect(() => {
    let mounted = true;
    const controller = new AbortController();
    (async () => {
      try {
        const items = await fetchCanvasMeta({ limit: 50, signal: controller.signal });
        if (!mounted) return;
        const mapped: CanvasFileVM[] = (items || []).map((c: CanvasMetaItem) => ({
          id: c.id,
          title: c.title || t('canvas.untitled'),
          lastUpdated: new Date(c.updatedAt),
          folderId: c.folderId || undefined,
        }));
        setRecentFiles(mapped);
        // 基于 folderId 简易分组（若将来需要）
        const groups = new Map<string, CanvasFileVM[]>();
        for (const file of mapped) {
          const key = file.folderId || 'root';
          if (!groups.has(key)) groups.set(key, []);
          groups.get(key)!.push(file);
        }
        const newFolders: CanvasFolder[] = Array.from(groups.entries()).map(([key, files]) => ({
          id: key,
          name: key === 'root' ? 'Root' : key,
          isExpanded: key === 'root',
          files,
        }));
        setFolders(newFolders);
      } catch (e) {
        console.warn('[CanvasFileSection] 加载画布列表失败:', e);
      }
    })();
    return () => { mounted = false; controller.abort(); };
  }, [t]);

  // 本地订阅：收到标题变更事件时立即更新列表以避免刷新
  useEffect(() => {
    const onTitleChanged = (e: any) => {
      try {
        const id = e?.detail?.id;
        const title = e?.detail?.title;
        if (!id || typeof title !== 'string') return;
        setRecentFiles((prev) => prev.map((f) => (f.id === id ? { ...f, title } : f)));
        setFolders((prev) => prev.map((folder) => ({
          ...folder,
          files: folder.files.map((f) => (f.id === id ? { ...f, title } : f)),
        })));
      } catch {}
    };
    try { window.addEventListener('canvas:title-changed', onTitleChanged as any); } catch {}
    return () => { try { window.removeEventListener('canvas:title-changed', onTitleChanged as any); } catch {} };
  }, []);

  const handleToggleFolder = (folderId: string) => {
    setFolders(prev => prev.map(folder =>
      folder.id === folderId
        ? { ...folder, isExpanded: !folder.isExpanded }
        : folder
    ));
  };

  const handleCanvasSelect = (canvasId: string) => {
    onCanvasSelect?.(canvasId);
  };

  const handleNewCanvas = async () => {
    try {
      const created = await canvasManager.createCanvas(t('canvas.untitled'));
      // 追加到最近列表
      const newItem: CanvasFileVM = {
        id: created.id,
        title: created.title,
        lastUpdated: new Date(created.updatedAt),
        folderId: created.folderId || undefined,
      };
      setRecentFiles(prev => [newItem, ...prev]);
      onCanvasSelect?.(created.id);
    } catch (e) {
      console.warn('[CanvasFileSection] 创建画布失败:', e);
    }
  };

  const formatDate = (date: Date) =>
    format.dateTime(date, { month: 'short', day: 'numeric' });

  return (
    <div className={cn("flex flex-col h-full", className)}>
      {/* 头部 */}
      <div className="flex items-center justify-between p-3 border-b">
        <div className="flex items-center space-x-2">
          <FileText className="h-4 w-4 text-muted-foreground" />
          <span className="font-medium text-sm">{t('sidebar.canvasFiles')}</span>
          <Badge variant="secondary" className="text-xs">
            {recentFiles.length}
          </Badge>
        </div>

        <Button
          variant="ghost"
          size="sm"
          onClick={handleNewCanvas}
          className="h-6 w-6 p-0"
        >
          <Plus className="h-3 w-3" />
        </Button>
      </div>

      {/* 文件列表 */}
      <ScrollArea className="flex-1">
        <div className="p-2 space-y-1">
          {/* 最近文件 */}
          <div className="space-y-1">
            <div className="flex items-center space-x-2 px-2 py-1 text-xs text-muted-foreground">
              <Calendar className="h-3 w-3" />
              <span>{t('sidebar.recent', {default: 'Recent'})}</span>
            </div>
            {recentFiles.slice(0, 10).map((file) => (
              <Button
                key={file.id}
                variant={currentCanvasId === file.id ? "secondary" : "ghost"}
                className="w-full justify-start h-8 px-2 text-xs"
                onClick={() => handleCanvasSelect(file.id)}
              >
                <div className="flex items-center justify-between w-full">
                  <div className="flex items-center space-x-2 min-w-0">
                    <FileText className="h-3 w-3 text-muted-foreground flex-shrink-0" />
                    <span className="truncate">{file.title}</span>
                  </div>
                  <span className="text-xs text-muted-foreground ml-2 flex-shrink-0">
                    {formatDate(file.lastUpdated)}
                  </span>
                </div>
              </Button>
            ))}
          </div>

          {/* 文件夹 */}
          {folders.map((folder) => (
            <div key={folder.id} className="space-y-1">
              <Button
                variant="ghost"
                className="w-full justify-start h-6 px-2 text-xs"
                onClick={() => handleToggleFolder(folder.id)}
              >
                <div className="flex items-center space-x-2">
                  {folder.isExpanded ? (
                    <ChevronDown className="h-3 w-3" />
                  ) : (
                    <ChevronRight className="h-3 w-3" />
                  )}
                  <Folder className="h-3 w-3 text-muted-foreground" />
                  <span>{folder.name}</span>
                  <Badge variant="outline" className="text-xs h-4 px-1">
                    {folder.files.length}
                  </Badge>
                </div>
              </Button>

              {folder.isExpanded && (
                <div className="ml-4 space-y-1">
                  {folder.files.map((file) => (
                    <Button
                      key={file.id}
                      variant={currentCanvasId === file.id ? "secondary" : "ghost"}
                      className="w-full justify-start h-7 px-2 text-xs"
                      onClick={() => handleCanvasSelect(file.id)}
                    >
                      <div className="flex items-center justify-between w-full">
                        <div className="flex items-center space-x-2 min-w-0">
                          <FileText className="h-3 w-3 text-muted-foreground flex-shrink-0" />
                          <span className="truncate">{file.title}</span>
                        </div>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-4 w-4 p-0 opacity-0 group-hover:opacity-100"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <MoreHorizontal className="h-3 w-3" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem>{t('sidebar.rename', {default: 'Rename'})}</DropdownMenuItem>
                            <DropdownMenuItem>{t('sidebar.duplicate', {default: 'Duplicate'})}</DropdownMenuItem>
                            <DropdownMenuItem className="text-destructive">
                              {t('sidebar.delete', {default: 'Delete'})}
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </Button>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      </ScrollArea>
    </div>
  );
}
