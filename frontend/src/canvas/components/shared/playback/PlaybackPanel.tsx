import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Play, Pause, Square, Settings, Zap, Repeat } from 'lucide-react';
import type { Canvas } from '../../../types/canvas';
import type { BackgroundStyle } from '../panels/StylePanel';
import { pathAnalyzer } from './PathAnalyzer';
import { cameraAnimator, setPlaybackSpeed, getPlaybackSpeed, setLoopEnabled, getLoopEnabled, setTransitionSpeed, setMotionProfile, onProgress, offProgress } from './CameraAnimator';
import { contentTimingAnalyzer } from './ContentTimingAnalyzer';

export type PlayState = 'idle' | 'playing' | 'paused';

interface PlaybackPanelProps {
  canvas: Canvas;
  playState?: PlayState;
  onPlayStateChange?: (state: 'play' | 'pause' | 'stop') => void;
  className?: string;
  onClose?: () => void;
  backgroundStyle?: BackgroundStyle;
  backgroundColor?: string;
}

const SPEED_STEPS = [0.5, 1.0, 2.0, 3.0];

const getPersisted = <T,>(key: string, fallback: T): T => {
  try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) as T : fallback; } catch { return fallback; }
};
const setPersisted = (k: string, v: any) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };

const PlaybackPanel: React.FC<PlaybackPanelProps> = ({ canvas, playState: extPlayState = 'idle', onPlayStateChange, className = '', onClose, backgroundStyle, backgroundColor }) => {
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isSpeedOpen, setIsSpeedOpen] = useState(false);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);
  const [paths, setPaths] = useState<any[]>([]);
  const [autoHidden, setAutoHidden] = useState(false);
  const [isPanelHovering, setIsPanelHovering] = useState(false);
  const lastProgressRef = useRef(0);

  // 持久化参数
  const [speed, setSpeed] = useState<number>(() => getPersisted('playback:speed', getPlaybackSpeed()));
  const [loop, setLoop] = useState<boolean>(() => getPersisted('playback:loop', getLoopEnabled()));
  useEffect(() => { try { setPlaybackSpeed(speed); } catch {} }, [speed]);
  useEffect(() => { try { setLoopEnabled(loop); } catch {} }, [loop]);
  // 强制自然曲线
  useEffect(() => { try { setMotionProfile('natural'); } catch {} }, []);

  const initialCfg = useMemo(() => pathAnalyzer.getConfig(), []);
  const [focusPercentage, setFocusPercentage] = useState<number>(() => getPersisted('playback:focusPercentage', initialCfg.focusPercentage ?? 0.7));
  type Pacing = 'slow' | 'medium' | 'fast'
  const [pacing, setPacing] = useState<Pacing>(() => getPersisted('playback:pacing', 'medium'));
  // 初始应用统一速度档位 -> transitionSpeed=medium, readingSpeed=normal
  useEffect(() => {
    try {
      const ts: 'slow'|'medium'|'fast' = pacing;
      const rs: 'slow'|'normal'|'fast' = pacing === 'medium' ? 'normal' : pacing;
      pathAnalyzer.updateConfig({ focusPercentage, transitionSpeed: ts });
      setTransitionSpeed(ts);
      const base = contentTimingAnalyzer.getProfile();
      const mult = pacing === 'slow' ? 0.85 : pacing === 'fast' ? 1.2 : 1.0;
      contentTimingAnalyzer.updateProfile({ customSettings: {
        ...base.customSettings,
        textSpeedMultiplier: mult,
        codeSpeedMultiplier: Math.min(3, Math.max(0.5, base.customSettings.codeSpeedMultiplier * mult)),
        tableSpeedMultiplier: Math.min(2.5, Math.max(0.5, base.customSettings.tableSpeedMultiplier * mult)),
      }});
    } catch {}
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // 移除曲线选项，固定为 natural（详见上方 useEffect）

  // 进度更新：来自动画事件，节流到 8-10fps，避免 React 每帧抖动
  useEffect(() => {
    const handler = (p: number) => {
      const pct = Math.round(p * 100);
      if (Math.abs(pct - lastProgressRef.current) < 1) return;
      lastProgressRef.current = pct;
      setProgress(pct);
    };
    try { onProgress(handler); } catch {}
    return () => {
      try { offProgress(handler); } catch {}
      lastProgressRef.current = 0;
    };
  }, []);
  useEffect(() => {
    if (extPlayState === 'idle') {
      lastProgressRef.current = 0;
      setProgress(0);
    }
  }, [extPlayState]);

  // 自动隐藏（播放中 3s 无操作）
  useEffect(() => {
    let hideTimer: number | null = null;
    const reset = () => {
      setAutoHidden(false);
      if (hideTimer) window.clearTimeout(hideTimer);
      // 子菜单或面板 hover 时暂停隐藏计时
      if (isSpeedOpen || isSettingsOpen || isPanelHovering) return;
      hideTimer = window.setTimeout(() => setAutoHidden(true), 3000);
    };
    const onMove = () => reset(); const onKey = () => reset();
    document.addEventListener('mousemove', onMove); document.addEventListener('keydown', onKey);
    reset();
    return () => { if (hideTimer) window.clearTimeout(hideTimer); document.removeEventListener('mousemove', onMove); document.removeEventListener('keydown', onKey); };
  }, [extPlayState, isSpeedOpen, isSettingsOpen, isPanelHovering]);

  // 悬浮菜单延时关闭与点击空白关闭
  const speedCloseTimerRef = useRef<number | null>(null);
  const settingsCloseTimerRef = useRef<number | null>(null);
  const speedAnchorRef = useRef<HTMLButtonElement | null>(null);
  const speedMenuRef = useRef<HTMLDivElement | null>(null);
  const settingsAnchorRef = useRef<HTMLButtonElement | null>(null);
  const settingsMenuRef = useRef<HTMLDivElement | null>(null);

  const scheduleSpeedClose = useCallback(() => {
    if (speedCloseTimerRef.current) window.clearTimeout(speedCloseTimerRef.current);
    speedCloseTimerRef.current = window.setTimeout(() => setIsSpeedOpen(false), 180);
  }, []);
  const scheduleSettingsClose = useCallback(() => {
    if (settingsCloseTimerRef.current) window.clearTimeout(settingsCloseTimerRef.current);
    settingsCloseTimerRef.current = window.setTimeout(() => setIsSettingsOpen(false), 180);
  }, []);

  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      const t = e.target as Node;
      if (isSpeedOpen) {
        if (
          speedMenuRef.current && !speedMenuRef.current.contains(t) &&
          speedAnchorRef.current && !speedAnchorRef.current.contains(t)
        ) setIsSpeedOpen(false);
      }
      if (isSettingsOpen) {
        if (
          settingsMenuRef.current && !settingsMenuRef.current.contains(t) &&
          settingsAnchorRef.current && !settingsAnchorRef.current.contains(t)
        ) setIsSettingsOpen(false);
      }
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [isSpeedOpen, isSettingsOpen]);

  useEffect(() => {
    setPaths([]);
  }, [canvas.id, canvas.updatedAt, canvas.nodes.length, canvas.connections.length]);

  const ensurePaths = useCallback(() => {
    if (!paths.length && canvas.nodes.length) setPaths(pathAnalyzer.analyzeCanvas(canvas) || []);
  }, [paths.length, canvas]);

  const setPlayState = useCallback((s: PlayState) => {
    if (!onPlayStateChange) return;
    if (s === 'playing') onPlayStateChange('play');
    else if (s === 'paused') onPlayStateChange('pause');
    else onPlayStateChange('stop');
  }, [onPlayStateChange]);

  const handlePlay = useCallback(async () => {
    ensurePaths();
    const path = (paths.length ? paths : pathAnalyzer.analyzeCanvas(canvas))?.[0];
    if (!path) return;
    try {
      lastProgressRef.current = 0;
      setProgress(0);
      setPlayState('playing');
      const seq = await cameraAnimator.createAnimationSequence(path.nodes, path.name);
      if (!seq.keyframes.length) { setPlayState('idle'); return; }
      setDuration(seq.totalDuration);
      await cameraAnimator.playSequence(seq);
      setPlayState('idle'); lastProgressRef.current = 100; setProgress(100);
    } catch (e) { setPlayState('idle'); setProgress(0); }
  }, [paths, canvas, ensurePaths, setPlayState]);

  const handlePause = useCallback(() => { cameraAnimator.pauseAnimation(); setPlayState('paused'); }, [setPlayState]);
  const handleResume = useCallback(() => { cameraAnimator.resumeAnimation(); setPlayState('playing'); }, [setPlayState]);
  const handleStop = useCallback(() => {
    cameraAnimator.stopAnimation();
    setPlayState('idle');
    lastProgressRef.current = 0;
    setProgress(0);
  }, [setPlayState]);

  const cycleSpeed = useCallback((dir: 1|-1 = 1) => {
    const idx = SPEED_STEPS.findIndex(s => s === speed);
    const next = SPEED_STEPS[(idx + dir + SPEED_STEPS.length) % SPEED_STEPS.length];
    setPlaybackSpeed(next); setSpeed(next); setPersisted('playback:speed', next);
  }, [speed]);

  const toggleLoop = useCallback(() => {
    const next = !loop; setLoopEnabled(next); setLoop(next); setPersisted('playback:loop', next);
  }, [loop]);

  const applySettingsAndReplay = useCallback(async () => {
    setPersisted('playback:focusPercentage', focusPercentage);
    setPersisted('playback:pacing', pacing);
    // 映射统一速度档位
    const ts: 'slow'|'medium'|'fast' = pacing;
    const rs: 'slow'|'normal'|'fast' = pacing === 'medium' ? 'normal' : pacing;
    setPersisted('playback:transitionSpeed', ts);
    setPersisted('playback:readingSpeed', rs);
    // 更新分析与相机配置
    pathAnalyzer.updateConfig({ focusPercentage, transitionSpeed: ts });
    setTransitionSpeed(ts);
    try { setMotionProfile('natural'); } catch {}
    // 阅读配置转换为 multiplier
    const base = contentTimingAnalyzer.getProfile();
    const mult = pacing === 'slow' ? 0.85 : pacing === 'fast' ? 1.2 : 1.0;
    contentTimingAnalyzer.updateProfile({ customSettings: {
      ...base.customSettings,
      textSpeedMultiplier: mult,
      codeSpeedMultiplier: Math.min(3, Math.max(0.5, base.customSettings.codeSpeedMultiplier * mult)),
      tableSpeedMultiplier: Math.min(2.5, Math.max(0.5, base.customSettings.tableSpeedMultiplier * mult)),
    }});
    // 重播：静默停止，不发 stop 事件，避免上层关闭面板
    try { cameraAnimator.stopAnimation(); } catch {}
    setProgress(0);
    try { pathAnalyzer.clearPathAnalysisCache?.(); } catch {}
    setTimeout(() => { setPaths([]); ensurePaths(); handlePlay(); }, 60);
  }, [focusPercentage, pacing, handlePlay, ensurePaths]);

  // UI（常驻，使用动画显隐）

  const panelBg = (() => {
    if ((backgroundColor as any)) return backgroundColor as string;
    if ((backgroundStyle as any)) {
      const bs: any = backgroundStyle;
      if (bs.type === 'solid') return bs.color || '#eeeded';
      return '#eeeded';
    }
    return '#eeeded';
  })();

  return (
    <div className={`absolute bottom-2 left-1/2 -translate-x-1/2 z-50 ${className}`}>
      <div
        className="rounded-lg"
        onMouseEnter={() => setIsPanelHovering(true)}
        onMouseLeave={() => setIsPanelHovering(false)}
        style={{
          width: 'auto',
          height: 'auto',
          backgroundColor: panelBg,
          opacity: autoHidden ? 0 : 1,
          transform: autoHidden ? 'translateY(16px)' : 'translateY(0px)',
          transition: 'transform 220ms ease, opacity 220ms ease',
          pointerEvents: autoHidden ? 'none' : 'auto',
          padding: '6px 20px',
        }}
      >
        {/* 去掉进度条（按需求） */}

        {/* 主按钮行：尽量全部用按钮展示 */}
        <div className="flex items-center justify-between gap-2">
          {/* 播放控件 */}
          <button onClick={extPlayState === 'playing' ? handlePause : extPlayState === 'paused' ? handleResume : handlePlay} className="w-9 h-9 rounded-md bg-foreground text-background hover:bg-foreground/90 flex items-center justify-center" title={extPlayState==='playing'?'Pause':'Play'}>
            {extPlayState === 'playing' ? <Pause className="w-5 h-5" /> : <Play className="w-5 h-5" />}
          </button>
          <button onClick={handleStop} className="w-9 h-9 rounded-md flex items-center justify-center text-foreground hover:bg-accent/60" title="Stop">
            <Square className="w-4 h-4" />
          </button>

          {/* 速度：悬浮菜单（延时关闭） */}
          <div className="relative">
            <button
              className="h-9 px-2 rounded-md border border-border text-foreground hover:bg-accent/40 flex items-center gap-1"
              title="Speed"
              ref={speedAnchorRef}
              onMouseEnter={() => { if (speedCloseTimerRef.current) window.clearTimeout(speedCloseTimerRef.current); setIsSpeedOpen(true); }}
              onMouseLeave={() => scheduleSpeedClose()}
            >
              <Zap size={14} />{speed}x
            </button>
            {isSpeedOpen && (
              <div
                className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 bg-popover border border-border rounded-md shadow-lg p-1 flex flex-col z-10"
                ref={speedMenuRef}
                onMouseEnter={() => { if (speedCloseTimerRef.current) window.clearTimeout(speedCloseTimerRef.current); }}
                onMouseLeave={() => scheduleSpeedClose()}
              >
                {SPEED_STEPS.map(s => (
                  <button key={s} onClick={() => { setPlaybackSpeed(s); setSpeed(s); setPersisted('playback:speed', s); }} className={`px-3 py-1.5 text-sm text-foreground hover:bg-accent/40 rounded ${s===speed?'bg-accent/60':''}`}>{s}x</button>
                ))}
              </div>
            )}
          </div>

          {/* 循环 */}
          <button onClick={toggleLoop} className={`w-8 h-8 rounded-md border flex items-center justify-center ${loop ? 'bg-accent text-accent-foreground border-border' : 'bg-background border-border text-muted-foreground'}`} title="Loop">
            <Repeat size={14} />
          </button>

          {/* 设置：悬浮菜单（延时关闭，选择即应用） */}
          <div className="relative">
            <button
              className="h-9 px-2 rounded-md border border-border text-foreground hover:bg-accent/40 flex items-center gap-1"
              title="Settings"
              ref={settingsAnchorRef}
              onMouseEnter={() => { if (settingsCloseTimerRef.current) window.clearTimeout(settingsCloseTimerRef.current); setIsSettingsOpen(true); }}
              onMouseLeave={() => scheduleSettingsClose()}
            >
              <Settings size={14} />
            </button>
            {isSettingsOpen && (
              <div
                className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 bg-popover border border-border rounded-md shadow-lg p-2 z-10"
                ref={settingsMenuRef}
                onMouseEnter={() => { if (settingsCloseTimerRef.current) window.clearTimeout(settingsCloseTimerRef.current); }}
                onMouseLeave={() => scheduleSettingsClose()}
              >
                {/* Focus Ratio */}
                <div className="mb-1">
                  <div className="text-[10px] text-gray-500 dark:text-zinc-400 mb-1">Focus Ratio</div>
                  <div className="flex gap-1">
                    {[60,70,80].map(v => (
                      <button key={v} onClick={() => { setFocusPercentage(v/100); setPersisted('playback:focusPercentage', v/100); applySettingsAndReplay(); }} className={`px-2 py-1 text-xs rounded border ${Math.round(focusPercentage*100)===v?'bg-foreground text-background border-foreground':'border-border text-foreground hover:bg-accent/40'}`}>{v}%</button>
                    ))}
                  </div>
                </div>
                {/* Unified Playback Speed */}
                <div className="mb-1">
                  <div className="text-[10px] text-gray-500 dark:text-zinc-400 mb-1">Playback Speed</div>
                  <div className="flex gap-1">
                    {(['slow','medium','fast'] as const).map(v => (
                      <button key={v} onClick={() => { setPacing(v as any); applySettingsAndReplay(); }} className={`px-2 py-1 text-xs rounded border ${pacing===v?'bg-foreground text-background border-foreground':'border-border text-foreground hover:bg-accent/40'}`}>{v==='slow'?'Slow':v==='medium'?'Medium':'Fast'}</button>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default PlaybackPanel;
