// 🔍 SVG解析工具
// 解析SVG代码，提取元素结构和属性

/**
 * SVG元素接口
 */
export interface SvgElement {
  id: string;                           // 元素ID（自动生成或使用现有）
  type: string;                         // 元素类型：rect, circle, path, text等
  attributes: Record<string, string>;   // 所有属性
  children?: SvgElement[];              // 子元素（用于<g>等容器）
  domNode?: SVGElement;                 // 对应的DOM节点引用
  boundingBox?: DOMRect;                // 元素边界框
  parent?: string;                      // 父元素ID
  textContent?: string;                 // 文本内容（仅用于text元素）
}

/**
 * 支持的SVG元素类型
 */
export const SUPPORTED_SVG_ELEMENTS = [
  'rect',      // 矩形
  'circle',    // 圆形
  'ellipse',   // 椭圆
  'line',      // 直线
  'polyline',  // 折线
  'polygon',   // 多边形
  'path',      // 路径
  'text',      // 文本
  'g',         // 组
  'use',       // 引用
  'image',     // 图片
  'defs',      // 定义
  'symbol'     // 符号
] as const;

/**
 * 生成唯一元素ID
 */
let elementIdCounter = 0;
export function generateElementId(type: string): string {
  return `svg-element-${type}-${Date.now()}-${elementIdCounter++}`;
}

/**
 * 解析SVG内容，提取所有元素
 * @param svgCode SVG代码字符串
 * @returns 元素列表
 */
export function parseSvgContent(svgCode: string): SvgElement[] {
  try {
    // 预处理：提取 <svg> 片段并修正常见 XML 实体错误
    const normalizedSource = normalizeSvgSource(svgCode);

    // 使用DOMParser解析SVG
    const parser = new DOMParser();
    let doc = parser.parseFromString(normalizedSource, 'image/svg+xml');

    // 检查解析错误
    const errorNode = doc.querySelector('parsererror');
    if (errorNode) {
      // 某些浏览器会在存在未转义 & 等情况下抛出 xmlParseEntityRef 错误
      console.error('SVG解析错误:', errorNode.textContent);
      // 回退：使用 text/html 模式进行更宽松的解析，仍然可以获取 <svg> 结构
      doc = parser.parseFromString(normalizedSource, 'text/html');
    }

    // 获取SVG根元素
    const svgRoot = doc.querySelector('svg');
    if (!svgRoot) {
      console.error('未找到SVG根元素');
      return [];
    }

    // 递归解析所有子元素
    const elements: SvgElement[] = [];
    parseElementsRecursive(svgRoot, null, elements);

    return elements;
  } catch (error) {
    console.error('SVG解析失败:', error);
    return [];
  }
}

/**
 * 规范化 SVG 源代码，提升解析健壮性
 * - 提取首个 <svg>...</svg> 片段
 * - 将未转义的 & 转为 &amp;（避免 xmlParseEntityRef 错误）
 */
function normalizeSvgSource(source: string): string {
  if (!source) return source;

  let out = source;

  // 提取第一个 <svg>...</svg> 片段，兼容外层包裹内容
  const lower = out.toLowerCase();
  const start = lower.indexOf('<svg');
  if (start !== -1) {
    const end = lower.lastIndexOf('</svg>');
    out = end === -1 ? out.slice(start) : out.slice(start, end + '</svg>'.length);
  }

  // 修正未转义的 &，排除已合法实体（amp/lt/gt/quot/apos/数值实体）
  out = out.replace(
    /&(?!(?:amp|lt|gt|quot|apos|#[0-9]+|#x[0-9a-f]+);)/gi,
    '&amp;'
  );

  return out;
}

/**
 * 递归解析元素
 * @param element DOM元素
 * @param parentId 父元素ID
 * @param result 结果数组
 */
function parseElementsRecursive(
  element: Element,
  parentId: string | null,
  result: SvgElement[]
): void {
  const tagName = element.tagName.toLowerCase();

  // 跳过非SVG元素和特殊元素
  if (tagName === 'svg' || tagName === 'defs' || tagName === 'style') {
    // 递归处理子元素
    Array.from(element.children).forEach(child => {
      parseElementsRecursive(child, parentId, result);
    });
    return;
  }

  // 检查是否是支持的元素类型
  if (!SUPPORTED_SVG_ELEMENTS.includes(tagName as any)) {
    return;
  }

  // 提取元素ID（如果没有则生成）
  let elementId = element.getAttribute('id');
  if (!elementId) {
    elementId = generateElementId(tagName);
    element.setAttribute('id', elementId);
  }

  // 提取所有属性
  const attributes: Record<string, string> = {};
  Array.from(element.attributes).forEach(attr => {
    attributes[attr.name] = attr.value;
  });

  // 创建元素对象
  const svgElement: SvgElement = {
    id: elementId,
    type: tagName,
    attributes,
    domNode: element as SVGElement,
    parent: parentId || undefined
  };

  // 提取text元素的文本内容
  if (tagName === 'text') {
    svgElement.textContent = element.textContent || '';
  }

  // 尝试获取边界框（某些元素可能没有）
  try {
    if (element instanceof SVGGraphicsElement) {
      svgElement.boundingBox = element.getBBox() as DOMRect;
    }
  } catch (error) {
    // 某些元素（如<defs>）没有boundingBox
  }

  // 添加到结果
  result.push(svgElement);

  // 递归处理子元素
  if (element.children.length > 0) {
    const children: SvgElement[] = [];
    Array.from(element.children).forEach(child => {
      parseElementsRecursive(child, elementId, result);
    });
  }
}

/**
 * 根据ID查找元素
 * @param elements 元素列表
 * @param id 元素ID
 * @returns 元素或undefined
 */
export function findElementById(
  elements: SvgElement[],
  id: string
): SvgElement | undefined {
  return elements.find(el => el.id === id);
}

/**
 * 根据类型过滤元素
 * @param elements 元素列表
 * @param type 元素类型
 * @returns 过滤后的元素列表
 */
export function filterElementsByType(
  elements: SvgElement[],
  type: string
): SvgElement[] {
  return elements.filter(el => el.type === type);
}

/**
 * 查找指定坐标处的元素
 * @param elements 元素列表
 * @param x X坐标
 * @param y Y坐标
 * @returns 找到的元素或null
 */
export function findElementAtPoint(
  elements: SvgElement[],
  x: number,
  y: number
): SvgElement | null {
  // 从后向前遍历（后面的元素在上层）
  for (let i = elements.length - 1; i >= 0; i--) {
    const element = elements[i];

    // 跳过没有boundingBox的元素
    if (!element.boundingBox) continue;

    const bbox = element.boundingBox;

    // 检查点是否在边界框内
    if (
      x >= bbox.x &&
      x <= bbox.x + bbox.width &&
      y >= bbox.y &&
      y <= bbox.y + bbox.height
    ) {
      return element;
    }
  }

  return null;
}

/**
 * 获取元素的可读名称
 * @param element SVG元素
 * @returns 元素名称
 */
export function getElementDisplayName(element: SvgElement): string {
  switch (element.type) {
    case 'rect':
      return '矩形';
    case 'circle':
      return '圆形';
    case 'ellipse':
      return '椭圆';
    case 'line':
      return '直线';
    case 'polyline':
      return '折线';
    case 'polygon':
      return '多边形';
    case 'path':
      return '路径';
    case 'text':
      return '文本';
    case 'g':
      return '组';
    case 'image':
      return '图片';
    default:
      return element.type;
  }
}

/**
 * 获取元素的关键属性（用于属性面板显示）
 * @param element SVG元素
 * @returns 关键属性列表
 */
export function getElementKeyAttributes(element: SvgElement): string[] {
  const commonAttrs = ['fill', 'stroke', 'stroke-width', 'opacity', 'transform'];

  switch (element.type) {
    case 'rect':
      return ['x', 'y', 'width', 'height', 'rx', 'ry', ...commonAttrs];
    case 'circle':
      return ['cx', 'cy', 'r', ...commonAttrs];
    case 'ellipse':
      return ['cx', 'cy', 'rx', 'ry', ...commonAttrs];
    case 'line':
      return ['x1', 'y1', 'x2', 'y2', ...commonAttrs];
    case 'polyline':
    case 'polygon':
      return ['points', ...commonAttrs];
    case 'path':
      return ['d', ...commonAttrs];
    case 'text':
      return ['x', 'y', 'font-size', 'font-family', 'fill'];
    default:
      return commonAttrs;
  }
}
