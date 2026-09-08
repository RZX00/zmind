'use client';

import React, { useState } from 'react';
import { ChevronDown, ChevronUp, Search, Sparkles } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { CtaAction } from '@/components/thread/types';

export type ResearchPlanPayload = {
    status?: string;
    clarified_task?: string;
    clarification_notes?: string;
    rewritten_task?: string;
    focus_areas?: string[];
    queries?: string[];
    query_rationale?: string;
    config_summary?: {
        query_count?: number;
        max_loops?: number;
        phase2_enabled?: boolean;
        max_total_queries?: number;
        results_per_query?: number;
    };
};

export interface ResearchPlanCardProps {
    plan: ResearchPlanPayload;
    onCtaAction?: (cta: CtaAction) => void;
    disabled?: boolean;
}

export const ResearchPlanCard: React.FC<ResearchPlanCardProps> = ({
    plan,
    onCtaAction,
    disabled = false,
}) => {
    const [showFocusAreas, setShowFocusAreas] = useState(false);

    const topic = (plan.rewritten_task || plan.clarified_task || '').trim();
    const queries = Array.isArray(plan.queries) ? plan.queries : [];
    const focusAreas = Array.isArray(plan.focus_areas) ? plan.focus_areas : [];
    const rationale = (plan.query_rationale || '').trim();
    const config = plan.config_summary || {};

    const configParts: string[] = [];
    if (config.query_count) configParts.push(`${config.query_count} 条查询`);
    if (config.max_loops) configParts.push(`最多 ${config.max_loops} 轮追问`);
    if (config.phase2_enabled) {
        configParts.push('验证已开启');
    } else if (config.phase2_enabled === false) {
        configParts.push('验证已关闭');
    }

    const handleStart = () => {
        onCtaAction?.({
            label: '开始研究',
            action: 'research_plan.start',
            style: 'primary',
            payload: plan,
        });
    };

    const handleAdjust = () => {
        onCtaAction?.({
            label: '调整方向',
            action: 'research_plan.adjust',
            style: 'secondary',
        });
    };

    return (
        <div className="rounded-xl border border-border/70 bg-card/70 p-4 backdrop-blur-sm">
            <div className="flex items-center gap-2">
                <Search className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm font-medium text-foreground">研究计划</span>
            </div>

            {topic && (
                <div className="mt-3">
                    <div className="text-xs text-muted-foreground">研究主题</div>
                    <div className="mt-1 rounded-lg border border-border/60 bg-background/80 px-3 py-2 text-sm text-foreground">
                        {topic}
                    </div>
                </div>
            )}

            {focusAreas.length > 0 && (
                <div className="mt-3">
                    <button
                        type="button"
                        className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                        onClick={() => setShowFocusAreas((prev) => !prev)}
                    >
                        <Sparkles className="h-3 w-3" />
                        搜索方向（{focusAreas.length}）
                        {showFocusAreas ? (
                            <ChevronUp className="h-3 w-3" />
                        ) : (
                            <ChevronDown className="h-3 w-3" />
                        )}
                    </button>
                    {showFocusAreas && (
                        <ul className="mt-1.5 space-y-1 pl-1">
                            {focusAreas.map((area, idx) => (
                                <li key={idx} className="text-xs text-muted-foreground">
                                    <span className="mr-1 text-muted-foreground/60">•</span>
                                    {area}
                                </li>
                            ))}
                        </ul>
                    )}
                </div>
            )}

            {queries.length > 0 && (
                <div className="mt-3">
                    <div className="text-xs text-muted-foreground">计划查询</div>
                    <ol className="mt-1.5 space-y-1 pl-1">
                        {queries.map((query, idx) => (
                            <li key={idx} className="text-sm text-foreground">
                                <span className="mr-1.5 text-xs text-muted-foreground">{idx + 1}.</span>
                                {query}
                            </li>
                        ))}
                    </ol>
                </div>
            )}

            {rationale && (
                <div className="mt-3">
                    <div className="text-xs text-muted-foreground">策略说明</div>
                    <div className="mt-1 text-xs leading-relaxed text-muted-foreground">
                        {rationale}
                    </div>
                </div>
            )}

            {configParts.length > 0 && (
                <div className="mt-3">
                    <div className="text-xs text-muted-foreground">研究配置</div>
                    <div className="mt-1 text-xs text-muted-foreground">
                        {configParts.join(' · ')}
                    </div>
                </div>
            )}

            <div className="mt-4 flex flex-wrap items-center gap-2">
                <Button
                    size="sm"
                    variant="cta"
                    disabled={disabled || queries.length === 0}
                    onClick={handleStart}
                >
                    开始研究
                </Button>
                <Button
                    size="sm"
                    variant="outline"
                    disabled={disabled}
                    onClick={handleAdjust}
                >
                    调整方向
                </Button>
            </div>
        </div>
    );
};

export default ResearchPlanCard;
