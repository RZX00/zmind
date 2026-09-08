// 📝 Markdown渲染工具函数
// 统一的Markdown渲染逻辑，供多个组件使用

/**
 * 🛡️ 安全的HTML内容清理
 * 防止XSS攻击，只允许安全的HTML标签和属性
 */
function sanitizeHTML(html: string): string {
  // 简单的HTML清理，移除潜在的危险标签和属性
  return html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi, '')
    .replace(/on\w+\s*=\s*["'][^"']*["']/gi, '') // 移除事件处理器
    .replace(/javascript:/gi, '') // 移除javascript协议
    .replace(/data:/gi, '') // 移除data协议
    .replace(/<object\b[^>]*>/gi, '')
    .replace(/<embed\b[^>]*>/gi, '')
    .replace(/<form\b[^>]*>/gi, '')
    .replace(/<input\b[^>]*>/gi, '')
    .replace(/<button\b[^>]*>/gi, '');
}

/**
 * 🚀 Markdown渲染缓存
 * 使用LRU缓存策略，避免重复渲染计算
 */
class MarkdownRenderCache {
  private cache = new Map<string, string>();
  private readonly maxSize = 500; // 限制缓存大小

  get(key: string): string | undefined {
    const value = this.cache.get(key);
    if (value !== undefined) {
      // LRU: 重新设置以更新访问顺序
      this.cache.delete(key);
      this.cache.set(key, value);
    }
    return value;
  }

  set(key: string, value: string): void {
    if (this.cache.has(key)) {
      this.cache.delete(key);
    } else if (this.cache.size >= this.maxSize) {
      // 删除最旧的项
      const firstKey = this.cache.keys().next().value;
      if (firstKey) {
        this.cache.delete(firstKey);
      }
    }
    this.cache.set(key, value);
  }
}

const renderCache = new MarkdownRenderCache();

/**
 * 增强的Markdown渲染器 - 支持正确的多行文本显示 + XSS防护 + 缓存优化
 * 用于TextNode和TableNode的单元格内容渲染
 */
export const renderMarkdown = (content: string): string => {
  if (!content || typeof content !== 'string') {
    return '';
  }

  // 🚀 缓存检查：相同内容直接返回缓存结果
  const cached = renderCache.get(content);
  if (cached !== undefined) {
    return cached;
  }

  // 先处理换行符，确保多行文本正确显示
  const processedContent = content
    // 保护代码块中的换行
    .replace(/```([\s\S]*?)```/g, () => {
      const placeholder = `___CODE_BLOCK_${Math.random().toString(36).substr(2, 9)}___`;
      return placeholder;
    })
    // 将单个换行转换为<br>标签
    .replace(/\n(?!\n)/g, '<br>')
    // 恢复代码块
    .replace(/___CODE_BLOCK_[a-z0-9]+___/g, (placeholder) => {
      return content.match(/```([\s\S]*?)```/)?.[0] || placeholder;
    });

  const renderedContent = processedContent
    // 标题（不硬编码颜色，继承容器，在暗色模式变为浅色）
    .replace(/^### (.*$)/gim, '<h3 class="text-base font-semibold mb-2">$1</h3>')
    .replace(/^## (.*$)/gim, '<h2 class="text-lg font-semibold mb-2">$1</h2>')
    .replace(/^# (.*$)/gim, '<h1 class="text-xl font-bold mb-3">$1</h1>')
    
    // 粗体和斜体（不硬编码颜色，继承容器颜色）
    .replace(/\*\*(.*?)\*\*/gim, '<strong class="font-semibold">$1</strong>')
    .replace(/\*(.*?)\*/gim, '<em class="italic">$1</em>')
    
    // 链接
    .replace(/\[([^\]]+)\]\(([^)]+)\)/gim, '<a href="$2" target="_blank" class="text-blue-600 hover:text-blue-800 underline">$1</a>')
    
    // 代码块（多行）- 维持浅色背景以保证可读性，代码文字使用深色以配合浅背景
    .replace(/```([\s\S]*?)```/gim, '<pre class="bg-gray-100 border border-gray-200 rounded p-2 mb-2 overflow-x-auto"><code class="text-sm font-mono text-gray-800 whitespace-pre-wrap">$1</code></pre>')
    // 行内代码 - 同上
    .replace(/`([^`\n]+)`/gim, '<code class="bg-gray-100 text-gray-800 px-1 py-0.5 rounded text-sm font-mono">$1</code>')
    
    // 列表处理 - 修复多行列表缩进问题
    .replace(/^\s*[-*+] (.*$)/gim, (match, content) => {
      return `<li class="mb-1 ml-0">${content}</li>`;
    })
    // 将连续的li标签包裹在ul中
    .replace(/((?:<li class="mb-1 ml-0">.*?<\/li>\s*)+)/gim, (match) => {
      return `<ul class="list-disc list-inside mb-2 space-y-1 pl-0">${match}</ul>`;
    })
    
    // 有序列表
    .replace(/^\s*\d+\. (.*$)/gim, (match, content) => {
      return `<li class="mb-1 ml-0">${content}</li>`;
    })
    // 将连续的li标签包裹在ol中
    .replace(/((?:<li class="mb-1 ml-0">.*?<\/li>\s*)+)/gim, (match) => {
      return `<ol class="list-decimal list-inside mb-2 space-y-1 pl-0">${match}</ol>`;
    })
    
    // 引用（去掉文本颜色，继承容器）
    .replace(/^> (.*$)/gim, '<blockquote class="border-l-4 border-blue-500 pl-4 py-2 bg-blue-50 italic mb-2">$1</blockquote>')
    
    // 分割线
    .replace(/^---$/gim, '<hr class="border-t border-gray-300 my-4" />')
    
    // 处理段落 - 双换行分段
    .split('<br><br>')
    .map(paragraph => {
      const trimmed = paragraph.trim();
      if (trimmed === '') return '';
      if (trimmed.includes('<h1') || trimmed.includes('<h2') || trimmed.includes('<h3') || 
          trimmed.includes('<ul') || trimmed.includes('<ol') || trimmed.includes('<pre') ||
          trimmed.includes('<blockquote') || trimmed.includes('<hr')) {
        return trimmed;
      }
      return `<p class="mb-2 leading-relaxed">${trimmed}</p>`;
    })
    .join('');

  // 🛡️ 最终安全清理 - 防止XSS攻击
  const result = sanitizeHTML(renderedContent);
  
  // 🚀 缓存存储：将渲染结果保存到缓存
  renderCache.set(content, result);
  
  return result;
};

/**
 * 针对表格单元格优化的Markdown渲染器
 * 移除一些在单元格中不适合的样式（如段落间距）+ XSS防护
 */
export const renderCellMarkdown = (content: string): string => {
  if (!content || typeof content !== 'string') {
    return '';
  }

  const rendered = renderMarkdown(content);

  // 单元格必须是单行盒：renderMarkdown 包的 <p class="mb-2 leading-relaxed">
  // 会额外撑高，选中切到 textarea 时行高就会跳。先拆段距，再去掉 p 壳。
  const optimizedContent = rendered
    .replace(/<\/p>\s*<p\b[^>]*>/gi, '<br>')
    .replace(/<\/?p\b[^>]*>/gi, '')
    .replace(/class="list-disc list-inside mb-2 space-y-1 pl-0"/g, 'class="list-disc list-inside space-y-1 pl-0"')
    .replace(/class="list-decimal list-inside mb-2 space-y-1 pl-0"/g, 'class="list-decimal list-inside space-y-1 pl-0"')
    .replace(/class="bg-gray-100 border border-gray-200 rounded p-2 mb-2 overflow-x-auto"/g, 'class="bg-gray-100 border border-gray-200 rounded p-1 overflow-x-auto"');

  return sanitizeHTML(optimizedContent);
};
