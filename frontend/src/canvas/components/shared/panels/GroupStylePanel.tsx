import React, { useState, useEffect, useCallback, useRef } from 'react';
import './color-selector.css';
import { Palette, ArrowLeft, ArrowRight, ArrowLeftRight } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { setMindmapOrientation } from '../../../utils/mindmapLayout';
import type { Canvas, CanvasNode } from '../../../../types/canvas';
import { MORANDI_GROUP_PALETTE } from '../../../utils/groupUtils';

interface GroupStylePanelProps {
  selectedGroup: CanvasNode; // type='group'
  onStyleChange: (groupId: string, styles: { accentColor?: string; groupStyles?: { bgOpacity?: number } }) => void;
  onClose?: () => void;
}

const COLOR_PRESETS = MORANDI_GROUP_PALETTE.map((c, i) => ({ name: `Morandi ${i + 1}`, color: c }));

type PanelMode = 'none' | 'accent' | 'opacity';

const GroupStylePanel: React.FC<GroupStylePanelProps> = ({ selectedGroup, onStyleChange }) => {
  const t = useTranslations();
  const initialColor = (selectedGroup.accentColor as string) || MORANDI_GROUP_PALETTE[0];
  const initialOpacity = selectedGroup.groupStyles?.bgOpacity ?? 0.06;

  const [color, setColor] = useState<string>(initialColor);
  const [opacity, setOpacity] = useState<number>(initialOpacity);
  const [panelMode, setPanelMode] = useState<PanelMode>('none');
  const isDraggingRef = useRef(false);

  useEffect(() => {
    setColor((selectedGroup.accentColor as string) || MORANDI_GROUP_PALETTE[0]);
    setOpacity(selectedGroup.groupStyles?.bgOpacity ?? 0.06);
  }, [selectedGroup.id, selectedGroup.accentColor, selectedGroup.groupStyles?.bgOpacity]);

  const applyColor = useCallback((c: string) => {
    setColor(c);
    onStyleChange(selectedGroup.id, { accentColor: c });
  }, [selectedGroup.id, onStyleChange]);

  const applyOpacity = useCallback((o: number) => {
    setOpacity(o);
    onStyleChange(selectedGroup.id, { groupStyles: { bgOpacity: o } });
  }, [selectedGroup.id, onStyleChange]);

  const isMindmapGroup = Boolean((selectedGroup as any)?.mindmap);
  const currentOrientation: 'right' | 'both' = (isMindmapGroup && ((selectedGroup as any).mindmap?.orientation === 'both')) ? 'both' : 'right';
  const applyOrientation = useCallback((o: 'right' | 'both') => {
    try { setMindmapOrientation(selectedGroup.id, o); } catch {}
  }, [selectedGroup.id]);

  // 子面板：颜色
  const renderColorPanel = () => (
    <>
      {/* Back button */}
      <button
        onClick={() => setPanelMode('none')}
        className="w-9 h-9 rounded-lg flex items-center justify-center cursor-pointer transition-all duration-200 hover:bg-accent/60 hover:translate-x-1 hover:shadow-md text-gray-600 dark:text-zinc-300"
        title="Back to style settings"
      >
        <ArrowLeft size={16} />
      </button>
      <div className="h-px bg-gray-200/60 dark:bg-zinc-700/60 mx-2" />

      <div className="accent-color-list">
        <div className="container-items">
          {COLOR_PRESETS.map((preset) => (
            <button
              key={preset.color}
              className={`item-color ${color === preset.color ? 'ring-2 ring-blue-400' : ''}`}
              style={{ ['--color' as any]: preset.color } as React.CSSProperties}
              data-color={preset.name}
              onClick={() => applyColor(preset.color)}
              title={preset.name}
            />
          ))}
        </div>
      </div>
    </>
  );

  // 子面板：透明度（竖向滑条）
  const renderOpacityPanel = () => (
    <>
      <button
        onClick={() => setPanelMode('none')}
        className="w-9 h-9 rounded-lg flex items-center justify-center cursor-pointer transition-all duration-200 hover:bg-accent/60 hover:translate-x-1 hover:shadow-md text-gray-600 dark:text-zinc-300"
        title="返回样式设置"
      >
        <ArrowLeft size={16} />
      </button>
      <div className="h-px bg-gray-200/60 dark:bg-zinc-700/60 mx-2" />

      <div className="flex flex-col items-center justify-center h-64 relative">
        <div 
          className="relative w-6 h-48 bg-gradient-to-t from-black/20 via-gray-300 to-white dark:from-white/15 dark:via-zinc-600 dark:to-black border border-gray-300 dark:border-zinc-700/60 rounded-full overflow-hidden cursor-pointer"
          onClick={(e) => {
            const rect = (e.target as HTMLDivElement).getBoundingClientRect();
            const y = e.clientY - rect.top;
            const ratio = 1 - Math.max(0, Math.min(1, y / rect.height));
            applyOpacity(ratio);
          }}
        >
          {/* 刻度 */}
          {Array.from({ length: 5 }).map((_, idx) => (
            <div
              key={idx}
              className="absolute left-1/2 -translate-x-1/2 w-3 h-px bg-gray-400/60"
              style={{ bottom: `${idx * 25}%` }}
            />
          ))}

          {/* 滑块 */}
            <div
              className="absolute left-1/2 -translate-x-1/2 w-6 h-6 bg-white dark:bg-zinc-900 border border-gray-300 dark:border-zinc-600 rounded-full shadow cursor-grab"
            style={{ bottom: `${Math.round((opacity ?? 0) * 100)}%`, marginBottom: '-12px' }}
            onMouseDown={(e) => {
              e.preventDefault();
              isDraggingRef.current = true;
              const track = (e.currentTarget.parentElement as HTMLDivElement);
              const handleMove = (ev: MouseEvent) => {
                if (!isDraggingRef.current) return;
                const rect = track.getBoundingClientRect();
                const y = ev.clientY - rect.top;
                const ratio = 1 - Math.max(0, Math.min(1, y / rect.height));
                applyOpacity(ratio);
              };
              const handleUp = () => {
                isDraggingRef.current = false;
                document.removeEventListener('mousemove', handleMove);
                document.removeEventListener('mouseup', handleUp);
              };
              document.addEventListener('mousemove', handleMove);
              document.addEventListener('mouseup', handleUp);
            }}
          />
        </div>
        <div className="mt-3 text-xs text-gray-500 dark:text-zinc-400 text-center">{Math.round((opacity ?? 0) * 100)}%</div>
      </div>
    </>
  );

  // 主面板：两个按钮（颜色/透明度） — 无外层卡片，保持与文本样式面板同宽度
  return (
    <>
      {panelMode === 'none' ? (
        <>
          {/* Color button */}
          <button
            onClick={() => setPanelMode('accent')}
            className={`w-9 h-9 rounded-lg flex items-center justify-center cursor-pointer transition-all duration-200 hover:bg-accent/60 hover:translate-x-1 hover:shadow-md relative text-gray-600 dark:text-zinc-300`}
            title="Group background color"
          >
            <Palette size={16} />
            {color ? (
              <div className="absolute bottom-1 right-1 w-2 h-2 rounded-full border border-white" style={{ backgroundColor: color }} />
            ) : null}
          </button>

      {/* Divider */}
      <div className="h-px bg-gray-200/60 dark:bg-zinc-700/60 mx-2" />

      {/* Mindmap Orientation (only for mindmap groups) */}
      {isMindmapGroup && (
        <>
          <button
            onClick={() => applyOrientation('right')}
            className={`w-9 h-9 rounded-lg flex items-center justify-center cursor-pointer transition-all duration-200 hover:bg-accent/60 hover:translate-x-1 hover:shadow-md relative ${currentOrientation === 'right' ? 'text-blue-600' : 'text-gray-600 dark:text-zinc-300'}`}
            title={t('canvas.mindmap.orientation.right', { default: 'Right only' })}
          >
            <ArrowRight size={16} />
          </button>

          <div className="h-px bg-gray-200/60 dark:bg-zinc-700/60 mx-2" />

          <button
            onClick={() => applyOrientation('both')}
            className={`w-9 h-9 rounded-lg flex items-center justify-center cursor-pointer transition-all duration-200 hover:bg-accent/60 hover:translate-x-1 hover:shadow-md relative ${currentOrientation === 'both' ? 'text-blue-600' : 'text-gray-600 dark:text-zinc-300'}`}
            title={t('canvas.mindmap.orientation.both', { default: 'Both sides' })}
          >
            <ArrowLeftRight size={16} />
          </button>

          <div className="h-px bg-gray-200/60 dark:bg-zinc-700/60 mx-2" />
        </>
      )}

      {/* Opacity button */}
          <button
            onClick={() => setPanelMode('opacity')}
            className={`w-9 h-9 rounded-lg flex items-center justify-center cursor-pointer transition-all duration-200 hover:bg-accent/60 hover:translate-x-1 hover:shadow-md relative text-gray-600 dark:text-zinc-300`}
            title={`Opacity: ${Math.round((opacity ?? 0) * 100)}%`}
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="none" viewBox="0 0 16 16">
              <path fill="currentColor" d="M0 0h3.2v3.2H0z"></path>
              <path fill="currentColor" d="M0 6.4h3.2v3.2H0z"></path>
              <path fill="currentColor" d="M0 12.801h3.2v3.2H0z"></path>
              <path fill="currentColor" fillOpacity="0.8" d="M3.2 3.199h3.2v3.2H3.2z"></path>
              <path fill="currentColor" fillOpacity="0.8" d="M3.2 9.6h3.2v3.2H3.2z"></path>
              <path fill="currentColor" fillOpacity="0.6" d="M6.4 0h3.2v3.2H6.4z"></path>
              <path fill="currentColor" fillOpacity="0.2" d="M12.8 0H16v3.2h-3.2z"></path>
              <path fill="currentColor" fillOpacity="0.6" d="M6.4 6.4h3.2v3.2H6.4z"></path>
              <path fill="currentColor" fillOpacity="0.2" d="M12.8 6.4H16v3.2h-3.2z"></path>
              <path fill="currentColor" fillOpacity="0.6" d="M6.4 12.801h3.2v3.2H6.4z"></path>
              <path fill="currentColor" fillOpacity="0.2" d="M12.8 12.801H16v3.2h-3.2z"></path>
              <path fill="currentColor" fillOpacity="0.4" d="M9.6 3.199h3.2v3.2H9.6zM9.6 9.6h3.2v3.2H9.6z"></path>
            </svg>
            {opacity < 1 ? (
              <div className="absolute -bottom-1 -right-1 text-xs text-gray-400 dark:text-zinc-500 bg-white dark:bg-zinc-900 rounded px-1 text-[10px] leading-tight">
                {Math.round((opacity ?? 0) * 100)}
              </div>
            ) : null}
          </button>
        </>
      ) : panelMode === 'accent' ? (
        renderColorPanel()
      ) : (
        renderOpacityPanel()
      )}
    </>
  );
};

export default GroupStylePanel;
