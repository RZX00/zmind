'use client';

import React, { useState, useRef } from 'react';
import {useTranslations, useFormatter} from 'next-intl';
import { useSearchParams } from 'next/navigation';
import { toast } from 'sonner';
import { createClient } from '@/lib/supabase/client';
import { uploadKnowledgeBaseFile } from '@/lib/knowledge-base-upload';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { requiredEnv } from '@/lib/env-utils';
import { getCurrentWorkspaceId } from '@/lib/workspace-session';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  CloudUpload,
  FileText,
  FolderPlusIcon,
  PencilLine,
  Trash2,
} from 'lucide-react';
import { KnowledgeBasePageHeader } from './knowledge-base-header';
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  DragStartEvent,
  DragEndEvent,
  useSensors,
  useSensor,
  DragOverlay,
} from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { SharedTreeItem, FileDragOverlay } from '@/components/knowledge-base/shared-kb-tree';
import { KBFilePreviewModal } from './kb-file-preview-modal';
import { TextEntryModal } from './text-entry-modal';
import { KBDeleteConfirmDialog } from './kb-delete-confirm-dialog';
import { EditSummaryModal } from './edit-summary-modal';
import { FileNameValidator } from '@/lib/validation';
import { useFileStorageUsage } from '@/hooks/react-query/files';

const API_URL = requiredEnv('NEXT_PUBLIC_BACKEND_URL');
const API_BASE = API_URL.endsWith('/api') ? API_URL : `${API_URL}/api`;

const formatBytes = (bytes: number) => {
  if (!bytes || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const idx = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / Math.pow(1024, idx);
  const fixed = idx === 0 ? 0 : 1;
  return `${value.toFixed(fixed)} ${units[idx]}`;
};

const getFileTypeInfo = (filename: string) => {
  const extension = filename.split('.').pop()?.toLowerCase() || '';
  const fileType = extension.toUpperCase();
  const getShadowColor = (ext: string) => {
    switch (ext) {
      case 'pdf':
        return 'shadow-red-200/70';
      case 'doc':
      case 'docx':
        return 'shadow-blue-200/70';
      case 'ppt':
      case 'pptx':
        return 'shadow-orange-200/70';
      case 'xls':
      case 'xlsx':
      case 'csv':
        return 'shadow-emerald-200/70';
      case 'txt':
      case 'md':
        return 'shadow-slate-200/70';
      case 'jpg':
      case 'jpeg':
      case 'png':
      case 'gif':
      case 'webp':
        return 'shadow-fuchsia-200/70';
      case 'mp3':
      case 'wav':
      case 'm4a':
      case 'ogg':
        return 'shadow-amber-200/70';
      case 'mp4':
      case 'mov':
      case 'webm':
      case 'mkv':
        return 'shadow-indigo-200/70';
      default:
        return 'shadow-sky-200/70';
    }
  };
  return { extension: fileType, shadowClass: getShadowColor(extension) };
};

const normalizeSummary = (summary?: string | null) => {
  if (!summary) return '';
  let cleaned = summary.trim();
  cleaned = cleaned.replace(/^Here is a concise summary for an AI agent's knowledge base:\s*/i, '');
  cleaned = cleaned.replace(/^\*{0,2}File Summary:\*{0,2}\s*/i, '');
  return cleaned.trim();
};

const useFormatDate = () => {
  const t = useTranslations();
  const format = useFormatter();
  return (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffTime = Math.abs(now.getTime() - date.getTime());
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    if (diffDays === 1) return t('knowledge.today', {default: 'Today'});
    if (diffDays === 2) return t('knowledge.yesterday', {default: 'Yesterday'});
    if (diffDays <= 7) return t('knowledge.daysAgo', {count: diffDays, default: `${diffDays} days ago`});
    return format.dateTime(date, { month: 'short', day: 'numeric' });
  };
};

export interface Folder {
  folder_id: string;
  name: string;
  description?: string;
  entry_count: number;
  created_at: string;
}

export interface Entry {
  entry_id: string;
  filename: string;
  summary: string;
  file_size: number;
  created_at: string;
  folder_id?: string;
  mime_type?: string | null;
  updated_at?: string | null;
}

interface TreeItem {
  id: string;
  type: 'folder' | 'file';
  name: string;
  parentId?: string;
  data?: Folder | Entry;
  children?: TreeItem[];
  expanded?: boolean;
}

// Load folders + recent files via Supabase (matches page’s in-file hook)
const useKnowledgeFolders = () => {
  const [folders, setFolders] = useState<Folder[]>([]);
  const [allFiles, setAllFiles] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchFolders = async () => {
    try {
      const supabase = createClient();
      const workspaceId = getCurrentWorkspaceId();
      if (!workspaceId) {
        setFolders([]);
        setAllFiles([]);
        return;
      }

      const { data: foldersData, error: foldersError } = await supabase
        .from('knowledge_base_folders')
        .select('folder_id, name, description, created_at')
        .eq('account_id', workspaceId)
        .order('created_at', { ascending: false });
      if (foldersError) {
        console.error('Supabase error fetching folders:', foldersError);
        return;
      }

      const { data: allFilesData, error: allFilesError } = await supabase
        .from('knowledge_base_entries')
        .select('entry_id, filename, summary, file_size, mime_type, created_at, updated_at, folder_id')
        .eq('account_id', workspaceId)
        .order('created_at', { ascending: false });
      if (allFilesError) {
        console.error('Supabase error fetching all files:', allFilesError);
      } else {
        setAllFiles(allFilesData || []);
      }

      const foldersWithCounts = await Promise.all(
        (foldersData || []).map(async (folder) => {
          const { count, error: countError } = await supabase
            .from('knowledge_base_entries')
            .select('*', { count: 'exact', head: true })
            .eq('folder_id', folder.folder_id)
            .eq('account_id', workspaceId);
          if (countError) {
            console.error('Error counting entries:', countError);
          }
          return {
            folder_id: folder.folder_id,
            name: folder.name,
            description: folder.description,
            entry_count: count || 0,
            created_at: folder.created_at,
          } as Folder;
        })
      );

      setFolders(foldersWithCounts);
    } catch (error) {
      console.error('Failed to fetch folders:', error);
    } finally {
      setLoading(false);
    }
  };

  React.useEffect(() => {
    fetchFolders();
  }, []);

  return { folders, allFiles, loading, refetch: fetchFolders };
};

export interface KnowledgeBaseManagerProps {
  showHeader?: boolean;
  headerTitle?: string;
  headerDescription?: string;
  maxHeight?: string;
  enableAssignments?: boolean;
  agentId?: string;
}

export function KnowledgeBaseManager({
  showHeader = true,
  headerTitle = 'Knowledge Base',
  headerDescription = '',
  maxHeight,
  enableAssignments = false,
  agentId,
}: KnowledgeBaseManagerProps) {
  const t = useTranslations();
  const formatDate = useFormatDate();
  const searchParams = useSearchParams();
  const { data: storageUsage } = useFileStorageUsage(!enableAssignments);
  const requestedEntryId =
    searchParams?.get('entry') ||
    searchParams?.get('entryId') ||
    searchParams?.get('kb_entry_id') ||
    '';
  const perFileBytes = storageUsage?.max_file_bytes ?? 0;
  const showHeaderText = enableAssignments || !showHeader;
  const [treeData, setTreeData] = useState<TreeItem[]>([]);
  const [folderEntries, setFolderEntries] = useState<{ [folderId: string]: Entry[] }>({});
  const [loadingFolders, setLoadingFolders] = useState<{ [folderId: string]: boolean }>({});
  const [movingFiles, setMovingFiles] = useState<{ [fileId: string]: boolean }>({});
  const [selectedItem, setSelectedItem] = useState<TreeItem | null>(null);
  const [editingFolder, setEditingFolder] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');
  const [validationError, setValidationError] = useState<string | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const editInputRef = useRef<HTMLInputElement>(null);

  const buildAuthHeaders = (token: string, extra?: Record<string, string>) => {
    const workspaceId = getCurrentWorkspaceId();
    return {
      Authorization: `Bearer ${token}`,
      ...(workspaceId ? { 'X-Workspace-Id': workspaceId } : {}),
      ...(extra || {}),
    };
  };

  const [deleteConfirm, setDeleteConfirm] = useState<{
    isOpen: boolean;
    item: { id: string; name: string; type: 'folder' | 'file' } | null;
    isDeleting: boolean;
  }>({ isOpen: false, item: null, isDeleting: false });

  const [uploadStatus, setUploadStatus] = useState<{
    [folderId: string]: {
      isUploading: boolean;
      progress: number;
      currentFile?: string;
      totalFiles?: number;
      completedFiles?: number;
    };
  }>({});

  const [editSummaryModal, setEditSummaryModal] = useState<{
    isOpen: boolean;
    fileId: string;
    fileName: string;
    currentSummary: string;
  }>({ isOpen: false, fileId: '', fileName: '', currentSummary: '' });

  const [filePreviewModal, setFilePreviewModal] = useState<{ isOpen: boolean; file: Entry | null }>({ isOpen: false, file: null });
  const [autoOpenedEntryId, setAutoOpenedEntryId] = useState<string | null>(null);

  const { folders, allFiles, loading: foldersLoading, refetch: refetchFolders } = useKnowledgeFolders();
  const folderNameMap = React.useMemo(() => {
    return new Map(folders.map((folder) => [folder.folder_id, folder.name]));
  }, [folders]);
  const [uploadFolderId, setUploadFolderId] = useState<string>('');
  const [isDropActive, setIsDropActive] = useState(false);
  const dropInputRef = useRef<HTMLInputElement>(null);
  const sortedFiles = React.useMemo(() => {
    return [...allFiles].sort((a, b) => {
      const aDate = new Date(a.updated_at || a.created_at).getTime();
      const bDate = new Date(b.updated_at || b.created_at).getTime();
      return bDate - aDate;
    });
  }, [allFiles]);
  const { filesByFolder, unfiledFiles } = React.useMemo(() => {
    const byFolder: { [folderId: string]: Entry[] } = {};
    const unfiled: Entry[] = [];
    const folderIdSet = new Set(folders.map((folder) => folder.folder_id));
    sortedFiles.forEach((file) => {
      const folderId = file.folder_id;
      if (folderId && folderIdSet.has(folderId)) {
        if (!byFolder[folderId]) {
          byFolder[folderId] = [];
        }
        byFolder[folderId].push(file);
      } else {
        unfiled.push(file);
      }
    });
    return { filesByFolder: byFolder, unfiledFiles: unfiled };
  }, [folders, sortedFiles]);

  React.useEffect(() => {
    if (!requestedEntryId) {
      if (autoOpenedEntryId !== null) {
        setAutoOpenedEntryId(null);
      }
      return;
    }
    if (autoOpenedEntryId === requestedEntryId) return;
    const target = allFiles.find((file) => file.entry_id === requestedEntryId);
    if (!target) return;
    setFilePreviewModal({ isOpen: true, file: target });
    setAutoOpenedEntryId(requestedEntryId);
  }, [requestedEntryId, allFiles, autoOpenedEntryId]);

  React.useEffect(() => {
    if (!uploadFolderId && folders.length > 0) {
      setUploadFolderId(folders[0].folder_id);
      return;
    }
    if (uploadFolderId && !folders.some((folder) => folder.folder_id === uploadFolderId)) {
      setUploadFolderId(folders[0]?.folder_id || '');
    }
  }, [folders, uploadFolderId]);

  // Assignment mode state
  const [selectedEntries, setSelectedEntries] = useState<Set<string>>(new Set());
  const [assignmentsLoading, setAssignmentsLoading] = useState(false);

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  // Build tree from folders and cached folderEntries
  React.useEffect(() => {
    const tree: TreeItem[] = folders.map((folder) => ({
      id: folder.folder_id,
      type: 'folder',
      name: folder.name,
      data: folder,
      children:
        folderEntries[folder.folder_id]?.map((entry) => ({
          id: entry.entry_id,
          type: 'file',
          name: entry.filename,
          parentId: folder.folder_id,
          data: entry,
        })) || [],
      expanded: false,
    }));
    setTreeData(tree);
  }, [folders, folderEntries]);

  // Load assignments for agent (if enabled)
  React.useEffect(() => {
    const loadAssignments = async () => {
      if (!enableAssignments || !agentId) return;
      try {
        setAssignmentsLoading(true);
        const supabase = createClient();
        const { data: { session } } = await supabase.auth.getSession();
        if (!session?.access_token) return;
        const res = await fetch(`${API_BASE}/knowledge-base/agents/${agentId}/assignments`, {
          headers: buildAuthHeaders(session.access_token),
        });
        if (res.ok) {
          const json = await res.json();
          const set = new Set<string>();
          Object.entries(json || {}).forEach(([entryId, enabled]) => {
            if (enabled) set.add(entryId);
          });
          setSelectedEntries(set);
          // Preload entries for all folders to allow folder-level selection state
          for (const f of folders) {
            if (!folderEntries[f.folder_id]) await fetchFolderEntries(f.folder_id);
          }
        }
      } catch (e) {
        // non-fatal
      } finally {
        setAssignmentsLoading(false);
      }
    };
    loadAssignments();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enableAssignments, agentId, folders.length]);

  const handleCreateFolder = async () => {
    try {
      const supabase = createClient();
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session?.access_token) return toast.error(t('knowledge.toasts.authError', {default: 'Authentication error'}));

      const response = await fetch(`${API_BASE}/knowledge-base/folders`, {
        method: 'POST',
        headers: buildAuthHeaders(session.access_token, { 'Content-Type': 'application/json' }),
        body: JSON.stringify({ name: 'Untitled Folder' }),
      });
      if (!response.ok) {
        const errorData = await response.json().catch(() => null);
        return toast.error(errorData?.detail || t('knowledge.toasts.createFolderFailed', {default: 'Failed to create folder'}));
      }
      const newFolder = await response.json();
      toast.success(t('knowledge.toasts.createFolderSuccess', {default: 'Folder created successfully'}));
      refetchFolders();
      setTimeout(() => {
        setEditingFolder(newFolder.folder_id);
        setEditingName(newFolder.name);
      }, 100);
    } catch (e) {
      console.error(e);
      toast.error(t('knowledge.toasts.createFolderFailed', {default: 'Failed to create folder'}));
    }
  };

  const fetchFolderEntries = async (folderId: string) => {
    try {
      setLoadingFolders((p) => ({ ...p, [folderId]: true }));
      const supabase = createClient();
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session?.access_token) return toast.error(t('knowledge.toasts.authError', {default: 'Authentication error'}));

      const response = await fetch(`${API_BASE}/knowledge-base/folders/${folderId}/entries`, {
        headers: buildAuthHeaders(session.access_token),
      });
      const data = await response.json();
      const entries = Array.isArray(data) ? data : data.entries || [];
      setFolderEntries((prev) => ({ ...prev, [folderId]: entries }));
    } catch (e) {
      console.error('Failed to load entries', e);
    } finally {
      setLoadingFolders((p) => ({ ...p, [folderId]: false }));
    }
  };

  const handleStartEdit = (folderId: string, currentName: string) => {
    setEditingFolder(folderId);
    setEditingName(currentName);
    setValidationError(null);
    setTimeout(() => {
      editInputRef.current?.focus();
      editInputRef.current?.select();
    }, 0);
  };

  const handleEditChange = (newName: string) => {
    setEditingName(newName);
    const existingNames = folders.map((f) => f.name).filter((name) => name !== folders.find((f) => f.folder_id === editingFolder)?.name);
    const nameValidation = FileNameValidator.validateName(newName, 'folder');
    const hasConflict = nameValidation.isValid && FileNameValidator.checkNameConflict(newName, existingNames);
    const isValid = nameValidation.isValid && !hasConflict;
    const errorMessage = hasConflict ? t('knowledge.toasts.folderNameExists', {default: 'A folder with this name already exists'}) : FileNameValidator.getFriendlyErrorMessage(newName, 'folder');
    setValidationError(isValid ? null : errorMessage);
  };

  const handleFinishEdit = async () => {
    if (!editingFolder || !editingName.trim()) {
      setEditingFolder(null);
      return;
    }
    const trimmedName = editingName.trim();
    const existingNames = folders.map((f) => f.name).filter((name) => name !== folders.find((f) => f.folder_id === editingFolder)?.name);
    const nameValidation = FileNameValidator.validateName(trimmedName, 'folder');
    const hasConflict = nameValidation.isValid && FileNameValidator.checkNameConflict(trimmedName, existingNames);
    if (!nameValidation.isValid || hasConflict) {
      return toast.error(hasConflict ? t('knowledge.toasts.folderNameExists', {default: 'A folder with this name already exists'}) : FileNameValidator.getFriendlyErrorMessage(trimmedName, 'folder'));
    }
    try {
      const supabase = createClient();
      const { error } = await supabase.from('knowledge_base_folders').update({ name: trimmedName }).eq('folder_id', editingFolder);
      if (error) {
        console.error('Supabase error:', error);
        return toast.error(error.message?.includes('duplicate') || (error as any).code === '23505' ? t('knowledge.toasts.folderNameExists', {default: 'A folder with this name already exists'}) : t('knowledge.toasts.renameFolderFailed', {default: 'Failed to rename folder'}));
      }
      toast.success(t('knowledge.toasts.renameFolderSuccess', {default: 'Folder renamed successfully'}));
      refetchFolders();
    } catch (e) {
      console.error(e);
      toast.error(t('knowledge.toasts.renameFolderFailed', {default: 'Failed to rename folder'}));
    }
    setEditingFolder(null);
    setEditingName('');
    setValidationError(null);
  };

  const handleEditKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleFinishEdit();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setEditingFolder(null);
      setEditingName('');
      setValidationError(null);
    }
  };

  const handleEditSummary = (fileId: string, fileName: string, currentSummary: string) => {
    setEditSummaryModal({ isOpen: true, fileId, fileName, currentSummary });
  };

  const handleSaveSummary = async (newSummary: string): Promise<void> => {
    try {
      const supabase = createClient();
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session?.access_token) throw new Error('No session found');
      const response = await fetch(`${API_BASE}/knowledge-base/entries/${editSummaryModal.fileId}`, {
        method: 'PATCH',
        headers: buildAuthHeaders(session.access_token, { 'Content-Type': 'application/json' }),
        body: JSON.stringify({ summary: newSummary }),
      });
      if (!response.ok) {
        const errorData = await response.json().catch(() => null);
        toast.error(errorData?.detail || t('knowledge.toasts.updateSummaryFailed', {default: 'Failed to update summary'}));
        return;
      }
      toast.success(t('knowledge.toasts.updateSummarySuccess', {default: 'Summary updated successfully'}));
      const fileItem = treeData.flatMap((folder) => folder.children || []).find((file) => file.id === editSummaryModal.fileId);
      const parentFolderId =
        fileItem?.parentId || allFiles.find((file) => file.entry_id === editSummaryModal.fileId)?.folder_id;
      if (parentFolderId) await fetchFolderEntries(parentFolderId);
      refetchFolders();
    } catch (e) {
      console.error(e);
      toast.error(t('knowledge.toasts.updateSummaryFailed', {default: 'Failed to update summary'}));
    }
  };

  const handleMoveFile = async (fileId: string, targetFolderId: string) => {
    setMovingFiles((p) => ({ ...p, [fileId]: true }));
    try {
      const supabase = createClient();
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session?.access_token) throw new Error('No session found');
      const response = await fetch(`${API_BASE}/knowledge-base/entries/${fileId}/move`, {
        method: 'PUT',
        headers: buildAuthHeaders(session.access_token, { 'Content-Type': 'application/json' }),
        body: JSON.stringify({ folder_id: targetFolderId }),
      });
      if (!response.ok) return toast.error(t('knowledge.toasts.moveFileFailed', {default: 'Failed to move file'}));
      toast.success(t('knowledge.toasts.moveFileSuccess', {default: 'File moved successfully'}));
      refetchFolders();
      const movedItem = treeData.flatMap((folder) => folder.children || []).find((file) => file.id === fileId);
      if (movedItem) {
        await fetchFolderEntries(movedItem.parentId!);
        await fetchFolderEntries(targetFolderId);
      }
    } catch (e) {
      toast.error(t('knowledge.toasts.moveFileFailed', {default: 'Failed to move file'}));
    } finally {
      setMovingFiles((p) => ({ ...p, [fileId]: false }));
    }
  };

  const handleDelete = (id: string, type: 'folder' | 'file') => {
    const name =
      type === 'folder'
        ? folders.find((folder) => folder.folder_id === id)?.name
        : allFiles.find((file) => file.entry_id === id)?.filename;
    const fallback = treeData.flatMap((folder) => [folder, ...(folder.children || [])]).find((item) => item.id === id);
    const itemName = name || fallback?.name;
    if (!itemName) return;
    setDeleteConfirm({ isOpen: true, item: { id, name: itemName, type }, isDeleting: false });
  };

  const confirmDelete = async () => {
    if (!deleteConfirm.item) return;
    const { id, type } = deleteConfirm.item;
    setDeleteConfirm((prev) => ({ ...prev, isDeleting: true }));
    try {
      const supabase = createClient();
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session?.access_token) throw new Error('No session found');
      const endpoint = type === 'folder' ? `${API_BASE}/knowledge-base/folders/${id}` : `${API_BASE}/knowledge-base/entries/${id}`;
      const response = await fetch(endpoint, {
        method: 'DELETE',
        headers: buildAuthHeaders(session.access_token, { 'Content-Type': 'application/json' }),
      });
      if (!response.ok) return toast.error(type === 'folder' ? t('knowledge.toasts.deleteFolderFailed', {default: 'Failed to delete folder'}) : t('knowledge.toasts.deleteFileFailed', {default: 'Failed to delete file'}));
      toast.success(`${type === 'folder' ? 'Folder' : 'File'} deleted`);
      refetchFolders();
      if (type === 'file') {
        const parentFolderId = allFiles.find((file) => file.entry_id === id)?.folder_id;
        if (parentFolderId) await fetchFolderEntries(parentFolderId);
      } else if (selectedItem?.id === id) {
        setSelectedItem(null);
      }
    } catch (e) {
      toast.error(type === 'folder' ? t('knowledge.toasts.deleteFolderFailed', {default: 'Failed to delete folder'}) : t('knowledge.toasts.deleteFileFailed', {default: 'Failed to delete file'}));
    } finally {
      setDeleteConfirm({ isOpen: false, item: null, isDeleting: false });
    }
  };

  const handleFolderToggle = async (folderId: string) => {
    const isExpanded = treeData.find((f) => f.id === folderId)?.expanded;
    setTreeData((prev) => prev.map((f) => (f.id === folderId ? { ...f, expanded: !isExpanded } : f)));
    if (!isExpanded && !folderEntries[folderId]) await fetchFolderEntries(folderId);
  };

  const handleDragStart = (event: DragStartEvent) => {
    setActiveId(event.active.id as string);
  };
  const handleDragEnd = async (event: DragEndEvent) => {
    try {
      const over = event.over;
      const active = event.active;
      setActiveId(null);
      if (!over || !active) return;
      const overId = String(over.id || '');
      // Expect droppable-<folderId>
      if (!overId.startsWith('droppable-')) return;
      const targetFolderId = overId.replace('droppable-', '');
      const fileId = String(active.id);
      // Find current parent for the file
      const fileItem = treeData.flatMap((f) => f.children || []).find((c) => c.id === fileId);
      const currentFolderId = fileItem?.parentId;
      if (!fileItem || !currentFolderId || currentFolderId === targetFolderId) return;
      await handleMoveFile(fileId, targetFolderId);
    } catch {}
  };

  // Assignment helpers
  const getFolderChildrenIds = (folderId: string): string[] => {
    const folder = treeData.find((f) => f.id === folderId);
    if (!folder || !folder.children) return [];
    return folder.children.filter((c) => c.type === 'file').map((c) => c.id);
  };

  const getFolderSelectionState = (folderId: string): { selected: boolean; indeterminate: boolean } => {
    const childIds = getFolderChildrenIds(folderId);
    if (childIds.length === 0) return { selected: false, indeterminate: false };
    const selectedCount = childIds.filter((id) => selectedEntries.has(id)).length;
    return {
      selected: selectedCount === childIds.length,
      indeterminate: selectedCount > 0 && selectedCount < childIds.length,
    };
  };

  const toggleEntrySelection = (entryId: string) => {
    setSelectedEntries((prev) => {
      const next = new Set(prev);
      if (next.has(entryId)) next.delete(entryId);
      else next.add(entryId);
      return next;
    });
  };

  const toggleFolderSelection = (folderId: string) => {
    const childIds = getFolderChildrenIds(folderId);
    const allSelected = childIds.every((id) => selectedEntries.has(id));
    setSelectedEntries((prev) => {
      const next = new Set(prev);
      if (allSelected) childIds.forEach((id) => next.delete(id));
      else childIds.forEach((id) => next.add(id));
      return next;
    });
  };

  const onToggleAssignment = (id: string) => {
    const item = treeData.flatMap((f) => [f, ...(f.children || [])]).find((i) => i.id === id);
    if (!item) return;
    if (item.type === 'folder') toggleFolderSelection(id);
    else toggleEntrySelection(id);
  };

  const saveAssignments = async () => {
    if (!enableAssignments || !agentId) return;
    try {
      const supabase = createClient();
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) throw new Error('No session');
      const res = await fetch(`${API_BASE}/knowledge-base/agents/${agentId}/assignments`, {
        method: 'POST',
        headers: buildAuthHeaders(session.access_token, { 'Content-Type': 'application/json' }),
        body: JSON.stringify({ entry_ids: Array.from(selectedEntries) }),
      });
      if (!res.ok) throw new Error('Failed to save assignments');
      toast.success(t('knowledge.toasts.saveAssignmentsSuccess', {default: 'Knowledge base access updated'}));
    } catch (e) {
      console.error(e);
      toast.error(t('knowledge.toasts.saveAssignmentsFailed', {default: 'Failed to save assignments'}));
    }
  };

  // Native drop-to-upload support on folders
  const handleNativeFileDrop = async (files: FileList, folderId: string) => {
    try {
      setUploadStatus((p) => ({ ...p, [folderId]: { isUploading: true, progress: 0, totalFiles: files.length, completedFiles: 0 } as any }));

      let completed = 0;
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        try {
          await uploadKnowledgeBaseFile(folderId, file);
          completed += 1;
          setUploadStatus((p) => ({ ...p, [folderId]: { ...(p[folderId] || {}), completedFiles: completed, progress: Math.round((completed / files.length) * 100), isUploading: completed < files.length } as any }));
        } catch (err) {
          const msg = err instanceof Error ? err.message : '';
          toast.error(t('knowledge.toasts.uploadFileFailed', {name: file.name, message: msg, default: `Failed to upload ${file.name}. ${msg}`}));
        }
      }
      await fetchFolderEntries(folderId);
      refetchFolders();
      toast.success(t('knowledge.toasts.uploadCompleted', {default: 'Upload completed'}));
    } catch (e) {
      console.error(e);
      toast.error(t('knowledge.toasts.uploadFailed', {default: 'Upload failed'}));
    } finally {
      setUploadStatus((p) => ({ ...p, [folderId]: { ...(p[folderId] || {}), isUploading: false } as any }));
    }
  };

  const handleDropZoneFiles = async (files: FileList) => {
    if (!files.length) return;
    if (!uploadFolderId) {
      toast.error(t('knowledge.toasts.selectFolder', {default: 'Select a folder to upload'}));
      return;
    }
    await handleNativeFileDrop(files, uploadFolderId);
  };

  const handleDropZoneDragOver = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setIsDropActive(true);
  };

  const handleDropZoneDragLeave = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setIsDropActive(false);
  };

  const handleDropZoneDrop = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setIsDropActive(false);
    const files = event.dataTransfer?.files;
    if (files && files.length) {
      handleDropZoneFiles(files);
    }
  };

  const handleDropZoneBrowse = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (files && files.length) {
      handleDropZoneFiles(files);
    }
    event.target.value = '';
  };

  const dropZoneSection = (
    <div
      className={`rounded-2xl border-[3px] border-dashed p-6 transition-colors min-h-[180px] lg:min-h-[220px] bg-card ${isDropActive ? 'border-sky-500/90 bg-sky-50/40 dark:border-sky-300/80 dark:bg-sky-950/20' : 'border-sky-300/80 dark:border-sky-300/50'}`}
      onDragOver={handleDropZoneDragOver}
      onDragLeave={handleDropZoneDragLeave}
      onDrop={handleDropZoneDrop}
    >
      <div className="flex flex-col gap-5">
        <div className="flex flex-col items-center text-center gap-2">
          <div className={`flex h-11 w-11 items-center justify-center rounded-xl transition-transform ${isDropActive ? 'bg-sky-100 text-sky-700 scale-105 dark:bg-sky-900/40 dark:text-sky-200' : 'bg-muted text-foreground/70'}`}>
            <CloudUpload className="h-6 w-6" />
          </div>
          <div>
            <div className={`text-base font-semibold ${isDropActive ? 'text-sky-700 dark:text-sky-200' : 'text-foreground'}`}>
              {t('knowledge.dropzone.title', {default: 'Drag files here to upload'})}
            </div>
            {perFileBytes > 0 && (
              <div className={`text-xs ${isDropActive ? 'text-sky-700/80 dark:text-sky-200/80' : 'text-muted-foreground'}`}>
                {t('knowledge.dropzone.limit', {max: formatBytes(perFileBytes), default: `Max ${formatBytes(perFileBytes)} per file`})}
              </div>
            )}
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-center gap-2">
          <Select
            value={uploadFolderId}
            onValueChange={(value) => setUploadFolderId(value)}
            disabled={folders.length === 0}
          >
            <SelectTrigger className="h-9 w-[160px]">
              <SelectValue placeholder={t('knowledge.dropzone.folderPlaceholder', {default: 'Choose folder'})} />
            </SelectTrigger>
            <SelectContent>
              {folders.map((folder) => (
                <SelectItem key={folder.folder_id} value={folder.folder_id}>
                  {folder.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            variant="outline"
            size="sm"
            onClick={() => dropInputRef.current?.click()}
          >
            {t('knowledge.dropzone.browse', {default: 'Browse files'})}
          </Button>
          <TextEntryModal
            folders={folders}
            onUploadComplete={refetchFolders}
            trigger={
              <Button variant="ghost" size="sm" className="text-muted-foreground">
                <FileText className="h-4 w-4 mr-2" />
                {t('knowledge.actions.newEntry', {default: 'New text entry'})}
              </Button>
            }
          />
        </div>
      </div>
      {folders.length === 0 && (
        <div className="mt-3 text-center text-xs text-muted-foreground">
          {t('knowledge.dropzone.empty', {default: 'Create a folder to start uploading.'})}
        </div>
      )}
      <input
        ref={dropInputRef}
        type="file"
        multiple
        className="hidden"
        onChange={handleDropZoneBrowse}
      />
    </div>
  );

  const renderFileCard = (file: Entry) => {
    const folderName = file.folder_id ? folderNameMap.get(file.folder_id) : undefined;
    const folderLabel = `${folderName || t('knowledge.files.unfiled', {default: 'Unfiled'})} /`;
    const info = getFileTypeInfo(file.filename);
    const summaryText = normalizeSummary(file.summary);
    return (
      <div
        key={file.entry_id}
        role="button"
        tabIndex={0}
        className={`group relative flex aspect-[3/4] w-full flex-col overflow-hidden rounded-lg border bg-card text-left shadow-sm ${info.shadowClass} transition hover:border-foreground/20 hover:shadow-md`}
        onClick={() => setFilePreviewModal({ isOpen: true, file })}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            setFilePreviewModal({ isOpen: true, file });
          }
        }}
      >
        <div className="relative flex h-full flex-col px-4 py-4">
          <div className="flex items-start justify-between gap-2">
            <div className="text-[11px] text-muted-foreground truncate">{folderLabel}</div>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-muted-foreground hover:text-destructive opacity-0 transition group-hover:opacity-100"
              aria-label={t('knowledge.files.delete', {default: 'Delete'})}
              title={t('knowledge.files.delete', {default: 'Delete'})}
              onClick={(event) => {
                event.stopPropagation();
                handleDelete(file.entry_id, 'file');
              }}
            >
              <Trash2 className="h-4 w-4" />
              <span className="sr-only">{t('knowledge.files.delete', {default: 'Delete'})}</span>
            </Button>
          </div>

          <div className="mt-4 space-y-2">
            <div className="text-sm font-semibold text-foreground font-serif line-clamp-2">{file.filename}</div>
            <div className="text-xs leading-relaxed text-muted-foreground line-clamp-4">
              {summaryText || t('knowledge.noSummary', {default: 'No summary'})}
            </div>
          </div>

          <div className="mt-auto pt-4 flex items-center justify-between text-[11px] text-muted-foreground">
            <span>{formatDate(file.updated_at || file.created_at)}</span>
            <span>{formatBytes(file.file_size || 0)}</span>
          </div>
        </div>
      </div>
    );
  };

  const renderFileGrid = (files: Entry[]) => (
    <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6">
      {files.map(renderFileCard)}
    </div>
  );

  const managementSection = (
    <section id="knowledge-files" className="space-y-6">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold text-foreground">
          {t('knowledge.files.managementTitle', {default: 'File management'})}
        </h3>
        <Button variant="outline" size="sm" onClick={handleCreateFolder}>
          <FolderPlusIcon className="h-4 w-4 mr-2" />
          {t('knowledge.actions.createFolder', {default: 'Create Folder'})}
        </Button>
      </div>
      {foldersLoading ? (
        <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6">
          {Array.from({ length: 6 }).map((_, index) => (
            <Skeleton key={`file-skeleton-${index}`} className="aspect-[3/4] w-full rounded-lg" />
          ))}
        </div>
      ) : folders.length === 0 && unfiledFiles.length === 0 ? (
        <div className="text-sm text-muted-foreground border rounded-lg p-6 bg-card">
          {t('knowledge.files.empty', {default: 'No files yet. Upload your first document to get started.'})}
        </div>
      ) : (
        <div className="space-y-6">
          {folders.map((folder) => {
            const files = filesByFolder[folder.folder_id] || [];
            const isEditing = editingFolder === folder.folder_id;
            return (
              <div key={folder.folder_id} className="space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-3">
                    {isEditing ? (
                      <div className="space-y-1">
                        <input
                          ref={editInputRef}
                          value={editingName}
                          onChange={(event) => handleEditChange(event.target.value)}
                          onKeyDown={handleEditKeyPress}
                          onBlur={handleFinishEdit}
                          className="h-8 rounded-md border border-input bg-background px-2 text-sm"
                          aria-label={t('knowledge.folders.renameLabel', {default: 'Folder name'})}
                        />
                        {validationError && (
                          <div className="text-xs text-destructive">{validationError}</div>
                        )}
                      </div>
                    ) : (
                      <div className="text-sm font-semibold text-foreground">
                        {folder.name} /
                      </div>
                    )}
                    <span className="text-xs text-muted-foreground">
                      {t('knowledge.files.count', {
                        count: files.length,
                        default: `${files.length} files`,
                      })}
                    </span>
                  </div>
                  <div className="flex items-center gap-1">
                    {!isEditing && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-muted-foreground hover:text-foreground"
                        aria-label={t('knowledge.actions.renameFolder', {default: 'Rename'})}
                        title={t('knowledge.actions.renameFolder', {default: 'Rename'})}
                        onClick={() => handleStartEdit(folder.folder_id, folder.name)}
                      >
                        <PencilLine className="h-4 w-4" />
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-muted-foreground hover:text-destructive"
                      aria-label={t('knowledge.files.delete', {default: 'Delete'})}
                      title={t('knowledge.files.delete', {default: 'Delete'})}
                      onClick={() => handleDelete(folder.folder_id, 'folder')}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
                {files.length > 0 ? (
                  renderFileGrid(files)
                ) : (
                  <div className="text-xs text-muted-foreground border rounded-lg p-4 bg-card">
                    {t('knowledge.files.emptyFolder', {default: 'Empty folder'})}
                  </div>
                )}
              </div>
            );
          })}
          {unfiledFiles.length > 0 && (
            <div className="space-y-3">
              <div className="flex items-center gap-3">
                <div className="text-sm font-semibold text-foreground">
                  {t('knowledge.files.unfiled', {default: 'Unfiled'})} /
                </div>
                <span className="text-xs text-muted-foreground">
                  {t('knowledge.files.count', {
                    count: unfiledFiles.length,
                    default: `${unfiledFiles.length} files`,
                  })}
                </span>
              </div>
              {renderFileGrid(unfiledFiles)}
            </div>
          )}
        </div>
      )}
    </section>
  );

  return (
    <div className={`w-full ${showHeader ? 'dashboard-page' : ''}`}>
      {showHeader && (
        <div className="dashboard-container">
          <KnowledgeBasePageHeader />
        </div>
      )}
      <div className={`${showHeader ? 'dashboard-container' : 'w-full'} ${showHeader ? '' : 'px-4'} py-2`} style={maxHeight ? { maxHeight } : undefined}>
        <div className="w-full min-h-[calc(100vh-300px)]">
          {showHeaderText && (
            <div className="flex flex-col gap-6 mb-8">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div className="space-y-1">
                  <h2 className="text-xl font-semibold text-foreground">{headerTitle || t('knowledge.title', {default: 'Knowledge Base'})}</h2>
                  <p className="text-sm text-muted-foreground">{headerDescription || t('knowledge.subtitle', {default: 'Turn files into a knowledge base you can ask anytime.'})}</p>
                </div>
                {enableAssignments && (
                  <div className="flex gap-3 items-center">
                    <Button onClick={saveAssignments} disabled={assignmentsLoading || !agentId}>
                      {t('knowledge.actions.saveAssignments', {default: 'Save Assignments'})}
                    </Button>
                  </div>
                )}
              </div>
            </div>
          )}

          <div className="space-y-8" onDragOver={(e) => e.preventDefault()} onDrop={(e) => e.preventDefault()}>
            {!enableAssignments && dropZoneSection}
            {!enableAssignments && managementSection}

            {enableAssignments && (
              <div className="space-y-3">
              <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
                <SortableContext items={treeData.map((t) => t.id)} strategy={verticalListSortingStrategy}>
                  <div className="space-y-3">
                    {treeData.length === 0 && (
                      <div className="text-sm text-muted-foreground border rounded-lg p-6 bg-card">{t('knowledge.emptyFolders', {default: 'No folders yet. Create your first folder to get started.'})}</div>
                    )}
                    {treeData.map((item) => {
                      // Build assignments map and indeterminate state across full tree for this render
                      const allAssignments: { [id: string]: boolean } = {};
                      const indeterminate: { [id: string]: boolean } = {};
                      treeData.forEach((folder) => {
                        if (folder.children && folder.children.length) {
                          const childIds = folder.children.filter((c) => c.type === 'file').map((c) => c.id);
                          const selectedCount = childIds.filter((id) => selectedEntries.has(id)).length;
                          allAssignments[folder.id] = selectedCount > 0 && selectedCount === childIds.length;
                          indeterminate[folder.id] = selectedCount > 0 && selectedCount < childIds.length;
                          folder.children.forEach((child) => {
                            if (child.type === 'file') allAssignments[child.id] = selectedEntries.has(child.id);
                          });
                        } else {
                          allAssignments[folder.id] = false;
                        }
                      });
                      return (
                        <SharedTreeItem
                          key={item.id}
                          item={item as any}
                          isLoadingEntries={loadingFolders[item.id]}
                          onExpand={() => handleFolderToggle(item.id)}
                          onSelect={setSelectedItem}
                          onDelete={handleDelete}
                          onStartEdit={handleStartEdit}
                          onFinishEdit={handleFinishEdit}
                          onEditChange={handleEditChange}
                          onEditKeyPress={handleEditKeyPress}
                          editInputRef={editInputRef}
                          onNativeFileDrop={handleNativeFileDrop}
                          uploadStatus={uploadStatus[item.id]}
                          validationError={editingFolder === item.id ? validationError : null}
                          movingFiles={movingFiles}
                          enableDnd={!enableAssignments}
                          enableActions={!enableAssignments}
                          enableEdit={!enableAssignments}
                          enableAssignment={enableAssignments}
                          assignments={enableAssignments ? allAssignments : undefined}
                          assignmentIndeterminate={enableAssignments ? indeterminate : undefined}
                          onToggleAssignment={enableAssignments ? onToggleAssignment : undefined}
                        />
                      );
                    })}
                  </div>
                </SortableContext>

                <DragOverlay>
                  {activeId ? <FileDragOverlay item={treeData.flatMap((f) => [f, ...(f.children || [])]).find((i) => i.id === activeId) as any} /> : null}
                </DragOverlay>
              </DndContext>
            </div>
            )}
          </div>
        </div>
      </div>

      {/* Modals */}
      <KBDeleteConfirmDialog
        isOpen={deleteConfirm.isOpen}
        onClose={() => setDeleteConfirm({ isOpen: false, item: null, isDeleting: false })}
        onConfirm={confirmDelete}
        itemName={deleteConfirm.item?.name || ''}
        itemType={deleteConfirm.item?.type || 'file'}
        isDeleting={deleteConfirm.isDeleting}
      />

      <EditSummaryModal
        isOpen={editSummaryModal.isOpen}
        onClose={() => setEditSummaryModal({ isOpen: false, fileId: '', fileName: '', currentSummary: '' })}
        fileName={editSummaryModal.fileName}
        currentSummary={editSummaryModal.currentSummary}
        onSave={handleSaveSummary}
      />

      {filePreviewModal.file && (
        <KBFilePreviewModal
          isOpen={filePreviewModal.isOpen}
          onClose={() => setFilePreviewModal({ isOpen: false, file: null })}
          file={filePreviewModal.file}
          onEditSummary={handleEditSummary}
        />
      )}
    </div>
  );
}
