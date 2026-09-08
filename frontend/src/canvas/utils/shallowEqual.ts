// 🎯 浅比较工具 - 用于React.memo性能优化
// 针对NodeContainer大量props的高效比较策略

/**
 * 浅比较两个对象是否相等
 * 用于React.memo的areEqual函数
 */
export function shallowEqual<T extends Record<string, any>>(obj1: T, obj2: T): boolean {
  const keys1 = Object.keys(obj1);
  const keys2 = Object.keys(obj2);

  // 键数量不同，直接返回false
  if (keys1.length !== keys2.length) {
    return false;
  }

  // 逐个比较每个键的值
  for (const key of keys1) {
    if (obj1[key] !== obj2[key]) {
      return false;
    }
  }

  return true;
}

/**
 * 函数引用比较 - 检查函数是否为同一引用
 * 避免每次渲染时创建新函数导致的不必要重渲染
 */
export function areFunctionRefsEqual(fn1?: (...args: any[]) => any, fn2?: (...args: any[]) => any): boolean {
  return fn1 === fn2;
}

/**
 * 数组浅比较
 */
export function shallowEqualArray<T>(arr1: T[], arr2: T[]): boolean {
  if (arr1.length !== arr2.length) {
    return false;
  }

  for (let i = 0; i < arr1.length; i++) {
    if (arr1[i] !== arr2[i]) {
      return false;
    }
  }

  return true;
}

/**
 * Canvas对象浅比较 - 替换JSON.stringify深度比较
 * 专门用于Canvas状态变更检测的高性能比较
 */
export function areCanvasEqual(canvas1: any, canvas2: any): boolean {
  if (!canvas1 || !canvas2) {
    return canvas1 === canvas2;
  }

  // 🎯 比较基础属性
  if (canvas1.id !== canvas2.id || 
      canvas1.title !== canvas2.title || 
      canvas1.version !== canvas2.version ||
      canvas1.updatedAt !== canvas2.updatedAt) {
    return false;
  }

  // 🎨 比较全局样式与文本预设（确保样式变化能触发状态更新）
  if (canvas1.cornerStyle !== canvas2.cornerStyle) return false;
  if (canvas1.fontStyle !== canvas2.fontStyle) return false;
  if (canvas1.backgroundColor !== canvas2.backgroundColor) return false;
  if (canvas1.backgroundStyleId !== canvas2.backgroundStyleId) return false;
  if (canvas1.patternColor !== canvas2.patternColor) return false;
  if (canvas1.textOpacityPreset !== canvas2.textOpacityPreset) return false;
  if (canvas1.textLayoutPreset !== canvas2.textLayoutPreset) return false;

  // 🎯 比较nodes数组长度
  const nodes1 = canvas1.nodes || [];
  const nodes2 = canvas2.nodes || [];
  if (nodes1.length !== nodes2.length) {
    return false;
  }

  // 🎯 比较节点关键属性（按ID匹配，避免顺序依赖）
  for (let i = 0; i < nodes1.length; i++) {
    const node1 = nodes1[i];
    const node2 = nodes2.find(n => n.id === node1.id);

    // 节点不存在或关键属性变化
    if (!node2 ||
        node1.x !== node2.x ||
        node1.y !== node2.y ||
        node1.width !== node2.width ||
        node1.height !== node2.height ||
        node1.updatedAt !== node2.updatedAt) {
      return false;
    }
  }

  // 🎯 比较connections数组长度
  const conns1 = canvas1.connections || [];
  const conns2 = canvas2.connections || [];
  if (conns1.length !== conns2.length) {
    return false;
  }

  // 🎯 比较连接关键属性
  for (let i = 0; i < conns1.length; i++) {
    const conn1 = conns1[i];
    const conn2 = conns2[i];
    
    if (conn1.id !== conn2.id || 
        conn1.from !== conn2.from || 
        conn1.to !== conn2.to) {
      return false;
    }
  }

  return true;
}

/**
 * NodeContainer专用的props比较函数
 * 针对关键渲染props进行优化比较
 */
export function areNodePropsEqual(prevProps: any, nextProps: any): boolean {
  // 🎯 关键渲染属性 - 这些变化时必须重新渲染
  const criticalProps = [
    'node', 'selected', 'editing', 'isConnecting', 'isHovered',
    'isDragTarget', 'isDraggingNode', 'isDragLeader'
  ];

  // 🎯 全局样式道具变化（字体/圆角）必须触发渲染
  // 之前未比较这些道具，导致全局样式变更后节点不更新
  if (prevProps.fontStyle !== nextProps.fontStyle) {
    return false;
  }
  if (prevProps.cornerStyle !== nextProps.cornerStyle) {
    return false;
  }

  // 🎯 检查关键属性
  for (const prop of criticalProps) {
    if (prop === 'node') {
      // node对象需要深度比较关键属性
      const prevNode = prevProps.node;
      const nextNode = nextProps.node;
      
      if (!prevNode && !nextNode) continue;
      if (!prevNode || !nextNode) return false;
      
      // 比较node的关键属性
      const nodeKeys = [
        'id', 'type', 'x', 'y', 'width', 'height', 'locked', 'isCollapsed',
        'shapeDecoration',
        // 样式相关：此前仅比较了opacity，导致其他样式变更无法触发重渲染
        'textStyles', 'tableStyles', 'linkStyles',
        // Mermaid 主题更新需要触发重渲染
        'mermaidTheme', 'mermaidThemeId'
      ];
      for (const key of nodeKeys) {
        if (prevNode[key] !== nextNode[key]) {
          return false;
        }
      }
      // 额外兜底：对textStyles的关键字段做浅比较，
      // 以防更新发生在原对象被突变的情况下（理论上不应突变，但确保稳健）
      const prevTextStyles = prevNode.textStyles || {};
      const nextTextStyles = nextNode.textStyles || {};
      const textStyleKeys: Array<keyof typeof prevTextStyles> = ['textAlign', 'accentColor', 'opacity'];
      for (const k of textStyleKeys) {
        if (prevTextStyles[k] !== nextTextStyles[k]) {
          return false;
        }
      }
    } else {
      if (prevProps[prop] !== nextProps[prop]) {
        return false;
      }
    }
  }

  // 🎯 检查childNodes：长度和关键尺寸变化（影响收集栏高度计算）
  const prevChildNodes = prevProps.childNodes || [];
  const nextChildNodes = nextProps.childNodes || [];
  if (prevChildNodes.length !== nextChildNodes.length) {
    return false;
  }
  // 若用于收集栏高度，需要对子节点高度求和比较，避免高度变化不触发重渲染
  if (prevProps.node?.type === 'column') {
    const sumHeights = (arr: any[]) => arr.reduce((s, n) => s + Math.max((n?.height ?? 0), 0), 0);
    if (sumHeights(prevChildNodes) !== sumHeights(nextChildNodes)) {
      return false;
    }
  }

  // 🎯 检查selectedNodes数组（影响多选状态）
  const prevSelectedNodes = prevProps.selectedNodes || [];
  const nextSelectedNodes = nextProps.selectedNodes || [];
  if (!shallowEqualArray(prevSelectedNodes, nextSelectedNodes)) {
    return false;
  }

  // 🎯 函数引用比较 - 函数变化通常不影响视觉渲染
  // 这里我们允许函数引用变化，减少重渲染
  
  return true;
}
