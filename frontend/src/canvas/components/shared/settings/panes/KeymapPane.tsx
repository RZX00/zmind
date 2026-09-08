import React, { useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { useTranslations } from 'next-intl';

interface ShortcutItem {
  key: string;
  description: string;
  keys: string[];
  category: string;
}

const KeymapPane: React.FC = () => {
  const t = useTranslations('settings.keymap');
  const [searchQuery, setSearchQuery] = useState('');
  const categoriesLabels = useMemo(() => ({
    all: t('categories.all', {default: 'All'}),
    basics: t('categories.basics', {default: 'Basics'}),
    selectEdit: t('categories.selectEdit', {default: 'Select & Edit'}),
    tools: t('categories.tools', {default: 'Tools'}),
    editor: t('categories.editor', {default: 'Editor'}),
    files: t('categories.files', {default: 'Files'})
  } as const), [t]);
  const [selectedCategory, setSelectedCategory] = useState(categoriesLabels.all);
  React.useEffect(() => {
    setSelectedCategory(categoriesLabels.all);
  }, [categoriesLabels.all]);

  const shortcuts: ShortcutItem[] = useMemo(() => ([
    { key: 'save', description: t('shortcuts.save', {default: 'Save canvas'}), keys: ['⌘', 'S'], category: categoriesLabels.basics },
    { key: 'undo', description: t('shortcuts.undo', {default: 'Undo'}), keys: ['⌘', 'Z'], category: categoriesLabels.basics },
    { key: 'redo', description: t('shortcuts.redo', {default: 'Redo'}), keys: ['⌘', 'Y'], category: categoriesLabels.basics },
    { key: 'redo-shift', description: t('shortcuts.redoShift', {default: 'Redo'}), keys: ['⌘', '⇧', 'Z'], category: categoriesLabels.basics },
    { key: 'select-all', description: t('shortcuts.selectAll', {default: 'Select all nodes'}), keys: ['⌘', 'A'], category: categoriesLabels.basics },
    { key: 'duplicate', description: t('shortcuts.duplicate', {default: 'Duplicate node / Toggle To‑Do'}), keys: ['⌘', 'D'], category: categoriesLabels.basics },
    { key: 'delete', description: t('shortcuts.delete', {default: 'Delete selection'}), keys: ['Delete'], category: categoriesLabels.selectEdit },
    { key: 'backspace', description: t('shortcuts.backspace', {default: 'Delete selection'}), keys: ['Backspace'], category: categoriesLabels.selectEdit },
    { key: 'escape', description: t('shortcuts.escape', {default: 'Deselect'}), keys: ['Esc'], category: categoriesLabels.selectEdit },
    { key: 'multi-select', description: t('shortcuts.multiSelect', {default: 'Multi‑select'}), keys: ['⌘', 'Click'], category: categoriesLabels.selectEdit },
    { key: 'box-select', description: t('shortcuts.boxSelect', {default: 'Box select'}), keys: ['Drag'], category: categoriesLabels.selectEdit },
    { key: 'multi-box-select', description: t('shortcuts.multiBoxSelect', {default: 'Add to box selection'}), keys: ['⌘', 'Drag'], category: categoriesLabels.selectEdit },
    { key: 'right-drag-canvas', description: t('shortcuts.rightDragCanvas', {default: 'Pan canvas'}), keys: ['Right‑drag'], category: categoriesLabels.selectEdit },
    { key: 'select-tool', description: t('shortcuts.selectTool', {default: 'Select tool'}), keys: ['V'], category: categoriesLabels.tools },
    { key: 'hand-tool', description: t('shortcuts.handTool', {default: 'Hand tool'}), keys: ['H'], category: categoriesLabels.tools },
    { key: 'pan-temp', description: t('shortcuts.panTemp', {default: 'Temporary pan'}), keys: ['Space'], category: categoriesLabels.tools },
    { key: 'focus-selection', description: t('shortcuts.focusSelection', {default: 'Focus selection (double space)'}), keys: ['Space ×2'], category: categoriesLabels.tools },
    { key: 'smart-guides-toggle', description: t('shortcuts.smartGuidesToggle', {default: 'Toggle smart guides on/off'}), keys: ['⌘', 'G'], category: categoriesLabels.tools },
    { key: 'editor-save', description: t('shortcuts.editorSave', {default: 'Save and exit edit'}), keys: ['⌘', 'Enter'], category: categoriesLabels.editor },
    { key: 'editor-cancel', description: t('shortcuts.editorCancel', {default: 'Cancel edit'}), keys: ['Esc'], category: categoriesLabels.editor },
    { key: 'table-tab', description: t('shortcuts.tableTab', {default: 'Next cell'}), keys: ['Tab'], category: categoriesLabels.editor },
    { key: 'table-shift-tab', description: t('shortcuts.tableShiftTab', {default: 'Previous cell'}), keys: ['⇧', 'Tab'], category: categoriesLabels.editor },
    { key: 'close-sidebar', description: t('shortcuts.closeSidebar', {default: 'Close sidebar'}), keys: ['Esc'], category: categoriesLabels.files },
  ]), [t, categoriesLabels]);

  const categories = useMemo(() => {
    const cats = Array.from(new Set(shortcuts.map(s => s.category)));
    return [categoriesLabels.all, ...cats];
  }, [shortcuts, categoriesLabels.all]);

  const filteredShortcuts = useMemo(() => {
    let filtered = shortcuts;
    if (selectedCategory !== categoriesLabels.all) filtered = filtered.filter(s => s.category === selectedCategory);
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      filtered = filtered.filter(s => s.description.toLowerCase().includes(q) || s.keys.some(k => k.toLowerCase().includes(q)));
    }
    return filtered;
  }, [shortcuts, selectedCategory, searchQuery, categoriesLabels.all]);

  const renderKeys = (keys: string[]) => (
    <div className="flex items-center gap-1">
      {keys.map((k, i) => (
        <React.Fragment key={i}>
          <kbd className="px-2 py-1 text-xs font-medium bg-accent/20 border border-border rounded-md shadow-sm min-w-[24px] text-center text-foreground">{k}</kbd>
          {i < keys.length - 1 && <span className="text-muted-foreground text-xs">+</span>}
        </React.Fragment>
      ))}
    </div>
  );

  return (
    <div className="flex h-full flex-col text-foreground">
      <div className="text-sm font-semibold text-foreground mb-4">{t('title', {default: 'Keyboard Shortcuts'})}</div>

      {/* 搜索与分类 */}
      <div className="flex flex-col sm:flex-row gap-3 mb-3">
        <div className="flex-1 relative">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder={t('search.placeholder', {default: 'Search shortcuts...'})}
            className="w-full pl-9 pr-3 py-2 border border-border rounded-lg text-sm bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
          />
        </div>
        <div className="flex gap-2 overflow-x-auto pb-1">
          {categories.map(c => (
            <button
              key={c}
              onClick={() => setSelectedCategory(c)}
              className={`px-3 py-1.5 text-xs rounded-lg border ${selectedCategory===c ? 'bg-accent text-foreground border-border' : 'bg-background text-muted-foreground border-border hover:bg-accent/20'}`}
            >
              {c}
            </button>
          ))}
        </div>
      </div>

      {/* 列表 */}
      <div className="flex-1 overflow-y-auto">
        {filteredShortcuts.length ? (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            {filteredShortcuts.map(s => (
              <div key={s.key} className="flex items-center justify-between p-3 rounded-lg border border-border hover:bg-accent/10">
                <div className="min-w-0">
                  <div className="text-sm font-medium text-foreground truncate">{s.description}</div>
                  <div className="text-xs text-muted-foreground mt-1">{s.category}</div>
                </div>
                <div className="ml-3 flex-shrink-0">{renderKeys(s.keys)}</div>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-center text-sm text-muted-foreground py-8">{t('empty', {default: 'No matching shortcuts'})}</div>
        )}
      </div>
    </div>
  );
};

export default KeymapPane;
