import React from 'react';
import type { Canvas } from '../../types/canvas';
import OutlineItem from './OutlineItem';
import type { OutlineTreeNode, LinkExpansion } from '../../stores/outlineSelectors';
import type { OutlineNodeRelationMap, OutlineNodeRelationSummary } from '../../types/outline';

interface OutlineTreeGroupProps {
  canvas: Canvas;
  node: OutlineTreeNode;
  collapsed: Record<string, boolean>;
  expansions: Map<string, LinkExpansion>;
  relationMap: OutlineNodeRelationMap;
  onToggle: (id: string) => void;
  onToggleTodo: (id: string, completed: boolean) => void;
  onEditTitle: (id: string, title: string) => void;
  onJump: (id: string) => void;
  onOpenRelations: (id: string) => void;
  allowEdit?: boolean;
}

function formatRelationBadge(summary: OutlineNodeRelationSummary): string {
  const parts = [`↑${summary.inboundCount}`, `↓${summary.outboundCount}`];
  if (summary.crossContainerCount > 0) parts.push(`↔${summary.crossContainerCount}`);
  if ((summary.danglingInboundCount + summary.danglingOutboundCount) > 0) {
    parts.push(`⚠${summary.danglingInboundCount + summary.danglingOutboundCount}`);
  }
  return parts.join(' ');
}

const OutlineTreeGroup: React.FC<OutlineTreeGroupProps> = ({ canvas, node, collapsed, expansions, relationMap, onToggle, onToggleTodo, onEditTitle, onJump, onOpenRelations, allowEdit = true }) => {
  const hasChildren = node.children && node.children.length > 0;
  const isCollapsed = !!collapsed[node.id];
  const typeForItem: 'heading' | 'note' | 'todo' = node.kind === 'todo' ? 'todo' : (node.kind === 'container' ? 'heading' : 'note');
  const expansion = expansions.get(node.id);
  const relationSummary = relationMap.get(node.id)?.summary;
  const shouldShowRelationBadge = !!relationSummary && (
    relationSummary.inboundCount > 0
    || relationSummary.outboundCount > 0
    || relationSummary.danglingInboundCount > 0
    || relationSummary.danglingOutboundCount > 0
  );

  return (
    <div>
      {/* 简化：仅渲染内容行，不显示左侧点与竖线 */}
      <div
        className={`outline-row ${node.kind === 'container' ? 'is-heading' : ''} outline-depth-${node.depth}`}
        data-collapsed={isCollapsed ? 'true' : 'false'}
        onClick={(e) => {
          const target = e.target as HTMLElement;
          if (target.tagName === 'BUTTON' || target.closest('button')) return;
          onJump(node.id);
        }}
      >
        {hasChildren && (
          <button
            className="mr-2 text-xs text-muted-foreground hover:text-foreground"
            onClick={(e) => { e.stopPropagation(); onToggle(node.id); }}
            aria-label={isCollapsed ? 'Expand' : 'Collapse'}
          >
            {isCollapsed ? '▶' : '▼'}
          </button>
        )}
        <div className="outline-content">
            <OutlineItem
              canvas={canvas}
              id={node.id}
              type={typeForItem}
              depth={node.depth}
              title={node.title}
              expansion={expansion}
              allowEdit={allowEdit}

              onToggleTodo={onToggleTodo}
              onEditTitle={onEditTitle}
              onJumpToNode={onJump}
            />
        </div>
        {shouldShowRelationBadge && relationSummary ? (
          <button
            className="outline-rel-badge"
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              onOpenRelations(node.id);
            }}
            aria-label="Open relation details"
            title="Open relation details"
          >
            {formatRelationBadge(relationSummary)}
          </button>
        ) : null}
      </div>
      {/* 子项：不再使用引导线容器 */}
      {hasChildren && !isCollapsed && (
        <div className={node.kind === 'container' ? 'outline-guide-layer container-guide' : ''}>
          {node.children.map(child => (
            <OutlineTreeGroup
              key={child.id}
              canvas={canvas}
              node={child}
              collapsed={collapsed}
              expansions={expansions}
              relationMap={relationMap}
              onToggle={onToggle}
              onToggleTodo={onToggleTodo}
              onEditTitle={onEditTitle}
              onJump={onJump}
              onOpenRelations={onOpenRelations}
              allowEdit={allowEdit}
            />
          ))}
        </div>
      )}
    </div>
  );
};

export default OutlineTreeGroup;
