// 真正的Mermaid渲染组件 - "偷取"自mermaid-live-editor的渲染逻辑
import React, { useEffect, useRef, useState, useCallback } from 'react';
import { useTheme } from 'next-themes';
// 简单的内联安全检查，避免过度抽象
const isSecureMermaidContent = (content: string): boolean => {
  // 检查危险的HTML/JS模式
  const dangerousPatterns = [
    /<script/i,
    /javascript:/i,
    /on\w+\s*=/i,
    /<iframe/i,
    /<object/i,
    /<embed/i
  ];
  return !dangerousPatterns.some(pattern => pattern.test(content));
};

// 🔧 暂时禁用静态导入，采用CDN方案
// import staticMermaid from '../../lib/mermaid-static';

// 由于mermaid可能还在安装中，我们创建一个渐进式方案
let mermaidInstance: any = null;
let isLoading = false;
let loadingPromise: Promise<any> | null = null;
const isSystemDarkMode = () => {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
};

// 🔧 简化的mermaid加载方案 - 优先CDN
const loadMermaid = async () => {
  if (mermaidInstance) return mermaidInstance;
  
  // 如果正在加载，返回同一个 Promise
  if (isLoading && loadingPromise) {
    return loadingPromise;
  }
  
  isLoading = true;
  loadingPromise = loadMermaidInternal();
  
  try {
    const result = await loadingPromise;
    return result;
  } finally {
    isLoading = false;
    loadingPromise = null;
  }
};

const loadMermaidInternal = async () => {
  
  try {
    
    // 策略1：使用CDN实例（最优先）
    if (typeof window !== 'undefined' && (window as any).mermaidCDN) {
      mermaidInstance = (window as any).mermaidCDN;
      return mermaidInstance;
    }
    
    // 策略2：使用预加载实例
    if (typeof window !== 'undefined' && (window as any).mermaidPreloaded) {
      mermaidInstance = (window as any).mermaidPreloaded;
      return mermaidInstance;
    }
    
    // 策略3：使用全局mermaid对象
    if (typeof window !== 'undefined' && (window as any).mermaid) {
      mermaidInstance = (window as any).mermaid;
      return mermaidInstance;
    }
    
    // 策略4：尝试触发CDN加载
    if (typeof window !== 'undefined' && (window as any).loadMermaidCDN) {
      try {
        const cdnMermaid = await (window as any).loadMermaidCDN();
        if (cdnMermaid) {
          mermaidInstance = cdnMermaid;
          return mermaidInstance;
        }
      } catch (cdnError) {
        console.warn('⚠️ CDN加载失败:', cdnError instanceof Error ? cdnError.message : String(cdnError));
      }
    }
    
    // 策略5：最后尝试动态导入（通常会失败）
    try {
      const mermaidModule = await import('mermaid');
      mermaidInstance = mermaidModule.default || mermaidModule;
    } catch (importError) {
      console.warn('❌ Dynamic import failed:', importError instanceof Error ? importError.message : String(importError));
      throw new Error('All Mermaid loading strategies failed');
    }
    
    // 确保mermaid对象存在且有initialize方法
    if (!mermaidInstance || typeof mermaidInstance.initialize !== 'function') {
      throw new Error('Invalid Mermaid instance');
    }
    
    // ✅ 动态配置，支持外部主题传入
    const baseConfig = {
      startOnLoad: false,
      securityLevel: 'strict',
      fontFamily: 'Inter, system-ui, sans-serif',
      fontSize: 14,
      deterministicIds: false, // 禁用确定性ID避免冲突
      maxTextSize: 50000,
      maxEdges: 500,
      suppressErrorRendering: true,
    };
    
    // 默认主题配置
    const darkMode = isSystemDarkMode();
    const defaultThemeConfig = {
      theme: 'neutral',
      themeVariables: {
        primaryColor: '#2563eb',
        primaryTextColor: darkMode ? '#E5E7EB' : '#374151',
        primaryBorderColor: darkMode ? '#4B5563' : '#e5e7eb',
        lineColor: darkMode ? '#9CA3AF' : '#6b7280',
        secondaryColor: darkMode ? '#1F2937' : '#f3f4f6',
        tertiaryColor: darkMode ? '#111827' : '#ffffff'
      }
    };
    
    mermaidInstance.initialize({
      ...baseConfig,
      ...defaultThemeConfig // 将作为默认配置，之后可被外部主题覆盖
    });
    
    return mermaidInstance;
  } catch (error) {
    console.error('❌ Mermaid load failed:', error);
    return null;
  }
};

// 🎯 图表类型定义
type DiagramType = 'flowchart' | 'sequence' | 'mindmap' | 'class' | 'state' | 'unknown';

// 🔍 图表类型检测函数
const detectDiagramType = (code: string): DiagramType => {
  // Skip Mermaid init/comment lines that begin with %%
  const firstMeaningful = (code || '')
    .split('\n')
    .map(l => l.trim())
    .find(l => l && !l.startsWith('%%')) || '';
  const lower = firstMeaningful.toLowerCase();

  if (lower.startsWith('flowchart') || lower.startsWith('graph')) {
    return 'flowchart';
  } else if (lower.startsWith('sequencediagram') || lower.startsWith('sequencedia')) {
    return 'sequence';
  } else if (lower.startsWith('mindmap')) {
    return 'mindmap';
  } else if (lower.startsWith('classdiagram')) {
    return 'class';
  } else if (lower.startsWith('statediagram')) {
    return 'state';
  }
  return 'unknown';
};

// 🎯 图表类型配置
const DIAGRAM_CONFIGS = {
  flowchart: {
    supportsNodeEditing: true,
    supportsNodeCreation: true,
    supportsEdgeEditing: true,
    supportsEdgeCreation: true,
    nodeSelector: 'g[id*="flowchart-"], g.node',
    editingName: '流程图编辑'
  },
  sequence: {
    supportsNodeEditing: true,
    supportsNodeCreation: false,
    supportsEdgeEditing: false,
    supportsEdgeCreation: false,
    nodeSelector: 'g.actor, g[class*="actor"], rect[class*="actor"], text[class*="actor"]',
    editingName: '时序图编辑'
  },
  mindmap: {
    supportsNodeEditing: true,
    supportsNodeCreation: true, // 启用双击创建
    supportsEdgeEditing: false,
    supportsEdgeCreation: true, // 启用拖拽创建
    nodeSelector: 'g.section, g[class*="section"], circle[class*="mindmap"], rect[class*="mindmap"]',
    editingName: '思维导图编辑'
  },
  class: {
    supportsNodeEditing: true,
    supportsNodeCreation: true,
    supportsEdgeEditing: false,
    supportsEdgeCreation: false,
    nodeSelector: 'g[class*="class"], rect[class*="class"]',
    editingName: '类图编辑'
  },
  state: {
    supportsNodeEditing: true,
    supportsNodeCreation: true,
    supportsEdgeEditing: false,
    supportsEdgeCreation: false,
    nodeSelector: 'g[id*="state"], rect[id*="state"]',
    editingName: '状态图编辑'
  }
} as const;

type MermaidFixTarget = 'flowchart' | 'sequence' | 'class' | 'state';

const FIXABLE_TYPES = new Set<MermaidFixTarget>(['flowchart', 'sequence', 'class', 'state']);

const getFirstMeaningfulLine = (code: string): string => {
  const lines = (code || '').split('\n');
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith('%%')) continue;
    return line;
  }
  return '';
};

const stripMermaidFence = (code: string): string => {
  const normalized = (code || '').replace(/\r\n/g, '\n');
  const lines = normalized.split('\n');
  if (lines.length >= 2 && lines[0].trim().startsWith('```')) {
    lines.shift();
    if (lines.length && lines[lines.length - 1].trim().startsWith('```')) {
      lines.pop();
    }
  }
  return lines.join('\n');
};

const hasExplicitHeader = (code: string): boolean => {
  const first = getFirstMeaningfulLine(code);
  return /^(flowchart|graph|sequenceDiagram|classDiagram|stateDiagram(?:-v2)?|mindmap)\b/i.test(first);
};

const inferFixTargetType = (code: string): MermaidFixTarget | null => {
  const first = getFirstMeaningfulLine(code).toLowerCase();
  if (!first) return null;
  if (first.startsWith('mindmap')) return null;
  if (first.startsWith('flowchart') || first.startsWith('graph')) return 'flowchart';
  if (first.startsWith('sequencediagram') || first.startsWith('sequencedia')) return 'sequence';
  if (first.startsWith('classdiagram')) return 'class';
  if (first.startsWith('statediagram')) return 'state';

  const hay = code.toLowerCase();
  if (/^\s*(participant|actor)\b/im.test(code)) return 'sequence';
  if (/^\s*\w+\s*[-=]{1,2}>>?\s*\w+\s*:/im.test(code)) return 'sequence';
  if (/(^|\n)\s*class\s+\w+/i.test(code) || /\bclassdiagram\b/i.test(hay)) return 'class';
  if (/\bstatediagram\b/i.test(hay) || /^\s*\[\*\]/m.test(code) || /^\s*state\b/im.test(code)) return 'state';
  if (/-->|---|-\.\->|==>/.test(code)) return 'flowchart';
  if (/^\s*[A-Za-z0-9_]+\s*(?:\[\[|\[\(|\[\w|\(|\{\{|\{)/m.test(code)) return 'flowchart';
  return null;
};

const headerForType = (type: MermaidFixTarget): string => {
  switch (type) {
    case 'sequence':
      return 'sequenceDiagram';
    case 'class':
      return 'classDiagram';
    case 'state':
      return 'stateDiagram-v2';
    case 'flowchart':
    default:
      return 'flowchart TD';
  }
};

const normalizeFullwidthChars = (code: string): string => {
  const map: Record<string, string> = {
    '（': '(',
    '）': ')',
    '【': '[',
    '】': ']',
    '｛': '{',
    '｝': '}',
    '，': ',',
    '：': ':',
    '；': ';',
    '“': '"',
    '”': '"',
    '‘': "'",
    '’': "'",
  };
  return (code || '').replace(/[（）【】｛｝，：；“”‘’]/g, (m) => map[m] || m);
};

type LineSegment = { type: 'plain' | 'label'; text: string };

const splitLineByLabels = (line: string): LineSegment[] => {
  const segments: LineSegment[] = [];
  let buf = '';
  let mode: 'plain' | 'label' = 'plain';
  let endChar = '';
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (mode === 'plain') {
      if (ch === '[' || ch === '(' || ch === '{' || ch === '|') {
        if (buf) segments.push({ type: 'plain', text: buf });
        mode = 'label';
        endChar = ch === '[' ? ']' : ch === '(' ? ')' : ch === '{' ? '}' : '|';
        buf = ch;
      } else {
        buf += ch;
      }
    } else {
      buf += ch;
      if (ch === endChar) {
        segments.push({ type: 'label', text: buf });
        buf = '';
        mode = 'plain';
        endChar = '';
      }
    }
  }
  if (buf) segments.push({ type: mode, text: buf });
  return segments;
};

const transformLineByLabels = (
  line: string,
  plainFn: (input: string) => string,
  labelFn: (input: string) => string
): string => {
  const segments = splitLineByLabels(line);
  return segments.map((seg) => (seg.type === 'label' ? labelFn(seg.text) : plainFn(seg.text))).join('');
};

const fixQuotesInLabels = (code: string): string => {
  const lines = (code || '').split('\n');
  const fixed = lines.map((line) =>
    transformLineByLabels(
      line,
      (plain) => plain,
      (label) => label.replace(/"/g, "'")
    )
  );
  return fixed.join('\n');
};

const normalizeFlowchartArrows = (code: string): string => {
  const lines = (code || '').split('\n');
  const fixed = lines.map((line) =>
    transformLineByLabels(
      line,
      (plain) => plain.replace(/\s*[→⇒]\s*/g, ' --> '),
      (label) => label
    )
  );
  return fixed.join('\n');
};

const removeDanglingFlowchartEdges = (code: string): string => {
  const lines = (code || '').split('\n');
  const arrowTail = /([A-Za-z0-9_]+)\s*(?:-->|---|--|-\.\->|-\.-|==>|==|--o|--x|-\.-o|-\.-x)\s*(?:\|[^|]*\|\s*)?$/;
  const result: string[] = [];
  for (const raw of lines) {
    const line = raw.replace(/[ \t]+$/g, '');
    const trimmed = line.trim();
    if (!trimmed) {
      result.push('');
      continue;
    }
    if (/^(flowchart|graph)\b/i.test(trimmed)) {
      result.push(line);
      continue;
    }
    const tailMatch = line.match(/(\s{2,})([A-Za-z0-9_]+\s*(?:-->|---|--|-\.\->|-\.-|==>|==|--o|--x|-\.-o|-\.-x)\s*(?:\|[^|]*\|\s*)?)$/);
    if (tailMatch) {
      const prefix = line.slice(0, tailMatch.index).replace(/[ \t]+$/g, '');
      if (prefix.trim()) {
        result.push(prefix);
      }
      continue;
    }
    if (arrowTail.test(trimmed)) {
      continue;
    }
    result.push(line);
  }
  return result.join('\n');
};

const removeTrailingBareNodeAfterLabel = (code: string): string => {
  const lines = (code || '').split('\n');
  const pattern = /(\]|\)|\})(\s*)([A-Za-z0-9_]+)\s*$/;
  const result = lines.map((line) => {
    const trimmed = line.trim();
    if (!trimmed) return line;
    if (/^(flowchart|graph)\b/i.test(trimmed)) return line;
    const match = line.match(pattern);
    if (!match || match.index === undefined) return line;
    const prefix = line.slice(0, match.index);
    return `${prefix}${match[1]}`;
  });
  return result.join('\n');
};

const cleanupMermaidLines = (code: string): string => {
  const lines = (code || '').split('\n');
  const cleaned: string[] = [];
  let prevBlank = false;
  for (const raw of lines) {
    const line = raw.replace(/[ \t]+$/g, '');
    const trimmed = line.trim();
    if (!trimmed) {
      if (prevBlank) continue;
      prevBlank = true;
      cleaned.push('');
      continue;
    }
    prevBlank = false;
    cleaned.push(line);
  }
  return cleaned.join('\n').trim();
};

const autoFixMermaidCode = (rawCode: string): string | null => {
  if (!rawCode) return null;
  let code = stripMermaidFence(rawCode);
  code = code.replace(/^\uFEFF/, '');
  const targetType = inferFixTargetType(code);
  if (!targetType || !FIXABLE_TYPES.has(targetType)) {
    return null;
  }

  code = normalizeFullwidthChars(code);
  const lines = code.split('\n');
  const filtered = lines.filter((line) => {
    if (!line) return true;
    if (line.includes('%%{init')) return false;
    if (/^\s*style\b/i.test(line)) return false;
    if (/^\s*classDef\b/i.test(line)) return false;
    return true;
  });
  code = filtered.join('\n');

  if (!hasExplicitHeader(code)) {
    code = `${headerForType(targetType)}\n${code}`;
  }

  code = fixQuotesInLabels(code);
  if (targetType === 'flowchart') {
    code = normalizeFlowchartArrows(code);
    code = removeTrailingBareNodeAfterLabel(code);
    code = removeDanglingFlowchartEdges(code);
  }

  code = cleanupMermaidLines(code);
  return code;
};

const validateMermaidCode = async (mermaid: any, code: string): Promise<boolean> => {
  if (!mermaid || !code) return false;
  try {
    if (typeof mermaid.parse === 'function') {
      await Promise.resolve(mermaid.parse(code));
      return true;
    }
  } catch {
    return false;
  }
  try {
    await mermaid.render(`mermaid-validate-${Date.now()}`, code);
    return true;
  } catch {
    return false;
  }
};

// 双向编辑数据结构定义
interface MermaidRendererProps {
  code: string;
  height?: string;
  className?: string;
  isEditMode?: boolean;                             // 是否为编辑模式
  onNodeEdit?: (nodeId: string, content: string) => void;  // 节点编辑回调
  onNodeSelect?: (nodeId: string, nodeType?: 'text' | 'mermaid' | 'html' | 'code') => void;  // 节点选择回调
  mermaidTheme?: any;                               // ✅ 添加主题配置支持
  mermaidThemeId?: string;                          // ✅ 主题ID，用于选择11色调色板
  allowAutoFix?: boolean;                           // 是否允许自动修复语法
  onAutoFix?: (fixedCode: string) => void;          // 自动修复回调
}

export const MermaidRenderer: React.FC<MermaidRendererProps> = ({
  code,
  height = '100%',
  className = '',
  isEditMode = false,
  onNodeEdit,
  onNodeSelect,
  mermaidTheme,  // ✅ 接收主题配置
  mermaidThemeId,
  allowAutoFix = false,
  onAutoFix
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [isLoading, setIsLoading] = useState(false);
  const { resolvedTheme } = useTheme();
  const [, setError] = useState<string | null>(null);
  const [mermaidReady, setMermaidReady] = useState(false);
  const lastAutoFixRef = useRef<string | null>(null);

  // 注入CSS动画样式和线条样式覆盖
  React.useEffect(() => {
    const style = document.createElement('style');
    style.textContent = `
      @keyframes pulse-indicator {
        0% {
          r: 10;
          opacity: 0.7;
        }
        50% {
          r: 13;
          opacity: 0.9;
        }
        100% {
          r: 10;
          opacity: 0.7;
        }
      }
      
      .mouse-position-indicator .indicator-outer {
        animation: pulse-indicator 1s infinite ease-in-out;
      }
      
      .connection-hint {
        transition: opacity 0.2s ease-in-out;
      }
      
      /* 🎯 专业学术风格：统一所有连线为实线 */
      svg path.edge-thickness-normal.edge-pattern-dotted,
      svg path.dotted {
        stroke-dasharray: none !important;
        stroke-linecap: round;
        stroke-linejoin: round;
      }
      
      /* 🎯 编辑模式下移除节点边框虚线 */
      .editing-mode g[id*="flowchart-"] {
        outline: none !important;
      }
      
      /* 🎯 确保节点在编辑模式下不会发生布局偏移 */
      .editing-mode g[id*="flowchart-"] * {
        transform-origin: center;
      }
      
      /* 🎯 编辑模式下确保连线没有填充 */
      svg path[id^="L_"] {
        fill: none !important;
        stroke-width: 2;
      }
      
      /* 🎯 拖拽时的视觉反馈样式 */
      svg path.dragging-source {
        opacity: 0.3 !important;
        stroke: #999 !important;
        transition: all 0.2s ease-in-out;
      }
    `;
    document.head.appendChild(style);
    
    return () => {
      document.head.removeChild(style);
    };
  }, []);

  // 渲染图表的函数（从mermaid-live-editor "偷取"逻辑）
  const renderDiagram = useCallback(async () => {
    if (!containerRef.current || !code.trim()) {
      return;
    }

    // 🛡️ 简单有效的安全检查
    if (!isSecureMermaidContent(code)) {
      console.error('🚨 Mermaid内容包含潜在危险元素');
      setError('Content contains unsafe elements; rendering blocked');
      setIsLoading(false);
      return;
    }

    const safeCode = code.trim();

    setIsLoading(true);
    setError(null);

    let mermaid: any = null;
    try {
      mermaid = await loadMermaid();
      
      if (!mermaid) {
        // Mermaid还未准备好，显示占位符，但不重复设置状态
        if (mermaidReady) {
          setMermaidReady(false);
        }
        const loadingTextColor = resolvedTheme === 'dark' ? '#D4D4D8' : '#6B7280';
        const loadingHintBg = resolvedTheme === 'dark' ? 'rgba(30, 41, 59, 0.45)' : '#EFF6FF';
        if (containerRef.current) {
          containerRef.current.innerHTML = `
            <div class="flex flex-col items-center justify-center h-full" style="color: ${loadingTextColor}">
              <div class="text-4xl mb-4">⚙️</div>
              <div class="text-lg mb-2">Loading Mermaid engine...</div>
              <div class="text-sm">Please wait; dependencies are installing</div>
              <div class="mt-4 max-w-md text-xs text-center">
                <div class="p-3 rounded" style="background: ${loadingHintBg}">
                  Setup ready; renderer starting shortly
                </div>
              </div>
            </div>
          `;
        }
        return;
      }

      // 只在状态真正改变时更新
      if (!mermaidReady) {
        setMermaidReady(true);
      }
      
      // ✅ 生成/应用动态主题配置（优先使用外部传入，其次根据画布背景自动生成）
      const computeAutoTheme = () => {
        // 获取可见背景色：向上查找第一个非透明背景，否则按主题兜底
        const getEffectiveBg = (el: HTMLElement | null): string => {
          let cur: HTMLElement | null = el;
          while (cur) {
            const cs = window.getComputedStyle(cur);
            const bg = cs.backgroundColor;
            if (bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent') return bg;
            cur = cur.parentElement;
          }
          return resolvedTheme === 'dark' ? '#232628' : '#EBEBEB';
        };

        const baseBg = getEffectiveBg(containerRef.current);

        // 简单的颜色工具
        const clamp = (v: number) => Math.max(0, Math.min(255, v));
        const parseCssColor = (c: string): { r: number; g: number; b: number } => {
          // 支持 rgb(a) 或 #rrggbb
          if (c.startsWith('rgb')) {
            const m = c.match(/rgba?\((\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
            if (m) return { r: +m[1], g: +m[2], b: +m[3] };
          }
          // 简单解析 #rrggbb
          if (c.startsWith('#') && (c.length === 7)) {
            const r = parseInt(c.slice(1, 3), 16);
            const g = parseInt(c.slice(3, 5), 16);
            const b = parseInt(c.slice(5, 7), 16);
            return { r, g, b };
          }
          // 兜底
          return resolvedTheme === 'dark' ? { r: 35, g: 38, b: 40 } : { r: 235, g: 235, b: 235 };
        };
        const toHex = (n: number) => n.toString(16).padStart(2, '0');
        const rgbToHex = ({ r, g, b }: { r: number; g: number; b: number }) => `#${toHex(r)}${toHex(g)}${toHex(b)}`;
        const adjust = (rgb: { r: number; g: number; b: number }, amount: number) => {
          // amount: -1..1（负为变暗，正为变亮）
          return {
            r: clamp(Math.round(rgb.r + (255 - rgb.r) * amount)),
            g: clamp(Math.round(rgb.g + (255 - rgb.g) * amount)),
            b: clamp(Math.round(rgb.b + (255 - rgb.b) * amount)),
          };
        };

        const bgRGB = parseCssColor(baseBg);
        const isDark = resolvedTheme === 'dark';
        const fgHex = isDark ? '#EAECEF' : '#1A1A1A';
        // 派生色：边框/线条比背景更亮（暗色）或更暗（亮色）
        const borderRGB = isDark ? adjust(bgRGB, 0.22) : { r: clamp(bgRGB.r - 40), g: clamp(bgRGB.g - 40), b: clamp(bgRGB.b - 40) };
        const nodeRGB = isDark ? adjust(bgRGB, 0.12) : { r: clamp(bgRGB.r - 16), g: clamp(bgRGB.g - 16), b: clamp(bgRGB.b - 16) };
        const clusterRGB = isDark ? adjust(bgRGB, 0.18) : { r: clamp(bgRGB.r - 24), g: clamp(bgRGB.g - 24), b: clamp(bgRGB.b - 24) };

        return {
          theme: 'base',
          themeVariables: {
            background: rgbToHex(bgRGB),
            primaryColor: rgbToHex(nodeRGB),
            primaryTextColor: fgHex,
            primaryBorderColor: rgbToHex(borderRGB),
            lineColor: rgbToHex(borderRGB),
            secondaryColor: rgbToHex(clusterRGB),
            tertiaryColor: rgbToHex(clusterRGB),
            nodeBkg: rgbToHex(nodeRGB),
            nodeBorder: rgbToHex(borderRGB),
            clusterBkg: rgbToHex(clusterRGB),
            clusterBorder: rgbToHex(borderRGB),
            fontFamily: 'Inter, system-ui, sans-serif',
            fontSize: '14px'
          }
        } as any;
      };

      // 以面板主题为主，其次自动主题；若选择的是六套分类调色板，则生成通用Mermaid主题
      let effectiveTheme = (mermaidTheme as any) || computeAutoTheme();
      try {
        const isDark = resolvedTheme === 'dark';
        if (mermaidThemeId) {
          const palettes = await import('@/lib/mindmap-palettes');
          const derived = palettes.getMermaidThemeFromPalette(mermaidThemeId, isDark);
          if (derived) {
            effectiveTheme = derived as any;
          }
        }
      } catch (e) {
        console.warn('MermaidRenderer: failed to derive theme from palette id:', e);
      }

      if (effectiveTheme) {
        try {
          // 重新初始化mermaid实例以应用新主题
          const dynamicConfig = {
            startOnLoad: false,
            securityLevel: 'strict',
            fontFamily: 'Inter, system-ui, sans-serif',
            fontSize: 14,
            deterministicIds: false,
            maxTextSize: 50000,
            maxEdges: 500,
            suppressErrorRendering: true,
            theme: effectiveTheme.theme || 'neutral',
            themeVariables: effectiveTheme.themeVariables || {},
            look: effectiveTheme.look
          };
          
          mermaid.initialize(dynamicConfig);
        } catch (themeError) {
          console.warn('⚠️ MermaidRenderer: 主题应用失败，使用默认主题:', themeError);
        }
      }
      
      // 🎯 检测图表类型（使用净化后的代码）
      const diagramType = detectDiagramType(safeCode);

      // 生成唯一ID（从mermaid-live-editor "偷取"）
      const id = `mermaid-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

      // 清空容器
      containerRef.current.innerHTML = '';

      // 🛡️ 渲染图表（使用净化后的安全代码）
      const renderResult = await mermaid.render(id, safeCode);
      
      // 🛡️ 安全边界：验证渲染结果
      if (!renderResult.svg || renderResult.svg.length === 0) {
        throw new Error('Mermaid render failed: no valid SVG produced');
      }

      // 🔍 安全检查：确保生成的SVG不包含危险内容
      if (renderResult.svg.includes('<script') || renderResult.svg.includes('javascript:')) {
        console.error('🚨 Potentially unsafe content detected in SVG; rendering blocked');
        throw new Error('SVG content safety check failed');
      }

      // 插入经过验证的SVG
      containerRef.current.innerHTML = renderResult.svg;

      // 应用样式优化（从mermaid-live-editor "偷取"）
      const svgElement = containerRef.current.querySelector('svg');
      if (svgElement) {
        svgElement.style.maxWidth = '100%';
        svgElement.style.maxHeight = '100%';
        svgElement.style.width = 'auto';
        svgElement.style.height = 'auto';
        svgElement.style.display = 'block';
        svgElement.style.margin = '0 auto';
        svgElement.style.objectFit = 'contain'; // 确保SVG完整显示在容器内
        
        // 🖌️ 应用 mindmap 11色调色板（保证层级清晰）
        try {
          if (diagramType === 'mindmap') {
            // 动态导入以避免循环依赖
            const palettes = await import('@/lib/mindmap-palettes');
            const isDark = resolvedTheme === 'dark';
            const palette = palettes.getMindmapPalette(mermaidThemeId || 'professional', isDark);
            palettes.applyMindmapPalette(svgElement as unknown as SVGElement, palette, isDark, { adjustFill: true });
          }
        } catch (e) {
          console.warn('Mindmap palette application failed:', e);
        }

        // 标记已应用专用主题，避免外部CSS覆盖
        svgElement.classList.add('mm-theme');
        containerRef.current?.classList.add('mm-theme');

        // 🎯 添加编辑模式标识类
        if (isEditMode) {
          svgElement.classList.add('editing-mode');
        } else {
          svgElement.classList.remove('editing-mode');
        }
        
        // 🎯 添加双向编辑交互功能
        
        if (isEditMode && onNodeEdit) {
          const config = DIAGRAM_CONFIGS[diagramType as keyof typeof DIAGRAM_CONFIGS];
          if (config) {
            // 🎯 性能优化：使用ref中的最新回调，保存清理函数到ref中
            eventCleanupRef.current = addInteractivity(svgElement, lastOnNodeEditRef.current!, diagramType, onNodeSelect);
          } else {
          }
        } else {
        }
      }
      
    } catch (err) {
      const shouldAutoFix = Boolean(allowAutoFix && onAutoFix && mermaid);
      if (shouldAutoFix && lastAutoFixRef.current !== code) {
        lastAutoFixRef.current = code;
        const fixed = autoFixMermaidCode(code);
        if (fixed && fixed !== code) {
          try {
            const isValid = await validateMermaidCode(mermaid, fixed);
            if (isValid) {
              onAutoFix?.(fixed);
              return;
            }
          } catch {
            // ignore validation errors, fall through to error UI
          }
        }
      }

      setError(err instanceof Error ? err.message : 'Unknown error');
      
      // 显示友好的错误信息（模仿mermaid-live-editor）
      if (containerRef.current) {
        const errorHintColor = resolvedTheme === 'dark' ? '#A1A1AA' : '#6B7280';
        containerRef.current.innerHTML = `
          <div class="flex flex-col items-center justify-center h-full text-red-600 p-4">
            <div class="text-4xl mb-4">⚠️</div>
            <div class="text-lg font-semibold mb-2">语法错误</div>
            <div class="text-sm text-center max-w-md mb-4">
              ${err instanceof Error ? err.message : 'Unknown error'}
            </div>
            <div class="text-xs text-center" style="color: ${errorHintColor}">
              请检查 Mermaid 语法后重试
            </div>
          </div>
        `;
      }
    } finally {
      setIsLoading(false);
    }
  }, [allowAutoFix, code, isEditMode, mermaidReady, mermaidTheme, mermaidThemeId, onAutoFix, onNodeEdit, onNodeSelect, resolvedTheme]);

  // 防抖渲染（从mermaid-live-editor "偷取"策略）
  const renderTimerRef = useRef<NodeJS.Timeout | null>(null);
  const lastCodeRef = useRef<string>('');
  const lastEditModeRef = useRef<boolean>(false);
  const lastThemeRef = useRef<any>(null);
  const lastThemeIdRef = useRef<string | undefined>(undefined);
  const lastOnNodeEditRef = useRef<typeof onNodeEdit>(null);
  const eventCleanupRef = useRef<(() => void) | null>(null);
  
  useEffect(() => {
    if (!code.trim()) {
      setIsLoading(false);
      setError(null);
      if (containerRef.current) {
        containerRef.current.innerHTML = '';
      }
      // 清理事件监听器
      if (eventCleanupRef.current) {
        eventCleanupRef.current();
        eventCleanupRef.current = null;
      }
      return;
    }

    // 🎯 性能优化：更新回调引用但不依赖它进行重新渲染
    lastOnNodeEditRef.current = onNodeEdit;
    
    // 检查是否需要重新渲染（移除onNodeEdit依赖检查）
    const codeChanged = code !== lastCodeRef.current;
    const editModeChanged = isEditMode !== lastEditModeRef.current;
    const themeChanged = mermaidTheme !== lastThemeRef.current;
    const themeIdChanged = mermaidThemeId !== lastThemeIdRef.current;

    // 🚫 性能优化：拖拽时仅允许主题变更触发，其他情况跳过
    const isCanvasDragging = document.body.classList.contains('dragging-active') ||
      document.querySelector('.react-transform-component[data-dragging="true"]');
    if (isCanvasDragging && !(themeChanged || themeIdChanged)) {
      return;
    }

    if (!codeChanged && !editModeChanged && !themeChanged && !themeIdChanged) {
      return;
    }
    
    // 清除之前的定时器
    if (renderTimerRef.current) {
      clearTimeout(renderTimerRef.current);
    }

    // 清理之前的事件监听器
    if (eventCleanupRef.current) {
      eventCleanupRef.current();
      eventCleanupRef.current = null;
    }

    renderTimerRef.current = setTimeout(() => {
      lastCodeRef.current = code;
      lastEditModeRef.current = isEditMode;
      lastThemeRef.current = mermaidTheme;
      lastThemeIdRef.current = mermaidThemeId;
      renderDiagram();
    }, 300);

    return () => {
      if (renderTimerRef.current) {
        clearTimeout(renderTimerRef.current);
      }
      if (eventCleanupRef.current) {
        eventCleanupRef.current();
        eventCleanupRef.current = null;
      }
    };
  }, [code, isEditMode, mermaidTheme, mermaidThemeId, onNodeEdit, renderDiagram]); // 🎯 包含mermaidThemeId，确保切换主题时重新渲染

  return (
    <div 
      className={`relative overflow-hidden bg-transparent ${className}`}
      style={{ height, borderRadius: 'inherit' }}
    >
      {isLoading && mermaidReady && (
        <div className="absolute inset-0 flex items-center justify-center bg-transparent z-10" style={{ borderRadius: 'inherit' }}>
          <div className="flex items-center space-x-2">
            <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-500"></div>
            <span className="text-gray-600 dark:text-zinc-300">渲染图表中...</span>
          </div>
        </div>
      )}
      
      <div 
        ref={containerRef}
        className="w-full h-full flex items-center justify-center p-4"
        style={{ 
          minHeight: height,
          ...(mermaidReady ? {
            backgroundColor: 'transparent'
          } : {
            backgroundImage: 'radial-gradient(circle at 1px 1px, rgba(0,0,0,.05) 1px, transparent 0)',
            backgroundSize: '20px 20px'
          })
        }}
      />
    </div>
  );
};

// 🎯 双向编辑核心功能：为SVG添加交互能力
const addInteractivity = (svg: SVGElement, onNodeEdit: (nodeId: string, content: string) => void, diagramType: DiagramType = 'flowchart', onNodeSelect?: (nodeId: string, nodeType?: 'text' | 'mermaid' | 'html' | 'code') => void): (() => void) => {
  // 启用图表编辑模式
  
  const config = DIAGRAM_CONFIGS[diagramType as keyof typeof DIAGRAM_CONFIGS];
  if (!config) {
    console.warn(`⚠️ 未找到 ${diagramType} 的配置信息`);
    return () => {}; // 返回空的清理函数
  }

  // 存储所有事件监听器以便清理
  const eventListeners: Array<{ element: Element; event: string; handler: EventListener }> = [];
  const cleanupFunctions: Array<() => void> = [];
  
  const addEventListenerWithCleanup = (element: Element, event: string, handler: EventListener) => {
    element.addEventListener(event, handler);
    eventListeners.push({ element, event, handler });
  };

  // 根据图表类型决定启用哪些功能
  if (config.supportsNodeCreation) {
    const cleanup = addBlankAreaDoubleClick(svg, onNodeEdit, diagramType);
    cleanupFunctions.push(cleanup);
  }
  
  if (config.supportsEdgeEditing) {
    const cleanup = addConnectionLabelEditing(svg, onNodeEdit);
    cleanupFunctions.push(cleanup);
  }
  
  if (config.supportsEdgeCreation) {
    // 所有图表类型都使用通用的拖拽连接功能
    const cleanup = addNodeClickDragNewConnection(svg, onNodeEdit, diagramType);
    cleanupFunctions.push(cleanup);
  }
  
  // 🔍 智能查找所有可编辑节点
  const nodeGroups = findEditableNodes(svg, diagramType);
  
  
  nodeGroups.forEach((nodeGroup) => {
    const element = nodeGroup as SVGElement;
    
    // 提取精确的节点信息
    const nodeInfo = analyzeMermaidNode(element, diagramType);
    
    // 编辑模式下的视觉提示（移除虚线边框）
    element.style.cursor = 'pointer';
    // 移除可能导致布局偏移的样式
    
    // 添加单击选择事件 - 触发节点选择回调
    const clickHandler = (event: Event) => {
      event.preventDefault();
      event.stopPropagation();
      
      
      // 触发节点选择回调
      if (onNodeSelect && nodeInfo.mermaidId) {
        onNodeSelect(nodeInfo.mermaidId, 'mermaid');
      }
    };
    addEventListenerWithCleanup(element, 'click', clickHandler);
    
    // 添加双击编辑事件 - 实现真正的内联编辑
    const dblclickHandler = (event: Event) => {
      event.preventDefault();
      event.stopPropagation();
      
      
      // 🎯 创建内联编辑器，直接在节点位置编辑
      createInlineEditor(element, nodeInfo, onNodeEdit, diagramType);
    };
    addEventListenerWithCleanup(element, 'dblclick', dblclickHandler);
    
    // 🔧 悬浮效果：仅使用光标变化，避免任何布局偏移
    const mouseenterHandler = () => {
      if (!element.classList.contains('editing')) {
        element.style.cursor = 'pointer';
        // 为节点添加一个轻微的视觉反馈，但不影响布局
        const rect = element.querySelector('rect');
        if (rect) {
          rect.setAttribute('data-original-fill', rect.getAttribute('fill') || '');
          rect.setAttribute('fill', 'rgba(59, 130, 246, 0.1)');
        }
      }
    };
    addEventListenerWithCleanup(element, 'mouseenter', mouseenterHandler);
    
    const mouseleaveHandler = () => {
      if (!element.classList.contains('editing')) {
        const rect = element.querySelector('rect');
        if (rect) {
          const originalFill = rect.getAttribute('data-original-fill');
          if (originalFill !== null) {
            rect.setAttribute('fill', originalFill);
            rect.removeAttribute('data-original-fill');
          }
        }
      }
    };
    addEventListenerWithCleanup(element, 'mouseleave', mouseleaveHandler);
  });
  
  // 🔗 添加连线交互功能（传递onNodeEdit回调）
  const edgeCleanup = addEdgeInteractivity(svg, onNodeEdit, diagramType);
  cleanupFunctions.push(edgeCleanup);
  
  // 返回清理函数
  return () => {
    
    // 清理事件监听器
    eventListeners.forEach(({ element, event, handler }) => {
      element.removeEventListener(event, handler);
    });
    eventListeners.length = 0; // 清空数组
    
    // 执行所有子函数的清理
    cleanupFunctions.forEach(cleanup => cleanup());
    cleanupFunctions.length = 0; // 清空数组
  };
};

// 🔍 智能节点查找器 - 查找所有可能的节点元素
const findEditableNodes = (svg: SVGElement, diagramType: DiagramType = 'flowchart'): SVGElement[] => {
  const nodes: SVGElement[] = [];
  
  if (diagramType === 'flowchart') {
    // 流程图：查找所有包含flowchart-的g元素和node类
    const flowchartNodes = svg.querySelectorAll('g[id*="flowchart-"], g.node');
    flowchartNodes.forEach(node => nodes.push(node as SVGElement));
  } else if (diagramType === 'sequence') {
    // 时序图：查找参与者相关元素 - 更广泛的搜索
    const actorNodes = svg.querySelectorAll('g, rect, text');
    actorNodes.forEach(node => {
      const element = node as SVGElement;
      const id = element.id || '';
      const className = element.getAttribute('class') || '';
      
      // 查找包含actor、participant相关的元素
      if (id.includes('actor') || id.includes('participant') || 
          className.includes('actor') || className.includes('participant')) {
        const parent = element.closest('g') || element;
        if (parent && !nodes.includes(parent as SVGElement)) {
          nodes.push(parent as SVGElement);
        }
      }
      
      // 也查找包含文本且位置较高的元素（可能是参与者标签）
      if (element.tagName === 'text' && element.textContent) {
        const y = parseFloat(element.getAttribute('y') || '0');
        if (y < 100) { // 参与者通常在顶部
          const parent = element.closest('g') || element;
          if (parent && !nodes.includes(parent as SVGElement)) {
            nodes.push(parent as SVGElement);
          }
        }
      }
    });
  } else if (diagramType === 'mindmap') {
    // 思维导图：查找section相关元素
    const mindmapNodes = svg.querySelectorAll('g, circle, rect, text');
    mindmapNodes.forEach(node => {
      const element = node as SVGElement;
      const id = element.id || '';
      const className = element.getAttribute('class') || '';
      
      if (id.includes('section') || className.includes('section') || 
          id.includes('mindmap') || className.includes('mindmap')) {
        const parent = element.closest('g') || element;
        if (parent && !nodes.includes(parent as SVGElement)) {
          nodes.push(parent as SVGElement);
        }
      }
      
      // 也查找有文本内容的圆形或矩形元素
      if ((element.tagName === 'circle' || element.tagName === 'rect') && 
          element.nextElementSibling?.tagName === 'text') {
        const parent = element.closest('g') || element;
        if (parent && !nodes.includes(parent as SVGElement)) {
          nodes.push(parent as SVGElement);
        }
      }
    });
  }
  
  // 去重并过滤有效节点
  const uniqueNodes = Array.from(new Set(nodes)).filter(node => {
    // 确保节点有文本内容或可识别的标识
    const hasText = node.querySelector('text');
    const hasId = node.id || node.getAttribute('data-id');
    return hasText || hasId;
  });
  
  return uniqueNodes;
};

// 🔬 精确分析mermaid节点的函数
const analyzeMermaidNode = (nodeGroup: SVGElement, diagramType: DiagramType = 'flowchart') => {
  const groupId = nodeGroup.id;
  let mermaidId = 'UNKNOWN';
  
  // 根据不同图表类型提取节点标识
  switch (diagramType) {
    case 'flowchart':
      // flowchart-A-0 -> A
      {
        const flowchartMatch = groupId.match(/flowchart-([A-Z]+)-\d+/);
        mermaidId = flowchartMatch ? flowchartMatch[1] : 'UNKNOWN';
      }
      break;
      
    case 'sequence':
      // 时序图：优先从text内容获取，这是最可靠的方法
      {
        const sequenceTextEl = nodeGroup.querySelector('text');
        if (sequenceTextEl && sequenceTextEl.textContent) {
          mermaidId = sequenceTextEl.textContent.trim();
        } else {
          // 备用：从ID中提取
          const sequenceMatch = groupId.match(/(?:actor|participant)-(.+)/);
          if (sequenceMatch) {
            mermaidId = sequenceMatch[1];
          } else {
            // 最后尝试：直接使用ID去掉前缀
            mermaidId = groupId.replace(/^(actor|participant)-?/, '') || 'UNKNOWN';
          }
        }
      }
      break;
      
      
    case 'mindmap':
      // 思维导图通常从text内容获取
      {
        const mindmapText = nodeGroup.querySelector('text');
        if (mindmapText && mindmapText.textContent) {
          mermaidId = mindmapText.textContent.trim();
        } else {
          const mindmapMatch = groupId.match(/mindmap-node-(.+)/);
          mermaidId = mindmapMatch ? mindmapMatch[1] : 'UNKNOWN';
        }
      }
      break;
      
    default:
      // 通用匹配：尝试从ID中提取最后一个有意义的部分
      {
        const genericMatch = groupId.match(/[a-zA-Z]+-(.+)/);
        mermaidId = genericMatch ? genericMatch[1] : groupId || 'UNKNOWN';
      }
  }
  
  // 获取节点文本内容 - 支持多种文本元素
  const textElement = nodeGroup.querySelector('text, tspan, .label');
  const content = textElement?.textContent?.trim() || '';
  
  // 获取图形信息 - 支持多种形状元素
  const shapeElement = nodeGroup.querySelector('rect, circle, ellipse, path, polygon');
  const shapeInfo = shapeElement ? {
    type: shapeElement.tagName,
    x: shapeElement.getAttribute('x') || shapeElement.getAttribute('cx'),
    y: shapeElement.getAttribute('y') || shapeElement.getAttribute('cy'),
    width: shapeElement.getAttribute('width') || shapeElement.getAttribute('r'),
    height: shapeElement.getAttribute('height') || shapeElement.getAttribute('ry')
  } : null;
  
  return {
    svgId: groupId,
    mermaidId,
    content,
    shapeInfo, // 更通用的名称
    diagramType,
    element: nodeGroup
  };
};

// 🔗 连线交互功能 - 增强版：支持拖拽编辑
const addEdgeInteractivity = (svg: SVGElement, onNodeEdit?: (nodeId: string, content: string) => void, diagramType: DiagramType = 'flowchart'): (() => void) => {
  // 查找所有连线路径
  const edgePaths = svg.querySelectorAll('path[id^="L_"]');
  
  
  const cleanupFunctions: Array<() => void> = [];
  
  edgePaths.forEach((path) => {
    const element = path as SVGElement;
    
    // 分析连线信息
    const edgeInfo = analyzeMermaidEdge(element);
    
    // 添加连线拖拽功能
    const cleanup = addConnectionDragFunctionality(element, edgeInfo, svg, onNodeEdit, diagramType);
    if (cleanup) {
      cleanupFunctions.push(cleanup);
    }
  });
  
  // 返回清理函数
  return () => {
    cleanupFunctions.forEach(cleanup => cleanup());
  };
};

// 🎯 连线拖拽核心功能
const addConnectionDragFunctionality = (
  pathElement: SVGElement, 
  edgeInfo: any, 
  svg: SVGElement, 
  onNodeEdit?: (nodeId: string, content: string) => void,
  diagramType: DiagramType = 'flowchart'
): (() => void) => {
  // 🎯 事件监听器收集数组
  const eventListeners: Array<{ element: Element | Document, event: string, handler: EventListener }> = [];
  
  let isDragging = false;
  let dragStartPoint = { x: 0, y: 0 };
  let dragLine: SVGLineElement | null = null;

  
  // 🎯 改进连线样式：更容易拖拽
  pathElement.style.cursor = 'move';
  pathElement.style.strokeWidth = '3'; // 加粗便于点击
  
  // 🎨 添加不可见的粗线提供更大的点击区域
  const invisiblePath = pathElement.cloneNode(true) as SVGElement;
  invisiblePath.style.strokeWidth = '15'; // 很粗的不可见线
  invisiblePath.style.stroke = 'transparent';
  invisiblePath.style.pointerEvents = 'stroke'; // 只响应描边事件
  invisiblePath.setAttribute('class', 'drag-helper-invisible');
  
  // 插入到原连线之前，作为点击区域
  pathElement.parentElement?.insertBefore(invisiblePath, pathElement);
  
  // 🔍 悬浮效果：显示连线可拖拽
  const addHoverEffects = (element: SVGElement) => {
    const handleMouseEnter = () => {
      if (!isDragging) {
        pathElement.style.strokeWidth = '5'; // 更粗
        pathElement.style.filter = 'drop-shadow(2px 2px 4px rgba(0,0,0,0.5))';
        pathElement.style.stroke = '#3b82f6'; // 蓝色高亮
        pathElement.style.opacity = '1';
        
        // 添加拖拽提示
        pathElement.setAttribute('data-tooltip', '🖱️ 拖拽连线来重新连接');
      }
    };
    
    const handleMouseLeave = () => {
      if (!isDragging) {
        pathElement.style.strokeWidth = '3';
        pathElement.style.filter = 'none';
        pathElement.style.stroke = ''; // 恢复默认颜色
        pathElement.style.opacity = '';
        pathElement.removeAttribute('data-tooltip');
      }
    };
    
    element.addEventListener('mouseenter', handleMouseEnter);
    element.addEventListener('mouseleave', handleMouseLeave);
    eventListeners.push({ element, event: 'mouseenter', handler: handleMouseEnter });
    eventListeners.push({ element, event: 'mouseleave', handler: handleMouseLeave });
  };
  
  // 为可见线和不可见线都添加悬浮效果
  addHoverEffects(pathElement);
  addHoverEffects(invisiblePath);
  
  // 🖱️ 开始拖拽 - 添加到可见和不可见线
  const addDragEvents = (element: SVGElement) => {
    const handleMouseDown = (event: MouseEvent) => {
      event.preventDefault();
      event.stopPropagation();
    
    isDragging = true;
    pathElement.style.cursor = 'move';
    
    // 🎯 拖拽时让原线条变灰透明
    pathElement.classList.add('dragging-source');
    
    // 记录拖拽起始点
    dragStartPoint = { 
      x: event.clientX, 
      y: event.clientY 
    };
    
    
    // 🎯 使用业内标准方法：getPointAtLength() 获取连线真实起始点
    let pathStartPoint;
    try {
      // 获取连线的真实起始点坐标（SVG内部坐标）
      const startPoint = (pathElement as SVGPathElement).getPointAtLength(0);
      pathStartPoint = {
        x: startPoint.x,
        y: startPoint.y
      };
      
    } catch (error) {
      // 降级方案：将屏幕坐标转换为SVG坐标
      const pathRect = pathElement.getBoundingClientRect();
      const screenCenterX = pathRect.left + pathRect.width / 2;
      const screenCenterY = pathRect.top + pathRect.height / 2;
      pathStartPoint = convertScreenToSVGCoordinates(svg, screenCenterX, screenCenterY);
      
    }
    
    // 创建平滑贝塞尔拖拽线（从真实起始点开始）
    createSmoothDragLine(svg, pathStartPoint);
    
    // 添加全局鼠标事件
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    
    };
    
    element.addEventListener('mousedown', handleMouseDown as EventListener);
    eventListeners.push({ element, event: 'mousedown', handler: handleMouseDown as EventListener });
  };
  
  // 为可见线和不可见线都添加拖拽事件
  addDragEvents(pathElement);
  addDragEvents(invisiblePath);
  
  // 🔄 拖拽过程中 - 更新贝塞尔曲线和鼠标指示器
  const handleMouseMove = (event: MouseEvent) => {
    if (!isDragging || !dragLine) {
      return;
    }
    
    // 🎯 统一坐标转换：屏幕坐标 → SVG坐标
    const svgPoint = convertScreenToSVGCoordinates(svg, event.clientX, event.clientY);
    
    
    // 更新贝塞尔曲线路径（使用SVG坐标）
    updateSmoothDragLine(dragLine, svgPoint.x, svgPoint.y);
    
    // 🎯 添加/更新鼠标位置指示器（使用SVG坐标）
    updateMouseIndicator(svg, svgPoint.x, svgPoint.y);
    
    // 检测目标节点（使用屏幕坐标进行碰撞检测）
    const targetNode = findTargetNodeUnderMouse(svg, event.clientX, event.clientY, diagramType);
    highlightTargetNode(targetNode);
    
    // 🎯 根据是否有目标节点显示不同的鼠标指示器样式
    updateMouseIndicatorStyle(targetNode);
  };
  
  // 🎯 拖拽结束
  const handleMouseUp = (event: MouseEvent) => {
    if (!isDragging) {
      return;
    }
    
    
    isDragging = false;
    pathElement.style.cursor = 'move';
    
    // 🎯 恢复原线条样式
    pathElement.classList.remove('dragging-source');
    
    // 清理拖拽辅助线
    if (dragLine) {
      dragLine.remove();
      dragLine = null;
    }
    
    // 🧹 清理鼠标位置指示器
    removeMouseIndicator(svg);
    
    // 检测释放目标（使用屏幕坐标进行碰撞检测）
    const targetNode = findTargetNodeUnderMouse(svg, event.clientX, event.clientY, diagramType);
    const svgReleasePoint = convertScreenToSVGCoordinates(svg, event.clientX, event.clientY);
    
    
    if (targetNode && onNodeEdit) {
      const targetInfo = analyzeMermaidNode(targetNode, diagramType);
      
      // 🚫 检查是否尝试重连到同一个节点（自连接）
      if (edgeInfo.from === targetInfo.mermaidId) {
        showSelfConnectionWarning(svg, targetNode);
      } else {
        // 创建新的连接关系
        createNewConnection(edgeInfo, targetInfo, onNodeEdit);
      }
    } else {
    }
    
    // 清理高亮效果
    clearTargetHighlights(svg);
    
    // 移除全局事件监听
    document.removeEventListener('mousemove', handleMouseMove);
    document.removeEventListener('mouseup', handleMouseUp);
    
  };
  
  // 🎨 创建专业学术风格的拖拽直线（带箭头）
  const createSmoothDragLine = (svg: SVGElement, startPoint: {x: number, y: number}) => {
    
    // 确保SVG有箭头标记定义
    createArrowMarker(svg);
    
    // 创建拖拽线元素
    dragLine = document.createElementNS('http://www.w3.org/2000/svg', 'line') as SVGLineElement;
    
    // 设置直线起始和结束点（初始状态相同）
    dragLine.setAttribute('x1', String(startPoint.x));
    dragLine.setAttribute('y1', String(startPoint.y));
    dragLine.setAttribute('x2', String(startPoint.x));
    dragLine.setAttribute('y2', String(startPoint.y));
    
    // 🎯 专业学术风格样式
    dragLine.setAttribute('stroke', '#2563eb'); // 学术蓝色
    dragLine.setAttribute('stroke-width', '2');
    dragLine.setAttribute('fill', 'none');
    dragLine.setAttribute('opacity', '0.8');
    dragLine.setAttribute('marker-end', 'url(#drag-arrow)'); // 添加箭头
    dragLine.style.pointerEvents = 'none';
    dragLine.setAttribute('class', 'drag-connection-line');
    dragLine.style.filter = 'drop-shadow(0 1px 2px rgba(37, 99, 235, 0.2))';
    
    // 保存起始点供后续使用
    (dragLine as any)._startPoint = startPoint;
    
    svg.appendChild(dragLine);
  };
  
  // 🔄 更新直线路径
  const updateSmoothDragLine = (dragLine: SVGLineElement, endX: number, endY: number) => {
    const startPoint = (dragLine as any)._startPoint;
    if (!startPoint) return;
    
    // 直接更新直线的终点
    dragLine.setAttribute('x2', String(endX));
    dragLine.setAttribute('y2', String(endY));
    
    // 根据拖拽距离调整视觉强度
    const deltaX = endX - startPoint.x;
    const deltaY = endY - startPoint.y;
    const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);
    const intensity = Math.min(distance / 200, 1); // 标准化到0-1
    const opacity = 0.6 + intensity * 0.3; // 0.6-0.9范围
    
    dragLine.setAttribute('opacity', String(opacity));
  };
  
  // 🎯 创建箭头标记
  const createArrowMarker = (svg: SVGElement) => {
    let defs = svg.querySelector('defs');
    if (!defs) {
      defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
      svg.insertBefore(defs, svg.firstChild);
    }
    
    // 检查是否已存在箭头标记
    if (defs.querySelector('#drag-arrow')) return;
    
    const marker = document.createElementNS('http://www.w3.org/2000/svg', 'marker');
    marker.setAttribute('id', 'drag-arrow');
    marker.setAttribute('viewBox', '0 0 10 10');
    marker.setAttribute('refX', '8');
    marker.setAttribute('refY', '3');
    marker.setAttribute('markerWidth', '6');
    marker.setAttribute('markerHeight', '6');
    marker.setAttribute('orient', 'auto');
    marker.setAttribute('markerUnits', 'strokeWidth');
    
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', 'M0,0 L0,6 L9,3 z');
    path.setAttribute('fill', '#2563eb');
    path.setAttribute('opacity', '0.8');
    
    marker.appendChild(path);
    defs.appendChild(marker);
    
  };
  
  // 🎯 精确的坐标转换函数：屏幕坐标 → SVG坐标
  const convertScreenToSVGCoordinates = (svg: SVGElement, screenX: number, screenY: number) => {
    // 创建SVG点对象
    const svgElement = svg as any;
    const point = svgElement.createSVGPoint();
    point.x = screenX;
    point.y = screenY;
    
    try {
      // 获取SVG的屏幕坐标变换矩阵并求逆
      const ctm = svgElement.getScreenCTM();
      if (ctm) {
        const transformedPoint = point.matrixTransform(ctm.inverse());
        return {
          x: transformedPoint.x,
          y: transformedPoint.y
        };
      }
    } catch (error) {
      console.warn('⚠️ SVG坐标转换失败，使用简单计算方法:', error);
    }
    
    // 降级方案：简单的边界框计算
    const svgRect = svg.getBoundingClientRect();
    return {
      x: screenX - svgRect.left,
      y: screenY - svgRect.top
    };
  };
  
  // 🎯 鼠标位置指示器函数
  const updateMouseIndicator = (svg: SVGElement, x: number, y: number) => {
    let indicator = svg.querySelector('.mouse-position-indicator') as SVGElement;
    
    if (!indicator) {
      // 创建鼠标位置指示器组
      indicator = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      indicator.setAttribute('class', 'mouse-position-indicator');
      indicator.style.pointerEvents = 'none'; // 不干扰鼠标事件
      
      // 外圆环 - 学术风格脉动效果
      const outerCircle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      outerCircle.setAttribute('r', '10');
      outerCircle.setAttribute('fill', 'none');
      outerCircle.setAttribute('stroke', '#2563eb');
      outerCircle.setAttribute('stroke-width', '1.5');
      outerCircle.setAttribute('opacity', '0.7');
      outerCircle.setAttribute('class', 'indicator-outer');
      
      // 内圆 - 精致的指示点
      const innerCircle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      innerCircle.setAttribute('r', '3');
      innerCircle.setAttribute('fill', '#2563eb');
      innerCircle.setAttribute('stroke', 'white');
      innerCircle.setAttribute('stroke-width', '1.5');
      innerCircle.setAttribute('class', 'indicator-inner');
      
      // 十字准线 - 学术风格精确指示
      const crossV = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      crossV.setAttribute('y1', '-6');
      crossV.setAttribute('y2', '6');
      crossV.setAttribute('stroke', '#2563eb');
      crossV.setAttribute('stroke-width', '1');
      crossV.setAttribute('opacity', '0.6');
      crossV.setAttribute('class', 'indicator-cross-v');
      
      const crossH = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      crossH.setAttribute('x1', '-6');
      crossH.setAttribute('x2', '6');
      crossH.setAttribute('stroke', '#2563eb');
      crossH.setAttribute('stroke-width', '1');
      crossH.setAttribute('opacity', '0.6');
      crossH.setAttribute('class', 'indicator-cross-h');
      
      indicator.appendChild(outerCircle);
      indicator.appendChild(crossV);
      indicator.appendChild(crossH);
      indicator.appendChild(innerCircle);
      
      svg.appendChild(indicator);
      
    }
    
    // 更新位置
    indicator.setAttribute('transform', `translate(${x}, ${y})`);
    
    // 添加脉动动画效果
    const outerCircle = indicator.querySelector('.indicator-outer') as SVGElement;
    if (outerCircle) {
      // 创建脉动效果
      outerCircle.style.animation = 'none';
      outerCircle.getBoundingClientRect(); // 触发重排
      outerCircle.style.animation = 'pulse-indicator 1s infinite ease-in-out';
    }
  };
  
  // 🎨 更新鼠标指示器样式（根据是否有目标节点）
  const updateMouseIndicatorStyle = (targetNode: SVGElement | null) => {
    const indicator = document.querySelector('.mouse-position-indicator') as SVGElement;
    if (!indicator) return;
    
    const outerCircle = indicator.querySelector('.indicator-outer') as SVGElement;
    const innerCircle = indicator.querySelector('.indicator-inner') as SVGElement;
    const crossV = indicator.querySelector('.indicator-cross-v') as SVGElement;
    const crossH = indicator.querySelector('.indicator-cross-h') as SVGElement;
    
    if (targetNode) {
      // 有目标节点时：学术绿色指示器
      [outerCircle, crossV, crossH].forEach(el => {
        if (el) {
          el.setAttribute('stroke', '#059669');
        }
      });
      if (innerCircle) {
        innerCircle.setAttribute('fill', '#059669');
      }
      
      // 显示连接提示文字
      showConnectionHint(indicator, '释放以建立连接');
    } else {
      // 无目标节点时：学术蓝色指示器
      [outerCircle, crossV, crossH].forEach(el => {
        if (el) {
          el.setAttribute('stroke', '#2563eb');
        }
      });
      if (innerCircle) {
        innerCircle.setAttribute('fill', '#2563eb');
      }
      
      // 隐藏连接提示
      hideConnectionHint(indicator);
    }
  };
  
  // 🔧 清理鼠标位置指示器
  const removeMouseIndicator = (svg: SVGElement) => {
    const indicator = svg.querySelector('.mouse-position-indicator');
    if (indicator) {
      indicator.remove();
    }
  };
  
  // 💬 显示连接提示
  const showConnectionHint = (indicator: SVGElement, text: string) => {
    let hint = indicator.querySelector('.connection-hint') as SVGElement;
    
    if (!hint) {
      // 创建提示背景
      const hintBg = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      hintBg.setAttribute('x', '15');
      hintBg.setAttribute('y', '-10');
      hintBg.setAttribute('width', String(text.length * 6 + 10));
      hintBg.setAttribute('height', '20');
      hintBg.setAttribute('fill', 'rgba(5, 150, 105, 0.9)');
      hintBg.setAttribute('rx', '4');
      hintBg.setAttribute('class', 'hint-bg');
      
      // 创建提示文字
      const hintText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      hintText.setAttribute('x', '20');
      hintText.setAttribute('y', '4');
      hintText.setAttribute('fill', 'white');
      hintText.setAttribute('font-size', '10');
      hintText.setAttribute('font-family', 'Inter, sans-serif');
      hintText.setAttribute('class', 'hint-text');
      hintText.textContent = text;
      
      // 创建提示组
      hint = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      hint.setAttribute('class', 'connection-hint');
      hint.appendChild(hintBg);
      hint.appendChild(hintText);
      
      indicator.appendChild(hint);
    }
    
    hint.style.opacity = '1';
  };
  
  // 🔇 隐藏连接提示
  const hideConnectionHint = (indicator: SVGElement) => {
    const hint = indicator.querySelector('.connection-hint') as SVGElement;
    if (hint) {
      hint.style.opacity = '0';
    }
  };
  
  // 查找鼠标下的目标节点
  const findTargetNodeUnderMouse = (svg: SVGElement, mouseX: number, mouseY: number, diagramType: DiagramType = 'flowchart'): SVGElement | null => {
    const nodeGroups = svg.querySelectorAll('g[id*="flowchart-"]');
    
    
    for (const nodeGroup of nodeGroups) {
      const element = nodeGroup as SVGElement;
      const rect = element.getBoundingClientRect();
      const nodeInfo = analyzeMermaidNode(element, diagramType);
      
      
      if (mouseX >= rect.left && mouseX <= rect.right && 
          mouseY >= rect.top && mouseY <= rect.bottom) {
        
        // 排除源节点（不能连接到自己）
        if (nodeInfo.mermaidId !== edgeInfo.from) {
          return element;
        } else {
        }
      }
    }
    
    return null;
  };
  
  // 高亮目标节点
  const highlightTargetNode = (targetNode: SVGElement | null) => {
    // 先清除所有高亮
    clearTargetHighlights(svg);
    
    if (targetNode) {
      targetNode.style.outline = '2px solid #059669'; // 学术绿色高亮
      targetNode.style.outlineOffset = '3px';
      targetNode.style.boxShadow = '0 0 8px rgba(5, 150, 105, 0.3)';
      targetNode.classList.add('drag-target-highlight');
    }
  };
  
  // 清除所有目标高亮
  const clearTargetHighlights = (svg: SVGElement) => {
    const highlightedNodes = svg.querySelectorAll('.drag-target-highlight');
    highlightedNodes.forEach(node => {
      const element = node as SVGElement;
      element.style.outline = '';
      element.style.outlineOffset = '';
      element.style.boxShadow = '';
      element.classList.remove('drag-target-highlight');
    });
  };
  
  // 创建新的连接关系
  const createNewConnection = (
    edgeInfo: any, 
    targetInfo: any, 
    onNodeEdit: (nodeId: string, content: string) => void
  ) => {
    
    // 这里我们需要通知上层组件更新mermaid代码
    // 由于我们现在只有onNodeEdit回调，我们需要扩展它来支持连线编辑
    // 暂时使用特殊格式来传递连线更改信息
    const connectionChangeInfo = `CONNECTION_CHANGE:${edgeInfo.from}->${targetInfo.mermaidId}:REPLACE:${edgeInfo.from}->${edgeInfo.to}`;
    onNodeEdit('__CONNECTION__', connectionChangeInfo);
  };
  
  // 返回清理函数
  return () => {
    eventListeners.forEach(({ element, event, handler }) => {
      element.removeEventListener(event, handler);
    });
  };
};

// 🔬 分析连线的函数
const analyzeMermaidEdge = (pathElement: SVGElement) => {
  // 从ID中提取连线信息，支持多种格式
  const pathId = pathElement.id;
  
  let from = 'UNKNOWN';
  let to = 'UNKNOWN';
  
  // 🎯 精确的连线ID格式匹配（按优先级排序）
  const patterns = [
    // 1. Mermaid标准格式: L-A-B-0, L-A-C-1 (最高优先级) - 使用横杠
    {
      regex: /^L-([A-Za-z0-9]+)-([A-Za-z0-9]+)-\d+$/,
      handler: (match: RegExpMatchArray) => ({ from: match[1], to: match[2] })
    },
    // 1b. 备用格式: L_A_B_0 (下划线格式)
    {
      regex: /^L_([A-Za-z0-9]+)_([A-Za-z0-9]+)_\d+$/,
      handler: (match: RegExpMatchArray) => ({ from: match[1], to: match[2] })
    },
    // 2. 直接连线格式: A-B, A->B, A-->B
    {
      regex: /^([A-Za-z0-9]+)-+>?([A-Za-z0-9]+)$/,
      handler: (match: RegExpMatchArray) => ({ from: match[1], to: match[2] })
    },
    // 3. 边缘格式: edge_A_B, connection_A_B, link_A_B
    {
      regex: /^(edge|connection|link)_([A-Za-z0-9]+)_([A-Za-z0-9]+)$/i,
      handler: (match: RegExpMatchArray) => ({ from: match[2], to: match[3] })
    },
    // 4. 流程图连线格式: flowchart-A-B-link-0
    {
      regex: /^flowchart-([A-Za-z0-9]+)-([A-Za-z0-9]+)-link-\d+$/,
      handler: (match: RegExpMatchArray) => ({ from: match[1], to: match[2] })
    },
    // 5. 包含两个节点ID的其他格式（最低优先级，更严格）
    {
      regex: /^[^A-Za-z0-9]*([A-Za-z0-9]+)[^A-Za-z0-9]+([A-Za-z0-9]+)[^A-Za-z0-9]*$/,
      handler: (match: RegExpMatchArray) => ({ from: match[1], to: match[2] })
    }
  ];
  
  // 🎯 按优先级尝试匹配
  for (const pattern of patterns) {
    const match = pathId.match(pattern.regex);
    if (match) {
      const result = pattern.handler(match);
      from = result.from;
      to = result.to;
      break;
    }
  }
  
  // 如果仍然是UNKNOWN，尝试从父元素或相邻元素获取信息
  if (from === 'UNKNOWN' || to === 'UNKNOWN') {
    // 可以添加更复杂的DOM分析逻辑
  }
  
  // 从className判断连线类型
  const className = pathElement.className.baseVal || pathElement.className || '';
  const isDotted = className.includes('dotted') || className.includes('dashed');
  const type = isDotted ? 'dotted' : 'solid';
  
  
  return {
    svgId: pathId,
    from,
    to,
    type,
    element: pathElement
  };
};


// 🎯 创建文字选中效果编辑器：让原文字显示蓝色选中状态
const createInlineEditor = (
  nodeElement: SVGElement, 
  nodeInfo: any, 
  onNodeEdit: (nodeId: string, content: string) => void,
  diagramType: DiagramType = 'flowchart'
) => {
  
  // 注意：类图现在也使用内联编辑，不再使用模态编辑器
  
  // 防止重复创建编辑器
  if (nodeElement.classList.contains('editing')) {
    return;
  }
  
  // 标记正在编辑状态
  nodeElement.classList.add('editing');
  
  // 📍 深度调试：分析完整的SVG结构
  
  // 🔍 尝试各种方式查找文本元素
  let textElement = null;
  
  // 方法1: 直接查找text
  textElement = nodeElement.querySelector('text');
  
  // 方法2: 查找g > text
  if (!textElement) {
    textElement = nodeElement.querySelector('g text');
  }
  
  // 方法3: 查找所有text元素
  if (!textElement) {
    const allTexts = nodeElement.querySelectorAll('text');
    textElement = allTexts[0];
  }
  
  // 方法4: 查找tspan元素（有时mermaid使用tspan）
  if (!textElement) {
    const allTspans = nodeElement.querySelectorAll('tspan');
    if (allTspans.length > 0) {
      textElement = allTspans[0].parentElement; // tspan的父元素通常是text
    }
  }
  
  // 方法5: 递归查找所有子元素中的text
  if (!textElement) {
    const findTextElements = (element: Element): Element[] => {
      const texts: Element[] = [];
      for (const child of element.children) {
        if (child.tagName === 'text') {
          texts.push(child);
        }
        if (child.tagName === 'tspan') {
          texts.push(child.parentElement as Element);
        }
        texts.push(...findTextElements(child));
      }
      return texts;
    };
    
    const allFoundTexts = findTextElements(nodeElement);
    textElement = allFoundTexts[0];
  }
  
  
  if (!textElement) {
    
    // 🚀 即使没有找到文本元素，也继续创建编辑器
    createSimpleEditor(nodeElement, nodeInfo, onNodeEdit, diagramType);
    return;
  }
  
  // 🎯 关键：让原文字显示蓝色选中效果
  const originalFill = textElement.getAttribute('fill') || '#000000';
  const originalBackground = (textElement as HTMLElement).style.background || '';
  
  // 设置文字选中效果：蓝色背景，白色文字
  (textElement as HTMLElement).style.background = '#007acc';
  (textElement as HTMLElement).style.color = 'white';
  textElement.setAttribute('fill', 'white');
  
  // 添加选中高亮背景
  const textBBox = (textElement as SVGTextElement).getBBox();
  const highlight = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
  highlight.setAttribute('x', String(textBBox.x - 2));
  highlight.setAttribute('y', String(textBBox.y - 2));
  highlight.setAttribute('width', String(textBBox.width + 4));
  highlight.setAttribute('height', String(textBBox.height + 4));
  highlight.setAttribute('fill', '#007acc');
  highlight.setAttribute('rx', '2');
  highlight.classList.add('text-selection-highlight');
  
  // 在文字前插入高亮背景
  textElement.parentElement?.insertBefore(highlight, textElement);
  
  
  // 创建透明的contentEditable覆盖层
  const nodeRect = nodeElement.getBoundingClientRect();
  const editableDiv = document.createElement('div');
  editableDiv.contentEditable = 'true';
  editableDiv.textContent = nodeInfo.content;
  editableDiv.className = 'text-selection-editor';
  
  // 读取原文字样式，尽量与节点文字一致
  let computedFontSize = '14px';
  let computedFontFamily = "'Inter', system-ui, sans-serif";
  let computedFontWeight = 'normal';
  let computedLineHeight = '';
  let textAlign = 'center';
  try {
    const cs = window.getComputedStyle(textElement as any);
    if (cs && cs.fontSize) computedFontSize = cs.fontSize;
    if (cs && cs.fontFamily) computedFontFamily = cs.fontFamily;
    if (cs && cs.fontWeight) computedFontWeight = cs.fontWeight as string;
    if (cs && cs.lineHeight && cs.lineHeight !== 'normal') computedLineHeight = cs.lineHeight;
    const anchor = (textElement as SVGTextElement).getAttribute('text-anchor');
    if (anchor === 'middle') textAlign = 'center';
    else if (anchor === 'end') textAlign = 'right';
    else textAlign = 'left';
  } catch {}

  // 简易缩放估计（相对于当前画布缩放），尽量让编辑时的字号接近显示字号
  let scale = 1;
  try {
    const rect = (textElement as SVGGraphicsElement).getBoundingClientRect();
    const bbox = (textElement as SVGGraphicsElement).getBBox();
    if (bbox && bbox.width > 0 && rect && rect.width > 0) {
      scale = rect.width / bbox.width; // 近似当前缩放
    } else {
      const m = (textElement as SVGGraphicsElement).getScreenCTM();
      if (m) scale = Math.abs(m.a) || 1;
    }
  } catch {}
  // 限制比例，避免极端情况
  if (!isFinite(scale) || scale <= 0) scale = 1;
  scale = Math.max(0.5, Math.min(4, scale));

  // 将字号按缩放调整（粗略近似即可）
  let scaledFontPx = parseFloat(String(computedFontSize).replace('px','')) || 14;
  scaledFontPx = Math.max(8, Math.min(128, scaledFontPx * scale));

  // 设置透明底色的编辑层（位置大小与节点一致；字体与节点一致）
  editableDiv.style.cssText = `
    position: fixed;
    left: ${nodeRect.left + 2}px;
    top: ${nodeRect.top + 2}px;
    width: ${nodeRect.width - 4}px;
    height: ${nodeRect.height - 4}px;
    z-index: 9999;
    background: rgba(255, 255, 255, 0.95);
    color: #000000;
    border: var(--stroke-1) solid #007acc;
    border-radius: inherit;
    outline: none;
    font-size: ${scaledFontPx.toFixed(2)}px;
    font-family: ${computedFontFamily};
    font-weight: ${computedFontWeight};
    ${computedLineHeight ? `line-height: ${computedLineHeight};` : ''}
    text-align: ${textAlign};
    cursor: text;
    overflow: hidden;
    padding: var(--space-2) var(--space-4);
    box-shadow: var(--shadow-elev-5);
  `;
  
  document.body.appendChild(editableDiv);
  
  // 清理函数
  const cleanup = () => {
    nodeElement.classList.remove('editing');
    
    // 恢复原始文字样式
    (textElement as HTMLElement).style.background = originalBackground;
    (textElement as HTMLElement).style.color = '';
    textElement.setAttribute('fill', originalFill);
    
    // 移除全局监听器
    document.removeEventListener('pointerdown', onGlobalPointerDown, true);
    document.removeEventListener('mousedown', onGlobalMouseDown, true);
    document.removeEventListener('touchstart', onGlobalTouchStart, true);

    // 移除高亮背景
    const highlightElement = nodeElement.querySelector('.text-selection-highlight');
    if (highlightElement) {
      highlightElement.remove();
    }
    
    editableDiv.remove();
  };
  
  // 确认编辑
  let finalized = false;
  const confirmEdit = () => {
    if (finalized) return;
    const newContent = editableDiv.textContent?.trim() || '';
    
    if (newContent && newContent !== nodeInfo.content) {
      onNodeEdit(nodeInfo.mermaidId, newContent);
    }
    finalized = true;
    cleanup();
  };
  
  // 事件处理
  editableDiv.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      confirmEdit();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      cleanup();
    }
  });
  
  editableDiv.addEventListener('blur', () => {
    setTimeout(confirmEdit, 50);
  });

  // 点击编辑框以外区域：立即确认保存（更可靠的“点击空白自动保存”）
  const onGlobalPointerDown = (e: Event) => {
    const t = e.target as Node;
    if (!editableDiv.contains(t)) {
      confirmEdit();
    }
  };
  const onGlobalMouseDown = (e: Event) => { const t = e.target as Node; if (!editableDiv.contains(t)) confirmEdit(); };
  const onGlobalTouchStart = (e: Event) => { const t = e.target as Node; if (!editableDiv.contains(t)) confirmEdit(); };
  document.addEventListener('pointerdown', onGlobalPointerDown, true);
  document.addEventListener('mousedown', onGlobalMouseDown, true);
  document.addEventListener('touchstart', onGlobalTouchStart, true);
  
  editableDiv.addEventListener('click', (e) => {
    e.stopPropagation();
  });
  
  // 自动聚焦并选中所有文字
  editableDiv.focus();
  
  // 延迟确保内容已渲染再选中
  setTimeout(() => {
    const range = document.createRange();
    range.selectNodeContents(editableDiv);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
  }, 10);
  
};

// 🚀 简化版编辑器：不依赖文本元素，支持图表类型特定尺寸
const createSimpleEditor = (
  nodeElement: SVGElement, 
  nodeInfo: any, 
  onNodeEdit: (nodeId: string, content: string) => void,
  diagramType: DiagramType = 'flowchart'
) => {
  
  // 获取节点位置
  const nodeRect = nodeElement.getBoundingClientRect();
  
  // 🎯 根据图表类型调整编辑框尺寸
  let editWidth = nodeRect.width - 4;
  let editHeight = nodeRect.height - 4;
  
  // 时序图参与者需要更大的编辑框
  if (diagramType === 'sequence') {
    editWidth = Math.max(editWidth, 120); // 最小宽度120px
    editHeight = Math.max(editHeight, 24); // 最小高度24px
  }
  
  // 创建明显的编辑框
  const input = document.createElement('input');
  input.type = 'text';
  input.value = nodeInfo.content;
  input.className = 'simple-editor';
  
  // 读取附近文字的样式，尽量与节点文字一致
  let simpleFontSize = '14px';
  let simpleFontFamily = "'Inter', system-ui, sans-serif";
  let simpleFontWeight = 'normal';
  let simpleScale = 1;
  try {
    const sampleText = nodeElement.querySelector('text, tspan') as SVGElement | null;
    const cs = sampleText ? window.getComputedStyle(sampleText as any) : (nodeElement.ownerSVGElement ? window.getComputedStyle(nodeElement.ownerSVGElement as any) : null);
    if (cs && cs.fontSize) simpleFontSize = cs.fontSize;
    if (cs && cs.fontFamily) simpleFontFamily = cs.fontFamily;
    if (cs && cs.fontWeight) simpleFontWeight = cs.fontWeight as string;
    // 简易缩放估计
    if (sampleText) {
      const r = (sampleText as any).getBoundingClientRect();
      const b = (sampleText as any).getBBox?.();
      if (b && b.width > 0 && r && r.width > 0) simpleScale = r.width / b.width;
      else {
        const m = (sampleText as any).getScreenCTM?.();
        if (m) simpleScale = Math.abs(m.a) || 1;
      }
    }
  } catch {}
  if (!isFinite(simpleScale) || simpleScale <= 0) simpleScale = 1;
  simpleScale = Math.max(0.5, Math.min(4, simpleScale));
  let simpleFontPx = parseFloat(String(simpleFontSize).replace('px','')) || 14;
  simpleFontPx = Math.max(8, Math.min(128, simpleFontPx * simpleScale));

  // 设置透明底色的编辑框样式
  input.style.cssText = `
    position: fixed;
    left: ${nodeRect.left + 2}px;
    top: ${nodeRect.top + 2}px;
    width: ${editWidth}px;
    height: ${editHeight}px;
    z-index: 9999;
    border: var(--stroke-1) solid #007acc;
    border-radius: inherit;
    background: rgba(255, 255, 255, 0.95);
    color: #000000;
    font-size: ${simpleFontPx.toFixed(2)}px;
    font-family: ${simpleFontFamily};
    font-weight: ${simpleFontWeight};
    text-align: center;
    padding: var(--space-2) var(--space-4);
    outline: none;
    box-shadow: var(--shadow-elev-5);
  `;
  
  document.body.appendChild(input);
  
  // 清理函数
  const cleanup = () => {
    nodeElement.classList.remove('editing');
    input.remove();
    document.removeEventListener('pointerdown', onGlobalPointerDownSimple, true);
  };
  
  // 确认编辑
  let finalizedSimple = false;
  const confirmEdit = () => {
    if (finalizedSimple) return;
    const newContent = input.value.trim();
    
    if (newContent && newContent !== nodeInfo.content) {
      onNodeEdit(nodeInfo.mermaidId, newContent);
    }
    finalizedSimple = true;
    cleanup();
  };
  
  // 事件处理
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      confirmEdit();
    } else if (e.key === 'Escape') {
      cleanup();
    }
  });
  
  input.addEventListener('blur', () => {
    setTimeout(confirmEdit, 50);
  });

  // 点击编辑框以外区域：立即确认保存
  const onGlobalPointerDownSimple = (e: Event) => {
    const t = e.target as Node;
    if (!input.contains(t)) {
      confirmEdit();
    }
  };
  document.addEventListener('pointerdown', onGlobalPointerDownSimple, true);
  
  input.addEventListener('click', (e) => {
    e.stopPropagation();
  });
  
  // 自动聚焦并选中文本
  input.focus();
  
  // 延迟确保选中效果生效
  setTimeout(() => {
    input.select();
  }, 10);
  
};



// 🆕 功能1：空白区域双击添加新节点（直接创建，无需弹窗）
const addBlankAreaDoubleClick = (svg: SVGElement, onNodeEdit: (nodeId: string, content: string) => void, diagramType: DiagramType = 'flowchart'): (() => void) => {
  
  const handleDoubleClick = (event: Event) => {
    const target = event.target as SVGElement;
    
    
    // 🎯 更精确的空白区域判断：排除所有交互元素
    const config = DIAGRAM_CONFIGS[diagramType as keyof typeof DIAGRAM_CONFIGS];
    const isNodeGroup = (element: SVGElement) => {
      if (!config) return element.id.includes('flowchart-');
      
      // 根据图表类型检查是否为节点组
      if (diagramType === 'flowchart') return element.id.includes('flowchart-');
      if (diagramType === 'sequence') return element.id.includes('actor') || element.id.includes('participant');
      if (diagramType === 'class') return element.getAttribute('class')?.includes('class');
      if (diagramType === 'state') return element.id.includes('state');
      if (diagramType === 'mindmap') return element.getAttribute('class')?.includes('mindmap-node');
      
      return false;
    };
    
    const isBlankArea = 
      target === svg || // 直接点击SVG根元素
      (target.tagName === 'svg') || // SVG元素本身
      (target.tagName === 'g' && !isNodeGroup(target)); // 非节点组
      
    // 🚫 排除连线和节点
    const isPath = target.tagName === 'path'; // 连线路径
    const isNode = isNodeGroup(target) || (config && target.closest(config.nodeSelector)); // 节点或节点内元素
    const isText = target.tagName === 'text' || target.tagName === 'tspan'; // 文字元素
    
    if (isBlankArea && !isPath && !isNode && !isText) {
      event.preventDefault();
      event.stopPropagation();
      
      
      // 转换为SVG坐标
      const svgPoint = convertScreenToSVGCoordinatesGlobal(svg, (event as MouseEvent).clientX, (event as MouseEvent).clientY);
      
      // 直接创建新节点，默认内容为"新节点"
      createNewNodeDirectly(svgPoint, onNodeEdit);
    } else {
    }
  };
  
  svg.addEventListener('dblclick', handleDoubleClick);
  
  // 返回清理函数
  return () => {
    svg.removeEventListener('dblclick', handleDoubleClick);
  };
};

// 🆕 功能2：连线双击添加中间文字标签
const addConnectionLabelEditing = (svg: SVGElement, onNodeEdit: (nodeId: string, content: string) => void): (() => void) => {
  
  // 🔍 直接查找所有路径元素，简化逻辑
  const allPaths = svg.querySelectorAll('path');
  
  // 🎯 过滤出真正的连线元素，排除箭头标记和装饰元素
  const edgePaths = Array.from(allPaths).filter((pathElement) => {
    const pathId = pathElement.id;
    const pathClass = pathElement.className.baseVal || pathElement.getAttribute('class') || '';
    
    // 排除箭头标记元素
    if (pathClass.includes('arrowMarkerPath')) {
      return false;
    }
    
    // 排除空ID的装饰元素
    if (!pathId || pathId.trim() === '') {
      return false;
    }
    
    // 只保留有效的连线元素（通常以L开头或包含连线相关类名）
    const isValidEdge = pathId.startsWith('L-') || 
                       pathClass.includes('flowchart-link') || 
                       pathClass.includes('edge') ||
                       pathClass.includes('link');
    
    if (isValidEdge) {
      return true;
    } else {
      return false;
    }
  }) as SVGElement[];
  
  
  // 存储事件监听器以便清理
  const eventListeners: Array<{ element: SVGElement; type: string; handler: EventListener; options?: boolean | AddEventListenerOptions }> = [];
  
  edgePaths.forEach((pathElement, index) => {
    
    
    const handleDoubleClick = (event: Event) => {
      // 🚫 强制阻止事件冒泡和默认行为
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation(); // 阻止同一元素上的其他事件监听器
      
      
      // 🎯 直接使用点击位置，不需要复杂的计算
      const clickPoint = { x: (event as MouseEvent).clientX, y: (event as MouseEvent).clientY };
      const edgeInfo = analyzeMermaidEdge(pathElement);
      
      createConnectionLabelEditor(svg, pathElement, edgeInfo, clickPoint, onNodeEdit);
      
      // 额外确保事件不会继续传播
      return false;
    };
    
    const handleMouseEnter = () => {
      pathElement.style.cursor = 'pointer';
      pathElement.style.strokeWidth = '3';
    };
    
    const handleMouseLeave = () => {
      pathElement.style.cursor = 'default';
      pathElement.style.strokeWidth = '';
    };
    
    // 注册事件监听器
    pathElement.addEventListener('dblclick', handleDoubleClick, true); // 使用捕获模式，优先处理
    pathElement.addEventListener('mouseenter', handleMouseEnter);
    pathElement.addEventListener('mouseleave', handleMouseLeave);
    
    // 记录事件监听器以便清理
    eventListeners.push(
      { element: pathElement, type: 'dblclick', handler: handleDoubleClick, options: true },
      { element: pathElement, type: 'mouseenter', handler: handleMouseEnter },
      { element: pathElement, type: 'mouseleave', handler: handleMouseLeave }
    );
  });
  
  // 返回清理函数
  return () => {
    eventListeners.forEach(({ element, type, handler, options }) => {
      element.removeEventListener(type, handler, options);
    });
  };
};

// 🆕 功能3：节点单击拖出新连线
const addNodeClickDragNewConnection = (svg: SVGElement, onNodeEdit: (nodeId: string, content: string) => void, diagramType: DiagramType = 'flowchart'): (() => void) => {
  
  const config = DIAGRAM_CONFIGS[diagramType as keyof typeof DIAGRAM_CONFIGS];
  if (!config) return () => {};
  
  const nodeGroups = svg.querySelectorAll(config.nodeSelector);
  
  // 存储事件监听器以便清理
  const eventListeners: Array<{ element: Element | Document; type: string; handler: EventListener; options?: boolean | AddEventListenerOptions }> = [];
  
  nodeGroups.forEach((nodeGroup) => {
    const element = nodeGroup as SVGElement;
    let isNewConnectionDrag = false;
    let dragStartNode: any = null;
    let newConnectionLine: SVGLineElement | null = null;
    
    // 添加单击拖拽开始新连线的功能（点击不放手模式）
    let mouseDownPos = { x: 0, y: 0 };
    let isDoubleClickMode = false; // 🆕 添加双击模式标记
    
    const handleMouseDown = (event: MouseEvent) => {
      mouseDownPos = { x: event.clientX, y: event.clientY };
      
      // 🆕 只记录按下状态，不立即启动拖拽
      // 添加临时全局事件监听，等待鼠标移动或释放
      const tempMouseMove = (moveEvent: MouseEvent) => {
        const deltaX = moveEvent.clientX - mouseDownPos.x;
        const deltaY = moveEvent.clientY - mouseDownPos.y;
        const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);
        
        // 只有鼠标移动超过阈值才启动拖拽
        if (distance > 3 && !isNewConnectionDrag && !isDoubleClickMode) {
          isNewConnectionDrag = true;
          dragStartNode = analyzeMermaidNode(element, diagramType);
          
          // 获取节点中心点作为起始位置
          const nodeRect = element.getBoundingClientRect();
          const startPoint = convertScreenToSVGCoordinatesGlobal(svg, 
            nodeRect.left + nodeRect.width / 2, 
            nodeRect.top + nodeRect.height / 2
          );
          
          newConnectionLine = createNewConnectionDragLine(svg, startPoint);
          
          // 切换到正式拖拽事件处理
          document.removeEventListener('mousemove', tempMouseMove);
          document.removeEventListener('mouseup', tempMouseUp);
          document.addEventListener('mousemove', handleNewConnectionDrag);
          document.addEventListener('mouseup', handleNewConnectionRelease);
        }
      };
      
      const tempMouseUp = () => {
        // 清理临时事件监听器
        document.removeEventListener('mousemove', tempMouseMove);
        document.removeEventListener('mouseup', tempMouseUp);
      };
      
      document.addEventListener('mousemove', tempMouseMove);
      document.addEventListener('mouseup', tempMouseUp);
    };
    
    element.addEventListener('mousedown', handleMouseDown as EventListener);
    eventListeners.push({ element, type: 'mousedown', handler: handleMouseDown as EventListener });
    
    // 双击时设置双击模式标记（防止意外启动拖拽）
    const handleDoubleClick = () => {
      isDoubleClickMode = true;
      
      // 短暂延迟后重置双击模式
      setTimeout(() => {
        isDoubleClickMode = false;
      }, 100);
    };
    
    element.addEventListener('dblclick', handleDoubleClick);
    eventListeners.push({ element, type: 'dblclick', handler: handleDoubleClick });
    
    
    const handleNewConnectionDrag = (event: MouseEvent) => {
      if (!isNewConnectionDrag || !newConnectionLine) return;
      
      const svgPoint = convertScreenToSVGCoordinatesGlobal(svg, event.clientX, event.clientY);
      updateNewConnectionLine(newConnectionLine, svgPoint);
      
      // 高亮潜在目标节点
      const targetNode = findTargetNodeUnderMouseGlobal(svg, event.clientX, event.clientY, diagramType);
      const mousePos = { x: event.clientX, y: event.clientY };
      highlightPotentialTarget(svg, targetNode, dragStartNode, diagramType, mousePos);
    };
    
    const handleNewConnectionRelease = (event: MouseEvent) => {
      if (!isNewConnectionDrag) return;
      
      
      isNewConnectionDrag = false;
      
      // 清理拖拽线
      if (newConnectionLine) {
        newConnectionLine.remove();
        newConnectionLine = null;
      }
      
      // 检查释放位置
      const targetNode = findTargetNodeUnderMouseGlobal(svg, event.clientX, event.clientY, diagramType);
      const svgReleasePoint = convertScreenToSVGCoordinatesGlobal(svg, event.clientX, event.clientY);
      
      if (targetNode && dragStartNode) {
        // 连接到现有节点
        const targetInfo = analyzeMermaidNode(targetNode, diagramType);
        
        // 🚫 检查是否尝试连接到自己
        if (dragStartNode.mermaidId === targetInfo.mermaidId) {
          showSelfConnectionWarning(svg, targetNode);
        } else {
          createConnectionBetweenNodes(dragStartNode, targetInfo, onNodeEdit);
        }
      } else {
        // 在空白区域创建新节点并连接
        createNewNodeAndConnect(dragStartNode, svgReleasePoint, onNodeEdit);
      }
      
      // 清理高亮
      clearAllHighlights(svg);
      dragStartNode = null;
      
      // 移除全局事件
      document.removeEventListener('mousemove', handleNewConnectionDrag);
      document.removeEventListener('mouseup', handleNewConnectionRelease);
    };
  });
  
  // 返回清理函数
  return () => {
    eventListeners.forEach(({ element, type, handler, options }) => {
      element.removeEventListener(type, handler, options);
    });
  };
};

// 🛠️ 辅助函数：全局坐标转换
const convertScreenToSVGCoordinatesGlobal = (svg: SVGElement, screenX: number, screenY: number) => {
  const svgElement = svg as any;
  const point = svgElement.createSVGPoint();
  point.x = screenX;
  point.y = screenY;
  
  try {
    const ctm = svgElement.getScreenCTM();
    if (ctm) {
      const transformedPoint = point.matrixTransform(ctm.inverse());
      return { x: transformedPoint.x, y: transformedPoint.y };
    }
  } catch (error) {
    console.warn('⚠️ SVG坐标转换失败:', error);
  }
  
  const svgRect = svg.getBoundingClientRect();
  return {
    x: screenX - svgRect.left,
    y: screenY - svgRect.top
  };
};

// 🛠️ 直接创建新节点（无需弹窗）
const createNewNodeDirectly = (position: {x: number, y: number}, onNodeEdit: (nodeId: string, content: string) => void) => {
  // 生成新节点ID
  const newNodeId = generateNextNodeId();
  const defaultContent = 'New node';
  
  
  // 通过特殊格式通知上层组件
  const nodeCreationInfo = `NEW_NODE:${newNodeId}:${defaultContent}:${position.x}:${position.y}`;
  onNodeEdit('__NEW_NODE__', nodeCreationInfo);
};

// 🛠️ 连线标签内联编辑器（类似节点编辑模式）
const createConnectionLabelEditor = (
  _svg: SVGElement, 
  pathElement: SVGElement, 
  edgeInfo: any, 
  clickPosition: {x: number, y: number}, // 现在是屏幕坐标
  onNodeEdit: (nodeId: string, content: string) => void
) => {
  
  // 🎯 先获取现有标签 - 通过特殊回调
  const currentText = '';
  const getLabelRequest = `GET_CONNECTION_LABEL:${edgeInfo.from}->${edgeInfo.to}`;
  onNodeEdit('__GET_CONNECTION_LABEL__', getLabelRequest);
  
  
  // 防止重复创建编辑器
  if (pathElement.classList.contains('connection-editing')) {
    return;
  }
  
  pathElement.classList.add('connection-editing');
  
  
  // 创建浮动输入框（白底蓝边样式）
  const editorInput = document.createElement('input');
  editorInput.type = 'text';
  editorInput.value = currentText || '';
  editorInput.placeholder = 'Label';
  editorInput.className = 'connection-label-editor';
  
  // 🎯 直接使用点击位置定位编辑器
  editorInput.style.cssText = `
    position: fixed;
    left: ${clickPosition.x - 40}px;
    top: ${clickPosition.y - 12}px;
    z-index: 10000;
    background: white;
    border: var(--stroke-2) solid #2563eb;
    border-radius: var(--radius-sm);
    padding: var(--space-4) var(--space-8);
    font-size: 12px;
    font-family: Inter, system-ui, sans-serif;
    min-width: 80px;
    max-width: 200px;
    text-align: center;
    box-shadow: var(--shadow-accent-glow);
    color: #1e40af;
    font-weight: 500;
    outline: none;
    transition: all 0.2s ease;
  `;
  
  document.body.appendChild(editorInput);
  
  
  // 清理函数
  const cleanup = () => {
    pathElement.classList.remove('connection-editing');
    editorInput.remove();
  };
  
  // 保存标签
  const saveLabel = () => {
    const labelText = editorInput.value.trim();
    
    if (labelText !== currentText) {
      // 通过特殊格式通知上层组件
      const labelInfo = `CONNECTION_LABEL:${edgeInfo.from}->${edgeInfo.to}:${labelText}`;
      onNodeEdit('__CONNECTION_LABEL__', labelInfo);
    }
    
    cleanup();
  };
  
  // 事件处理
  editorInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      saveLabel();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      cleanup();
    }
  });
  
  editorInput.addEventListener('blur', () => {
    setTimeout(saveLabel, 100);
  });
  
  editorInput.addEventListener('click', (e) => {
    e.stopPropagation();
  });
  
  // 自动聚焦并选中文字
  editorInput.focus();
  if (currentText) {
    editorInput.select();
  }
  
};

// 🛠️ 创建新连线拖拽线
const createNewConnectionDragLine = (svg: SVGElement, startPoint: {x: number, y: number}) => {
  const dragLine = document.createElementNS('http://www.w3.org/2000/svg', 'line') as SVGLineElement;
  
  dragLine.setAttribute('x1', String(startPoint.x));
  dragLine.setAttribute('y1', String(startPoint.y));
  dragLine.setAttribute('x2', String(startPoint.x));
  dragLine.setAttribute('y2', String(startPoint.y));
  dragLine.setAttribute('stroke', '#059669');
  dragLine.setAttribute('stroke-width', '2');
  dragLine.setAttribute('stroke-dasharray', '5,5');
  dragLine.setAttribute('opacity', '0.8');
  dragLine.style.pointerEvents = 'none';
  dragLine.setAttribute('class', 'new-connection-drag-line');
  
  svg.appendChild(dragLine);
  return dragLine;
};

// 🛠️ 更新新连线拖拽线
const updateNewConnectionLine = (dragLine: SVGLineElement, endPoint: {x: number, y: number}) => {
  dragLine.setAttribute('x2', String(endPoint.x));
  dragLine.setAttribute('y2', String(endPoint.y));
};

// 🛠️ 辅助函数
const generateNextNodeId = () => {
  // 简单的节点ID生成（实际应用中可能需要更复杂的逻辑）
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const existingNodes = document.querySelectorAll('g[id*="flowchart-"]');
  const existingIds = Array.from(existingNodes).map(node => {
    const match = node.id.match(/flowchart-([A-Z]+)-/);
    return match ? match[1] : '';
  }).filter(id => id.length === 1);
  
  for (const char of chars) {
    if (!existingIds.includes(char)) {
      return char;
    }
  }
  
  // 如果单字母用完，使用双字母
  return chars[Math.floor(Math.random() * chars.length)] + chars[Math.floor(Math.random() * chars.length)];
};

const findTargetNodeUnderMouseGlobal = (svg: SVGElement, mouseX: number, mouseY: number, diagramType: DiagramType = 'flowchart') => {
  // 根据图表类型使用相应的配置选择器
  const config = DIAGRAM_CONFIGS[diagramType as keyof typeof DIAGRAM_CONFIGS];
  const selector = config ? config.nodeSelector : 'g[id*="flowchart-"]';
  
  const nodeGroups = svg.querySelectorAll(selector);
  
  for (const nodeGroup of nodeGroups) {
    const element = nodeGroup as SVGElement;
    const rect = element.getBoundingClientRect();
    
    if (mouseX >= rect.left && mouseX <= rect.right && 
        mouseY >= rect.top && mouseY <= rect.bottom) {
      return element;
    }
  }
  
  return null;
};


const highlightPotentialTarget = (svg: SVGElement, targetNode: SVGElement | null, dragStartNode: any, diagramType: DiagramType = 'flowchart', mousePos?: { x: number, y: number }) => {
  clearAllHighlights(svg);
  
  if (targetNode && dragStartNode) {
    const targetInfo = analyzeMermaidNode(targetNode, diagramType);
    if (targetInfo.mermaidId !== dragStartNode.mermaidId) {
      // 有效目标节点：绿色高亮
      targetNode.style.outline = '2px solid #059669';
      targetNode.style.outlineOffset = '3px';
      targetNode.style.boxShadow = '0 0 8px rgba(5, 150, 105, 0.4)';
      targetNode.classList.add('new-connection-target');
    } else {
      // 无效目标节点（自连接）：红色警告高亮
      targetNode.style.outline = '2px solid #dc2626';
      targetNode.style.outlineOffset = '3px';
      targetNode.style.boxShadow = '0 0 8px rgba(220, 38, 38, 0.4)';
      targetNode.classList.add('invalid-connection-target');
    }
  } else if (mousePos && dragStartNode) {
    // 空白区域：显示新节点预览
    showNewNodePreview(svg, mousePos, diagramType);
  }
};

const clearAllHighlights = (svg: SVGElement) => {
  // 清理节点高亮
  const highlighted = svg.querySelectorAll('.new-connection-target, .drag-target-highlight, .invalid-connection-target');
  highlighted.forEach(el => {
    const element = el as SVGElement;
    element.style.outline = '';
    element.style.outlineOffset = '';
    element.style.boxShadow = '';
    element.classList.remove('new-connection-target', 'drag-target-highlight', 'invalid-connection-target');
  });
  
  // 清理新节点预览
  const previews = svg.querySelectorAll('.new-node-preview');
  previews.forEach(preview => preview.remove());
};

// 🎯 显示新节点预览
const showNewNodePreview = (svg: SVGElement, mousePos: { x: number, y: number }, diagramType: DiagramType) => {
  // 移除之前的预览
  const oldPreviews = svg.querySelectorAll('.new-node-preview');
  oldPreviews.forEach(preview => preview.remove());
  
  // 转换为SVG坐标
  const svgPos = convertScreenToSVGCoordinatesGlobal(svg, mousePos.x, mousePos.y);
  
  // 创建预览组
  const previewGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  previewGroup.setAttribute('class', 'new-node-preview');
  previewGroup.style.pointerEvents = 'none';
  previewGroup.style.opacity = '0.7';
  
  // 根据图表类型创建不同的预览形状
  let previewShape: SVGElement;
  
  if (diagramType === 'flowchart') {
    // 流程图：矩形预览
    previewShape = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    previewShape.setAttribute('x', String(svgPos.x - 50));
    previewShape.setAttribute('y', String(svgPos.y - 20));
    previewShape.setAttribute('width', '100');
    previewShape.setAttribute('height', '40');
    previewShape.setAttribute('rx', '5');
    previewShape.setAttribute('fill', 'rgba(5, 150, 105, 0.2)');
    previewShape.setAttribute('stroke', '#059669');
    previewShape.setAttribute('stroke-width', '2');
    previewShape.setAttribute('stroke-dasharray', '4,4');
  } else if (diagramType === 'state') {
    // 状态图：圆角矩形预览
    previewShape = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    previewShape.setAttribute('x', String(svgPos.x - 40));
    previewShape.setAttribute('y', String(svgPos.y - 15));
    previewShape.setAttribute('width', '80');
    previewShape.setAttribute('height', '30');
    previewShape.setAttribute('rx', '15');
    previewShape.setAttribute('fill', 'rgba(59, 130, 246, 0.2)');
    previewShape.setAttribute('stroke', '#3b82f6');
    previewShape.setAttribute('stroke-width', '2');
    previewShape.setAttribute('stroke-dasharray', '4,4');
  } else if (diagramType === 'mindmap') {
    // 思维导图：圆形预览
    previewShape = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    previewShape.setAttribute('cx', String(svgPos.x));
    previewShape.setAttribute('cy', String(svgPos.y));
    previewShape.setAttribute('r', '25');
    previewShape.setAttribute('fill', 'rgba(168, 85, 247, 0.2)');
    previewShape.setAttribute('stroke', '#a855f7');
    previewShape.setAttribute('stroke-width', '2');
    previewShape.setAttribute('stroke-dasharray', '4,4');
  } else {
    // 默认：矩形预览
    previewShape = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    previewShape.setAttribute('x', String(svgPos.x - 45));
    previewShape.setAttribute('y', String(svgPos.y - 18));
    previewShape.setAttribute('width', '90');
    previewShape.setAttribute('height', '36');
    previewShape.setAttribute('rx', '3');
    previewShape.setAttribute('fill', 'rgba(107, 114, 128, 0.2)');
    previewShape.setAttribute('stroke', '#6b7280');
    previewShape.setAttribute('stroke-width', '2');
    previewShape.setAttribute('stroke-dasharray', '4,4');
  }
  
  // 创建预览文本
  const previewText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
  previewText.setAttribute('x', String(svgPos.x));
  previewText.setAttribute('y', String(svgPos.y + 5));
  previewText.setAttribute('text-anchor', 'middle');
  previewText.setAttribute('font-size', '12');
  previewText.setAttribute('fill', '#374151');
  previewText.setAttribute('font-family', 'sans-serif');
  previewText.textContent = '新节点';
  
  // 添加动画效果
  const animateOpacity = document.createElementNS('http://www.w3.org/2000/svg', 'animate');
  animateOpacity.setAttribute('attributeName', 'opacity');
  animateOpacity.setAttribute('values', '0.3;0.7;0.3');
  animateOpacity.setAttribute('dur', '1.5s');
  animateOpacity.setAttribute('repeatCount', 'indefinite');
  previewShape.appendChild(animateOpacity);
  
  // 组装预览
  previewGroup.appendChild(previewShape);
  previewGroup.appendChild(previewText);
  svg.appendChild(previewGroup);
};

const createConnectionBetweenNodes = (fromNode: any, toNode: any, onNodeEdit: (nodeId: string, content: string) => void) => {
  
  const connectionInfo = `NEW_CONNECTION:${fromNode.mermaidId}->${toNode.mermaidId}`;
  onNodeEdit('__NEW_CONNECTION__', connectionInfo);
};


const createNewNodeAndConnect = (fromNode: any, position: {x: number, y: number}, onNodeEdit: (nodeId: string, content: string) => void) => {
  
  // 直接创建新节点，无需弹窗
  const newNodeId = generateNextNodeId();
  const defaultContent = 'New node';
  
  
  const nodeAndConnectionInfo = `NEW_NODE_AND_CONNECT:${newNodeId}:${defaultContent}:${fromNode.mermaidId}:${position.x}:${position.y}`;
  onNodeEdit('__NEW_NODE_AND_CONNECT__', nodeAndConnectionInfo);
};

// 🚫 显示自连接警告
const showSelfConnectionWarning = (_: SVGElement, targetNode: SVGElement) => {
  
  // 获取节点位置用于定位警告
  const nodeRect = targetNode.getBoundingClientRect();
  
  // 创建警告提示框
  const warning = document.createElement('div');
  warning.className = 'self-connection-warning';
  warning.style.cssText = `
    position: fixed;
    left: ${nodeRect.left + nodeRect.width / 2 - 80}px;
    top: ${nodeRect.top - 50}px;
    z-index: 10000;
    background: linear-gradient(135deg, #fee2e2, #fecaca);
    border: var(--stroke-2) solid #dc2626;
    border-radius: var(--radius-md);
    padding: var(--space-8) var(--space-12);
    box-shadow: var(--shadow-danger);
    color: #991b1b;
    font-size: 12px;
    font-weight: 600;
    font-family: Inter, system-ui, sans-serif;
    text-align: center;
    min-width: 160px;
    animation: warningPulse 0.5s ease-out;
  `;
  
  warning.innerHTML = `
    <div style="display: flex; align-items: center; gap: var(--space-6);">
      <span style="font-size: 16px;">🚫</span>
      <span>A node cannot connect to itself</span>
    </div>
  `;
  
  document.body.appendChild(warning);
  
  // 添加脉动动画样式
  if (!document.querySelector('#warning-animation-style')) {
    const style = document.createElement('style');
    style.id = 'warning-animation-style';
    style.textContent = `
      @keyframes warningPulse {
        0% {
          opacity: 0;
          transform: scale(0.8) translateY(10px);
        }
        50% {
          transform: scale(1.05) translateY(-5px);
        }
        100% {
          opacity: 1;
          transform: scale(1) translateY(0);
        }
      }
      
      .self-connection-warning {
        transition: opacity 0.3s ease-out;
      }
    `;
    document.head.appendChild(style);
  }
  
  // 节点闪烁红色警告效果
  targetNode.style.animation = 'warningFlash 0.6s ease-in-out';
  targetNode.style.outline = '3px solid #dc2626';
  targetNode.style.outlineOffset = '2px';
  
  // 添加闪烁动画
  if (!document.querySelector('#warning-flash-style')) {
    const flashStyle = document.createElement('style');
    flashStyle.id = 'warning-flash-style';
    flashStyle.textContent = `
      @keyframes warningFlash {
        0%, 100% { 
          filter: none; 
        }
        25%, 75% { 
          filter: drop-shadow(0 0 8px #dc2626); 
        }
        50% { 
          filter: drop-shadow(0 0 12px #dc2626) drop-shadow(0 0 20px #dc2626); 
        }
      }
    `;
    document.head.appendChild(flashStyle);
  }
  
  // 2秒后自动清除警告
  setTimeout(() => {
    if (warning && warning.parentNode) {
      warning.style.opacity = '0';
      setTimeout(() => {
        warning.remove();
      }, 300);
    }
    
    // 清除节点警告样式
    targetNode.style.animation = '';
    targetNode.style.outline = '';
    targetNode.style.outlineOffset = '';
  }, 2000);
  
};

export default MermaidRenderer;
