// 🎯 ZhenZhi原版节点默认尺寸配置
const DEFAULT_NODE_SIZES = {
  text: { width: 300, height: 60 },
  todo: { width: 300, height: 60 },
  mermaid: { width: 350, height: 250 },
  html: { width: 650, height: 540 },
  svg: { width: 400, height: 400 }, // SVG节点默认尺寸（正方形）
  column: { width: 300, height: 200 },
  table: { width: 400, height: 130 },
  'canvas-link': { width: 280, height: 180 },
  media: { width: 240, height: 160 },
  code: { width: 350, height: 200 } // 代码节点默认尺寸
} as const;

// 🎯 获取节点默认尺寸 - 支持不同节点类型
export const getDefaultNodeSize = (type: string, codeType?: string) => {
  // 特殊处理code节点的子类型
  if (type === 'code' && codeType) {
    if (codeType === 'mermaid') {
      return DEFAULT_NODE_SIZES.mermaid;
    }
    if (codeType === 'html') {
      return DEFAULT_NODE_SIZES.html;
    }
    if (codeType === 'svg') {
      return DEFAULT_NODE_SIZES.svg;
    }
  }

  // 返回对应类型的默认尺寸，如果没有找到则使用text的默认尺寸
  return DEFAULT_NODE_SIZES[type as keyof typeof DEFAULT_NODE_SIZES] || DEFAULT_NODE_SIZES.text;
};

// 🎯 获取节点默认内容 - 为HTML和Mermaid提供有意义的默认内容
export const getDefaultNodeContent = (type: string, codeType?: string) => {
  switch (type) {
    case 'text':
      return '';
    case 'todo':
      return '';
    case 'code':
      if (codeType === 'mermaid') {
        return `graph TD
    A[节点A] --> B[节点B]`;
      }
      if (codeType === 'html') {
        return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>Mini Landing</title>
  <style>
    :root {
      --bg: #f7f7f7;
      --fg: #111;
      --muted: #666;
      --card: #fff;
      --ring: #0ea5e9;
      --radius-xs: 4px;
      --radius-sm: 6px;
      --radius-md: 8px;
      --radius-lg: 10px;
      --radius-xl: 12px;
      --radius-2xl: 16px;
      --radius-full: 9999px;
    }
    [data-theme="dark"] { --bg:#0b0c0e; --fg:#eaeaea; --muted:#9aa0a6; --card:#14161a; --ring:#38bdf8; }
    * { box-sizing: border-box; }
    body {
      margin: 0; font: 16px/1.6 system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
      background: var(--bg); color: var(--fg);
      display: grid; min-height: 100svh; place-items: center; padding: 24px;
    }
    .wrap { width: min(880px, 100%); }
    .nav {
      display:flex; justify-content: space-between; align-items:center; gap:12px; margin-bottom: 20px;
    }
    .brand { font-weight:700; letter-spacing:.4px; }
    .btn {
      padding: 8px 14px; border:1px solid color-mix(in oklab, var(--fg) 20%, transparent);
      background: transparent; color: var(--fg); border-radius: var(--radius-xl); cursor: pointer;
    }
    .btn:focus-visible { outline: 3px solid var(--ring); outline-offset: 2px; }
    .hero {
      border: 1px solid color-mix(in oklab, var(--fg) 12%, transparent);
      background: var(--card); border-radius: var(--radius-2xl); padding: 28px;
      display:grid; gap:16px;
      box-shadow: 0 8px 30px color-mix(in oklab, #000 18%, transparent);
    }
    h1 { margin:0; font-size: clamp(26px, 4vw, 40px); line-height:1.2; }
    p.lead { margin:0; color: var(--muted); font-size: clamp(14px, 2.5vw, 18px); }
    .grid { display:grid; gap:12px; grid-template-columns: repeat(auto-fit, minmax(220px,1fr)); margin-top: 8px; }
    .card {
      border:1px dashed color-mix(in oklab, var(--fg) 18%, transparent);
      border-radius: var(--radius-xl); padding:14px; background: color-mix(in oklab, var(--card) 92%, var(--bg));
    }
    .card h3 { margin:0 0 6px; font-size: 16px; }
    .card p { margin:0; color: var(--muted); font-size:14px; }
    .cta { display:flex; gap:10px; flex-wrap:wrap; margin-top: 8px; }
    .primary {
      background: var(--fg); color: var(--bg); border: none;
    }
    footer { margin-top: 16px; color: var(--muted); font-size: 12px; text-align:center; }
  </style>
</head>
<body>
  <div class="wrap">
    <header class="nav" aria-label="Top navigation">
      <div class="brand">Thinking Studio</div>
      <button class="btn" id="themeBtn" aria-pressed="false" aria-label="Toggle theme">Toggle Theme</button>
    </header>

    <main class="hero" role="main">
      <h1>Think Clearly</h1>
      <p class="lead">Structure your reasoning on a clean canvas.</p>

      <section class="grid" aria-label="Highlights">
        <article class="card">
          <h3>Visualize</h3>
          <p>Present chains of thought with nodes and links.</p>
        </article>
        <article class="card">
          <h3>Reflect</h3>
          <p>Capture premises, counterexamples, and evidence.</p>
        </article>
        <article class="card">
          <h3>Collaborate</h3>
          <p>Edit and discuss in parallel with others.</p>
        </article>
        <article class="card">
          <h3>Export</h3>
          <p>Export to PDF/Markdown with one click.</p>
        </article>
      </section>

      <div class="cta">
        <button class="btn primary">Get Started</button>
        <button class="btn">Learn More</button>
      </div>
    </main>

    <footer>© 2025 Thinking Studio. All rights reserved.</footer>
  </div>

  <script>
    // Theme toggle with localStorage
    (function() {
      const KEY = "theme";
      const root = document.documentElement;
      const btn = document.getElementById("themeBtn");
      const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
      const saved = localStorage.getItem(KEY);
      const initial = saved || (prefersDark ? "dark" : "light");
      root.setAttribute("data-theme", initial);
      btn.setAttribute("aria-pressed", String(initial === "dark"));
      btn.addEventListener("click", () => {
        const next = root.getAttribute("data-theme") === "dark" ? "light" : "dark";
        root.setAttribute("data-theme", next);
        localStorage.setItem(KEY, next);
        btn.setAttribute("aria-pressed", String(next === "dark"));
      });
    })();
  </script>
</body>
</html>`;
      }
      if (codeType === 'svg') {
        return `<svg viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg">
  <!-- SVG 画布 -->
  <defs>
    <linearGradient id="grad1" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:#3b82f6;stop-opacity:1" />
      <stop offset="100%" style="stop-color:#8b5cf6;stop-opacity:1" />
    </linearGradient>
  </defs>

  <!-- 背景矩形 -->
  <rect x="10" y="10" width="180" height="180"
        fill="url(#grad1)" rx="20" opacity="0.1" />

  <!-- 主形状 -->
  <rect x="50" y="50" width="100" height="100"
        fill="#3b82f6" rx="10" />

  <!-- 装饰圆 -->
  <circle cx="100" cy="100" r="30"
        fill="#ffffff" opacity="0.8" />

  <!-- 文本 -->
  <text x="100" y="180"
        text-anchor="middle"
        font-family="system-ui, sans-serif"
        font-size="16"
        fill="#1f2937">
    SVG 节点
  </text>
</svg>`;
      }
      return '';
    case 'table':
      return '';
    case 'html':
      return ''; // HTML内容在code + codeType='html'中处理
    case 'canvas-link':
      return '';
    default:
      return '';
  }
};

// 🎯 获取节点默认标题
export const getDefaultNodeTitle = (type: string) => {
  // 仅为需要展示独立标题的节点提供默认标题。
  // 其余类型（text/todo/code/table/media/column/mermaid）不返回默认标题，避免生成无必要的 title 字段。
  switch (type) {
    case 'canvas-link':
      return 'Canvas Link';
    default:
      return undefined as unknown as string; // 明确表示无默认标题
  }
};

// 🎯 获取节点类型特定默认值
export const getNodeTypeSpecificDefaults = (type: string, codeType?: string) => {
  switch (type) {
    case 'todo':
      return { completed: false };
    case 'code':
      // 为Mermaid节点设置默认的 Macarons 主题（与样式面板最后一项保持一致）
      if (codeType === 'mermaid') {
        return {
          mermaidThemeId: 'echarts-macarons',
          mermaidTheme: {
            theme: 'base',
            look: 'neo',
            themeVariables: {
              primaryColor: '#e98a36',
              primaryTextColor: '#4b2e1f',
              primaryBorderColor: '#f5c29b',
              lineColor: '#e98a36',
              secondaryColor: '#fff0e3',
              tertiaryColor: '#ffffff',
              background: '#ffffff',
              mainBkg: '#ffe7d1',
              secondaryBkgColor: '#fff7ef',
              nodeBkg: '#ffffff',
              nodeBorder: '#e98a36',
              clusterBkg: '#fff0e3',
              clusterBorder: '#f5c29b',
              fontFamily: '"Nunito", system-ui, sans-serif',
              fontSize: '14px'
            }
          }
        };
      }
      // 为SVG节点设置默认主题
      if (codeType === 'svg') {
        return {
          svgTheme: {
            colorScheme: 'light',
            colors: {
              primary: '#3b82f6',
              secondary: '#8b5cf6',
              background: '#ffffff',
              stroke: '#1f2937',
              fill: '#3b82f6'
            }
          },
          svgMetadata: {
            viewBox: '0 0 200 200',
            preserveAspectRatio: 'xMidYMid meet'
          },
          svgBgMode: 'transparent'
        };
      }
      return {};
    case 'table':
      return {
        data: {
          rows: [
            ['Header 1', 'Header 2'],
            ['', '']
          ],
          columnWidths: [160, 160],
          rowHeights: [40, 40]
        }
      };
    case 'canvas-link':
      return {
        targetCanvasId: null,
        thumbnailUrl: null,
        lastSyncedAt: null
      };
    default:
      return {};
  }
};
