// 🛠️ 工具模式选择器组件
// 提供选择工具和手型工具的切换功能，以及缩放控制和视图操作

import React, { useState } from 'react';
import {useTranslations} from 'next-intl';
import { useTheme } from 'next-themes';
import { Crosshair, Lock, Unlock, RotateCcw, Map as MapIcon, Magnet } from 'lucide-react';
import GlassSurface from '../GlassSurface';
import type { CanvasToolMode } from '../../../../types/canvas';
import type { BackgroundStyle } from '../panels/StylePanel';
import Minimap from '../../Minimap';
import { useSettingsStore } from '../../../stores/settings.store';

interface ToolModeSelectorProps {
  currentMode: CanvasToolMode;
  onModeChange: (mode: CanvasToolMode) => void;
  className?: string;
  // 新增的缩放和视图控制props
  currentZoom?: number;
  onFitToView?: () => void;
  isPanningLocked?: boolean;
  onPanningLockToggle?: () => void;
  isEditMode?: boolean;
  // 背景样式匹配
  backgroundStyle?: BackgroundStyle;
  backgroundColor?: string;
  // 小地图导航回调（由父组件调用 transformRef 生效）
  onMinimapNavigate?: (center: { x: number; y: number }) => void;
}

const ToolModeSelector: React.FC<ToolModeSelectorProps> = ({
  currentMode,
  onModeChange,
  className = "",
  currentZoom = 100,
  onFitToView,
  isPanningLocked = false,
  onPanningLockToggle,
  isEditMode = false,
  backgroundStyle,
  backgroundColor,
  onMinimapNavigate
}) => {
  const [isMinimapOpen, setIsMinimapOpen] = useState(false);
  const t = useTranslations();
  const { resolvedTheme } = useTheme();
  const guidesEnabled = useSettingsStore(s => s.guides?.enabled !== false);
  const setGuides = useSettingsStore(s => s.setGuides);
  // 提取背景色，匹配Canvas背景
  const getToolbarBackgroundColor = () => {
    // 优先使用传入的自定义背景色
    if (backgroundColor) {
      return backgroundColor;
    }

    // 根据背景样式类型提取背景色
    if (backgroundStyle) {
      if (backgroundStyle.type === 'solid') {
        // 纯色背景：使用样式定义的颜色
        return backgroundStyle.color || '#eeeded';
      } else {
        // 图案背景（dots/grid）：使用基础背景色
        return '#eeeded';
      }
    }

    // 默认背景色（暗色模式下使用更深的黑色）
    return resolvedTheme === 'dark' ? '#0F0F10' : '#eeeded';
  };

  return (
    <div
      className={`absolute z-30 zoom-controls ${className}`}
      style={{
        bottom: 0,
        right: `var(--ai-panel-width, 0px)`,
      }}
      data-screenshot-exclude="true"
    >
      {/* 小地图面板（可折叠） */}
      {isMinimapOpen && (
        <div className="absolute bottom-14 right-2 rounded-md shadow-lg overflow-hidden bg-card">
          <Minimap
            width={200}
            height={140}
            onNavigate={onMinimapNavigate}
          />
        </div>
      )}
      {/* 背景层 - 匹配Canvas背景色（不拦截点击） */}
      <div
        className="absolute inset-0 rounded-tl-lg"
        style={{
          backgroundColor: getToolbarBackgroundColor(),
          pointerEvents: 'none'
        }}
        aria-hidden="true"
      />

      {/* 内容层 - 紧贴按钮，减少边缘空白 */}
      <div className="relative flex items-center px-1.5 py-1.5 space-x-1">

        {/* 智能对齐开关（拖拽 + 尺寸吸附） */}
        <button
          onClick={() => setGuides && setGuides({ enabled: !guidesEnabled })}
          className={`w-8 h-8 rounded-lg flex items-center justify-center transition-all duration-150 ease-out hover:-translate-y-1 hover:shadow-md hover:bg-accent/60 transform will-change-transform ${
            guidesEnabled ? 'text-green-600' : 'text-muted-foreground'
          }`}
          title={guidesEnabled
            ? 'Smart guides on — click to turn off'
            : 'Smart guides off — click to turn on'}
        >
          <Magnet size={14} />
        </button>

        {/* 线条工具按钮已迁移到左侧垂直工具栏 */}

        {/* 思维导图模式已移除：导图改为模板/节点范式，不再需要模式按钮 */}


        {/* Linear风格分割线 */}
        <div className="h-6 w-px bg-border/70 mx-1" />

        {/* 缩放显示 */}
        <div className="text-xs font-mono text-muted-foreground min-w-[50px] text-center">
          {currentZoom}%
        </div>

        {/* Linear风格分割线 */}
        <div className="h-6 w-px bg-border/70 mx-1" />

        {/* 小地图展开/折叠按钮（默认折叠） */}
        {
          <button
            onClick={() => setIsMinimapOpen((v) => !v)}
            className={`w-8 h-8 rounded-lg flex items-center justify-center transition-all duration-150 ease-out hover:-translate-y-1 hover:shadow-md hover:bg-accent/60 ${isMinimapOpen ? 'text-blue-600' : 'text-muted-foreground'}`}
            title={isMinimapOpen ? t('canvas.tools.hideMinimap', { default: 'Hide minimap' }) : t('canvas.tools.showMinimap', { default: 'Show minimap' })}
          >
            <MapIcon size={14} />
          </button>
        }

        {/* Linear风格分割线 */}
        <div className="h-6 w-px bg-border/70 mx-1" />

        {/* 居中视图按钮 */}
        {onFitToView && (
          <button
            onClick={onFitToView}
            className="w-8 h-8 rounded-lg flex items-center justify-center transition-all duration-150 ease-out hover:-translate-y-1 hover:shadow-md hover:bg-accent/60 text-muted-foreground transform will-change-transform"
            title={t('canvas.tools.centerView', { default: 'Center view' })}
          >
            <Crosshair size={14} />
          </button>
        )}

        {/* 锁定画布按钮 */}
        {onPanningLockToggle && (
          <button
            onClick={onPanningLockToggle}
            className={`w-8 h-8 rounded-lg flex items-center justify-center transition-all duration-150 ease-out hover:-translate-y-1 hover:shadow-md hover:bg-accent/60 transform will-change-transform ${
              isPanningLocked ? 'text-red-600' : 'text-muted-foreground'
            }`}
            title={isPanningLocked ? t('canvas.tools.unlockCanvas', { default: 'Unlock canvas' }) : t('canvas.tools.lockCanvas', { default: 'Lock canvas' })}
          >
            {isPanningLocked ? <Lock size={14} /> : <Unlock size={14} />}
          </button>
        )}
      </div>
    </div>
  );
};

export default ToolModeSelector;
