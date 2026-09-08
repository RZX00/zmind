import React from 'react';
import { useTranslations } from 'next-intl';
import { useSettingsStore } from '../../../../stores/settings.store';
import { useCanvasStore } from '../../../../stores/canvas.store';
import { tidyLayout, applyLayout, findMindmapGroupForNode } from '../../../../utils/mindmapLayout';

const LabeledSlider: React.FC<{
  label: string;
  value: number;
  onChange: (v: number) => void;
  min?: number; max?: number; step?: number; hint?: string; tick?: number;
}> = ({ label, value, onChange, min = 0, max = 300, step = 1, hint, tick }) => {
  return (
    <div className="mb-4">
      <div className="flex items-center justify-between mb-1">
        <div className="text-sm font-medium text-foreground">{label}</div>
        <input
          type="number"
          className="w-20 text-sm px-2 py-1 border border-border rounded-md bg-background text-foreground"
          value={value}
          min={min}
          max={max}
          step={step}
          onChange={e => onChange(Number(e.target.value))}
        />
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={e => onChange(Number(e.target.value))}
        className="w-full"
      />
      {hint && (
        <div className="text-xs text-muted-foreground mt-1">{hint}</div>
      )}
      {typeof tick === 'number' && (
        <div className="relative h-3 mt-1">
          <div className="absolute left-0 right-0 h-px bg-border" />
          <div className="absolute" style={{ left: `${(tick - (min||0)) / ((max||100) - (min||0)) * 100}%` }}>
            <div className="w-px h-3 bg-border mx-auto" />
            <div className="text-[10px] text-muted-foreground -mt-1 -ml-2">{tick}</div>
          </div>
        </div>
      )}
    </div>
  );
};

const ConnectionsPane: React.FC = () => {
  const t = useTranslations('settings');
  const c = useSettingsStore(s => s.connection);
  const set = useSettingsStore(s => s.setConnection);
  const reset = useSettingsStore(s => s.resetConnection);
  const screenshot = useSettingsStore(s => s.screenshot);
  const setScreenshot = useSettingsStore(s => s.setScreenshot);
  const aiPanel = useSettingsStore(s => s.aiPanel);
  const setAiPanel = useSettingsStore(s => s.setAiPanel);
  const focus = useSettingsStore(s => s.focus);
  const setFocus = useSettingsStore(s => s.setFocus);
  const mindmap = useSettingsStore(s => s.mindmap);
  const setMindmap = useSettingsStore(s => s.setMindmap);
  const canvas = useCanvasStore(s => s.canvas);

  const applyMindmapWidthMode = React.useCallback(async (mode: 'auto'|'fixed') => {
    try {
      // Recompute widths for current canvas mindmap nodes
      const { estimateAutoTextWidth, calculateTextNodeHeight, getTextLayoutPreset, DEFAULT_TEXT_LAYOUT_PRESET } = require('../../../../utils/canvasUtils');
      const layout = getTextLayoutPreset ? getTextLayoutPreset(canvas?.textLayoutPreset ?? DEFAULT_TEXT_LAYOUT_PRESET) : undefined;
      const groups = (canvas?.nodes || []).filter(n => (n as any).type === 'group' && (n as any).mindmap) as any[];
      if (groups.length === 0) return;
      const store = useCanvasStore.getState();
      const now = Date.now();
      const updatedGroups = new Set<string>();
      for (const g of groups) {
        const ids: string[] = Array.isArray(g.children) ? g.children : [];
        let touched = false;
        for (const id of ids) {
          const n = canvas.nodes.find(nn => nn.id === id);
          if (!n) continue;
          if (!(n.type === 'text' || n.type === 'todo')) continue;
          // Skip shaped text nodes from auto sizing
          const shapedText = n.type === 'text' && (n as any)?.shapeDecoration && (n as any).shapeDecoration?.type && (n as any).shapeDecoration.type !== 'none';
          if (shapedText) continue;
          let w = n.width;
          if (mode === 'auto') {
            w = estimateAutoTextWidth(n.content || '', { layoutPreset: layout, nodeType: n.type as any, clamp: { min: 150, max: 450 } });
          } else {
            w = 300;
          }
          const h = calculateTextNodeHeight ? calculateTextNodeHeight(n.content || '', w, { layoutPreset: layout }) : (n.height || 60);
          if (Math.abs((n.width || 0) - w) > 0.5 || Math.abs((n.height || 0) - h) > 0.5) {
            store.updateNode(n.id, { width: w, height: h, updatedAt: now } as any);
            touched = true;
          }
        }
        if (touched) {
          const latest = useCanvasStore.getState().canvas;
          const res = tidyLayout(latest, g.id);
          applyLayout(res);
          updatedGroups.add(g.id);
        }
      }
    } catch {}
  }, [canvas]);

  return (
    <div className="flex h-full flex-col overflow-y-auto text-foreground">
      {/* AI panel settings */}
      <div className="mb-6">
        <div className="text-sm font-semibold text-foreground mb-2">{t('connections.aiPanel.title', {default: 'AI Panel'})}</div>
        <LabeledSlider
          label={t('connections.aiPanel.expandRatio.label', {default: 'Expanded width (%)'})}
          value={Math.round(((aiPanel?.expandedRatio ?? 0.8) * 100))}
          min={60}
          max={95}
          step={1}
          onChange={(v) => {
            const next = Math.max(0.6, Math.min(0.95, v / 100));
            setAiPanel && setAiPanel({ expandedRatio: next });
          }}
          hint={t('connections.aiPanel.expandRatio.hint', {default: 'Applies when the AI panel is expanded.'})}
          tick={80}
        />
        <LabeledSlider
          label={t('connections.aiPanel.backgroundOpacity.label', {default: 'Background opacity (%)'})}
          value={Math.round(((aiPanel?.backgroundOpacity ?? 0.8) * 100))}
          min={50}
          max={95}
          step={1}
          onChange={(v) => {
            const next = Math.max(0.5, Math.min(0.95, v / 100));
            setAiPanel && setAiPanel({ backgroundOpacity: next });
          }}
          hint={t('connections.aiPanel.backgroundOpacity.hint', {default: 'Higher values look more solid; lower values feel lighter.'})}
          tick={80}
        />
      </div>

      {/* Focus settings */}
      <div className="mb-6">
        <div className="text-sm font-semibold text-foreground mb-2">{t('connections.focus.title', {default: 'Focus (Double-Space)'})}</div>
        <LabeledSlider
          label={t('connections.focus.fillRatio.label', {default: 'Fill ratio (%)'})}
          value={Math.round(((focus?.fitRatio ?? 0.8) * 100))}
          min={50}
          max={100}
          step={1}
          hint={t('connections.focus.fillRatio.hint', {default: 'When focusing selection (double-space), how much of the viewport the selection should fill.'})}
          onChange={(v) => setFocus && setFocus({ fitRatio: Math.max(0.5, Math.min(1, v / 100)) })}
          tick={80}
        />
        <LabeledSlider
          label={t('connections.focus.padding.label', {default: 'Padding (px)'})}
          value={Math.round(focus?.padding ?? 24)}
          min={0}
          max={200}
          step={2}
          onChange={(v) => setFocus && setFocus({ padding: Math.max(0, Math.min(200, v)) })}
          hint={t('connections.focus.padding.hint', {default: 'Extra margin around focused selection.'})}
          tick={24}
        />
      </div>

      {/* Smart Guides moved to dedicated Guides pane */}

      {/* Screenshot settings */}
      <div className="mb-6">
        <div className="text-sm font-semibold text-foreground mb-2">{t('connections.screenshot.title', {default: 'Screenshot'})}</div>
        <label className="text-xs text-muted-foreground block mb-1">{t('connections.screenshot.aspect.label', {default: 'Default aspect ratio'})}</label>
        <select
          className="px-2 py-1.5 text-sm border border-border rounded-md bg-background text-foreground"
          value={screenshot?.aspect || '16:9'}
          onChange={(e) => setScreenshot && setScreenshot({ aspect: e.target.value })}
        >
          <option value="16:9">{t('connections.screenshot.aspect.options.169', {default: '16:9 (Widescreen)'})}</option>
          <option value="4:3">{t('connections.screenshot.aspect.options.43', {default: '4:3'})}</option>
          <option value="1:1">{t('connections.screenshot.aspect.options.11', {default: '1:1 (Square)'})}</option>
          <option value="original">{t('connections.screenshot.aspect.options.original', {default: 'Original (no crop)'})}</option>
        </select>
        <div className="text-xs text-muted-foreground mt-1">{t('connections.screenshot.aspect.help', {default: 'Screenshots will be center-cropped to the selected ratio.'})}</div>
      </div>

      {/* Curvature controls removed: curvature is adjusted only via mid-handle drag */}
      {/* Endpoint strategy */}
      <div className="mb-6">
        <div className="text-sm font-semibold text-foreground mb-2">{t('connections.endpoint.title', {default: 'Endpoint Strategy'})}</div>
        <div className="flex items-center gap-3">
          {[
            { id: 'center-ray', label: t('connections.endpoint.options.centerRay', {default: 'Center Ray (Recommended)'}) },
            { id: 'side-midpoints', label: t('connections.endpoint.options.sideMidpoints', {default: 'Side Midpoints (Legacy)'}) },
          ].map(opt => (
            <label key={opt.id} className="flex items-center gap-2 text-sm text-foreground">
              <input
                type="radio"
                name="conn-endpoint-strategy"
                value={opt.id}
                checked={c.endpointStrategy === (opt.id as any)}
                onChange={() => set({ endpointStrategy: opt.id as any })}
              />
              {opt.label}
            </label>
          ))}
        </div>
      </div>

      {/* Mindmap width behavior */}
      <div className="mb-6">
        <div className="text-sm font-semibold text-foreground mb-2">{t('connections.mindmapWidth.title', {default: 'Mindmap Node Width'})}</div>
        <div className="flex items-center gap-3">
          {[
            { id: 'auto', label: t('connections.mindmapWidth.options.auto', {default: 'Auto-expand (150–450)'}) },
            { id: 'fixed', label: t('connections.mindmapWidth.options.fixed', {default: 'Fixed 300 (match text nodes)'}) },
          ].map(opt => (
            <label key={opt.id} className="flex items-center gap-2 text-sm text-foreground">
              <input
                type="radio"
                name="mindmap-width-mode"
                value={opt.id}
                checked={((mindmap?.autoWidthMode ?? 'fixed') as any) === (opt.id as any)}
                onChange={async () => { setMindmap && setMindmap({ autoWidthMode: opt.id as any }); await applyMindmapWidthMode(opt.id as any); }}
              />
              {opt.label}
            </label>
          ))}
        </div>
      </div>

      <div className="flex justify-end">
        <button onClick={reset} className="px-3 py-1.5 text-sm rounded-md border border-border hover:bg-accent/20">{t('connections.reset', {default: 'Reset to defaults'})}</button>
      </div>
    </div>
  );
};

export default ConnectionsPane;

