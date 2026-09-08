'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useScroll } from 'motion/react';
import { motion, AnimatePresence } from 'framer-motion';
import VirtualizedCanvas from '@/canvas/components/core/VirtualizedCanvas';
import type { Canvas, CanvasNode } from '@/canvas/types/canvas';
import { createEmptyCanvas, calculateTextNodeHeight } from '@/canvas/utils/canvasUtils';
import { useMediaQuery } from '@/hooks/use-media-query';
import { cn } from '@/lib/utils';

type View = { centerX: number; centerY: number; scale: number };

// Simple helper to create a text node with measured height
function textNode(params: {
  id: string;
  x: number;
  y: number;
  width?: number;
  content: string;
  accentColor?: string;
}): CanvasNode {
  const width = params.width ?? 280;
  const height = Math.max(64, calculateTextNodeHeight(params.content, width));
  const now = Date.now();
  return {
    id: params.id,
    type: 'text',
    x: Math.round(params.x),
    y: Math.round(params.y),
    width,
    height,
    content: params.content,
    createdAt: now,
    updatedAt: now,
    accentColor: params.accentColor,
    locked: true,
  } as CanvasNode;
}

function bboxOf(nodes: CanvasNode[]) {
  if (!nodes.length) return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const n of nodes) {
    minX = Math.min(minX, n.x);
    minY = Math.min(minY, n.y);
    maxX = Math.max(maxX, n.x + n.width);
    maxY = Math.max(maxY, n.y + n.height);
  }
  return { minX, minY, maxX, maxY };
}

function viewFor(nodes: CanvasNode[], viewport: { w: number; h: number }): View {
  const { minX, minY, maxX, maxY } = bboxOf(nodes);
  const boxW = Math.max(1, maxX - minX);
  const boxH = Math.max(1, maxY - minY);
  const cx = minX + boxW / 2;
  const cy = minY + boxH / 2;
  const pad = 1.2; // padding factor
  const rawScale = Math.min(viewport.w / (boxW * pad), viewport.h / (boxH * pad));
  const scale = Math.max(0.1, Math.min(1.6, rawScale));
  return { centerX: cx, centerY: cy, scale };
}

// 叙事步骤文案（右侧画布保持静止，仅用于高亮）
const steps = [
  { title: '从零散到在一张画布上', desc: '把脑中的碎片、截图、链接随手放进来，不用先想结构。', focusId: 'n1' },
  { title: '自动聚合相近信息', desc: '相似内容被聚在一起，降低认知负担，先看到“块”。', focusId: 'n2' },
  { title: '识别关系，形成“因果链”', desc: '把信息编织成路径：从输入到行动，再到结果。', focusId: 'n3' },
  { title: '一键生成结构化大纲', desc: '自动把思考转为可执行结构：目标、策略、1-2-3步。', focusId: 'n4' },
  { title: '交付可用产物', desc: '直接导出演示文稿、PRD、路线图，或交给智能 Agent 执行。', focusId: 'n5' },
];

// 固定不动的右侧画布场景（节点相对位置不变）
function buildStableScene(originX: number, originY: number): CanvasNode[] {
  // 初始布局（允许暂时出现负值）
  let nodes: CanvasNode[] = [
    textNode({ id: 'n1', x: originX - 520, y: originY - 120, width: 340, content: '# 碎片收集\n截图 / 链接 / 语料', accentColor: '#27C240' }),
    textNode({ id: 'n2', x: originX - 520, y: originY + 40, width: 340, content: '# 智能聚合\n相似信息自动成块' }),
    textNode({ id: 'n3', x: originX - 120, y: originY - 120, width: 340, content: '# 因果链路\n从输入到行动' }),
    textNode({ id: 'n4', x: originX - 120, y: originY + 40, width: 340, content: '# 结构大纲\n目标/策略/路线' }),
    textNode({ id: 'n5', x: originX + 280, y: originY - 40, width: 340, content: '# 可用产物\nPitch / PRD / Roadmap' }),
  ];
  // 平移使其全部位于正坐标区（避免被容器裁剪）
  const minX = Math.min(...nodes.map(n => n.x));
  const minY = Math.min(...nodes.map(n => n.y));
  const pad = 60; // 视图内边距
  const dx = minX < pad ? (pad - minX) : 0;
  const dy = minY < pad ? (pad - minY) : 0;
  if (dx !== 0 || dy !== 0) {
    nodes = nodes.map(n => ({ ...n, x: n.x + dx, y: n.y + dy }));
  }
  return nodes;
}

export function CanvasStorySection() {
  const containerRef = useRef<HTMLDivElement>(null);
  const stickyRef = useRef<HTMLDivElement>(null);
  const storyRailRef = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({ target: storyRailRef, offset: ['start start', 'end end'] });
  const progressRef = useRef(0);
  const rafRef = useRef<number | null>(null);

  const [active, setActive] = useState(0);
  const [canvas, setCanvas] = useState<Canvas>(() => createEmptyCanvas('Landing Demo', 'landing-demo'));
  const [view, setView] = useState<View | null>(null);
  const [highlight, setHighlight] = useState<string | null>(null);
  const isDesktop = useMediaQuery('(min-width: 1024px)');
  const [mobileStep, setMobileStep] = useState(0);

  const computeViewport = useCallback(() => {
    const el = stickyRef.current;
    if (!el) return { w: 1200, h: 720 };
    const rect = el.getBoundingClientRect();
    return { w: Math.max(1, rect.width), h: Math.max(1, rect.height) };
  }, []);

  // Map scroll progress -> 文案切换（右侧画布不换景，不移动）
  useEffect(() => {
    if (!isDesktop) return undefined;
    const ease = (t: number) => t * t * (3 - 2 * t); // smoothstep
    const onProgress = (p: number) => {
      progressRef.current = Math.max(0, Math.min(1, p));
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(() => {
        const totalSeg = steps.length;
        const tt = progressRef.current * totalSeg;
        const i = Math.min(totalSeg - 1, Math.max(0, Math.floor(tt)));
        setActive((prev) => (prev === i ? prev : i));
        setHighlight(steps[i].focusId);
      });
    };
    const unsub = scrollYProgress.on('change', onProgress);
    return () => {
      unsub();
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [isDesktop, scrollYProgress, computeViewport]);

  // 初始化右侧画布（固定不动），并计算一次视角以适配视区
  useEffect(() => {
    const vp = computeViewport();
    const originX = Math.round(vp.w * 0.5);
    const originY = Math.round(vp.h * 0.5);
    const nodes = buildStableScene(originX, originY);
    const nextCanvas: Canvas = {
      ...createEmptyCanvas('Landing Demo', 'landing-demo'),
      nodes,
      connections: [],
      updatedAt: Date.now(),
    };
    setCanvas(nextCanvas);
    // 固定视角：一次性适配
    const v = viewFor(nodes, vp);
    setView(v);
    setHighlight(steps[0].focusId);
  }, [computeViewport]);

  // 仅在窗口尺寸变化时重新拟合一次视角（节点位置不变）
  useEffect(() => {
    const onResize = () => {
      const vp = computeViewport();
      if (canvas.nodes.length > 0) {
        setView(viewFor(canvas.nodes, vp));
      }
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [canvas.nodes, computeViewport]);

  const displayedStep = isDesktop ? active : mobileStep;
  const effectiveHighlight = isDesktop ? highlight : steps[displayedStep]?.focusId ?? null;

  return (
    <section id="canvas-story" className="relative w-full">
      <div ref={containerRef} className="relative w-full">
        {/* Header */}
        <div className="max-w-6xl mx-auto px-6 py-16">
          <h2 className="text-3xl md:text-4xl font-medium tracking-tighter">
            让画布驱动你的叙事与执行
          </h2>
          <p className="text-muted-foreground text-base md:text-lg mt-2 max-w-3xl">
            不是“滑过一段段页面”，而是沿着一条清晰的操作路径，逐步将混乱转化为可执行的结构和成果。
          </p>
        </div>

        {/* Sticky scrollytelling area (desktop only) */}
        <div className="relative border-t border-b border-border hidden lg:block">
          <div className="max-w-6xl mx-auto grid grid-cols-10 gap-0 px-0 sm:px-6">
            {/* Left: sticky copy, 3/10 width */}
            <div className="col-span-10 lg:col-span-3 order-2 lg:order-1 relative">
              <div className="sticky top-16 lg:top-20 h-[60vh] lg:h-[calc(100vh-5rem)] flex items-center px-6">
                <div className="w-full">
                  <AnimatePresence mode="popLayout" initial={false}>
                    <motion.div
                      key={active}
                      initial={{ opacity: 0, y: 16 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -16 }}
                      transition={{ duration: 0.45, ease: [0.22, 0.61, 0.36, 1] }}
                      className="space-y-3"
                    >
                      <div className="text-xs text-muted-foreground tracking-wider">STEP {active + 1}</div>
                      <h3 className="text-xl md:text-2xl font-medium tracking-tight">
                        {steps[active].title}
                      </h3>
                      <p className="text-muted-foreground text-sm md:text-base leading-relaxed">
                        {steps[active].desc}
                      </p>
                    </motion.div>
                  </AnimatePresence>
                </div>
              </div>
              {/* Tall rail to drive scroll & progress; placed after sticky to keep sticky visible while scrolling */}
              <div ref={storyRailRef} className="h-[380vh]" aria-hidden="true" />
            </div>

            {/* Right: sticky canvas, 7/10 width */}
            <div className="col-span-10 lg:col-span-7 order-1 lg:order-2">
              <div ref={stickyRef} className="sticky top-16 lg:top-20 h-[60vh] lg:h-[calc(100vh-5rem)]">
                <div className="h-full w-full border-l border-border overflow-hidden">
                  <VirtualizedCanvas
                    canvas={canvas}
                    isEditMode={false}
                    className="bg-background"
                    showPerformanceIndicator={false}
                    disableInteractions
                    controlledView={view}
                    highlightNodeId={effectiveHighlight}
                  />
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Mobile/tablet narrative */}
        {!isDesktop && (
          <div className="px-6 py-12 space-y-8">
            <div className="space-y-4">
              {steps.map((step, idx) => (
                <button
                  key={step.title}
                  type="button"
                  onClick={() => setMobileStep(idx)}
                  className={cn(
                    'w-full rounded-2xl border bg-white/80 p-4 text-left shadow-sm transition dark:bg-[#0B0B0B]/80',
                    idx === mobileStep
                      ? 'border-slate-900 text-slate-900 dark:border-white dark:text-white'
                      : 'border-slate-200 text-slate-700 dark:border-[#1E1E1E] dark:text-slate-200'
                  )}
                >
                  <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                    STEP {idx + 1}
                  </div>
                  <h3 className="mt-2 text-xl font-semibold tracking-tight">{step.title}</h3>
                  <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">{step.desc}</p>
                </button>
              ))}
            </div>
            <div className="rounded-3xl border border-slate-200 bg-white p-2 shadow-xl dark:border-[#1E1E1E] dark:bg-[#050505]">
              <div className="h-[360px] w-full overflow-hidden rounded-2xl border border-slate-100 dark:border-[#1E1E1E]">
                <VirtualizedCanvas
                  canvas={canvas}
                  isEditMode={false}
                  className="bg-background"
                  showPerformanceIndicator={false}
                  disableInteractions
                  controlledView={view}
                  highlightNodeId={effectiveHighlight}
                />
              </div>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

export default CanvasStorySection;
