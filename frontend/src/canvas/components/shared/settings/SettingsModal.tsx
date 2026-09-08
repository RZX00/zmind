import React from 'react';
import { X } from 'lucide-react';
import {useTranslations} from 'next-intl';
import { useSettingsStore } from '../../../stores/settings.store';
import SettingsNav from './SettingsNav';
import ConnectionsPane from './panes/ConnectionsPane';
import GuidesPane from './panes/GuidesPane';
import KeymapPane from './panes/KeymapPane';
import AccountPane from './panes/AccountPane';
import IntegrationsPane from './panes/IntegrationsPane';
// InstructionsPane is temporarily disabled

const SettingsModal: React.FC = () => {
  const isOpen = useSettingsStore(s => s.ui.isOpen);
  const activePane = useSettingsStore(s => s.ui.activePane);
  const close = useSettingsStore(s => s.close);

  React.useEffect(() => {
    useSettingsStore.getState().load();
  }, []);

  const t = useTranslations('settings');
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[1000] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-[2px]" onClick={close} />
      <div className="relative flex w-[90vw] max-w-[1200px] aspect-[4/3] flex-col rounded-xl border border-border bg-background text-foreground shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-5 py-3 border-b border-border bg-background/95 flex-none">
          <div>
            <h2 className="text-base font-semibold">{t('title', {default: 'Settings'})}</h2>
            <p className="text-xs text-muted-foreground">{t('subtitle', {default: 'Global preferences'})}</p>
          </div>
          <button onClick={close} className="p-2 rounded-md hover:bg-accent/30">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex min-h-0 flex-1">
          <SettingsNav />
          <div className="flex-1 p-5 overflow-hidden">
            {activePane === 'account' && <AccountPane />}
            {activePane === 'integrations' && <IntegrationsPane />}
            {activePane === 'connections' && <ConnectionsPane />}
            {activePane === 'guides' && <GuidesPane />}
            {activePane === 'keymap' && <KeymapPane />}
            {/** Instructions pane disabled */}
          </div>
        </div>
      </div>
    </div>
  );
};

export default SettingsModal;

