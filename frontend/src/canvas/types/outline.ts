import type { CanvasNode } from './canvas';

export interface OutlineNodeRelationSummary {
  nodeId: string;
  inboundCount: number;
  outboundCount: number;
  crossContainerCount: number;
  danglingInboundCount: number;
  danglingOutboundCount: number;
}

export interface OutlineRelationLink {
  edgeId: string;
  label?: string;
  otherNodeId?: string;
  otherNodeTitle: string;
  crossContainer: boolean;
  dangling: boolean;
  otherNodeType?: CanvasNode['type'];
}

export interface OutlineNodeRelationDetails {
  nodeId: string;
  nodeTitle: string;
  inbound: OutlineRelationLink[];
  outbound: OutlineRelationLink[];
  summary: OutlineNodeRelationSummary;
}

export type OutlineNodeRelationMap = Map<string, OutlineNodeRelationDetails>;
