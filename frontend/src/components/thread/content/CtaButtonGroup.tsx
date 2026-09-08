'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
    Loader2,
    Check,
    Download,
    Search,
    Play,
    Pause,
    RefreshCw,
    Send,
    Copy,
    Trash2,
    Edit,
    Plus,
    Settings,
    ExternalLink,
    ArrowRight,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { CtaAction } from '@/components/thread/types';

// ── Icon support ────────────────────────────────────────────────

const ICON_MAP: Record<string, LucideIcon> = {
    download: Download,
    search: Search,
    play: Play,
    pause: Pause,
    refresh: RefreshCw,
    send: Send,
    copy: Copy,
    trash: Trash2,
    delete: Trash2,
    edit: Edit,
    plus: Plus,
    add: Plus,
    settings: Settings,
    external: ExternalLink,
    link: ExternalLink,
    arrow: ArrowRight,
    next: ArrowRight,
};

const EMOJI_RE = /^\p{Emoji}/u;

function resolveIcon(icon?: string): React.ReactNode {
    if (!icon) return null;
    const trimmed = icon.trim();
    if (!trimmed) return null;

    // Check for emoji
    if (EMOJI_RE.test(trimmed)) {
        return <span className="text-sm leading-none">{trimmed}</span>;
    }

    // Check whitelist
    const LucideIcon = ICON_MAP[trimmed.toLowerCase()];
    if (LucideIcon) {
        return <LucideIcon size={16} />;
    }

    return null;
}

// ── Types ────────────────────────────────────────────────────────

type ButtonState = 'active' | 'loading' | 'sibling_loading' | 'selected' | 'stale';

interface CtaButtonGroupProps {
    ctas: CtaAction[];
    disabled: boolean;
    agentStatus: string;
    onCtaAction: (cta: CtaAction) => void;
    groupKey: string;
}

// ── Component ────────────────────────────────────────────────────

export function CtaButtonGroup({
    ctas,
    disabled,
    agentStatus,
    onCtaAction,
    groupKey,
}: CtaButtonGroupProps) {
    const [buttonStates, setButtonStates] = useState<ButtonState[]>(
        () => ctas.map(() => 'active'),
    );
    const clickedIndexRef = useRef<number | null>(null);
    const wasIdleRef = useRef(agentStatus === 'idle');

    // Transition to stale when agent leaves idle (after a click)
    useEffect(() => {
        const isIdle = agentStatus === 'idle';

        if (wasIdleRef.current && !isIdle && clickedIndexRef.current !== null) {
            // Agent just started working after our click
            setButtonStates((prev) =>
                prev.map((s, i) =>
                    i === clickedIndexRef.current ? 'selected' : 'stale',
                ),
            );
            // Brief selected flash, then go stale
            const timer = setTimeout(() => {
                setButtonStates((prev) => prev.map(() => 'stale'));
            }, 400);
            return () => clearTimeout(timer);
        }

        // If agent comes back to idle and we were stale, stay stale
        wasIdleRef.current = isIdle;
    }, [agentStatus]);

    const handleClick = useCallback(
        (index: number) => {
            if (disabled) return;
            if (buttonStates[index] !== 'active') return;

            clickedIndexRef.current = index;
            setButtonStates((prev) =>
                prev.map((_, i) => (i === index ? 'loading' : 'sibling_loading')),
            );
            onCtaAction(ctas[index]);
        },
        [disabled, buttonStates, onCtaAction, ctas],
    );

    const isStale = buttonStates.every((s) => s === 'stale');
    const hasDescription = ctas.some((c) => c.description);

    // ── Layout classes ──

    const layoutClass =
        ctas.length === 1
            ? 'flex w-full'
            : ctas.length === 2
              ? 'grid grid-cols-2 gap-2'
              : 'flex flex-col gap-2';

    // ── Stale compact row ──

    if (isStale) {
        return (
            <motion.div
                key={`stale-${groupKey}`}
                initial={{ opacity: 0.8, scale: 0.98 }}
                animate={{ opacity: 1, scale: 1 }}
                className="mt-2 flex flex-wrap gap-1.5"
            >
                {ctas.map((cta, idx) => {
                    const icon = resolveIcon(cta.icon);
                    const wasClicked = idx === clickedIndexRef.current;
                    return (
                        <div
                            key={`${cta.action}-${idx}`}
                            className={cn(
                                'inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs',
                                'text-muted-foreground bg-muted/40 border border-border/40',
                                'cursor-default select-none',
                                wasClicked && 'ring-1 ring-primary/30 bg-muted/60',
                            )}
                        >
                            {icon}
                            <span>{cta.label}</span>
                            {wasClicked && <Check size={12} className="text-primary/60" />}
                        </div>
                    );
                })}
            </motion.div>
        );
    }

    // ── Active / loading / selected states ──

    return (
        <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.25, ease: 'easeOut' }}
            className={cn('mt-2', layoutClass)}
        >
            <AnimatePresence mode="sync">
                {ctas.map((cta, idx) => {
                    const state = buttonStates[idx];
                    const icon = resolveIcon(cta.icon);
                    const variant =
                        cta.style === 'danger'
                            ? 'destructive'
                            : cta.style === 'secondary'
                              ? 'outline'
                              : 'cta';

                    const isLoading = state === 'loading';
                    const isSelected = state === 'selected';
                    const isSiblingLoading = state === 'sibling_loading';

                    const buttonDisabled =
                        disabled || isLoading || isSelected || isSiblingLoading;

                    const leadingIcon = isLoading ? (
                        <Loader2 size={16} className="animate-spin" />
                    ) : isSelected ? (
                        <Check size={16} />
                    ) : (
                        icon
                    );

                    // Card-like layout when description is present
                    if (cta.description) {
                        return (
                            <motion.div
                                key={`${cta.action}-${idx}`}
                                initial={{ opacity: 0, y: 6 }}
                                animate={{
                                    opacity: isSiblingLoading ? 0.5 : 1,
                                    y: 0,
                                }}
                                transition={{
                                    duration: 0.2,
                                    delay: idx * 0.06,
                                }}
                            >
                                <Button
                                    variant={variant}
                                    size="lg"
                                    disabled={buttonDisabled}
                                    onClick={() => handleClick(idx)}
                                    className={cn(
                                        'h-auto w-full flex-col items-start gap-0.5 py-2.5 px-3.5 text-left',
                                        isSiblingLoading && 'opacity-50',
                                    )}
                                >
                                    <span className="flex items-center gap-1.5 font-medium text-sm">
                                        {leadingIcon}
                                        {cta.label}
                                    </span>
                                    <span className="text-xs text-muted-foreground font-normal">
                                        {cta.description}
                                    </span>
                                </Button>
                            </motion.div>
                        );
                    }

                    // Standard button
                    return (
                        <motion.div
                            key={`${cta.action}-${idx}`}
                            initial={{ opacity: 0, y: 6 }}
                            animate={{
                                opacity: isSiblingLoading ? 0.5 : 1,
                                y: 0,
                            }}
                            transition={{
                                duration: 0.2,
                                delay: idx * 0.06,
                            }}
                            className={ctas.length === 1 ? 'w-full' : undefined}
                        >
                            <Button
                                variant={variant}
                                size="sm"
                                disabled={buttonDisabled}
                                onClick={() => handleClick(idx)}
                                className={cn(
                                    ctas.length === 1 && 'w-full',
                                    isSiblingLoading && 'opacity-50',
                                )}
                            >
                                {leadingIcon}
                                {cta.label}
                            </Button>
                        </motion.div>
                    );
                })}
            </AnimatePresence>
        </motion.div>
    );
}
