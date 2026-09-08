import React from 'react';
import { useTranslations } from 'next-intl';
import { useSettingsStore } from '../../../../stores/settings.store';
import { Switch } from '@/components/ui/switch';

const GuidesPane: React.FC = () => {
  const t = useTranslations('settings');
  const guides = useSettingsStore(s => s.guides);
  const setGuides = useSettingsStore(s => s.setGuides);
  const showLines = guides?.showLines === true;
  const lineColor = guides?.colorHex || '#9FA8A3';
  const tolerance = typeof guides?.tolerancePx === 'number' ? guides!.tolerancePx : 8;

  // Morandi palette (soft, muted tones)
  const MORANDI: string[] = [
    '#9FA8A3', // sage gray
    '#C7C4BF', // warm gray
    '#B0A8B9', // mauve gray
    '#A7C4BC', // seafoam
    '#C8C2BB', // greige
    '#A3B5A6', // dusty green
  ];

  return (
    <div className="flex h-full flex-col overflow-y-auto text-foreground">
      <div className="text-sm font-semibold text-foreground mb-2">{t('connections.guides.title', {default: 'Smart Guides'})}</div>

      {/* Enable toggle */}
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm text-foreground">{t('connections.guides.enabled.label', {default: 'Enable smart guides'})}</span>
        <Switch checked={guides?.enabled !== false} onCheckedChange={(v) => setGuides && setGuides({ enabled: !!v })} />
      </div>

      {/* Show guide lines (new) */}
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm text-foreground">{t('connections.guides.lines.label', { default: 'Show guide lines' })}</span>
        <Switch checked={guides?.showLines === true} onCheckedChange={(v) => setGuides && setGuides({ showLines: !!v })} />
      </div>

      {/* Distance labels */}
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm text-foreground">{t('connections.guides.distance.label', {default: 'Show distance labels'})}</span>
        <Switch checked={guides?.showDistance === true} onCheckedChange={(v) => setGuides && setGuides({ showDistance: !!v })} />
      </div>

      {/* Equal spacing snap */}
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm text-foreground">{t('connections.guides.equal.label', {default: 'Equal spacing snap'})}</span>
        <Switch checked={guides?.equalSpacing !== false} onCheckedChange={(v) => setGuides && setGuides({ equalSpacing: !!v })} />
      </div>

      {/* Snap tolerance */}
      <div className="mt-2 mb-3">
        <div className="text-sm text-foreground mb-1">{t('connections.guides.tolerance.label', {default: 'Snap tolerance (px, screen)'})}</div>
        <div className="flex items-center gap-3">
          <input
            type="range"
            min={2}
            max={20}
            step={1}
            value={tolerance}
            onChange={(e) => setGuides && setGuides({ tolerancePx: Number(e.target.value) })}
            className="flex-1"
          />
          <span className="text-xs text-muted-foreground w-10 text-right">{tolerance}px</span>
        </div>
        <div className="text-xs text-muted-foreground mt-1">{t('connections.guides.tolerance.hint', {default: 'Converted by zoom automatically. Smaller=stricter, larger=easier to snap.'})}</div>
      </div>

      {/* Fallback to grid */}
      <div className="flex items-center justify-between">
        <span className="text-sm text-foreground">{t('connections.guides.gridFallback.label', {default: 'Fallback to grid when no guide'})}</span>
        <Switch checked={!!guides?.fallbackToGrid} onCheckedChange={(v) => setGuides && setGuides({ fallbackToGrid: !!v })} />
      </div>

      {showLines && (
        <>
          {/* Color (Morandi palette) */}
          <div className="mt-4">
            <div className="text-sm font-medium text-foreground mb-2">{t('connections.guides.color.label', {default: 'Guide color (Morandi palette)'})}</div>
            <div className="flex flex-wrap gap-2">
              {MORANDI.map((hex) => (
                <button
                  key={hex}
                  onClick={() => setGuides && setGuides({ colorHex: hex })}
                  className={`w-8 h-8 rounded-md border ${guides?.colorHex === hex ? 'ring-2 ring-blue-400 border-blue-300' : 'border-border hover:border-foreground/30'}`}
                  style={{ backgroundColor: hex }}
                  title={hex}
                />
              ))}
              <label className="w-8 h-8 rounded-md border border-border grid place-items-center text-xs cursor-pointer">
                <input type="color" className="hidden" value={(guides?.colorHex || '#9FA8A3')} onChange={(e)=> setGuides && setGuides({ colorHex: e.target.value })} />
                +
              </label>
            </div>
          </div>

          {/* Line style */}
          <div className="mt-3">
            <div className="text-sm font-medium text-foreground mb-2">{t('connections.guides.style.label', {default: 'Line style'})}</div>
            <div className="flex items-center gap-3">
              {[{ dashed: false, label: t('connections.guides.style.solid', {default: 'Solid'}) }, { dashed: true, label: t('connections.guides.style.dashed', {default: 'Dashed'}) }].map((opt) => {
                const active = guides?.dashed === opt.dashed;
                return (
                  <button
                    key={opt.dashed ? 'dashed' : 'solid'}
                    type="button"
                    onClick={() => setGuides && setGuides({ dashed: opt.dashed })}
                    className={`flex items-center gap-2 px-3 py-2 rounded-md border ${active ? 'border-primary ring-2 ring-primary/40 bg-primary/5' : 'border-border hover:border-foreground/40'}`}
                  >
                    <span className="text-xs text-foreground">{opt.label}</span>
                    <span
                      className="h-px w-12"
                      style={{ borderTop: `2px ${opt.dashed ? 'dashed' : 'solid'} ${lineColor}` }}
                    />
                  </button>
                );
              })}
            </div>
          </div>
        </>
      )}

      <div className="text-xs text-muted-foreground mt-2">
        {t('connections.guides.tips', {default: 'Tip: Snapping happens on release. Hold Shift to preview guides, Alt/Option to disable snapping.'})}
      </div>
    </div>
  );
};

export default GuidesPane;
