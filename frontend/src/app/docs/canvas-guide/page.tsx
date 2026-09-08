'use client';

import { DocsBody, DocsHeader } from '@/components/ui/docs-index';
import { useRouter } from '@/i18n/routing';

export default function CanvasGuidePage() {
  const router = useRouter();
  const breadcrumbs = [
    { title: 'Docs', onClick: () => router.push('/docs') },
    { title: '画布使用指南' },
  ];

  return (
    <>
      <DocsHeader
        title="画布使用指南"
        subtitle="用最少的步骤完成最多的事"
        breadcrumbs={breadcrumbs}
        lastUpdated="2026-02-02"
        showSeparator
        size="lg"
        className="mb-8 sm:mb-12"
      />

      <DocsBody className="mb-8">
        <h2 id="quick-start">快速上手</h2>
        <ul>
          <li>滚轮或触控板缩放；按住空格拖动画布。</li>
          <li>双击卡片开始编辑，点击空白处结束编辑。</li>
          <li>顶部标题可双击改名。</li>
        </ul>

        <h2 id="ui-overview">界面入口</h2>
        <ul>
          <li>左侧：工具栏（选择/拖动/连线/文本/代码/录音/样式）。</li>
          <li>顶部：分享、协作、大纲、播放、截图、素材库、AI。</li>
          <li>右下角：缩放、小地图、居中、锁定画布、对齐吸附。</li>
        </ul>

        <h2 id="create">创建内容</h2>
        <h3 id="create-drag">方式 A：拖拽创建</h3>
        <ul>
          <li>文本、待办、表格、列。</li>
          <li>Mermaid 图表、HTML、画布链接。</li>
          <li>麦克风：拖入后即可录音。</li>
        </ul>
        <h3 id="create-context">方式 B：右键创建</h3>
        <p>在空白处右键，快速新建常用卡片。</p>
        <h3 id="create-paste">方式 C：拖入/粘贴</h3>
        <ul>
          <li>拖入图片、视频、音频、PDF/Office 文档，自动生成媒体卡片。</li>
          <li>粘贴图片或视频链接（如 YouTube/哔哩哔哩）也可直接生成卡片。</li>
        </ul>

        <h2 id="edit">编辑与整理</h2>
        <ul>
          <li>单击选中，拖动移动；Shift 多选或拖框选。</li>
          <li>Delete/Backspace 删除；Ctrl/⌘ + D 复制。</li>
          <li>多选后会出现对齐/分布工具，快速排版。</li>
        </ul>

        <h2 id="connections">连线与关系</h2>
        <ul>
          <li>选择“连线”工具，从一个卡片拖到另一个卡片即可连接。</li>
          <li>选中连线可改文字、颜色、虚线和箭头。</li>
        </ul>

        <h2 id="groups">分组与思维导图</h2>
        <ul>
          <li>多选后右键“成组”，可命名、移动、改样式。</li>
          <li>组可切换为“思维导图”，支持右侧/双侧布局。</li>
          <li>思维导图快捷扩展：Tab 添加子节点，Enter 添加同级节点。</li>
          <li>在“对话模式”下，用 Shift + Tab 添加子节点。</li>
        </ul>

        <h2 id="tables-columns">表格与列</h2>
        <ul>
          <li>表格单元格可直接编辑，右键增删行列。</li>
          <li>“列”适合做清单/看板，把卡片拖进列里会自动对齐。</li>
        </ul>

        <h2 id="styles">样式与美化</h2>
        <ul>
          <li>选中卡片后左侧出现样式面板，可改颜色、字体、圆角等。</li>
          <li>左侧“调色板”可设置画布背景。</li>
          <li>右下角“磁铁”开关可控制智能对齐吸附。</li>
        </ul>

        <h2 id="outline">大纲视图</h2>
        <ul>
          <li>顶部“大纲”按钮可打开大纲面板。</li>
          <li>可快速定位卡片、改标题、勾选待办。</li>
        </ul>

        <h2 id="ai">AI 助手</h2>
        <ul>
          <li>顶部“AI”打开右侧助手。</li>
          <li>切到“对话模式”，选中内容后会出现 Chat 输入框。</li>
        </ul>

        <h2 id="playback-screenshot">演示与截图</h2>
        <ul>
          <li>顶部“播放”可自动巡游展示，支持速度与循环。</li>
          <li>顶部“相机”截图，可选比例并下载。</li>
        </ul>

        <h2 id="share">分享与协作</h2>
        <ul>
          <li>“分享”生成只读链接。</li>
          <li>“协作”生成可编辑链接（可能需要登录或邀请码）。</li>
          <li>管理员可在高级设置里发布模板或展示 AI 时间线。</li>
        </ul>

        <h2 id="autosave">自动保存</h2>
        <ul>
          <li>画布自动保存，无需手动操作。</li>
          <li>断网/关闭后会自动保留草稿，可在恢复提示中一键找回。</li>
        </ul>

        <h2 id="shortcuts">常用快捷键</h2>
        <ul>
          <li><strong>V</strong>：选择模式</li>
          <li><strong>H</strong>：拖动画布（手型）</li>
          <li><strong>空格</strong>：按住临时拖动画布</li>
          <li><strong>Ctrl/⌘ + Z</strong>：撤销</li>
          <li><strong>Ctrl/⌘ + Y</strong> 或 <strong>Ctrl/⌘ + Shift + Z</strong>：重做</li>
          <li><strong>Ctrl/⌘ + A</strong>：全选</li>
          <li><strong>Ctrl/⌘ + D</strong>：复制</li>
          <li><strong>Ctrl/⌘ + S</strong>：保存</li>
          <li><strong>Delete/Backspace</strong>：删除</li>
        </ul>
      </DocsBody>
    </>
  );
}
