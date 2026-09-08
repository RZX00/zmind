import React from 'react';
import {useTranslations} from 'next-intl';
import { SlidersHorizontal, Keyboard, Ruler, User, Plug } from 'lucide-react';
import { useSettingsStore } from '../../../stores/settings.store';

type PaneId = 'account' | 'integrations' | 'connections' | 'guides' | 'keymap';

const SettingsNav: React.FC = () => {
  const t = useTranslations('settings.nav');
  const active = useSettingsStore(s => s.ui.activePane);
  const setPane = (pane: PaneId) =>
    useSettingsStore.setState(s => ({ ui: { ...s.ui, activePane: pane } }));

  const Item: React.FC<{
    id: PaneId;
    icon: React.ElementType;
    label: string;
  }> = ({ id, icon: Icon, label }) => (
    <button
      onClick={() => setPane(id)}
      className={`w-full flex items-center gap-2 px-4 py-3 text-sm border-l-2 transition-colors ${
        active === id ? 'bg-accent/20 border-primary text-foreground' : 'border-transparent text-foreground hover:bg-accent/10'
      }`}
    >
      <Icon className="w-4 h-4 opacity-80" />
      <span>{label}</span>
    </button>
  );

  return (
    <div className="w-60 border-r border-border py-2 bg-background h-full overflow-y-auto">
      <nav>
        <Item id="account" icon={User} label={t('account', {default: 'Account'})} />
        <Item id="integrations" icon={Plug} label="Integrations" />
        <Item id="connections" icon={SlidersHorizontal} label={t('connections', {default: 'Appearance & Connections'})} />
        <Item id="guides" icon={Ruler} label={t('guides', {default: 'Smart Guides'})} />
        <Item id="keymap" icon={Keyboard} label={t('keymap', {default: 'Keyboard Shortcuts'})} />
        {/** Instructions temporarily disabled */}
      </nav>
    </div>
  );
};

export default SettingsNav;

