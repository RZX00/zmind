/**
 * Canvas as Code (CaC) - 类型定义
 *
 * AI Canvas 编辑的行业最佳实践范式
 *
 * 三个标准工具：
 * - canvas_read  → 读取画布内容（类比 Claude Code 的 Read）
 * - canvas_write → 创建新内容（类比 Claude Code 的 Write）
 * - canvas_edit  → 修改/删除现有内容（类比 Claude Code 的 Edit）
 */

// ============================================================
// 基础类型
// ============================================================

export type NodeType =
  | 'text'
  | 'todo'
  | 'table'
  | 'code'
  | 'media'
  | 'group'
  | 'column'
  | 'canvas-link';

export type CodeType = 'mermaid' | 'svg' | 'html';

export type LayoutMode =
  | 'stack'     // 垂直堆叠
  | 'row'       // 水平排列
  | 'grid'      // 网格布局
  | 'mindmap'   // 思维导图
  | 'tree'      // 树形结构
  | 'freeform'; // 自由布局（AI 指定坐标）

export type AnchorPoint =
  | 'selection'
  | 'selection.right'
  | 'selection.left'
  | 'selection.above'
  | 'selection.below'
  | 'selection.center'
  | 'viewport.center'
  | 'viewport.topLeft'
  | 'canvas.origin'
  | `node:${string}`           // node:n1
  | `node:${string}.${'right' | 'left' | 'above' | 'below'}` // node:n1.right
  | { x: number; y: number };  // 精确坐标

export type ConnectionPreset =
  | 'none'    // 不创建连接
  | 'chain'   // 串联 1→2→3
  | 'star'    // 星形 1→2, 1→3, 1→4
  | 'tree';   // 树形（父→子）

// CSS 风格选择器
export type Selector = string;
// 示例：
// '#id'           - 精确 ID 匹配
// '.type'         - 按节点类型 (.text, .todo, .table)
// '[attr=value]'  - 属性精确匹配
// '[attr*=value]' - 属性包含
// '*'             - 所有节点

// ============================================================
// canvas_read - 读取画布
// ============================================================

export interface CanvasReadPayload {
  /** 读取范围 */
  scope?: 'all' | 'selection' | 'viewport';

  /** 选择返回的字段 */
  select?: ('nodes' | 'connections' | 'canvas' | 'selection' | 'viewport')[];

  /** 过滤条件 */
  where?: {
    type?: NodeType | NodeType[];
    content?: string | { $contains?: string; $startsWith?: string; $regex?: string };
    id?: string | string[];
    $connected?: string;
    $direction?: 'incoming' | 'outgoing' | 'both';
    [key: string]: any;
  };

  /** 限制返回数量 */
  limit?: number;

  /** 是否包含完整内容（大节点可能被截断） */
  full?: boolean;

  /** 聚合统计 */
  aggregate?: {
    count?: boolean | { $group: string };
  };
}

export interface CanvasReadResult {
  canvas: {
    id: string;
    title: string;
    nodes: CanvasNodeOutput[];
    connections: ConnectionOutput[];
  };
  selection?: string[];
  viewport?: { x: number; y: number; zoom: number };
  meta?: {
    totalNodes: number;
    truncated: boolean;
  };
  aggregate?: {
    count?: number | Record<string, number>;
  };
}

// ============================================================
// canvas_write - 创建新内容
// ============================================================

export interface CanvasWritePayload {
  /** 布局模式 */
  layout?: LayoutMode;

  /** 锚点（新节点的起始位置） */
  anchor?: AnchorPoint;

  /** 节点间距 */
  spacing?: number | { x?: number; y?: number };

  /** 网格列数（layout=grid 时） */
  columns?: number;

  // ------ Level 1-2: 直接添加节点 ------

  /** 要添加的节点 */
  nodes?: NodeInput[];

  /** 要添加的连接 */
  connections?: ConnectionInput[] | ConnectionPreset;

  // ------ Level 3: 结构化创建 ------

  /** 树形结构（思维导图/树） */
  tree?: TreeNodeInput;
}

export interface CanvasWriteResult {
  success: boolean;

  /** 临时 ID 到真实 ID 的映射 */
  idMap?: Record<string, string>;

  /** 创建的 group ID（如果创建了思维导图） */
  groupId?: string;

  /** 应用的操作统计 */
  applied?: {
    nodesAdded: number;
    connectionsAdded: number;
  };

  /** 错误信息 */
  errors?: CanvasError[];

  /** 警告信息 */
  warnings?: string[];
}

// ============================================================
// canvas_edit - 修改/删除现有内容
// ============================================================

export interface CanvasEditPayload {
  // ------ 基础：通过 ID 修改 ------
  /** 节点 ID 到修改内容的映射 */
  [nodeId: string]: Partial<NodeInput> | undefined;

  // ------ 删除操作 ------
  /** 要删除的节点 ID 列表 */
  $delete?: string[];

  // ------ 连接操作 ------
  /** 连接修改 */
  $connections?: {
    [connectionId: string]: Partial<ConnectionInput>;
    $delete?: string[];
  };

  // ------ 画布属性 ------
  /** 画布属性修改 */
  $canvas?: Partial<CanvasProperties>;

  // ------ 选择器模式 ------
  /** CSS 风格选择器 */
  $select?: Selector;

  /** 设置属性（配合 $select 使用） */
  $set?: Partial<NodeInput>;

  /** 转换属性（配合 $select 使用） */
  $transform?: {
    [key: string]: any | { $replace: [string, string] };
  };

  // ------ 批量操作 ------
  /** 多个操作 */
  $operations?: EditOperation[];
}

export interface EditOperation {
  /** 选择器 */
  $select: Selector;

  /** 设置属性 */
  $set?: Partial<NodeInput>;

  /** 转换属性 */
  $transform?: {
    [key: string]: any | { $replace: [string, string] };
  };

  /** 删除匹配的节点 */
  $delete?: boolean;

  /** 移动 */
  $move?: RelativePosition | { x: number; y: number };
}

export interface CanvasEditResult {
  success: boolean | 'partial';

  /** 应用的操作统计 */
  applied?: {
    nodesUpdated?: number;
    nodesDeleted?: number;
    connectionsUpdated?: number;
    connectionsDeleted?: number;
  };

  /** 错误信息 */
  errors?: CanvasError[];

  /** 警告信息 */
  warnings?: string[];
}

// ============================================================
// 通用错误类型
// ============================================================

export interface CanvasError {
  code: string;
  message: string;
  path?: string;
  suggestions?: string[];
}

// ============================================================
// 节点输入格式
// ============================================================

export interface NodeInput {
  /** 临时 ID（$1, $2...）或指定 ID */
  $id?: string;
  id?: string;

  /** 节点类型 */
  type: NodeType;

  /** 内容 */
  content?: string;

  /** 标题（用于 group, canvas-link） */
  title?: string;

  // ------ 位置（可选，系统可自动计算） ------

  /** X 坐标 */
  x?: number;

  /** Y 坐标 */
  y?: number;

  /** 相对位置（替代 x/y） */
  position?: RelativePosition;

  // ------ 尺寸（可选，使用默认值或自动计算） ------

  /** 宽度，'auto' 表示根据内容自动计算 */
  width?: number | 'auto';

  /** 高度，'auto' 表示根据内容自动计算 */
  height?: number | 'auto';

  // ------ 类型特定属性 ------

  /** code 节点的代码类型 */
  codeType?: CodeType;

  /** table 节点的数据 */
  data?: {
    rows?: string[][];
    columnWidths?: number[];
    rowHeights?: number[];
  };

  /** group 节点的子节点 */
  children?: string[];

  /** group 节点的模式 */
  groupMode?: 'normal' | 'mindmap';

  /** canvas-link 节点的目标画布 */
  targetCanvasId?: string;

  /** media 节点的媒体类型 */
  mediaType?: 'image' | 'video';

  /** media 节点的 URL */
  url?: string;

  // ------ 样式 ------

  style?: NodeStyle;
}

export interface RelativePosition {
  /** 相对于哪个节点 */
  relativeTo: string | '$prev' | '$first' | 'selection';

  /** 方向 */
  direction: 'right' | 'left' | 'above' | 'below';

  /** 偏移量 */
  offset?: number;
}

export interface NodeStyle {
  backgroundColor?: string;
  textColor?: string;
  fontSize?: number;
  fontWeight?: 'normal' | 'bold';
  borderColor?: string;
  borderWidth?: number;
}

// ============================================================
// 树形结构输入（用于思维导图）
// ============================================================

export interface TreeNodeInput {
  /** 节点内容 */
  content: string;

  /** 节点类型（默认 text） */
  type?: NodeType;

  /** 样式 */
  style?: NodeStyle;

  /** 子节点 */
  children?: TreeNodeInput[];

  /** 临时 ID */
  $id?: string;
}

// ============================================================
// 连接输入格式
// ============================================================

export interface ConnectionInput {
  /** 临时 ID */
  $id?: string;
  id?: string;

  /** 起点节点 ID（支持 $id 引用） */
  from: string;

  /** 终点节点 ID（支持 $id 引用） */
  to: string;

  /** 连接标签 */
  label?: string;

  /** 连接样式 */
  style?: 'line' | 'arrow';

  /** 是否虚线 */
  dashed?: boolean;

  /** 曲线模式 */
  curveMode?: 'auto' | 'tension' | 'manual' | 'orthogonal';
}


// ============================================================
// 画布属性
// ============================================================

export interface CanvasProperties {
  title?: string;
  backgroundColor?: string;
  backgroundStyleId?: string;
  patternColor?: string;
  cornerStyle?: string;
  fontStyle?: string;
  textOpacityPreset?: string;
  textLayoutPreset?: string;
}

// ============================================================
// 输出类型
// ============================================================

export interface CanvasNodeOutput {
  id: string;
  type: NodeType;
  content?: string;
  title?: string;
  x: number;
  y: number;
  width: number;
  height: number;
  codeType?: CodeType;
  data?: any;
  children?: string[];
  groupMode?: string;
  targetCanvasId?: string;
  parentGroupId?: string;
  createdAt?: number;
  updatedAt?: number;
}

export interface ConnectionOutput {
  id: string;
  from: string;
  to: string;
  label?: string;
  style?: string;
  dashed?: boolean;
}

// ============================================================
// 工具函数签名
// ============================================================

/**
 * canvas_read - 读取画布内容
 * @param payload - 读取参数（可选，默认读取全部）
 * @returns 画布内容
 */
export type CanvasReadFn = (payload?: CanvasReadPayload) => Promise<CanvasReadResult>;

/**
 * canvas_write - 创建新内容
 * @param payload - 要创建的内容
 * @returns 创建结果
 */
export type CanvasWriteFn = (payload: CanvasWritePayload) => Promise<CanvasWriteResult>;

/**
 * canvas_edit - 修改/删除现有内容
 * @param payload - 修改内容
 * @returns 修改结果
 */
export type CanvasEditFn = (payload: CanvasEditPayload) => Promise<CanvasEditResult>;
