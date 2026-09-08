/**
 * 🎯 节点对齐功能类型定义
 * 
 * 定义对齐排列功能所需的TypeScript类型，确保类型安全和代码可维护性
 * 为后续的分布和排列功能预留接口设计
 * 
 * @version 1.0.0
 * @author ZhenZhi Canvas Team
 */

// ==================== 基础枚举类型 ====================

/**
 * 对齐类型枚举
 */
export enum AlignmentType {
  LEFT = 'left',           // 左对齐
  RIGHT = 'right',         // 右对齐  
  TOP = 'top',            // 顶部对齐
  BOTTOM = 'bottom',       // 底部对齐
  CENTER_H = 'centerH',    // 水平居中
  CENTER_V = 'centerV',    // 垂直居中
  DISTRIBUTE_H = 'distribute_h',  // 水平等距分布
  DISTRIBUTE_V = 'distribute_v'   // 垂直等距分布
}

/**
 * 分布类型枚举（为Phase 2预留）
 */
export enum DistributionType {
  HORIZONTAL = 'horizontal',    // 水平分布
  VERTICAL = 'vertical',       // 垂直分布
  GRID = 'grid'               // 网格分布
}

/**
 * 排列类型枚举（为Phase 3预留）
 */
export enum ArrangementType {
  ROWS = 'rows',              // 行排列
  COLUMNS = 'columns',        // 列排列
  GRID = 'grid',              // 网格排列
  COMPACT = 'compact'         // 紧凑排列
}

// ==================== 配置选项接口 ====================

/**
 * 对齐选项配置
 */
export interface AlignmentOptions {
  /** 是否保持节点间的相对层级 */
  preserveZIndex?: boolean;
  /** 对齐基准模式 */
  alignTo?: 'selection' | 'first' | 'last';
  /** 是否进行边界检查，防止节点移出画布 */
  boundaryCheck?: boolean;
}

/**
 * 分布选项配置（为Phase 2预留）
 */
export interface DistributionOptions {
  /** 分布间距（像素） */
  spacing?: number;
  /** 是否使用固定间距 */
  useFixedSpacing?: boolean;
  /** 分布边界模式 */
  boundaryMode?: 'selection' | 'outerNodes';
}

/**
 * 排列选项配置（为Phase 3预留）
 */
export interface ArrangementOptions {
  /** 网格列数（仅grid模式使用） */
  columns?: number;
  /** 节点间距 */
  spacing?: { x: number; y: number };
  /** 是否保持节点原始尺寸 */
  preserveSize?: boolean;
}

// ==================== 结果接口 ====================

/**
 * 对齐结果信息
 */
export interface AlignmentResult {
  /** 处理的节点数量 */
  processedCount: number;
  /** 实际移动的节点数量 */
  movedCount: number;
  /** 对齐后的节点数组 */
  alignedNodes: import('../types/canvas').CanvasNode[];
  /** 对齐基准线坐标 */
  alignmentLine: number;
}

/**
 * 分布结果信息（为Phase 2预留）
 */
export interface DistributionResult {
  /** 处理的节点数量 */
  processedCount: number;
  /** 实际移动的节点数量 */
  movedCount: number;
  /** 分布后的节点数组 */
  distributedNodes: import('../types/canvas').CanvasNode[];
  /** 计算的间距值 */
  calculatedSpacing: number;
}

/**
 * 排列结果信息（为Phase 3预留）
 */
export interface ArrangementResult {
  /** 处理的节点数量 */
  processedCount: number;
  /** 排列后的节点数组 */
  arrangedNodes: import('../types/canvas').CanvasNode[];
  /** 网格信息（仅grid模式） */
  gridInfo?: {
    rows: number;
    columns: number;
    cellSize: { width: number; height: number };
  };
}

// ==================== 工具栏状态接口 ====================

/**
 * 对齐工具栏状态
 */
export interface AlignmentToolbarState {
  /** 是否显示工具栏 */
  isVisible: boolean;
  /** 工具栏位置 */
  position: {
    x: number;
    y: number;
  };
  /** 当前选中的节点数量 */
  selectedCount: number;
  /** 是否正在执行对齐操作 */
  isAligning: boolean;
  /** 当前激活的对齐类型（用于高亮显示） */
  activeAlignmentType?: AlignmentType;
}

/**
 * 工具栏配置选项
 */
export interface ToolbarConfig {
  /** 工具栏样式主题 */
  theme?: 'light' | 'dark';
  /** 是否显示工具提示 */
  showTooltips?: boolean;
  /** 是否启用动画效果 */
  enableAnimations?: boolean;
  /** 工具栏大小 */
  size?: 'small' | 'medium' | 'large';
}

// ==================== 预览相关接口 ====================

/**
 * 对齐预览信息
 */
export interface AlignmentPreview {
  /** 节点ID到新位置的映射 */
  positions: Map<string, { x: number; y: number }>;
  /** 对齐基准线坐标 */
  alignmentLine: number;
  /** 对齐类型 */
  alignmentType: AlignmentType;
  /** 是否显示预览 */
  showPreview: boolean;
}

/**
 * 预览线样式配置
 */
export interface PreviewLineStyle {
  /** 线条颜色 */
  color: string;
  /** 线条宽度 */
  width: number;
  /** 线条样式 */
  dashArray?: string;
  /** 透明度 */
  opacity: number;
}

// ==================== 验证相关接口 ====================

/**
 * 节点验证结果
 */
export interface NodeValidationResult {
  /** 是否有效 */
  isValid: boolean;
  /** 无效原因 */
  reason?: string;
  /** 有效节点数量 */
  validCount: number;
  /** 无效节点ID列表 */
  invalidNodeIds?: string[];
}

/**
 * 操作限制配置
 */
export interface OperationConstraints {
  /** 最小节点数量 */
  minNodes: number;
  /** 最大节点数量 */
  maxNodes: number;
  /** 允许的节点类型 */
  allowedNodeTypes?: string[];
  /** 禁止的节点类型 */
  forbiddenNodeTypes?: string[];
}

// ==================== 性能相关接口 ====================

/**
 * 性能监控配置
 */
export interface PerformanceConfig {
  /** 是否启用性能监控 */
  enabled: boolean;
  /** 性能警告阈值（毫秒） */
  warningThreshold: number;
  /** 是否记录详细日志 */
  detailedLogging: boolean;
}

/**
 * 操作性能指标
 */
export interface PerformanceMetrics {
  /** 操作耗时（毫秒） */
  duration: number;
  /** 处理的节点数量 */
  nodeCount: number;
  /** 每秒处理节点数 */
  nodesPerSecond: number;
  /** 内存使用情况 */
  memoryUsage?: {
    before: number;
    after: number;
    delta: number;
  };
}

// ==================== 快捷键相关接口 ====================

/**
 * 快捷键配置
 */
export interface KeyboardShortcuts {
  /** 左对齐快捷键 */
  alignLeft: string;
  /** 右对齐快捷键 */
  alignRight: string;
  /** 顶部对齐快捷键 */
  alignTop: string;
  /** 底部对齐快捷键 */
  alignBottom: string;
  /** 水平居中快捷键 */
  alignCenterH: string;
  /** 垂直居中快捷键 */
  alignCenterV: string;
  /** 水平分布快捷键 */
  distributeH: string;
  /** 垂直分布快捷键 */
  distributeV: string;
  /** 撤销对齐快捷键 */
  undo: string;
  /** 重做对齐快捷键 */
  redo: string;
}

// ==================== 动画相关接口 ====================

/**
 * 对齐动画配置
 */
export interface AlignmentAnimation {
  /** 是否启用动画 */
  enabled: boolean;
  /** 动画持续时间（毫秒） */
  duration: number;
  /** 动画缓动函数 */
  easing: 'linear' | 'ease' | 'ease-in' | 'ease-out' | 'ease-in-out' | string;
  /** 是否显示动画路径 */
  showPath: boolean;
}

/**
 * 动画状态
 */
export interface AnimationState {
  /** 是否正在播放动画 */
  isPlaying: boolean;
  /** 动画进度（0-1） */
  progress: number;
  /** 动画开始时间 */
  startTime: number;
  /** 参与动画的节点ID列表 */
  animatingNodeIds: string[];
}

// ==================== 默认配置常量 ====================

/**
 * 默认对齐选项
 */
export const DEFAULT_ALIGNMENT_OPTIONS: Required<AlignmentOptions> = {
  preserveZIndex: true,
  alignTo: 'selection',
  boundaryCheck: true
};

/**
 * 默认工具栏配置
 */
export const DEFAULT_TOOLBAR_CONFIG: Required<ToolbarConfig> = {
  theme: 'light',
  showTooltips: true,
  enableAnimations: true,
  size: 'medium'
};

/**
 * 默认快捷键配置
 */
export const DEFAULT_KEYBOARD_SHORTCUTS: KeyboardShortcuts = {
  alignLeft: 'Ctrl+L',
  alignRight: 'Ctrl+R',
  alignTop: 'Ctrl+T',
  alignBottom: 'Ctrl+B',
  alignCenterH: 'Ctrl+E',
  alignCenterV: 'Ctrl+M',
  distributeH: 'Ctrl+Shift+H',
  distributeV: 'Ctrl+Shift+V',
  undo: 'Ctrl+Z',
  redo: 'Ctrl+Y'
};

/**
 * 默认动画配置
 */
export const DEFAULT_ANIMATION_CONFIG: AlignmentAnimation = {
  enabled: true,
  duration: 400,
  easing: 'ease-out',
  showPath: true
};

/**
 * 默认操作限制
 */
export const DEFAULT_OPERATION_CONSTRAINTS: OperationConstraints = {
  minNodes: 2,
  maxNodes: 1000
};

// ==================== 工具类型 ====================

/**
 * 对齐操作历史记录项
 */
export interface AlignmentHistoryItem {
  /** 操作ID */
  id: string;
  /** 操作类型 */
  type: AlignmentType | DistributionType | ArrangementType;
  /** 操作前的节点状态 */
  beforeState: Map<string, { x: number; y: number }>;
  /** 操作后的节点状态 */
  afterState: Map<string, { x: number; y: number }>;
  /** 操作时间戳 */
  timestamp: number;
  /** 操作选项 */
  options: AlignmentOptions | DistributionOptions | ArrangementOptions;
}

/**
 * 批量操作配置
 */
export interface BatchOperationConfig {
  /** 操作类型列表 */
  operations: Array<{
    type: AlignmentType | DistributionType | ArrangementType;
    options?: AlignmentOptions | DistributionOptions | ArrangementOptions;
  }>;
  /** 是否在每步操作后暂停 */
  pauseBetweenOperations?: boolean;
  /** 操作间隔时间（毫秒） */
  operationDelay?: number;
}

// ==================== 导出所有类型 ====================
// 类型已经通过interface声明自动导出，无需重复export type

/**
 * 🎯 使用示例：
 * 
 * ```typescript
 * import { 
 *   AlignmentType, 
 *   AlignmentOptions,
 *   DEFAULT_ALIGNMENT_OPTIONS 
 * } from './node-alignment';
 * 
 * // 使用枚举类型
 * const alignmentType = AlignmentType.LEFT;
 * 
 * // 配置选项
 * const options: AlignmentOptions = {
 *   ...DEFAULT_ALIGNMENT_OPTIONS,
 *   alignTo: 'first'
 * };
 * 
 * // 工具栏状态
 * const toolbarState: AlignmentToolbarState = {
 *   isVisible: true,
 *   position: { x: 100, y: 200 },
 *   selectedCount: 5,
 *   isAligning: false
 * };
 * ```
 */