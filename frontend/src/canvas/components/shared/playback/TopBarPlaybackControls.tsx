import React, { useCallback } from 'react';
import { Play, Pause, Square } from 'lucide-react';

interface TopBarPlaybackControlsProps {
  playState?: 'idle' | 'playing' | 'paused';
  onPlayStateChange?: (state: 'idle' | 'playing' | 'paused') => void;
}

const TopBarPlaybackControls: React.FC<TopBarPlaybackControlsProps> = ({ playState = 'idle', onPlayStateChange }) => {
  const onPlay = useCallback(() => onPlayStateChange?.('playing'), [onPlayStateChange]);
  const onPause = useCallback(() => onPlayStateChange?.('paused'), [onPlayStateChange]);
  const onStop = useCallback(() => onPlayStateChange?.('idle'), [onPlayStateChange]);

  return (
    <div className="flex items-center gap-1 ml-2 mr-1">
      <button
        className={`w-8 h-8 rounded-md flex items-center justify-center transition-colors ${playState === 'playing' ? 'text-gray-400 dark:text-zinc-600 cursor-not-allowed' : 'text-gray-700 dark:text-zinc-200 hover:bg-accent/60'}`}
        title="播放"
        onClick={onPlay}
        disabled={playState === 'playing'}
      >
        <Play size={16} />
      </button>
      <button
        className={`w-8 h-8 rounded-md flex items-center justify-center transition-colors ${playState !== 'playing' ? 'text-gray-400 dark:text-zinc-600 cursor-not-allowed' : 'text-gray-700 dark:text-zinc-200 hover:bg-accent/60'}`}
        title="暂停"
        onClick={onPause}
        disabled={playState !== 'playing'}
      >
        <Pause size={16} />
      </button>
      <button
        className={`w-8 h-8 rounded-md flex items-center justify-center transition-colors ${playState === 'idle' ? 'text-gray-400 dark:text-zinc-600 cursor-not-allowed' : 'text-gray-700 dark:text-zinc-200 hover:bg-accent/60'}`}
        title="停止"
        onClick={onStop}
        disabled={playState === 'idle'}
      >
        <Square size={16} />
      </button>
    </div>
  );
};

export default TopBarPlaybackControls;

