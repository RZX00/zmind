'use client';

import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  FileWarning,
  ShieldCheck,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export type ResearchPublicationPayload = {
  status?: string;
  kb_entry_id?: string | null;
  kb_folder_id?: string | null;
  kb_filename?: string | null;
  canvas_id?: string | null;
  canvas_group_node_id?: string | null;
  canvas_node_ids?: string[];
  warnings?: string[];
  errors?: string[];
};

export type ResearchVerificationPayload = {
  claims?: Array<Record<string, any>>;
  claim_verdicts?: Array<Record<string, any>>;
  evidence_graph?: Array<Record<string, any>>;
  conflicts?: Array<Record<string, any>>;
  confidence_scores?: Array<Record<string, any>>;
  citation_issues?: Array<Record<string, any>>;
  citation_coverage?: Record<string, any>;
  verification_summary?: string;
};

type ClaimDigest = {
  claimId: string;
  text: string;
  status: string;
  confidence: string;
};

const STATUS_META: Record<string, { label: string; tone: string; dot: string; icon: React.ReactNode }> = {
  published: {
    label: '研究结果已发布',
    tone: 'text-emerald-700 dark:text-emerald-300',
    dot: 'bg-emerald-500/90',
    icon: <CheckCircle2 className="h-4 w-4" />,
  },
  partial: {
    label: '部分发布成功',
    tone: 'text-amber-700 dark:text-amber-300',
    dot: 'bg-amber-500/90',
    icon: <AlertTriangle className="h-4 w-4" />,
  },
  failed: {
    label: '发布失败',
    tone: 'text-destructive',
    dot: 'bg-destructive/90',
    icon: <FileWarning className="h-4 w-4" />,
  },
  skipped: {
    label: '本次未发布',
    tone: 'text-muted-foreground',
    dot: 'bg-muted-foreground/70',
    icon: <AlertTriangle className="h-4 w-4" />,
  },
};

const toInt = (value: unknown, fallback = 0): number => {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
};

const normalizeStatus = (value: unknown): string => {
  if (typeof value !== 'string') return 'skipped';
  const trimmed = value.trim().toLowerCase();
  return trimmed || 'skipped';
};

const prettyConfidence = (value: unknown): string => {
  if (typeof value !== 'string') return 'unknown';
  const lowered = value.trim().toLowerCase();
  if (!lowered) return 'unknown';
  if (['high', 'medium', 'low'].includes(lowered)) return lowered;
  return lowered;
};

const prettyStatus = (value: unknown): string => {
  if (typeof value !== 'string') return 'insufficient';
  const lowered = value.trim().toLowerCase();
  if (!lowered) return 'insufficient';
  return lowered;
};

const truncate = (value: string, max = 180): string => {
  const text = value.trim();
  if (text.length <= max) return text;
  return `${text.slice(0, max).trimEnd()}…`;
};

const normalizeClaimsDigest = (verification?: ResearchVerificationPayload): ClaimDigest[] => {
  if (!verification) return [];
  const claims = Array.isArray(verification.claims) ? verification.claims : [];
  const verdicts = Array.isArray(verification.claim_verdicts) ? verification.claim_verdicts : [];
  const confidenceScores = Array.isArray(verification.confidence_scores) ? verification.confidence_scores : [];

  const verdictByClaim = new Map<string, Record<string, any>>();
  verdicts.forEach((item) => {
    const claimId = String(item?.claim_id || item?.id || '').trim();
    if (!claimId) return;
    verdictByClaim.set(claimId, item);
  });

  const confidenceByClaim = new Map<string, Record<string, any>>();
  confidenceScores.forEach((item) => {
    const claimId = String(item?.claim_id || item?.id || '').trim();
    if (!claimId) return;
    confidenceByClaim.set(claimId, item);
  });

  return claims
    .map((claim) => {
      const claimId = String(claim?.claim_id || claim?.id || '').trim();
      const text = String(claim?.text || claim?.claim || '').trim();
      if (!claimId || !text) return null;
      const verdict = verdictByClaim.get(claimId) || {};
      const confidenceItem = confidenceByClaim.get(claimId) || {};
      return {
        claimId,
        text,
        status: prettyStatus(verdict?.status),
        confidence: prettyConfidence(verdict?.confidence || confidenceItem?.level),
      } as ClaimDigest;
    })
    .filter(Boolean)
    .slice(0, 6) as ClaimDigest[];
};

const confidenceLabel = (value: string) => {
  if (value === 'high') return '高';
  if (value === 'medium') return '中';
  if (value === 'low') return '低';
  return '未知';
};

const statusLabel = (value: string) => {
  if (value === 'supported') return '支持';
  if (value === 'contradicted') return '反驳';
  if (value === 'mixed') return '冲突';
  if (value === 'insufficient') return '证据不足';
  return value;
};

export interface ResearchPublicationCardProps {
  publication: ResearchPublicationPayload;
  verification?: ResearchVerificationPayload;
  onOpenKnowledgeEntry?: (entryId: string) => void;
  onOpenCanvasBoard?: (canvasId: string, focusNodeId?: string | null) => void;
}

export const ResearchPublicationCard: React.FC<ResearchPublicationCardProps> = ({
  publication,
  verification,
  onOpenKnowledgeEntry,
  onOpenCanvasBoard,
}) => {
  const [showEvidence, setShowEvidence] = useState(false);

  const status = normalizeStatus(publication?.status);
  const statusMeta = STATUS_META[status] || STATUS_META.skipped;

  const claimsTotal = Array.isArray(verification?.claims) ? verification?.claims.length : 0;
  const evidenceTotal = Array.isArray(verification?.evidence_graph) ? verification?.evidence_graph.length : 0;
  const conflictsTotal = Array.isArray(verification?.conflicts) ? verification?.conflicts.length : 0;
  const citationIssuesTotal = Array.isArray(verification?.citation_issues) ? verification?.citation_issues.length : 0;

  const coverageRatioRaw = verification?.citation_coverage?.coverage_ratio;
  const coverageRatio = Math.max(0, Math.min(1, toInt(coverageRatioRaw, 0)));
  const coveragePercent = `${Math.round(coverageRatio * 100)}%`;

  const kbEntryId = typeof publication?.kb_entry_id === 'string' && publication.kb_entry_id.trim()
    ? publication.kb_entry_id.trim()
    : null;
  const canvasId = typeof publication?.canvas_id === 'string' && publication.canvas_id.trim()
    ? publication.canvas_id.trim()
    : null;
  const canvasGroupNodeId = typeof publication?.canvas_group_node_id === 'string' && publication.canvas_group_node_id.trim()
    ? publication.canvas_group_node_id.trim()
    : null;

  const claimDigest = useMemo(() => normalizeClaimsDigest(verification), [verification]);

  const canOpenKnowledge = Boolean(kbEntryId && onOpenKnowledgeEntry);
  const canOpenCanvas = Boolean(canvasId && onOpenCanvasBoard);

  return (
    <div className="rounded-xl border border-border/70 bg-card/70 p-4 backdrop-blur-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className={cn('inline-block h-2.5 w-2.5 rounded-full', statusMeta.dot)} />
          <span className={cn('inline-flex items-center gap-1.5 text-sm font-medium', statusMeta.tone)}>
            {statusMeta.icon}
            {statusMeta.label}
          </span>
        </div>
        <div className="text-xs text-muted-foreground">研究结果已沉淀为可复用资产</div>
      </div>

      <div className="mt-3 grid gap-2 md:grid-cols-3">
        <div className="rounded-lg border border-border/60 bg-background/80 px-3 py-2">
          <div className="text-xs text-muted-foreground">知识库文档</div>
          <div className="mt-1 text-sm font-medium text-foreground">
            {kbEntryId ? '已保存报告' : '未写入'}
          </div>
          <div className="mt-1 truncate text-xs text-muted-foreground">
            {publication?.kb_filename || (kbEntryId ? '报告已归档，可一键打开' : '等待发布')}
          </div>
        </div>

        <div className="rounded-lg border border-border/60 bg-background/80 px-3 py-2">
          <div className="text-xs text-muted-foreground">画布看板</div>
          <div className="mt-1 text-sm font-medium text-foreground">
            {canvasGroupNodeId ? '已生成看板' : '未写入'}
          </div>
          <div className="mt-1 truncate text-xs text-muted-foreground">
            {canvasGroupNodeId
              ? `节点 ${Array.isArray(publication?.canvas_node_ids) ? publication.canvas_node_ids.length : 0} 个`
              : '等待发布'}
          </div>
        </div>

        <div className="rounded-lg border border-border/60 bg-background/80 px-3 py-2">
          <div className="text-xs text-muted-foreground">验证质量</div>
          <div className="mt-1 flex items-center gap-1.5 text-sm font-medium text-foreground">
            <ShieldCheck className="h-3.5 w-3.5 text-emerald-500" />
            {claimsTotal} claims · 引用覆盖 {coveragePercent}
          </div>
          <div className="mt-1 text-xs text-muted-foreground">
            证据 {evidenceTotal} · 冲突 {conflictsTotal} · 引用问题 {citationIssuesTotal}
          </div>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant="default"
          disabled={!canOpenKnowledge}
          onClick={() => kbEntryId && onOpenKnowledgeEntry?.(kbEntryId)}
        >
          打开文档
          <ExternalLink className="ml-1 h-3.5 w-3.5" />
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={!canOpenCanvas}
          onClick={() => canvasId && onOpenCanvasBoard?.(canvasId, canvasGroupNodeId)}
        >
          定位到画布
          <ExternalLink className="ml-1 h-3.5 w-3.5" />
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={claimDigest.length === 0}
          onClick={() => setShowEvidence((prev) => !prev)}
        >
          查看证据摘要
          {showEvidence ? <ChevronUp className="ml-1 h-3.5 w-3.5" /> : <ChevronDown className="ml-1 h-3.5 w-3.5" />}
        </Button>
      </div>

      {showEvidence && (
        <div className="mt-3 rounded-lg border border-border/60 bg-background/70 px-3 py-3">
          <div className="mb-2 text-xs font-medium text-muted-foreground">Claim 摘要（Top {claimDigest.length}）</div>
          <div className="space-y-2">
            {claimDigest.map((item) => (
              <div key={item.claimId} className="rounded-md border border-border/40 bg-background/80 px-2.5 py-2">
                <div className="text-xs text-muted-foreground">{item.claimId}</div>
                <div className="mt-1 text-sm leading-relaxed text-foreground">{truncate(item.text)}</div>
                <div className="mt-1.5 text-xs text-muted-foreground">
                  状态：{statusLabel(item.status)} · 置信度：{confidenceLabel(item.confidence)}
                </div>
              </div>
            ))}
          </div>
          {verification?.verification_summary ? (
            <div className="mt-3 border-t border-border/50 pt-2 text-xs text-muted-foreground">
              {truncate(String(verification.verification_summary), 360)}
            </div>
          ) : null}
        </div>
      )}

      {Array.isArray(publication?.errors) && publication.errors.length > 0 && (
        <div className="mt-2 text-xs text-destructive">发布过程中出现异常，可稍后重试发布。</div>
      )}
    </div>
  );
};

export default ResearchPublicationCard;
