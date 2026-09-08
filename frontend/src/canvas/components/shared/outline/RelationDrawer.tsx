import React, { useMemo } from 'react';
import type { OutlineNodeRelationDetails, OutlineNodeRelationMap, OutlineRelationLink } from '../../../types/outline';

interface RelationDrawerProps {
  nodeId: string | null;
  relationMap: OutlineNodeRelationMap;
  onClose: () => void;
  onJumpToNode?: (nodeId: string) => void;
}

function LinkRow({
  edge,
  direction,
  onJumpToNode,
}: {
  edge: OutlineRelationLink;
  direction: 'inbound' | 'outbound';
  onJumpToNode?: (nodeId: string) => void;
}) {
  const arrow = direction === 'inbound' ? '←' : '→';
  const disabled = !edge.otherNodeId || edge.dangling;

  return (
    <div className="outline-rel-row">
      <div className="outline-rel-row-main">
        <span className="outline-rel-arrow">{arrow}</span>
        {disabled ? (
          <span className="outline-rel-node outline-rel-node--muted">{edge.otherNodeTitle}</span>
        ) : (
          <button
            className="outline-rel-node"
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              if (!edge.otherNodeId) return;
              onJumpToNode?.(edge.otherNodeId);
            }}
          >
            {edge.otherNodeTitle}
          </button>
        )}
      </div>
      <div className="outline-rel-row-meta">
        {edge.label ? <span className="outline-rel-chip">{edge.label}</span> : null}
        {edge.crossContainer ? <span className="outline-rel-chip">跨容器</span> : null}
        {edge.dangling ? <span className="outline-rel-chip outline-rel-chip--warn">断链</span> : null}
      </div>
    </div>
  );
}

const RelationDrawer: React.FC<RelationDrawerProps> = ({ nodeId, relationMap, onClose, onJumpToNode }) => {
  const details: OutlineNodeRelationDetails | null = useMemo(() => {
    if (!nodeId) return null;
    return relationMap.get(nodeId) || null;
  }, [nodeId, relationMap]);

  if (!details) return null;

  const { summary } = details;
  const hasRelations = summary.inboundCount > 0 || summary.outboundCount > 0;

  return (
    <aside className="outline-relation-drawer outline-no-drag" aria-label="Relation drawer">
      <div className="outline-rel-header">
        <div className="outline-rel-title-wrap">
          <div className="outline-rel-title">{details.nodeTitle}</div>
          <div className="outline-rel-subtitle">{details.nodeId}</div>
        </div>
        <button className="outline-rel-close" onClick={onClose} aria-label="Close relation drawer">
          ✕
        </button>
      </div>

      <div className="outline-rel-summary">
        <span className="outline-rel-chip">↑ {summary.inboundCount}</span>
        <span className="outline-rel-chip">↓ {summary.outboundCount}</span>
        <span className="outline-rel-chip">↔ {summary.crossContainerCount}</span>
        {(summary.danglingInboundCount + summary.danglingOutboundCount) > 0 ? (
          <span className="outline-rel-chip outline-rel-chip--warn">
            ⚠ {summary.danglingInboundCount + summary.danglingOutboundCount}
          </span>
        ) : null}
      </div>

      {!hasRelations ? (
        <div className="outline-rel-empty">暂无关系</div>
      ) : (
        <div className="outline-rel-sections">
          <section className="outline-rel-section">
            <div className="outline-rel-section-title">入边（Inbound）</div>
            {details.inbound.length === 0 ? (
              <div className="outline-rel-empty-inline">无入边</div>
            ) : (
              <div className="outline-rel-list">
                {details.inbound.map((edge) => (
                  <LinkRow key={`in-${edge.edgeId}-${edge.otherNodeId || edge.otherNodeTitle}`} edge={edge} direction="inbound" onJumpToNode={onJumpToNode} />
                ))}
              </div>
            )}
          </section>

          <section className="outline-rel-section">
            <div className="outline-rel-section-title">出边（Outbound）</div>
            {details.outbound.length === 0 ? (
              <div className="outline-rel-empty-inline">无出边</div>
            ) : (
              <div className="outline-rel-list">
                {details.outbound.map((edge) => (
                  <LinkRow key={`out-${edge.edgeId}-${edge.otherNodeId || edge.otherNodeTitle}`} edge={edge} direction="outbound" onJumpToNode={onJumpToNode} />
                ))}
              </div>
            )}
          </section>
        </div>
      )}
    </aside>
  );
};

export default RelationDrawer;
