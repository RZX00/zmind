// 🎨 SVG 节点编辑器 - 纯图形交互模式
// 类似 Mermaid 节点，只显示图形，通过直接交互编辑

import React, { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import SvgRenderer from '../svg/SvgRenderer';
import SvgInteractionLayer from '../svg/SvgInteractionLayer';
import SvgElementSelector from '../svg/SvgElementSelector';
import SvgTextEditor from '../svg/SvgTextEditor';
import type { SvgNode, SvgThemeConfig, FontStyle, CornerStyle } from '../../types/canvas';
import { parseSvgContent, type SvgElement } from '../svg/utils/svgParser';
import { updateElementTextContent, ensureElementIds } from '../svg/utils/svgModifier';
import { useViewTransform } from '../../hooks/useCanvasSelector';
import { useTheme } from 'next-themes';

interface SvgNodeEditorProps {
  node: SvgNode;
  editing?: boolean;
  selected?: boolean;
  fontStyle?: FontStyle;
  cornerStyle?: CornerStyle;
  onContentChange?: (nodeId: string, content: string) => void;
  onEditToggle?: (nodeId: string, editing: boolean) => void;
  onSelect?: (nodeId: string, multiSelect?: boolean) => void;
}

// 🎨 获取默认 SVG 主题
const getDefaultSvgTheme = (isDark: boolean): SvgThemeConfig => ({
  colorScheme: isDark ? 'dark' : 'light',
  colors: {
    primary: '#3b82f6',
    secondary: '#8b5cf6',
    background: isDark ? '#111827' : '#ffffff',
    stroke: isDark ? '#E5E7EB' : '#1f2937',
    fill: '#3b82f6'
  }
});

export const SvgNodeEditor: React.FC<SvgNodeEditorProps> = ({
  node,
  editing = false,
  selected = false,
  fontStyle,
  cornerStyle,
  onContentChange,
  onEditToggle,
  onSelect
}) => {
  // 🎯 本地内容状态
  const [localContent, setLocalContent] = useState(node.content);
  const allowEditing = true;

  // 🎯 元素选择状态
  const [selectedElementIds, setSelectedElementIds] = useState<string[]>([]);

  // 🎯 文字编辑状态
  const [editingTextElement, setEditingTextElement] = useState<SvgElement | null>(null);

  // 容器引用
  const containerRef = useRef<HTMLDivElement>(null);
  const [svgRoot, setSvgRoot] = useState<SVGSVGElement | null>(null);
  const viewTransform = useViewTransform();
  const viewScale = viewTransform?.scale || 1;
  const { resolvedTheme } = useTheme();
  
  // 使用 useCallback 避免每次渲染都创建新函数，防止无限循环
  const handleSvgElementReady = useCallback((svg: SVGSVGElement) => {
    setSvgRoot(svg);
  }, []);

  const svgTheme = useMemo(
    () => node.svgTheme || getDefaultSvgTheme(resolvedTheme === 'dark'),
    [node.svgTheme, resolvedTheme]
  );

  // 🎯 解析SVG元素
  const svgElements = useMemo(() => {
    if (!localContent || !allowEditing) return [];
    return parseSvgContent(localContent);
  }, [localContent, allowEditing]);

  // 确保 SVG 元素具有稳定的 id（用于交互与高亮）
  useEffect(() => {
    if (!allowEditing) return;
    try {
      const res = ensureElementIds(localContent);
      if (res.newIds && res.newIds.length > 0 && res.code && res.code !== localContent) {
        setLocalContent(res.code);
        onContentChange?.(node.id, res.code);
      }
    } catch {}
    // 仅在内容变化后检查一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [node.id]);

  // 同步外部内容变化
  useEffect(() => {
    if (node.content !== localContent) {
      setLocalContent(node.content);
      // 清空选择和编辑状态
      setSelectedElementIds([]);
      setEditingTextElement(null);
    }
  }, [node.content, localContent]);

  // 🎯 元素选择处理
  const handleElementSelect = useCallback((elementId: string, multiSelect: boolean) => {
    if (!allowEditing) return;
    if (!elementId) {
      // 清空选择
      setSelectedElementIds([]);
      setEditingTextElement(null);
      return;
    }

    // 单选模式
    setSelectedElementIds([elementId]);

    // 🎯 如果点击的是文字元素，立即进入编辑模式
    const element = svgElements.find(el => el.id === elementId);
    if (element && element.type === 'text') {
      console.log('✏️ 点击文字元素，立即进入编辑模式:', elementId);
      setEditingTextElement(element);
    } else {
      setEditingTextElement(null);
    }
  }, [allowEditing, svgElements]);

  // 🎯 元素双击处理（不再需要，点击即编辑）
  const handleElementDoubleClick = useCallback((elementId: string) => {
    // 文字元素已经在点击时进入编辑模式，这里不需要额外处理
  }, []);

  // 🎯 文字保存
  const handleTextSave = useCallback((elementId: string, newText: string) => {

    // 更新 SVG 代码
    const updatedCode = updateElementTextContent(localContent, elementId, newText);


    setLocalContent(updatedCode);

    // 立即保存到节点
    onContentChange?.(node.id, updatedCode);

    // 退出编辑模式
    setEditingTextElement(null);
  }, [localContent, node.id, onContentChange]);

  //（已移除属性编辑功能）

  // 🎯 文字编辑取消
  const handleTextCancel = useCallback(() => {
    console.log('❌ 取消文字编辑');
    setEditingTextElement(null);
  }, []);

  // 双击节点本身（非元素）的处理 - 不做任何事情，保持图形模式
  const handleNodeDoubleClick = useCallback((event: React.MouseEvent) => {
    // 不需要进入代码编辑模式
    event.preventDefault();
    event.stopPropagation();
  }, []);

  // 获取当前选中的元素
  const selectedElement = useMemo(() => {
    if (selectedElementIds.length === 1) {
      return svgElements.find(el => el.id === selectedElementIds[0]) || null;
    }
    return null;
  }, [svgElements, selectedElementIds]);

  return (
    <div className="w-full h-full relative">
      <div
        ref={containerRef}
        className="w-full h-full relative cursor-pointer hover:bg-accent/30 transition-colors p-4"
        onDoubleClick={handleNodeDoubleClick}
        onClick={() => onSelect?.(node.id, false)}
      >
        {/* SVG 渲染 */}
        <SvgRenderer
          content={localContent}
          theme={svgTheme}
          interactive={allowEditing}
          onSvgElementReady={handleSvgElementReady}
        />

        {/* 交互层（仅在节点被选中时启用） */}
        {selected && allowEditing && svgElements.length > 0 && !editingTextElement && (
          <>
            <SvgInteractionLayer
              containerRef={containerRef}
              svgElements={svgElements}
              selectedElementIds={selectedElementIds}
              onElementSelect={handleElementSelect}
              onElementDoubleClick={handleElementDoubleClick}
              enabled={true}
            />

            <SvgElementSelector
              elements={svgElements}
              selectedIds={selectedElementIds}
              containerRef={containerRef}
              svgRoot={svgRoot}
              viewScale={viewScale}
            />
          </>
        )}

        {/* 文字编辑器（原位置编辑） */}
        {allowEditing && editingTextElement && (
          <SvgTextEditor
            element={editingTextElement}
            containerRef={containerRef}
            onSave={handleTextSave}
            onCancel={handleTextCancel}
          />
        )}
      </div>

      {/* 属性编辑面板已移除 */}

      {/* 选中状态提示已移除 */}
    </div>
  );
};

export default SvgNodeEditor;
