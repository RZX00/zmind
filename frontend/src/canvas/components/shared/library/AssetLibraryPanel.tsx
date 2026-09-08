import React, { useEffect, useMemo, useState } from 'react';
import Image from 'next/image';
import {useTranslations, useFormatter} from 'next-intl';
import { X, Image as ImageIcon, File as FileIcon, Trash2, Link as LinkIcon, Download as DownloadIcon, Grid, List, Pencil } from 'lucide-react';
import { listAssets, signAsset, type AssetItem, removeAsset, renameAsset } from '@/canvas/services/asset-library.service';
import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import './AssetLibraryPanel.css';

interface AssetLibraryPanelProps {
  open: boolean;
  onClose: () => void;
  embedded?: boolean;
  className?: string;
}

const panelWidth = 400;

const AssetLibraryPanel: React.FC<AssetLibraryPanelProps> = ({ open, onClose, embedded = false, className }) => {
  const [tab, setTab] = useState<'assets' | 'knowledge'>('assets');
  const [assets, setAssets] = useState<AssetItem[]>([]);
  const [view, setView] = useState<'grid' | 'list'>('grid');
  const [loading, setLoading] = useState(false);
  const [urlMap, setUrlMap] = useState<Record<string, { fileUrl: string; downloadUrl: string }>>({});
  const [deleteTarget, setDeleteTarget] = useState<AssetItem | null>(null);
  const [renameTarget, setRenameTarget] = useState<AssetItem | null>(null);
  const [renameValue, setRenameValue] = useState('');

  const t = useTranslations();
  useEffect(() => {
    if (!open || tab !== 'assets') return;
    (async () => {
      setLoading(true);
      try {
        const items = await listAssets(60);
        setAssets(items);
      } finally {
        setLoading(false);
      }
    })();
  }, [open, tab]);

  const requestSign = async (item: AssetItem) => {
    if (urlMap[item.path]) return;
    try {
      const signed = await signAsset(item.path, item.name);
      setUrlMap(prev => ({ ...prev, [item.path]: signed }));
    } catch {}
  };

  const onDragStart = (e: React.DragEvent, item: AssetItem) => {
    const signed = urlMap[item.path];
    if (!signed) return;
    const payload = {
      type: 'asset-media',
      payload: {
        fileUrl: signed.fileUrl,
        fileDownloadUrl: signed.downloadUrl,
        fileName: item.name,
        fileType: item.contentType || 'application/octet-stream',
        fileSize: item.size,
        extension: item.extension,
        mediaType: item.mediaType,
        storagePath: item.path
      }
    };
    e.dataTransfer.setData('application/json', JSON.stringify(payload));
    e.dataTransfer.effectAllowed = 'copy';
  };

  const copyToClipboard = async (text: string) => {
    try { await navigator.clipboard.writeText(text); } catch {}
  };

  const requestDelete = (item: AssetItem) => {
    setDeleteTarget(item);
  };

  const doDelete = async () => {
    const item = deleteTarget;
    if (!item) return;
    try {
      if (!item.fileId) return;
      await removeAsset(item.fileId);
      setAssets(prev => prev.filter(a => a.path !== item.path));
    } catch (e) {
      // ignore for now
    } finally {
      setDeleteTarget(null);
    }
  };

  const openRenameDialog = (item: AssetItem) => {
    setRenameTarget(item);
    setRenameValue(item.name);
  };

  const doRename = async () => {
    const item = renameTarget;
    if (!item) return;
    const name = renameValue.trim();
    if (!name || name === item.name) {
      setRenameTarget(null);
      setRenameValue('');
      return;
    }
    try {
      if (!item.fileId) return;
      const oldExt = item.name.includes('.') ? item.name.slice(item.name.lastIndexOf('.') + 1) : '';
      const hasExt = name.includes('.');
      const targetName = hasExt ? name : (oldExt ? `${name}.${oldExt}` : name);
      const { newPath } = await renameAsset(item.fileId, targetName);
      setAssets(prev => prev.map(a => a.path === item.path ? { ...a, path: newPath || a.path, name: targetName } : a));
      // 清理旧签名
      setUrlMap(prev => { const n = { ...prev }; delete n[item.path]; return n; });
    } catch (e) {
      // ignore
    } finally {
      setRenameTarget(null);
      setRenameValue('');
    }
  };

  const closeRenameDialog = () => {
    setRenameTarget(null);
    setRenameValue('');
  };

  const managementDialogs = (
    <>
      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('assets.delete', { default: 'Delete' })}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('assets.deleteConfirm', { default: `Delete asset "${deleteTarget?.name || ''}"?` })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common.cancel', { default: 'Cancel' })}</AlertDialogCancel>
            <AlertDialogAction onClick={() => { void doDelete(); }}>
              {t('common.delete', { default: 'Delete' })}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={!!renameTarget} onOpenChange={(open) => { if (!open) closeRenameDialog(); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t('assets.rename', { default: 'Rename' })}</DialogTitle>
            <DialogDescription>
              {t('assets.renameHint', { default: 'You can omit the extension; we will keep the original extension automatically.' })}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="asset-rename-input">{t('assets.filename', { default: 'File name' })}</Label>
            <Input
              id="asset-rename-input"
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key !== 'Enter') return;
                e.preventDefault();
                if (!renameValue.trim()) return;
                void doRename();
              }}
              autoFocus
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={closeRenameDialog}>
              {t('common.cancel', { default: 'Cancel' })}
            </Button>
            <Button onClick={() => { void doRename(); }} disabled={!renameValue.trim()}>
              {t('common.save', { default: 'Save' })}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );

  const renderCard = (item: AssetItem) => {
    const signed = urlMap[item.path];
    const isImage = item.mediaType === 'image';
    return (
      <div key={item.path}
           className="group border border-border rounded-md overflow-hidden bg-white dark:bg-[#181a1b] hover:shadow-sm transition-shadow cursor-grab"
           draggable={!!signed}
           onDragStart={(e) => onDragStart(e, item)}
           onMouseEnter={() => requestSign(item)}
      >
        <div className={`w-full h-28 flex items-center justify-center overflow-hidden ${isImage ? 'bg-gray-50 checkerboard-dark' : 'bg-gray-50 dark:bg-[#232628]'}`}>
          {isImage && signed ? (
            <Image
              src={signed.fileUrl}
              alt={item.name}
              width={160}
              height={112}
              unoptimized
              loader={({ src }) => src}
              className="max-h-full object-contain"
              sizes="100vw"
            />
          ) : (
            <div className="flex items-center gap-2 text-gray-500 dark:text-zinc-400">
              <FileIcon size={18} /> <span className="text-xs">{item.extension || 'file'}</span>
            </div>
          )}
        </div>
        <div className="px-2 py-2 text-xs text-gray-700 dark:text-foreground flex items-center justify-between">
          <div className="truncate" title={item.name}>{item.name}</div>
          <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
            {signed && (
              <>
                <a href={signed.fileUrl} target="_blank" rel="noreferrer" title={t('assets.open', { default: 'Open' })} className="text-gray-500 dark:text-zinc-400 hover:text-gray-800 dark:hover:text-foreground"><LinkIcon size={14}/></a>
                <a href={signed.downloadUrl} target="_blank" rel="noreferrer" title={t('assets.download', { default: 'Download' })} className="text-gray-500 dark:text-zinc-400 hover:text-gray-800 dark:hover:text-foreground"><DownloadIcon size={14}/></a>
              </>
            )}
            <button className="text-gray-400 dark:text-zinc-500 hover:text-gray-800 dark:hover:text-foreground" title={t('assets.rename', { default: 'Rename' })} onClick={() => openRenameDialog(item)}><Pencil size={14}/></button>
            <button className="text-gray-400 dark:text-zinc-500 hover:text-red-600 dark:hover:text-red-500" title={t('assets.delete', { default: 'Delete' })} onClick={() => requestDelete(item)}><Trash2 size={14}/></button>
          </div>
        </div>
      </div>
    );
  };

  const renderRow = (item: AssetItem) => {
    const signed = urlMap[item.path];
    const isImage = item.mediaType === 'image';
    return (
      <div key={item.path}
           className="group border-b last:border-b-0 border-border px-2 py-2 flex items-center gap-2 hover:bg-accent/40 cursor-grab"
           draggable={!!signed}
           onDragStart={(e) => onDragStart(e, item)}
           onMouseEnter={() => requestSign(item)}
      >
        <div className={`w-10 h-10 flex items-center justify-center overflow-hidden rounded ${isImage ? 'bg-gray-100 checkerboard-dark' : 'bg-gray-100 dark:bg-[#232628]'}`}>
          {isImage && signed ? (
            <Image
              src={signed.fileUrl}
              alt={item.name}
              width={40}
              height={40}
              unoptimized
              loader={({ src }) => src}
              className="max-h-full object-contain"
            />
          ) : (
            <FileIcon size={16} className="text-gray-500 dark:text-zinc-400" />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-sm text-gray-800 dark:text-foreground truncate" title={item.name}>{item.name}</div>
          <div className="text-[11px] text-gray-500 dark:text-zinc-400">{item.contentType || 'application/octet-stream'}</div>
        </div>
        <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
          {signed && (
            <>
              <button onClick={() => copyToClipboard(signed.fileUrl)} title={t('assets.copyLink', { default: 'Copy link' })} className="text-gray-500 dark:text-zinc-400 hover:text-gray-800 dark:hover:text-foreground"><LinkIcon size={14}/></button>
              <a href={signed.downloadUrl} target="_blank" rel="noreferrer" title={t('assets.download', { default: 'Download' })} className="text-gray-500 dark:text-zinc-400 hover:text-gray-800 dark:hover:text-foreground"><DownloadIcon size={14}/></a>
            </>
          )}
          <button className="text-gray-400 dark:text-zinc-500 hover:text-gray-800 dark:hover:text-foreground" title={t('assets.rename', { default: 'Rename' })} onClick={() => openRenameDialog(item)}><Pencil size={14}/></button>
          <button className="text-gray-400 dark:text-zinc-500 hover:text-red-600 dark:hover:text-red-400" title={t('assets.delete', { default: 'Delete' })} onClick={() => requestDelete(item)}><Trash2 size={14}/></button>
        </div>
      </div>
    );
  };

  if (embedded) {
    return (
      <>
        <div className={className} role="dialog" aria-label={t('assets.aria.panelTitle', { default: 'Asset Library' })}>
          <div className="h-12 px-3 flex items-center justify-between border-b border-border">
            <div className="flex items-center gap-3 text-foreground">
              <button className={`px-2 py-1 rounded ${tab==='assets' ? 'bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400' : 'text-gray-600 dark:text-muted-foreground hover:bg-accent/40'}`} onClick={() => setTab('assets')}>{t('assets.tab.assets', { default: 'Assets' })}</button>
              <button className={`px-2 py-1 rounded ${tab==='knowledge' ? 'bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400' : 'text-gray-600 dark:text-muted-foreground hover:bg-accent/40'}`} onClick={() => setTab('knowledge')}>{t('assets.tab.knowledge', { default: 'Knowledge' })}</button>
            </div>
            <div className="flex items-center gap-2">
              <button className={`w-8 h-8 rounded hover:bg-accent/60 ${view==='grid'?'text-gray-900 dark:text-foreground':'text-gray-500 dark:text-muted-foreground'}`} onClick={() => setView('grid')} title={t('assets.grid', { default: 'Grid' })}><Grid size={16}/></button>
              <button className={`w-8 h-8 rounded hover:bg-accent/60 ${view==='list'?'text-gray-900 dark:text-foreground':'text-gray-500 dark:text-muted-foreground'}`} onClick={() => setView('list')} title={t('assets.list', { default: 'List' })}><List size={16}/></button>
              <button className="w-8 h-8 rounded hover:bg-accent/60 text-gray-500 dark:text-muted-foreground" onClick={onClose} aria-label={t('common.cancel', { default: 'Close' })}><X size={16}/></button>
            </div>
          </div>
          <div className="h-[calc(100%-48px)] overflow-auto p-3">
            {tab === 'assets' ? (
              loading ? (
                <div className="text-center text-sm text-gray-500 dark:text-zinc-400 py-10">{t('assets.loading', {default: 'Loading…'})}</div>
              ) : assets.length === 0 ? (
                <div className="text-center text-sm text-gray-500 dark:text-zinc-400 py-10">{t('assets.empty', {default: 'No assets yet. Drag files onto the canvas to add them.'})}</div>
              ) : view === 'grid' ? (
                <div className="grid grid-cols-2 gap-3">
                  {assets.map(renderCard)}
                </div>
              ) : (
                <div className="border border-border rounded-md overflow-hidden bg-white dark:bg-[#181a1b]">
                  {assets.map(renderRow)}
                </div>
              )
            ) : (
              <KnowledgeList />
            )}
          </div>
        </div>
        {managementDialogs}
      </>
    );
  }

  return (
    <>
      <div aria-hidden={!open}
           className="fixed inset-0 z-[2000] pointer-events-none"
      >
        {/* Backdrop: pointer-events disabled to avoid intercepting canvas drag */}
        <div className={`absolute inset-0 bg-black/20 transition-opacity ${open ? 'opacity-100' : 'opacity-0'} pointer-events-none`} />
        {/* Panel */}
        <aside
          className={`absolute top-0 right-0 h-full bg-white dark:bg-[#181a1b] shadow-xl border-l border-border w-[${panelWidth}px] max-w-[90vw] pointer-events-auto transform transition-transform duration-200 ${open ? 'translate-x-0' : 'translate-x-full'}`}
          style={{ width: panelWidth }}
          role="dialog"
          aria-label={t('assets.aria.panelTitle', { default: 'Asset Library' })}
        >
          <div className="h-12 px-3 flex items-center justify-between border-b border-border">
            <div className="flex items-center gap-3 text-foreground">
              <button className={`px-2 py-1 rounded ${tab==='assets' ? 'bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400' : 'text-gray-600 dark:text-muted-foreground hover:bg-accent/40'}`} onClick={() => setTab('assets')}>{t('assets.tab.assets', { default: 'Assets' })}</button>
              <button className={`px-2 py-1 rounded ${tab==='knowledge' ? 'bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400' : 'text-gray-600 dark:text-muted-foreground hover:bg-accent/40'}`} onClick={() => setTab('knowledge')}>Knowledge Base</button>
            </div>
            <div className="flex items-center gap-2">
              <button className={`w-8 h-8 rounded hover:bg-accent/60 ${view==='grid'?'text-gray-900 dark:text-foreground':'text-gray-500 dark:text-muted-foreground'}`} onClick={() => setView('grid')} title={t('assets.grid', { default: 'Grid' })}><Grid size={16}/></button>
              <button className={`w-8 h-8 rounded hover:bg-accent/60 ${view==='list'?'text-gray-900 dark:text-foreground':'text-gray-500 dark:text-muted-foreground'}`} onClick={() => setView('list')} title={t('assets.list', { default: 'List' })}><List size={16}/></button>
              <button className="w-8 h-8 rounded hover:bg-accent/60 text-gray-500 dark:text-muted-foreground" onClick={onClose} aria-label={t('common.cancel', { default: 'Close' })}><X size={16}/></button>
            </div>
          </div>
          <div className="h-[calc(100%-48px)] overflow-auto p-3">
            {tab === 'assets' ? (
              loading ? (
                <div className="text-center text-sm text-gray-500 dark:text-zinc-400 py-10">{t('assets.loading', {default: 'Loading…'})}</div>
              ) : assets.length === 0 ? (
                <div className="text-center text-sm text-gray-500 dark:text-zinc-400 py-10">{t('assets.empty', {default: 'No assets yet. Drag files onto the canvas to add them.'})}</div>
              ) : view === 'grid' ? (
                <div className="grid grid-cols-2 gap-3">
                  {assets.map(renderCard)}
                </div>
              ) : (
                <div className="border border-border rounded-md overflow-hidden bg-white dark:bg-[#181a1b]">
                  {assets.map(renderRow)}
                </div>
              )
            ) : (
              <KnowledgeList />
            )}
          </div>
        </aside>
      </div>
      {managementDialogs}
    </>
  );
};

export default AssetLibraryPanel;

// 简易知识库列表（拖拽到画布插入 TextNode 或带来源信息）
const DEFAULT_AGENT_ID = 'Zmind';

const KnowledgeList: React.FC = () => {
  const supabase = createClient();
  const [loading, setLoading] = useState(true);
  const [entries, setEntries] = useState<any[]>([]);
  const t = useTranslations();
  const format = useFormatter();

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const { data, error } = await supabase
          .from('knowledge_base_entries')
          .select('entry_id, filename, summary, created_at')
          .order('created_at', { ascending: false })
          .limit(50);
        if (!error) setEntries(data || []);
      } finally {
        setLoading(false);
      }
    })();
  }, [supabase]);

  if (loading) return <div className="text-center text-sm text-gray-500 dark:text-zinc-400 py-10">{t('knowledge.loading', {default: 'Loading…'})}</div>;
  // Map to a generic structure the UI expects
  const mapped = entries.map(e => ({
    entry_id: e.entry_id,
    name: e.filename,
    description: e.summary,
    created_at: e.created_at,
    content: e.summary,
  }));
  if (entries.length === 0) return <div className="text-center text-sm text-gray-500 dark:text-zinc-400 py-10">{t('knowledge.empty')}</div>;

  const onDragStart = (e: React.DragEvent, entry: any) => {
    const content = typeof entry.content === 'string' ? entry.content : JSON.stringify(entry.content || '');
    const title = entry.name || t('knowledge.entry', {default: 'Knowledge Entry'});
    const payload = {
      type: 'kb-entry',
      payload: { title, content }
    };
    e.dataTransfer.setData('application/json', JSON.stringify(payload));
    e.dataTransfer.effectAllowed = 'copy';
  };

  return (
    <div className="border border-border rounded-md overflow-hidden bg-white dark:bg-[#181a1b]">
      {mapped.map((entry: any) => (
        <div key={entry.entry_id}
             className="border-b last:border-b-0 border-border px-3 py-2 hover:bg-accent/40 cursor-grab"
             draggable
             onDragStart={(e) => onDragStart(e, entry)}
        >
          <div className="text-sm text-gray-800 dark:text-foreground truncate" title={entry.name}>{entry.name}</div>
          <div className="text-[11px] text-gray-500 dark:text-zinc-400 truncate">{(entry.description || '').slice(0, 80)}</div>
          <div className="text-[11px] text-gray-400 dark:text-zinc-500 mt-1">{t('knowledge.source.label', {default: 'Source'})}: {entry.source_type || t('knowledge.source.manual', {default: 'manual'})} · {format.dateTime(new Date(entry.created_at), {year:'numeric', month:'short', day:'numeric'})}</div>
        </div>
      ))}
    </div>
  );
};
