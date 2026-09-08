// 📝 文本节点组件
// 重构为使用TextNodeCore的轻量包装器

import React from 'react';
import TextNodeCore from '../shared/TextNodeCore';
import type { Canvas, CanvasNode, FontStyle, NodeStyles, CornerStyle } from '../../../../types/canvas';

type TextNodeType = CanvasNode & { type: 'text' };

interface TextNodeProps {
  node: TextNodeType;
  editing?: boolean;
  selected?: boolean;
  fontStyle?: FontStyle;
  nodeStyles?: NodeStyles; // 🎨 添加节点样式支持
  cornerStyle?: CornerStyle; // 🎨 添加圆角样式支持
  onContentChange?: (nodeId: string, content: string) => void;
  onEditToggle?: (nodeId: string, editing: boolean) => void;
  onRequestExpandedEdit?: (nodeId: string) => void;
}

export const TextNode: React.FC<TextNodeProps> = ({
  node,
  editing = false,
  selected = false,
  fontStyle,
  nodeStyles,
  cornerStyle, // 🎨 接收圆角样式
  onContentChange,
  onEditToggle,
  onRequestExpandedEdit,
}) => {
  // 🎯 TextNode现在是TextNodeCore的简单包装器
  // 保持完全相同的接口，零功能变化
  return (
    <TextNodeCore
      node={node}
      editing={editing}
      selected={selected}
      fontStyle={fontStyle}
      nodeStyles={nodeStyles}
      cornerStyle={cornerStyle} // 🎨 传递圆角样式给装饰条
      onContentChange={onContentChange}
      onEditToggle={onEditToggle}
      onRequestExpandedEdit={onRequestExpandedEdit}
      // 不传递renderPrefix - 保持TextNode的原始布局
      // 不传递completedStyle - TextNode不需要完成状态样式
    />
  );
};

export default TextNode;
