// 🎨 无限画布扁平化类型系统
// AI友好的扁平化数据结构，完全重构版本

import type { TextLayoutPresetId, TextOpacityPresetId } from '../constants/textNodePresets';
import type { TextStyles } from './textStyles';
import type { CanvasIconName } from '../constants/canvasIcons';
import type { StructuredTableData } from '../utils/structuredTable';
import type { JSONContent } from 'novel';
export type { TextStyles } from './textStyles';

export interface ExpandedEditorNodeData {
  expandedEditor?: {
    version?: string;
    markdown?: string;
    html?: string;
    json?: JSONContent | null;
    updatedAt?: number;
  };
  docRef?: DocRefMetadata;
  [key: string]: unknown;
}

export type DocRefSyncState = 'synced' | 'stale' | 'missing' | 'forbidden';

export interface DocRefMetadata {
  referenceId: string;
  sourceDocItemId: string;
  sourceBlockId?: string;
  sourceAnchor?: string;
  mode: 'reference' | 'snapshot';
  syncState: DocRefSyncState;
}

export type CanvasNodeData = StructuredTableData | ExpandedEditorNodeData;

export type ExternalVideoProvider = 'youtube' | 'bilibili';
export type MediaSourceType = 'file' | 'external';

// 📍 核心节点类型 - 扁平化结构
export interface CanvasNode {
  // 基础信息
  id: string;
  type: 'text' | 'code' | 'column' | 'table' | 'canvas-link' | 'todo' | 'media' | 'group';
  
  // 扁平化位置和尺寸
  x: number;
  y: number;
  width: number;
  height: number;
  
  // 内容
  content: string;
  
  // 🚨 表格专用字段 - 结构化数据
  data?: CanvasNodeData;
  
  // 特定类型字段 (可选)
  codeType?: 'mermaid' | 'html' | 'svg';  // 仅 code 节点使用
  // Mermaid 节点主题（ID 化 + 配置）
  mermaidThemeId?: string;            // 仅 code=mermaid 节点使用
  mermaidTheme?: MermaidThemeConfig;  // 仅 code=mermaid 节点使用
  // SVG 节点主题和元数据
  svgTheme?: SvgThemeConfig;          // 仅 code=svg 节点使用
  svgMetadata?: {                     // 仅 code=svg 节点使用
    viewBox?: string;                 // SVG 视口
    preserveAspectRatio?: string;     // 缩放策略
    width?: string;                   // SVG 宽度
    height?: string;                  // SVG 高度
    syntaxHash?: string;              // 语法哈希（缓存用）
    renderedAt?: number;              // 渲染时间戳
    source?: string;                  // 来源标识
  };
  title?: string;                     // 仅 canvas-link 使用；column/group 的标题均映射在 content 首行（title 废弃）
  children?: string[];                // 容器节点使用（column、group）
  isCollapsed?: boolean;              // 仅 column 节点使用
  parentGroupId?: string;             // 所属组（容器）可选
  // 组附属连接（仅当 type === 'group' 使用）：属于该组的连接ID集合（自由连线或节点-节点连线）
  attachedConnections?: string[];
  
  // Canvas Link 节点专用字段
  targetCanvasId?: string;            // 仅 canvas-link 节点使用 - 目标画布ID
  thumbnailUrl?: string;              // 仅 canvas-link 节点使用 - 缩略图URL
  lastSyncedAt?: number;              // 仅 canvas-link 节点使用 - 最后同步时间
  
  // Todo 节点专用字段
  completed?: boolean;                // 仅 todo 节点使用 - 完成状态
  
  // Media 节点专用字段
  fileName?: string;                  // 仅 media 节点使用 - 文件名
  fileType?: string;                  // 仅 media 节点使用 - 文件类型 (MIME type)
  fileExtension?: string;             // 仅 media 节点使用 - 文件扩展名
  fileSize?: number;                  // 仅 media 节点使用 - 文件大小（字节）
  mediaType?: 'image' | 'document' | 'spreadsheet' | 'presentation' | 'audio' | 'video'; // 仅 media 节点使用 - 媒体类型
  localPath?: string;                 // 仅 media 节点使用 - 本地存储路径（图片专用）
  uploadStatus?: 'pending' | 'uploaded' | 'mock' | 'error'; // 仅 media 节点使用 - 上传状态
  fileUrl?: string;                   // 仅 media 节点使用 - 云端文件URL（图片/文件）
  fileDownloadUrl?: string;           // 仅 media 节点使用 - 下载URL（携带原名）
  // 云端存储对象路径（稳定持久，用于重新签名生成临时访问URL）
  storagePath?: string;               // 仅 media 节点使用 - 云端存储内部路径（R2/Supabase）
  fileId?: string;                    // 仅 media 节点使用 - file_uploads 记录ID（R2/统一存储）
  mediaSource?: MediaSourceType;      // 仅 media 节点使用 - 来源类型（本地/外链）
  externalUrl?: string;               // 仅 media 节点使用 - 外部视频源链接
  embedUrl?: string;                  // 仅 media 节点使用 - 外部视频嵌入链接
  externalProvider?: ExternalVideoProvider; // 仅 media 节点使用 - 外部视频来源
  kbEntryId?: string;                 // 仅 media 节点使用 - 知识库条目ID（文档解析完成后）
  kbJobId?: string;                   // 仅 media 节点使用 - 知识库处理任务ID
  kbStatus?: 'pending' | 'completed' | 'failed'; // 仅 media 节点使用 - 知识库解析状态
  mediaHasTransparentBg?: boolean;   // 仅 media 图片节点使用 - 是否检测到透明底
  
  // 样式字段
  textStyles?: TextStyles;            // 文本样式对象 - text和todo节点使用
  tableStyles?: any;                  // 表格样式对象 - table节点使用
  linkStyles?: any;                   // 链接样式对象 - canvas-link节点使用
  shapeDecoration?: NodeShapeDecoration; // 🎨 形状装饰配置 - 所有节点可用
  accentColor?: string;               // 强调色 - 所有节点可用
  opacity?: number;                   // 节点整体透明度（0-1），当前主要用于 media 节点
  groupStyles?: {                     // 组样式（仅group使用）
    bgOpacity?: number;               // 背景不透明度 0-1
  };

  // 思维导图群组专用元数据（仅当 type === 'group' 且为导图组时使用）
  groupMode?: 'mindmap' | 'normal';   // 组模式：思维导图/普通
  mindmap?: {
    rootId: string;                   // 根节点ID
    spacingX: number;                 // 层级间水平间距
    spacingY: number;                 // 同级节点/子树间垂直间距
    // 紧凑纵向布局：同列兄弟仅按自身高度+固定行距紧凑堆叠，忽略更深子树高度
    // 为避免破坏既有导图，默认关闭（undefined/false）。
    compactY?: boolean;
    showCrossLinks?: boolean;         // 是否显示跨引用边（不参与布局）
    // 方向：右向或双向。缺省为 'right'（兼容旧数据）。
    orientation?: 'right' | 'both';
    collapsed?: Record<string, boolean>;      // 折叠状态
    siblingOrder?: Record<string, string[]>;  // 同级顺序
  };
  
  // 时间戳 (数字格式，性能更优)
  createdAt: number;
  updatedAt: number;
  
  // 标记和状态
  ai?: boolean;                       // AI生成标识
  locked?: boolean;                  // 锁定状态（防止移动）
}

// 🏷️ 表格节点专用类型 - 使用结构化数据存储
export interface TableNode extends CanvasNode {
  type: 'table';
  data: StructuredTableData;
}

// 🔗 Canvas Link 节点专用类型 - 画布间链接
export interface CanvasLinkNode extends CanvasNode {
  type: 'canvas-link';
  title: string;                      // 链接显示标题
  targetCanvasId?: string;            // 目标画布ID（创建时设置）
  thumbnailUrl?: string;              // 缩略图URL
  lastSyncedAt?: number;              // 最后同步时间
  content: string;                    // 描述信息或备注
}

// ✅ Todo 节点专用类型 - 任务管理
export interface TodoNode extends CanvasNode {
  type: 'todo';
  completed: boolean;                 // 完成状态（必需）
  content: string;                    // 任务内容，支持Markdown
}

// 📁 Media 节点专用类型 - 多媒体文件
export interface MediaNode extends CanvasNode {
  type: 'media';
  fileName: string;                   // 文件名（必需）
  fileType: string;                   // 文件类型 MIME type（必需）
  fileExtension: string;              // 文件扩展名（必需）
  fileSize: number;                   // 文件大小（必需）
  mediaType: 'image' | 'document' | 'spreadsheet' | 'presentation' | 'audio' | 'video'; // 媒体类型（必需）
  uploadStatus: 'pending' | 'uploaded' | 'mock' | 'error'; // 上传状态（必需）
  localPath?: string;                 // 本地存储路径（仅图片节点有实际路径）
  content: string;                    // 描述信息或备注
  fileUrl?: string;                   // 云端文件URL
  fileDownloadUrl?: string;           // 下载URL（携带原名）
  storagePath?: string;               // 云端存储路径（重新签名所需）
  fileId?: string;                    // file_uploads 记录ID（R2/统一存储）
  mediaSource?: MediaSourceType;      // 来源类型（本地/外链）
  externalUrl?: string;               // 外部视频源链接
  embedUrl?: string;                  // 外部视频嵌入链接
  externalProvider?: ExternalVideoProvider; // 外部视频来源
  kbEntryId?: string;                 // 知识库条目ID
  kbJobId?: string;                   // 知识库处理任务ID
  kbStatus?: 'pending' | 'completed' | 'failed'; // 知识库解析状态
  mediaHasTransparentBg?: boolean;    // 图片节点透明底标记（用于 UI 阴影/背景控制）
}

// 🎨 SVG 节点专用类型 - 矢量图形
export interface SvgNode extends CanvasNode {
  type: 'code';
  codeType: 'svg';
  content: string;                    // SVG 代码内容（必需）
  svgTheme?: SvgThemeConfig;          // SVG 主题配置
  svgMetadata?: {                     // SVG 元数据
    viewBox?: string;                 // SVG 视口
    preserveAspectRatio?: string;     // 缩放策略
    width?: string;                   // SVG 宽度
    height?: string;                  // SVG 高度
    syntaxHash?: string;              // 语法哈希（缓存用）
    renderedAt?: number;              // 渲染时间戳
    source?: string;                  // 来源标识
  };
  // 节点背景底色模式：transparent（默认）| auto（跟随明暗主题）
  svgBgMode?: 'transparent' | 'auto';
}

// 表格样式（从 TableStylePanel 提炼）
export interface TableStyles {
  theme?: 'booktabs' | 'nature' | 'ieee';
  borderStyle?: 'solid' | 'dashed' | 'dotted';
  borderWidth?: number;
  borderColor?: string;
  headerBackground?: string;
  evenRowBackground?: string;
  oddRowBackground?: string;
  headerTextColor?: string;
  textColor?: string;
  cellPadding?: number;
  borderRadius?: number;
  showGrid?: boolean;
  alternateRows?: boolean;
  headerBold?: boolean;
  topBorder?: number;
  headerBorder?: number;
  bottomBorder?: number;
  fontFamily?: string;
  fontSize?: number;
  textAlign?: 'left' | 'center' | 'right';
}

// 链接节点样式（预留）
export interface LinkStyles {
  // 预留占位，后续需要可扩展（例如 thumbnail 边框等）
}

// Mermaid 主题配置（精简版，与面板使用一致）
export interface MermaidThemeConfig {
  id?: string;
  theme: 'default' | 'dark' | 'forest' | 'neutral' | 'base';
  look?: 'neo' | 'handDrawn' | 'classical';
  themeVariables?: Record<string, string>;
}

// SVG 主题配置
export interface SvgThemeConfig {
  id?: string;
  colorScheme: 'light' | 'dark' | 'auto';
  colors?: {
    primary?: string;
    secondary?: string;
    background?: string;
    stroke?: string;
    fill?: string;
  };
  // 预设主题或自定义CSS变量
  cssVariables?: Record<string, string>;
}

// 汇总为统一的节点样式容器
export interface NodeStyles {
  textStyles?: TextStyles;
  tableStyles?: TableStyles;
  linkStyles?: LinkStyles;
  accentColor?: string;
  mermaidTheme?: MermaidThemeConfig | any; // 保持兼容已有数据
  svgTheme?: SvgThemeConfig; // SVG 主题配置
}

// 🔗 连接类型 - 完全动态智能连线结构
export interface CanvasConnection {
  id: string;
  from: string;
  to: string;
  label?: string;
  createdAt: number;
  selected?: boolean;                 // 选中状态（UI层面）
  // 向后兼容：允许可选的连线渲染信息（部分模块使用）
  type?: 'straight' | 'bezier';       // 渲染类型（未设置时按算法动态计算）
  controlPoints?: Array<{ x: number; y: number }>; // 贝塞尔控制点（手动调整优先）
  // 自由连线（不依附节点）端点（可选）
  fromPoint?: { x: number; y: number };
  toPoint?: { x: number; y: number };
  // 预留样式（MVP未用）
  style?: 'line' | 'arrow';
  dashed?: boolean;
  // 外观样式（可选，若后端忽略将冗余保存于 metadata.connectionStyles）
  appearance?: ConnectionAppearance;
  // 曲率控制
  curveMode?: 'auto' | 'tension' | 'manual' | 'orthogonal';
  tension?: number; // 0..1
  // 固定的中控锚点（可选）：用于手动曲率编辑时，持久化中控点位置
  curveAnchor?: { x: number; y: number };
  // 规范化锚点参数：u 为沿弦的相对位置(0..1)，v 为垂直偏移相对弦长的比例(可正负)
  anchorParams?: { u: number; v: number };
  // 🎯 移除静态存储，连线类型和控制点都由智能算法实时计算
  // type?: 'bezier';                   // 已移除 - 由算法自动决定
  // controlPoints?: Array<{ x: number; y: number }>; // 已移除 - 实时计算
}

// 连线外观样式
export interface ConnectionAppearance {
  color?: string; // 十六进制/rgba
  width?: number; // 线宽
  opacity?: number; // 0..1
  dashed?: boolean;
  dashArray?: number[]; // 如 [6,3]
  endpointStrategy?: 'center-ray' | 'side-midpoints';
  arrow?: {
    start?: boolean;
    end?: boolean;
    size?: number; // px
    shape?: 'triangle' | 'vee' | 'circle' | 'bar' | 'diamond';
    filled?: boolean; // 是否填充
  };
  theme?: 'solid' | 'handdrawn';
  roughness?: number; // 手绘风格粗糙度（预留）
}

// 🎨 画布容器 - 扁平化结构
export interface Canvas {
  id: string;
  title: string;
  nodes: CanvasNode[];
  connections: CanvasConnection[];
  nodeCount?: number;
  // 轻量全局元数据（可选、前后端都可透明透传）
  metadata?: {
    // 持久化的曲率锚点：connectionId -> anchor
    connectionAnchors?: Record<string, { x: number; y: number }>;
  };
  // 永久成组（Phase 1）
  groups?: GroupEntity[];
  createdAt: number;
  updatedAt: number;
  version: string;
  serverVersion?: number;
  
  // 🗂️ 文件夹关联字段
  folderId?: string | null;           // 所属文件夹ID，null表示根级
  
  // 样式配置
  cornerStyle?: string;               // 圆角样式ID
  fontStyle?: string;                // 字体样式ID
  // 全局背景样式（可选，持久化）
  backgroundColor?: string;          // 画布背景底色
  backgroundStyleId?: string;        // 背景样式ID（solid/dots-medium/grid-medium等）
  patternColor?: string;             // 图案颜色（点阵/网格）
  textOpacityPreset?: TextOpacityPresetId;
  textLayoutPreset?: TextLayoutPresetId;
}

// 🎯 永久组实体（Phase 1）
export interface GroupEntity {
  id: string;
  name: string;           // 组名（默认：组1/组2）
  nodeIds: string[];      // 成员节点ID列表（扁平，嵌套通过parentGroupId表达）
  parentGroupId?: string; // 递归嵌套（可选）
  locked?: boolean;       // 锁定后禁止整体拖拽
  updatedAt: number;
}

 

// 🎯 节点创建选项
export interface CreateNodeOptions {
  type: 'text' | 'code' | 'column' | 'table' | 'canvas-link' | 'todo' | 'media';
  x: number;
  y: number;
  width?: number;
  height?: number;
  content?: string;
  codeType?: 'mermaid' | 'html' | 'svg';
  title?: string;
  children?: string[];
  isCollapsed?: boolean;
  
  // Canvas Link 创建选项
  targetCanvasId?: string;
  thumbnailUrl?: string;
  
  // Todo 创建选项
  completed?: boolean;
  
  // Media 创建选项
  fileName?: string;
  fileType?: string;
  fileExtension?: string;
  fileSize?: number;
  mediaType?: 'image' | 'document' | 'spreadsheet' | 'presentation' | 'audio' | 'video';
  localPath?: string;
  uploadStatus?: 'pending' | 'uploaded' | 'mock' | 'error';
  storagePath?: string;
  mediaSource?: MediaSourceType;
  externalUrl?: string;
  embedUrl?: string;
  externalProvider?: ExternalVideoProvider;
  
  // 样式字段
  textStyles?: any;
  tableStyles?: any;
  linkStyles?: any;
  accentColor?: string;
  
  // 表格创建选项 - 简化为content字段
}

// 🔧 节点更新选项（部分更新）
export interface UpdateNodeOptions {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  content?: string;
  title?: string;
  children?: string[];
  isCollapsed?: boolean;
  locked?: boolean;

  // 表格更新选项 - 支持data字段
  data?: CanvasNodeData;

  // Canvas Link 更新选项
  targetCanvasId?: string;
  thumbnailUrl?: string;
  lastSyncedAt?: number;

  // Todo 更新选项
  completed?: boolean;

  // Media 更新选项
  fileName?: string;
  fileType?: string;
  fileExtension?: string;
  fileSize?: number;
  mediaType?: 'image' | 'document' | 'spreadsheet' | 'presentation' | 'audio' | 'video';
  localPath?: string;
  uploadStatus?: 'pending' | 'uploaded' | 'mock' | 'error';
  storagePath?: string;
  mediaSource?: MediaSourceType;
  externalUrl?: string;
  embedUrl?: string;
  externalProvider?: ExternalVideoProvider;

  // Mermaid 主题更新
  mermaidThemeId?: string;
  mermaidTheme?: MermaidThemeConfig;
}

// 📊 AI上下文格式 - 匹配扁平化结构
export interface AIContext {
  canvas: {
    title: string;
    nodes: Array<{
      id: string;
      type: 'text' | 'code' | 'column' | 'table' | 'canvas-link' | 'todo' | 'media';
      content: string;
      x: number;
      y: number;
      width: number;
      height: number;
      title?: string;
      codeType?: 'mermaid' | 'html' | 'svg';
      children?: string[];
      isCollapsed?: boolean;
      ai?: boolean;
      tableData?: {
        rows: string[][];
        columnWidths?: number[];
        rowHeights?: number[];
        totalRows: number;
        truncated: boolean;
      };
      // Canvas Link AI上下文
      targetCanvasId?: string;
      thumbnailUrl?: string;
      lastSyncedAt?: number;
      // Todo 节点专用字段
      completed?: boolean;
      // Media 节点专用字段
      fileName?: string;
      fileType?: string;
      fileExtension?: string;
      fileSize?: number;
      mediaType?: 'image' | 'document' | 'spreadsheet' | 'presentation' | 'audio' | 'video';
      localPath?: string;
      uploadStatus?: 'pending' | 'uploaded' | 'mock' | 'error';
      mediaSource?: MediaSourceType;
      externalUrl?: string;
      embedUrl?: string;
      externalProvider?: ExternalVideoProvider;
      // 表格AI上下文
    }>;
    connections: Array<{
      id: string;
      from: string;
      to: string;
      label?: string;
    }>;
  };
}

// 🎮 画布操作事件类型
export type CanvasEvent = 
  | { type: 'CREATE_NODE'; payload: CreateNodeOptions }
  | { type: 'UPDATE_NODE'; payload: { id: string; updates: UpdateNodeOptions } }
  | { type: 'DELETE_NODE'; payload: { id: string } }
  | { type: 'CREATE_CONNECTION'; payload: Omit<CanvasConnection, 'id' | 'createdAt'> }
  | { type: 'UPDATE_CONNECTION'; payload: { id: string; label?: string } }
  | { type: 'DELETE_CONNECTION'; payload: { id: string } }
  | { type: 'SELECT_NODES'; payload: { nodeIds: string[] } }
  | { type: 'CLEAR_SELECTION' }
  // 表格专用事件类型
  | { type: 'ADD_TABLE_ROW'; payload: { nodeId: string; rowIndex?: number; rowData?: string[] } }
  | { type: 'DELETE_TABLE_ROW'; payload: { nodeId: string; rowIndex: number } }
  | { type: 'ADD_TABLE_COLUMN'; payload: { nodeId: string; columnIndex?: number; header?: string; columnData?: string[] } }
  | { type: 'DELETE_TABLE_COLUMN'; payload: { nodeId: string; columnIndex: number } }
  | { type: 'UPDATE_TABLE_CELL'; payload: { nodeId: string; rowIndex: number; columnIndex: number; value: string } };

// 🛠️ 画布工具模式
export type CanvasToolMode = 'select' | 'hand' | 'line';

// 🎯 导出NodeType类型供其他模块使用
export type NodeType = 'text' | 'code' | 'column' | 'table' | 'canvas-link' | 'todo' | 'media' | 'group';

// ⌨️ 键盘快捷键映射
export interface KeyboardShortcut {
  key: string;
  action: string;
  description: string;
}

// Menu types moved to '@/types/menu'

// 🎨 样式配置
export interface CornerStyle {
  id: string;
  name: string;
  radius: number; // 统一半径字段（替代其他文件中的 value）
  className: string;
}

export interface FontStyle {
  id: string;
  name: string;
  className: string;
  fontFamily: string;
  textAlign?: 'left' | 'center' | 'right';
  size?: number;        // 字体大小
  weight?: string;      // 字体粗细
  color?: string;       // 字体颜色
}

// 🎨 画布配置
export interface CanvasConfig {
  gridSize: number;
  snapToGrid: boolean;
  showGrid: boolean;
  maxNodes: number;
  maxConnections: number;
  autosave: boolean;
  autosaveInterval: number;
}

// 🎯 默认值常量
export const DEFAULT_NODE_SIZES = {
  text: { width: 300, height: 60 },
  todo: { width: 300, height: 60 },  // 与文本节点相同尺寸（统一为60px）
  mermaid: { width: 350, height: 250 },
  html: { width: 650, height: 540 },
  svg: { width: 400, height: 400 },  // SVG节点默认尺寸（正方形）
  column: { width: 300, height: 200 },
  table: { width: 400, height: 130 },
  'canvas-link': { width: 280, height: 180 },
  media: { width: 240, height: 160 }  // 媒体节点适中尺寸
} as const;

export const DEFAULT_CANVAS_CONFIG: CanvasConfig = {
  gridSize: 20,
  snapToGrid: false,
  showGrid: true,
  maxNodes: 200, // 增加到200以支持复杂模板
  maxConnections: 400, // 相应增加连接数限制
  autosave: true,
  autosaveInterval: 30000
};

// 🔍 类型守卫函数
export function isTextNode(node: CanvasNode): node is CanvasNode & { type: 'text' } {
  return node.type === 'text';
}

export function isCodeNode(node: CanvasNode): node is CanvasNode & { type: 'code' } {
  return node.type === 'code';
}

export function isColumnNode(node: CanvasNode): node is CanvasNode & { type: 'column' } {
  return node.type === 'column';
}

export function isMermaidNode(node: CanvasNode): node is CanvasNode & { type: 'code'; codeType: 'mermaid' } {
  return node.type === 'code' && node.codeType === 'mermaid';
}

export function isHtmlNode(node: CanvasNode): node is CanvasNode & { type: 'code'; codeType: 'html' } {
  return node.type === 'code' && node.codeType === 'html';
}

export function isSvgNode(node: CanvasNode): node is SvgNode {
  return node.type === 'code' && node.codeType === 'svg';
}

export function isTableNode(node: CanvasNode): node is TableNode {
  return node.type === 'table';
}

export function isCanvasLinkNode(node: CanvasNode): node is CanvasLinkNode {
  return node.type === 'canvas-link';
}

export function isMediaNode(node: CanvasNode): node is MediaNode {
  return node.type === 'media';
}

// 🔍 表格数据辅助函数类型
export interface TableHelpers {
  // 创建默认表格数据
  createDefaultTable: (rows: number, columns: number) => StructuredTableData;
  
  // 表格数据序列化和反序列化
  tableToJSON: (tableNode: TableNode) => string;
  tableFromJSON: (jsonData: string) => StructuredTableData;
  
  // 表格尺寸计算
  calculateTableDimensions: (
    data: StructuredTableData
  ) => { width: number; height: number };
}

// 🧰 工具函数接口
export interface CanvasUtils {
  // 节点操作
  createNode: (options: CreateNodeOptions) => CanvasNode;
  updateNode: (node: CanvasNode, updates: UpdateNodeOptions) => CanvasNode;
  deleteNode: (canvas: Canvas, nodeId: string) => Canvas;
  
  // 连线操作
  createConnection: (from: string, to: string, label?: string) => CanvasConnection;
  updateConnection: (connection: CanvasConnection, label?: string) => CanvasConnection;
  deleteConnection: (canvas: Canvas, connectionId: string) => Canvas;
  
  // 序列化
  toAIContext: (canvas: Canvas) => AIContext;
  fromAIContext: (context: AIContext) => Partial<Canvas>;
  
  // 工具函数
  generateId: () => string;
  getCurrentTimestamp: () => number;
  validateCanvas: (canvas: Canvas) => boolean;
}

// 🎯 迁移辅助类型（临时向后兼容）
export interface LegacyPosition {
  x: number;
  y: number;
}

export interface LegacySize {
  width: number;
  height: number;
}

// 🔄 迁移工具函数类型
export interface MigrationUtils {
  convertLegacyNode: (legacyNode: any) => CanvasNode;
  convertLegacyCanvas: (legacyCanvas: any) => Canvas;
  validateMigration: (originalCanvas: any, migratedCanvas: Canvas) => boolean;
}

// 节点类型图标映射
export interface NodeTypeIcon {
  type: 'text' | 'code' | 'column' | 'table' | 'canvas-link' | 'todo' | 'media' | 'group';
  icon: CanvasIconName;
  glyph: string;
  label: string;
  color: string;
}


// 节点类型图标常量
export const NODE_TYPE_ICONS: Record<CanvasNode['type'], NodeTypeIcon> = {
  text: {
    type: 'text',
    icon: 'text',
    glyph: '📝',
    label: '文本',
    color: '#3B82F6'
  },
  todo: {
    type: 'todo',
    icon: 'todo',
    glyph: '☑️',
    label: '待办',
    color: '#10B981'
  },
  code: {
    type: 'code',
    icon: 'code',
    glyph: '💻',
    label: '代码',
    color: '#10B981'
  },
  column: {
    type: 'column',
    icon: 'column',
    glyph: '📂',
    label: '容器',
    color: '#8B5CF6'
  },
  table: {
    type: 'table',
    icon: 'table',
    glyph: '📊',
    label: '表格',
    color: '#F59E0B'
  },
  'canvas-link': {
    type: 'canvas-link',
    icon: 'canvasLink',
    glyph: '🔗',
    label: '画布链接',
    color: '#EC4899'
  },
  media: {
    type: 'media',
    icon: 'media',
    glyph: '📁',
    label: '媒体文件',
    color: '#6366F1'
  },
  group: {
    type: 'group',
    icon: 'group',
    glyph: '🗂️',
    label: '组',
    color: '#2563EB'
  }
} as const;


// 🔗 Canvas Link Node 专用类型和工具函数
export interface CanvasLinkHelpers {
  // 创建Canvas Link节点
  createCanvasLinkNode: (options: {
    x: number;
    y: number;
    title: string;
    targetCanvasId: string;
    content?: string;
    width?: number;
    height?: number;
  }) => CanvasLinkNode;
  
  // 获取目标画布信息
  getTargetCanvasInfo: (targetCanvasId: string) => Promise<{
    id: string;
    title: string;
    exists: boolean;
    lastUpdated?: number;
  } | null>;
  
  // 生成缩略图
  generateThumbnail: (canvasId: string) => Promise<string | null>;
  
  // 验证链接有效性
  validateLink: (linkNode: CanvasLinkNode) => Promise<boolean>;
  
  // 同步链接状态
  syncLinkStatus: (linkNode: CanvasLinkNode) => Promise<CanvasLinkNode>;
}

// Canvas Link Node 的状态类型
export type CanvasLinkStatus = 'valid' | 'broken' | 'loading' | 'unknown';

// Canvas Link Node 导航选项
export interface CanvasLinkNavigationOptions {
  openInNewTab?: boolean;
  preserveHistory?: boolean;
  showTransition?: boolean;
}

// 📁 Media Node 辅助类型和常量

// 支持的文件类型映射
export const MEDIA_FILE_TYPES = {
  image: ['jpg', 'jpeg', 'png', 'gif', 'svg', 'webp', 'bmp', 'tiff'],
  document: ['pdf', 'doc', 'docx', 'txt', 'md', 'rtf'],
  spreadsheet: ['xls', 'xlsx', 'csv', 'ods'],
  presentation: ['ppt', 'pptx', 'odp'],
  audio: ['mp3', 'wav', 'aac', 'ogg', 'flac', 'm4a'],
  video: ['mp4', 'mov', 'avi', 'mkv', 'wmv', 'webm', 'flv']
} as const;

// 文件类型到MIME类型的映射
export const FILE_MIME_TYPES: Record<string, string> = {
  // 图片
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif',
  svg: 'image/svg+xml', webp: 'image/webp', bmp: 'image/bmp', tiff: 'image/tiff',
  
  // 文档
  pdf: 'application/pdf', doc: 'application/msword', 
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  txt: 'text/plain', md: 'text/markdown', rtf: 'application/rtf',
  
  // 表格
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  csv: 'text/csv', ods: 'application/vnd.oasis.opendocument.spreadsheet',
  
  // 演示
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  odp: 'application/vnd.oasis.opendocument.presentation',
  
  // 音频
  mp3: 'audio/mpeg', wav: 'audio/wav', aac: 'audio/aac',
  ogg: 'audio/ogg', flac: 'audio/flac', m4a: 'audio/m4a',
  
  // 视频
  mp4: 'video/mp4', mov: 'video/quicktime', avi: 'video/x-msvideo',
  mkv: 'video/x-matroska', wmv: 'video/x-ms-wmv', webm: 'video/webm', flv: 'video/x-flv'
} as const;

// Media Node 辅助函数接口
export interface MediaNodeHelpers {
  // 根据文件扩展名判断媒体类型
  getMediaTypeFromExtension: (extension: string) => MediaNode['mediaType'] | null;
  
  // 根据MIME类型判断媒体类型
  getMediaTypeFromMimeType: (mimeType: string) => MediaNode['mediaType'] | null;
  
  // 格式化文件大小显示
  formatFileSize: (bytes: number) => string;
  
  // 生成媒体节点缩略图路径
  generateThumbnailPath: (nodeId: string, extension: string) => string;
  
  // 验证文件类型是否支持
  isSupportedFileType: (extension: string) => boolean;
  
  // 创建媒体节点
  createMediaNode: (options: {
    x: number;
    y: number;
    file: File;
    uploadStatus?: 'pending' | 'uploaded' | 'mock' | 'error';
  }) => MediaNode;
}

// 媒体节点图标映射（基于文件类型）
export const MEDIA_TYPE_ICONS: Record<MediaNode['mediaType'], { icon: CanvasIconName; color: string }> = {
  image: { icon: 'image', color: '#10B981' },
  document: { icon: 'document', color: '#3B82F6' },
  spreadsheet: { icon: 'spreadsheet', color: '#059669' },
  presentation: { icon: 'presentation', color: '#DC2626' },
  audio: { icon: 'audio', color: '#7C3AED' },
  video: { icon: 'video', color: '#1F2937' }
} as const;

// 🎨 形状装饰接口定义（重新导出以避免循环引用）
export interface NodeShapeDecoration {
  type: 'none' | 'circle' | 'diamond' | 'custom';
  size?: 'fit' | 'extend'; // fit=贴合内容，extend=外扩
  strokeWidth?: number;
  strokeColor?: string;
  fillColor?: string;
  opacity?: number;
  customPath?: string; // 自定义SVG路径
  offset?: number; // 装饰层偏移量（默认8px）
}

// 🎯 群组拖拽系统类型定义
// 基于tldraw/Figma/Miro的群组化拖拽范式

// 🎯 位置接口定义
export interface Position {
  x: number;
  y: number;
}

// 群组边界信息
export interface GroupBounds {
  x: number;        // 群组左上角x坐标
  y: number;        // 群组左上角y坐标
  width: number;    // 群组宽度
  height: number;   // 群组高度
  minX: number;     // 群组最小x坐标
  minY: number;     // 群组最小y坐标
  maxX: number;     // 群组最大x坐标
  maxY: number;     // 群组最大y坐标
}

// 临时群组数据结构
export interface TemporaryGroup {
  id: string;                    // 群组唯一标识
  nodeIds: Set<string>;          // 群组内节点ID集合
  bounds: GroupBounds;           // 群组边界信息
  pivot: Position;               // 群组拖拽锚点（通常为中心点）
  dragOffset: Position;          // 当前拖拽偏移量
  isActive: boolean;             // 群组是否激活状态
  createdAt: number;             // 群组创建时间戳
  isDragging: boolean;           // 是否正在拖拽中
}
