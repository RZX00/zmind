import React from 'react';
import { Globe } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { CardTitle } from '@/components/ui/card';

interface BrowserHeaderProps {
  isConnected: boolean;
  onRefresh?: () => void;
  viewToggle?: React.ReactNode;
}

export const BrowserHeader: React.FC<BrowserHeaderProps> = ({ isConnected, onRefresh, viewToggle }) => {
  return (
    <div className={`flex items-center justify-between px-3 md:px-4 py-2 border border-border ${!isConnected ? 'bg-muted/30 border-b' : ''}`}>
      <div className="flex items-center gap-2 justify-between min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <div className="relative p-2 rounded-xl bg-gradient-to-br from-purple-500/20 to-purple-600/10 border border-purple-500/20">
            <Globe className="w-5 h-5 text-purple-500 dark:text-purple-400" />
          </div>
          <div>
            <CardTitle className="text-base font-medium text-zinc-900 dark:text-zinc-100">
              Browser
            </CardTitle>
          </div>
        </div>
        <div className='flex items-center gap-1'>
          <Badge variant="outline" className="gap-1.5 p-2 rounded-3xl mr-2">
            <div className={`w-2 h-2 rounded-full ${isConnected ? 'bg-green-500' : 'bg-gray-500'}`} />
            {isConnected ? 'Connected' : 'Disconnected'}
          </Badge>
          {viewToggle}
        </div>
      </div>
    </div>
  );
};