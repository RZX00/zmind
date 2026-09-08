// 🎯 HTML工具函数
// 提供HTML解析和内容提取功能

/**
 * 🎯 提取HTML代码中的一级标题内容
 * @param htmlCode HTML代码字符串
 * @returns 提取到的标题文本，如果没有找到则返回空字符串
 */
export const extractH1Title = (htmlCode: string): string => {
  if (!htmlCode || typeof htmlCode !== 'string') {
    return '';
  }

  try {
    // 使用正则表达式匹配h1标签及其内容
    const h1Match = htmlCode.match(/<h1[^>]*>([^<]*(?:<[^/][^>]*>[^<]*<\/[^>]*>[^<]*)*)<\/h1>/i);
    
    if (h1Match && h1Match[1]) {
      // 移除HTML标签，只保留文本内容
      const titleText = h1Match[1].replace(/<[^>]*>/g, '').trim();
      return titleText;
    }

    // 如果没有找到h1标签，尝试查找title标签
    const titleMatch = htmlCode.match(/<title[^>]*>([^<]*)<\/title>/i);
    if (titleMatch && titleMatch[1]) {
      return titleMatch[1].trim();
    }

    return '';
  } catch (error) {
    console.warn('提取HTML标题时出错:', error);
    return '';
  }
};

/**
 * 🎯 截断文本并添加省略号
 * @param text 原始文本
 * @param maxLength 最大长度
 * @returns 截断后的文本
 */
export const truncateText = (text: string, maxLength: number): string => {
  if (!text || text.length <= maxLength) {
    return text;
  }
  return text.substring(0, maxLength - 3) + '...';
};

/**
 * 🎯 检查文本是否会溢出容器
 * @param text 文本内容
 * @param containerWidth 容器宽度(px)
 * @param fontSize 字体大小(px)
 * @returns 是否会溢出
 */
export const willTextOverflow = (text: string, containerWidth: number, fontSize: number = 14): boolean => {
  if (!text) return false;
  
  // 估算文本宽度（中文字符按1.2倍计算，英文按0.6倍计算）
  const estimatedWidth = text.split('').reduce((width, char) => {
    // 检查是否为中文字符
    if (/[\u4e00-\u9fa5]/.test(char)) {
      return width + fontSize * 1.2;
    } else {
      return width + fontSize * 0.6;
    }
  }, 0);
  
  return estimatedWidth > containerWidth - 40; // 减去40px的内边距
};