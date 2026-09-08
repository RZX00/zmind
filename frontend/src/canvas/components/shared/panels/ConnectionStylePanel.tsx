import React, { useMemo, useCallback, useState } from 'react';
import { ArrowLeft, ArrowRight, Palette, Minus, Crosshair, SplitSquareVertical } from 'lucide-react';
import { useCanvasStore } from '../../../stores/canvas.store';
import { MORANDI_GROUP_PALETTE } from '../../../utils/groupUtils';

type PanelMode = 'none' | 'color' | 'dash' | 'arrow';

const COLOR_PRESETS = MORANDI_GROUP_PALETTE;
const DASH_PRESETS: Array<{ id: string; dashed: boolean; dashArray?: number[] }> = [
  { id: 'solid', dashed: false },
  { id: 'short', dashed: true, dashArray: [6, 3] },
  { id: 'dot', dashed: true, dashArray: [2, 2] },
  { id: 'long', dashed: true, dashArray: [12, 6] },
];
const ARROW_SIZES = [16, 20, 24];

const ConnectionStylePanel: React.FC = () => {
  const selectedConnectionIds = useCanvasStore((s) => s.selections.connectionIds);
  const canvas = useCanvasStore((s) => s.canvas);
  const updateConnection = useCanvasStore((s) => s.updateConnection);

  const ids = useMemo(() => Array.from(selectedConnectionIds || new Set<string>()), [selectedConnectionIds]);
  const firstAppearance = useMemo(() => {
    const id = ids[0];
    if (!id) return {} as any;
    const c = (canvas.connections || []).find((x) => x.id === id) as any;
    return c?.appearance || {};
  }, [ids, canvas.connections]);

  const applyAppearancePatch = useCallback((patch: any) => {
    ids.forEach((id) => {
      const c = (canvas.connections || []).find((x) => x.id === id) as any;
      const next: any = { appearance: patch };
      // 当切换端点策略时，清除手动/自定义曲率，让新策略重算
      if (patch && Object.prototype.hasOwnProperty.call(patch, 'endpointStrategy') && c) {
        next.curveAnchor = undefined;
        next.controlPoints = undefined;
        next.curveMode = undefined;
        next.anchorParams = undefined;
      }
      updateConnection(id, next);
    });
  }, [ids, updateConnection, canvas.connections]);

  // 归一化当前尺寸用于高亮（渲染层已强制最小16，这里同步视觉状态）
  const currentSize = useMemo(() => {
    const sz = Number((firstAppearance as any)?.arrow?.size ?? 16);
    return Math.max(16, Math.min(24, isFinite(sz) ? sz : 16));
  }, [firstAppearance]);

  const [panel, setPanel] = useState<PanelMode>('none');

  const endpoint = (firstAppearance as any)?.endpointStrategy as ('center-ray'|'side-midpoints'|undefined);

  const renderColorPanel = () => (
    <>
      <button
        onClick={() => setPanel('none')}
        className="w-9 h-9 rounded-lg flex items-center justify-center cursor-pointer transition-all duration-200 hover:bg-accent/60 hover:translate-x-1 hover:shadow-md text-gray-600 dark:text-zinc-300"
        title="返回样式设置"
      >
        <ArrowLeft size={16} />
      </button>
      <div className="h-px bg-gray-200/60 dark:bg-zinc-700/60 mx-2" />
      <div className="flex flex-col gap-1 p-1 items-center">
        {COLOR_PRESETS.map((c) => (
          <button
            key={c}
            className={`w-7 h-7 rounded-md border border-gray-300 dark:border-zinc-700 hover:scale-105 transition ${(firstAppearance as any)?.color === c ? 'ring-1 ring-blue-400' : ''}`}
            style={{ backgroundColor: c }}
            onClick={() => applyAppearancePatch({ color: c })}
            title={c}
            aria-label={c}
          />
        ))}
      </div>
    </>
  );

  const renderDashPanel = () => (
    <>
      <button
        onClick={() => setPanel('none')}
        className="w-9 h-9 rounded-lg flex items-center justify-center cursor-pointer transition-all duration-200 hover:bg-accent/60 hover:translate-x-1 hover:shadow-md text-gray-600 dark:text-zinc-300"
        title="返回样式设置"
      >
        <ArrowLeft size={16} />
      </button>
      <div className="h-px bg-gray-200/60 dark:bg-zinc-700/60 mx-2" />
      <div className="flex flex-col gap-1 p-1 items-center">
        {DASH_PRESETS.map((d) => (
          <button
            key={d.id}
            className={`w-7 h-7 rounded-md flex items-center justify-center hover:bg-accent/60 border border-transparent ${(firstAppearance as any)?.dashed === d.dashed && String((((firstAppearance as any)?.dashArray)||[]).join(',')) === String(((d.dashArray)||[]).join(',')) ? 'ring-1 ring-blue-400' : ''}`}
            onClick={() => applyAppearancePatch({ dashed: d.dashed, dashArray: d.dashArray })}
            title={d.id}
            aria-label={d.id}
          >
            <svg width="18" height="12" viewBox="0 0 18 12">
              <line x1="2" y1="6" x2="16" y2="6" stroke={(firstAppearance as any)?.color || '#555'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" strokeDasharray={d.dashed ? (d.dashArray || [6,3]).join(',') : undefined as any} />
            </svg>
          </button>
        ))}
      </div>
    </>
  );

  const renderArrowPanel = () => (
    <>
      <button
        onClick={() => setPanel('none')}
        className="w-9 h-9 rounded-lg flex items-center justify-center cursor-pointer transition-all duration-200 hover:bg-accent/60 hover:translate-x-1 hover:shadow-md text-gray-600 dark:text-zinc-300"
        title="返回样式设置"
      >
        <ArrowLeft size={16} />
      </button>
      <div className="h-px bg-gray-200/60 dark:bg-zinc-700/60 mx-2" />
      <div className="flex flex-col gap-2 p-1 items-center">
        {/* 起点/终点 开关（每行一个） */}
        <button
          className={`w-7 h-7 rounded-md flex items-center justify-center ${(firstAppearance as any)?.arrow?.start ? 'ring-1 ring-blue-400' : 'border border-transparent hover:border-gray-300 dark:hover:border-zinc-700'}`}
          title="起点箭头"
          aria-pressed={Boolean((firstAppearance as any)?.arrow?.start)}
          onClick={() => applyAppearancePatch({ arrow: { ...((firstAppearance as any)?.arrow || {}), start: !Boolean((firstAppearance as any)?.arrow?.start) } })}
        >
          <ArrowLeft size={14} />
        </button>
        <button
          className={`w-7 h-7 rounded-md flex items-center justify-center ${(firstAppearance as any)?.arrow?.end === false ? '' : 'ring-1 ring-blue-400'} ${(firstAppearance as any)?.arrow?.end === false ? 'border border-transparent hover:border-gray-300 dark:hover:border-zinc-700' : ''}`}
          title="终点箭头"
          aria-pressed={!((firstAppearance as any)?.arrow?.end === false)}
          onClick={() => {
            const current = !(((firstAppearance as any)?.arrow?.end) === false);
            applyAppearancePatch({ arrow: { ...((firstAppearance as any)?.arrow || {}), end: !current } });
          }}
        >
          <ArrowRight size={14} />
        </button>

        {/* 箭头大小（纵向单列） */}
        <div className="flex flex-col gap-2">
          {ARROW_SIZES.map(sz => (
            <button
              key={sz}
              className={`w-7 h-7 rounded-md flex items-center justify-center ${currentSize === sz ? 'ring-1 ring-blue-400' : 'border border-transparent hover:border-gray-300 dark:hover:border-zinc-700'}`}
              onClick={() => applyAppearancePatch({ arrow: { ...((firstAppearance as any)?.arrow || {}), size: sz } })}
              title={`${sz}`}
              aria-label={`size-${sz}`}
            >
              <svg width="14" height="14" viewBox="0 0 14 14">
                <polygon points="2,2 12,7 2,12" fill="currentColor" transform={`scale(${(sz/24)}) translate(${(14 - (14*(sz/24)))/ (sz/24) /2}, ${(14 - (14*(sz/24)))/(sz/24)/2})`} />
              </svg>
            </button>
          ))}
          <button
            className={`w-7 h-7 rounded-md flex items-center justify-center ${((firstAppearance as any)?.arrow?.filled === false) ? 'ring-1 ring-blue-400' : 'border border-transparent hover:border-gray-300 dark:hover:border-zinc-700'}`}
            title="填充切换"
            aria-pressed={!(((firstAppearance as any)?.arrow?.filled) === false)}
            onClick={() => applyAppearancePatch({ arrow: { ...((firstAppearance as any)?.arrow || {}), filled: !(((firstAppearance as any)?.arrow?.filled) === false) ? false : true } })}
          >
            {((firstAppearance as any)?.arrow?.filled === false) ? (
              <svg width="14" height="14" viewBox="0 0 14 14"><polygon points="2,2 12,7 2,12" fill="none" stroke="currentColor" strokeWidth="1.5"/></svg>
            ) : (
              <svg width="14" height="14" viewBox="0 0 14 14"><polygon points="2,2 12,7 2,12" fill="currentColor"/></svg>
            )}
          </button>
        </div>
      </div>
    </>
  );

  // 面板切换：默认展示3个主图标（颜色/线型/箭头）
  if (panel === 'color') return (<>{renderColorPanel()}</>);
  if (panel === 'dash') return (<>{renderDashPanel()}</>);
  if (panel === 'arrow') return (<>{renderArrowPanel()}</>);

  return (
    <>
      {/* 颜色 */}
      <button
        onClick={() => setPanel('color')}
        className="w-9 h-9 rounded-lg flex items-center justify-center cursor-pointer transition-all duration-200 hover:bg-accent/60 hover:translate-x-1 hover:shadow-md relative text-gray-600 dark:text-zinc-300"
        title="连线颜色"
      >
        <Palette size={16} />
      </button>

      {/* 分割线 */}
      <div className="h-px bg-gray-200/60 dark:bg-zinc-700/60 mx-2" />

      {/* 线型 */}
      <button
        onClick={() => setPanel('dash')}
        className="w-9 h-9 rounded-lg flex items-center justify-center cursor-pointer transition-all duration-200 hover:bg-accent/60 hover:translate-x-1 hover:shadow-md relative text-gray-600 dark:text-zinc-300"
        title="线型"
      >
        <Minus size={16} />
      </button>

      {/* 分割线 */}
      <div className="h-px bg-gray-200/60 dark:bg-zinc-700/60 mx-2" />

      {/* 箭头 */}
      <button
        onClick={() => setPanel('arrow')}
        className="w-9 h-9 rounded-lg flex items-center justify-center cursor-pointer transition-all duration-200 hover:bg-accent/60 hover:translate-x-1 hover:shadow-md relative text-gray-600 dark:text-zinc-300"
        title="箭头样式"
      >
        <ArrowRight size={16} />
      </button>

      {/* 分割线 */}
      <div className="h-px bg-gray-200/60 dark:bg-zinc-700/60 mx-2" />

      {/* 连线方式切换（互斥：单按钮切换） */}
      <div className="flex flex-col gap-1 p-1 items-center">
        <button
          className={`w-7 h-7 rounded-md flex items-center justify-center ring-1 ring-blue-400`}
          title={endpoint === 'side-midpoints' ? '边中点起点' : '中心起点'}
          aria-pressed={true}
          onClick={() => applyAppearancePatch({ endpointStrategy: endpoint === 'side-midpoints' ? 'center-ray' : 'side-midpoints' })}
        >
          {endpoint === 'side-midpoints' ? (
            <SplitSquareVertical size={14} />
          ) : (
            <Crosshair size={14} />
          )}
        </button>
      </div>

    </>
  );
};

export default ConnectionStylePanel;
