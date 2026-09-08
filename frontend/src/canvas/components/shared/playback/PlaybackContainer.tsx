// 🎬 简单的播放容器
import React, { useEffect, useRef, useState } from 'react';
import type { Canvas, CanvasNode, CanvasConnection } from '../../../../types/canvas';
import { cameraAnimator } from './CameraAnimator';

interface PlaybackContainerProps {
  canvas: Canvas;
  children: React.ReactNode;
  className?: string;
  transformRef?: React.RefObject<any>;
  
  // 顶部栏集成相关
  onPlayStateChange?: (state: 'idle' | 'playing' | 'paused') => void;
  playState?: 'idle' | 'playing' | 'paused';
}

export const PlaybackContainer: React.FC<PlaybackContainerProps> = ({
  canvas,
  children,
  className = '',
  transformRef,
  onPlayStateChange,
  playState = 'idle'
}) => {
  // 绑定 transformRef（等待实际实例准备好）
  const [refReady, setRefReady] = useState(false);
  useEffect(() => {
    let cancelled = false;
    let raf = 0 as any;
    const tryBind = () => {
      if (cancelled) return;
      const refObj: any = transformRef as any;
      const r = refObj?.current || refObj;
      // 更稳健的就绪判定：存在 setTransform 且有 state/transformState
      const hasSetter = !!r?.setTransform;
      const hasState = !!(r?.state || r?.instance?.transformState);
      if (hasSetter && hasState) {
        cameraAnimator.setTransformRef(transformRef);
        setRefReady(true);
        return;
      }
      raf = requestAnimationFrame(tryBind);
    };
    tryBind();
    return () => { cancelled = true; if (raf) cancelAnimationFrame(raf); };
  }, [transformRef]);

  // ✅ 已优化：只在播放状态时分析路径，避免节点移动时的性能开销
  useEffect(() => {
    const executePlayers = async () => {
      if (playState === 'playing') {
        if (!refReady) return; // 等待视图变换引用就绪
        try {
          // 如果已有序列且当前是暂停，则继续播放；若已在播放则忽略
          const info = cameraAnimator.getAnimationInfo();
          const hasSeq = (cameraAnimator as any).hasActiveSequence?.() || (info.totalDuration > 0);
          const paused = (cameraAnimator as any).isPaused?.() || false;

          if (hasSeq) {
            if (paused) {
              cameraAnimator.resumeAnimation();
            }
            return;
          }

          // 无活动序列：开始新的播放
          if (canvas.nodes.length > 0) {
            console.log('🔄 PlaybackContainer开始播放，分析路径...');
            const { pathAnalyzer } = await import('./PathAnalyzer');
            const paths = pathAnalyzer.analyzeCanvas(canvas);
            if (paths && paths.length > 0) {
              const path = paths[0];
              console.log('🎬 开始播放:', path.name, '节点数:', path.nodes.length);
              const sequence = await cameraAnimator.createAnimationSequence(path.nodes, path.name);
              if (!sequence.keyframes.length) {
                if (onPlayStateChange) onPlayStateChange('idle');
                return;
              }
              await cameraAnimator.playSequence(sequence);
              if (onPlayStateChange) onPlayStateChange('idle');
            }
          }
        } catch (error) {
          console.error('播放失败:', error);
          if (onPlayStateChange) onPlayStateChange('idle');
        }
      } else if (playState === 'paused') {
        cameraAnimator.pauseAnimation();
      } else if (playState === 'idle') {
        cameraAnimator.stopAnimation();
      }
    };
    executePlayers();
  }, [playState, onPlayStateChange, canvas, refReady]);

  return (
    <div className={`relative w-full h-full ${className}`}>
      {/* 画布内容 */}
      {children}
    </div>
  );
};

export default PlaybackContainer;
