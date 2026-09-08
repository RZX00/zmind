// ✏️ SVG 修改工具（精简版）
// 仅保留当前交互所需的函数：ensureElementIds、updateElementTextContent

/**
 * 为元素添加ID（如果没有）
 * @param svgCode SVG代码
 * @returns 更新后的SVG代码和新添加的ID列表
 */
export function ensureElementIds(svgCode: string): {
  code: string;
  newIds: string[];
} {
  const parser = new DOMParser();
  const doc = parser.parseFromString(svgCode, 'image/svg+xml');
  const svgRoot = doc.querySelector('svg');

  if (!svgRoot) {
    return { code: svgCode, newIds: [] };
  }

  const newIds: string[] = [];
  let idCounter = 0;

  // 递归处理所有元素
  function addIdsRecursive(element: Element) {
    const tagName = element.tagName.toLowerCase();

    // 跳过svg根元素和特殊元素
    if (tagName === 'svg' || tagName === 'defs' || tagName === 'style') {
      Array.from(element.children).forEach(addIdsRecursive);
      return;
    }

    // 如果没有ID，添加一个
    if (!element.getAttribute('id')) {
      const newId = `svg-el-${tagName}-${Date.now()}-${idCounter++}`;
      element.setAttribute('id', newId);
      newIds.push(newId);
    }

    // 递归处理子元素
    Array.from(element.children).forEach(addIdsRecursive);
  }

  Array.from(svgRoot.children).forEach(addIdsRecursive);

  // 序列化回字符串
  const serializer = new XMLSerializer();
  const updatedSvg = serializer.serializeToString(doc);

  return {
    code: updatedSvg,
    newIds
  };
}

/**
 * 更新text元素的文本内容
 * @param svgCode 原始SVG代码
 * @param elementId 元素ID
 * @param newText 新的文本内容
 * @returns 更新后的SVG代码
 */
export function updateElementTextContent(
  svgCode: string,
  elementId: string,
  newText: string
): string {
  // 转义特殊字符
  const escapedId = elementId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  // 转义新文本中的特殊字符（用于替换）
  const escapedText = newText.replace(/\$/g, '$$$$');

  // 匹配 <text id="xxx" ...>旧文本</text> 格式
  // 支持多行和各种属性
  const textPattern = new RegExp(
    `(<text[^>]*id=["']${escapedId}["'][^>]*>)([^<]*)(</text>)`,
    'gis'
  );

  // 查找匹配项
  const match = svgCode.match(textPattern);
  if (match) {
    return svgCode.replace(textPattern, `$1${escapedText}$3`);
  }

  return svgCode;
}

