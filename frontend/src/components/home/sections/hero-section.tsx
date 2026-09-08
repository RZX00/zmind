'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  motion,
  useScroll,
  useTransform,
  useSpring,
  MotionValue,
  AnimatePresence,
  useMotionValue,
} from 'motion/react';
import {
  ArrowRight,
  Sparkles,
  FileText,
  MoreHorizontal,
  Play,
  GitMerge,
  ListTodo,
  CheckCircle2,
  Loader2,
  Plus,
  Folder,
  FolderOpen,
  FolderPlus,
  MousePointer2,
  PenTool,
  LayoutGrid,
  Wand2,
  Code,
  Type,
  CheckSquare,
  Network,
  FileCode2,
  Table,
  Mic,
  Link2,
  Workflow,
  MessageSquare,
} from 'lucide-react';
import Image from 'next/image';
import { useTranslations, useLocale } from 'next-intl';
import { useTheme } from 'next-themes';
import { Link, useRouter } from '@/i18n/routing';
import { Button } from '@/components/ui/button';
import { useMediaQuery } from '@/hooks/use-media-query';
import { useAuth } from '@/components/AuthProvider';
import { cn } from '@/lib/utils';
import GoldStarAI from '@/canvas/components/shared/icons/GoldStarAI';

type NodeType =
  | 'image'
  | 'text'
  | 'mindmap'
  | 'highlight'
  | 'todo'
  | 'file'
  | 'media'
  | 'mermaid'
  | 'svg'
  | 'widget';

type MindmapVariant = 'idea' | 'flow';

type WidgetData = {
  badge: string;
  timerLabel: string;
  focusLabel: string;
  remainingLabel: string;
  autoLabel: string;
  orderLabel: string;
  loopLabel: string;
  phases: string[];
};

type DiagramLabels = {
  chat: string;
  pdf: string;
  notes: string;
  claim: string;
  evidence: string;
  followUp: string;
};

type NodeConfig = {
  id: string;
  title: string;
  type: NodeType;
  content?: string;
  bodyLines?: string[];
  todoItems?: Array<{ label: string; done: boolean }>;
  diagramLabels?: DiagramLabels;
  left: number;
  top: number;
  width: number;
  start: number;
  variant?: MindmapVariant;
  hidden?: boolean;
  delay?: number;
};

type StagedNode = Omit<NodeConfig, 'left' | 'top'> & {
  leftPercent: number;
  topPercent: number;
  left: string;
  top: string;
  delay: number;
};

type CanvasNodeProps = {
  title: string;
  type: NodeType;
  content?: string;
  bodyLines?: string[];
  todoItems?: Array<{ label: string; done: boolean }>;
  widgetData?: WidgetData;
  diagramLabels?: DiagramLabels;
  left: string;
  top: string;
  width: number;
  scale: MotionValue<number>;
  opacity: MotionValue<number>;
  delay?: number;
  variant?: MindmapVariant;
};

const CanvasNode = ({
  title,
  type,
  content,
  left,
  top,
  width,
  scale,
  opacity,
  delay = 0,
  variant,
  bodyLines,
  todoItems,
  widgetData,
  diagramLabels,
}: CanvasNodeProps) => {
  const sourceIcons = [MessageSquare, FileText, Link2, Table, Mic, FileCode2];
  return (
    <motion.div
      style={{
        left,
        top,
        width,
        scale,
        opacity,
        x: '-50%',
        y: '-50%',
        transformOrigin: 'center',
      }}
      transition={{ duration: 0.35, ease: 'easeOut' }}
      className="absolute z-10 origin-center rounded-md border border-slate-200 bg-white text-[10px] shadow-md dark:border-[#2A2A2A] dark:bg-[#0B0B0B]"
    >
      {/** subtle floating to keep the canvas lively without breaking layout */}
      <motion.div
        animate={{ y: [0, -2.5, 0], x: [0, 1, 0] }}
        transition={{ duration: 8 + delay * 0.4, repeat: Infinity, ease: 'easeInOut', repeatType: 'mirror', delay: delay * 0.3 }}
      >
    {type !== 'image' && type !== 'media' && type !== 'widget' && (
      <div
        className={`flex items-center justify-between border-b px-2 py-1.5 text-slate-600 dark:text-slate-300 ${
          type === 'highlight'
            ? 'bg-orange-50 text-orange-800 dark:bg-orange-500/20 dark:text-orange-100'
            : 'bg-slate-50 dark:bg-[#171717]'
        }`}
      >
        <span className="flex items-center gap-1 truncate">
          {type === 'text' && <FileText size={10} />}
          {type === 'mindmap' && <GitMerge size={10} />}
          {type === 'highlight' && <Sparkles size={10} />}
          {type === 'todo' && <ListTodo size={10} />}
          {type === 'mermaid' && <Workflow size={10} />}
          {type === 'svg' && <Code size={10} />}
          {title}
        </span>
        <MoreHorizontal size={10} className="opacity-50" />
      </div>
    )}
    <div
      className={`space-y-2 ${
        type === 'image' || type === 'media' ? '' : 'bg-white p-2 dark:bg-[#0B0B0B]'
      }`}
    >
      {type === 'image' && (
        <div className="relative h-24 w-full overflow-hidden rounded border border-slate-100 bg-slate-100 dark:border-[#1E1E1E] dark:bg-[#171717]">
          <Image
            src="/thumbnail-light.png"
            alt="Canvas preview"
            fill
            className="object-cover"
            sizes="160px"
          />
          <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/60 to-transparent px-2 py-1 text-[9px] font-semibold text-white">
            {title}
          </div>
        </div>
      )}
      {type === 'widget' && widgetData && (
        <div className="rounded-lg border border-slate-200 bg-white p-3 text-[10px] shadow-sm dark:border-[#1E1E1E] dark:bg-[#0B0B0B]">
          <div className="flex items-center justify-between text-[9px] text-slate-600 dark:text-slate-300">
            <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-1.5 py-0.5 text-[8px] font-semibold uppercase tracking-wide text-slate-600 dark:bg-[#141414] dark:text-slate-200">
              {widgetData.badge}
            </span>
            <span className="flex items-center gap-1 font-semibold text-emerald-600 dark:text-emerald-300">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" aria-hidden />
              {widgetData.loopLabel}
            </span>
          </div>
          <div className="mt-2 rounded-md border border-dashed border-slate-200 bg-slate-50/60 px-2 py-1.5 text-[9px] dark:border-[#1F1F1F] dark:bg-[#111111]">
            <div className="flex items-center justify-between text-slate-500 dark:text-slate-400">
              <span>{widgetData.timerLabel}</span>
              <span className="font-semibold text-slate-900 dark:text-white">{widgetData.remainingLabel}</span>
            </div>
            <div className="mt-2 h-1.5 rounded-full bg-slate-100 dark:bg-[#1A1A1A]">
              <div className="h-full w-[92%] rounded-full bg-gradient-to-r from-emerald-400 via-sky-400 to-indigo-500" />
            </div>
            <div className="mt-1 text-[8px] text-slate-400 dark:text-slate-500">{widgetData.autoLabel}</div>
          </div>
          <div className="mt-2 grid grid-cols-2 gap-1.5">
            {widgetData.phases.map((item, idx) => {
              const Icon = sourceIcons[idx % sourceIcons.length];
              return (
                <div
                  key={`${title}-block-${idx}`}
                  className="flex items-center gap-1.5 rounded-md border border-slate-100 bg-slate-50 px-2 py-1 text-[9px] text-slate-700 dark:border-[#1F1F1F] dark:bg-[#111111] dark:text-slate-200"
                >
                  <Icon size={12} className="text-slate-400 dark:text-slate-500" />
                  <div className="flex flex-col leading-tight">
                    <span className="font-semibold">{item}</span>
                    <span className="text-[8px] text-slate-400 dark:text-slate-500">
                      {idx === 0 ? widgetData.orderLabel : widgetData.focusLabel}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
          <div className="mt-2 rounded-md bg-slate-50 px-2 py-1.5 text-[9px] text-slate-600 dark:bg-[#111111] dark:text-slate-300">
            <div className="flex items-center gap-1">
              <Sparkles size={10} className="text-emerald-500" />
              <span className="font-medium">{widgetData.orderLabel}</span>
            </div>
            <p className="mt-1 text-[8px] text-slate-400 dark:text-slate-500">
              {widgetData.autoLabel}
            </p>
          </div>
        </div>
      )}
      {type === 'media' && (
        <div className="relative h-24 w-full overflow-hidden rounded border border-slate-100 bg-black/5 dark:border-[#1E1E1E] dark:bg-black/20">
          <Image
            src="/thumbnail-light.png"
            alt="Media preview"
            fill
            className="object-cover"
            sizes="160px"
          />
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-white/80 text-slate-900 shadow dark:bg-black/70 dark:text-white">
              <Play size={14} />
            </div>
          </div>
          <div className="absolute inset-x-0 bottom-0 flex items-center justify-between bg-gradient-to-t from-black/80 to-transparent px-2 py-1 text-[9px] font-semibold text-white">
            <span>Storyboard Clip</span>
            <span className="text-[8px] opacity-80">00:12</span>
          </div>
        </div>
      )}
      {type === 'text' && (
        <div className="space-y-1.5 text-[10px] leading-snug text-slate-600 dark:text-slate-200">
          {(bodyLines && bodyLines.length > 0
            ? bodyLines
            : [
                'Surface-level capture vs. structured thinking',
                'Synthesise cross-media assets into one flow.',
                'Keep threads linked for downstream tasks.',
              ]
          ).map((line, idx) => (
            <p
              key={`${title}-line-${idx}`}
              className={`rounded-md px-1 py-0.5 ${
                idx === 0
                  ? 'bg-slate-100 font-semibold text-slate-700 dark:bg-[#151515] dark:text-white'
                  : 'bg-transparent text-slate-500 dark:text-slate-300'
              }`}
            >
              {line}
            </p>
          ))}
        </div>
      )}
      {type === 'mindmap' && (
        <>
          {variant === 'flow' ? (
            <div className="rounded-sm bg-slate-50 p-3 text-[9px] text-slate-600 dark:bg-[#111111] dark:text-slate-300">
              <div className="flex items-center justify-between gap-2">
                {['Capture', 'Parse', 'Structure', 'Export'].map((step, idx) => (
                  <div key={step} className="flex flex-col items-center gap-1">
                    <div className="flex h-5 w-5 items-center justify-center rounded-full bg-slate-900 text-[8px] font-semibold text-white dark:bg-white dark:text-slate-900">
                      {idx + 1}
                    </div>
                    <span>{step}</span>
                  </div>
                ))}
              </div>
              <div className="mt-3 h-1.5 rounded-full bg-slate-200 dark:bg-[#1F1F1F]">
                <motion.div
                  className="h-full rounded-full bg-gradient-to-r from-emerald-400 via-blue-500 to-purple-500"
                  animate={{ width: ['35%', '90%'] }}
                  transition={{ duration: 4, repeat: Infinity, repeatType: 'reverse' }}
                />
              </div>
            </div>
          ) : (
            <div className="relative h-28 rounded-sm bg-slate-50 p-3 text-[8px] text-slate-600 dark:bg-[#111111] dark:text-slate-200">
              <svg className="absolute inset-0 h-full w-full" viewBox="0 0 100 100">
                {[{ x: 20, y: 25 }, { x: 80, y: 20 }, { x: 18, y: 75 }, { x: 82, y: 72 }, { x: 50, y: 15 }, { x: 50, y: 85 }].map(
                  (point, idx) => (
                    <line
                      key={`branch-${idx}`}
                      x1="50"
                      y1="50"
                      x2={point.x}
                      y2={point.y}
                      stroke="rgba(51,65,85,0.4)"
                      strokeWidth="1.5"
                    />
                  ),
                )}
              </svg>
              <div className="absolute left-1/2 top-1/2 flex h-12 w-12 -translate-x-1/2 -translate-y-1/2 flex-col items-center justify-center rounded-full bg-white text-[8px] font-semibold text-slate-700 shadow-sm dark:bg-[#0b0b0b] dark:text-slate-200">
                Idea
                <span className="text-[7px] font-normal text-slate-400 dark:text-slate-500">Map</span>
              </div>
              {[
                { label: 'Research', x: '18%', y: '20%' },
                { label: 'Outline', x: '80%', y: '18%' },
                { label: 'Branch', x: '15%', y: '78%' },
                { label: 'Synthesize', x: '82%', y: '75%' },
                { label: 'Prompt', x: '50%', y: '10%' },
                { label: 'Insight', x: '50%', y: '88%' },
              ].map((node) => (
                <div
                  key={node.label}
                  className="absolute -translate-x-1/2 -translate-y-1/2 rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[7px] font-medium text-slate-600 shadow-sm dark:border-[#2A2A2A] dark:bg-[#0b0b0b] dark:text-slate-200"
                  style={{ left: node.x, top: node.y }}
                >
                  {node.label}
                </div>
              ))}
            </div>
          )}
        </>
      )}
      {type === 'mermaid' && diagramLabels && (
        <div className="rounded-sm border border-slate-200 bg-white p-2 shadow-sm dark:border-[#1E1E1E] dark:bg-[#0B0B0B]">
          <svg viewBox="0 0 240 140" className="w-full text-slate-800 dark:text-slate-200">
            <defs>
              <marker id="mermaidArrow" markerWidth="7" markerHeight="7" refX="5.5" refY="3.5" orient="auto">
                <path d="M0,0 L7,3.5 L0,7 Z" fill="currentColor" />
              </marker>
            </defs>
            <g className="text-[8px] font-medium">
              <rect x="20" y="16" width="62" height="26" rx="6" className="fill-white stroke-slate-200 dark:fill-[#0B0B0B] dark:stroke-[#1E1E1E]" />
              <text x="51" y="32" className="fill-current" textAnchor="middle">
                {diagramLabels.chat}
              </text>

              <rect x="90" y="16" width="62" height="26" rx="6" className="fill-white stroke-slate-200 dark:fill-[#0B0B0B] dark:stroke-[#1E1E1E]" />
              <text x="121" y="32" className="fill-current" textAnchor="middle">
                {diagramLabels.pdf}
              </text>

              <rect x="160" y="16" width="62" height="26" rx="6" className="fill-white stroke-slate-200 dark:fill-[#0B0B0B] dark:stroke-[#1E1E1E]" />
              <text x="191" y="32" className="fill-current" textAnchor="middle">
                {diagramLabels.notes}
              </text>

              <rect x="55" y="68" width="68" height="28" rx="7" className="fill-emerald-50 stroke-emerald-500/70 dark:fill-emerald-500/10 dark:stroke-emerald-400/80" />
              <text x="89" y="84" className="fill-current" textAnchor="middle">
                {diagramLabels.claim}
              </text>

              <rect x="140" y="68" width="68" height="28" rx="7" className="fill-blue-50 stroke-blue-500/70 dark:fill-blue-500/10 dark:stroke-blue-400/80" />
              <text x="174" y="84" className="fill-current" textAnchor="middle">
                {diagramLabels.evidence}
              </text>

              <rect x="95" y="106" width="90" height="24" rx="6" className="fill-slate-50 stroke-slate-300 dark:fill-[#111111] dark:stroke-[#1F1F1F]" />
              <text x="140" y="121" className="fill-current" textAnchor="middle">
                {diagramLabels.followUp}
              </text>
            </g>

            {[
              { d: 'M51 42 Q60 58 89 68', marker: true },
              { d: 'M121 42 Q120 58 89 68', marker: true },
              { d: 'M191 42 Q180 58 174 68', marker: true },
              { d: 'M123 82 Q136 82 140 82', marker: true },
              { d: 'M174 96 Q160 110 140 114', marker: true },
              { d: 'M89 96 Q108 110 140 114', marker: true },
            ].map((item, idx) => (
              <path
                key={`edge-${idx}`}
                d={item.d}
                fill="none"
                stroke="currentColor"
                strokeWidth="0.8"
                markerEnd={item.marker ? 'url(#mermaidArrow)' : undefined}
              />
            ))}
          </svg>
        </div>
      )}
      {type === 'svg' && (
        <div className="relative h-32 rounded-sm bg-slate-900 p-3 dark:bg-black">
          <div className="absolute right-2 top-2 flex gap-1">
            <div className="h-1.5 w-1.5 rounded-full bg-red-500"></div>
            <div className="h-1.5 w-1.5 rounded-full bg-yellow-500"></div>
            <div className="h-1.5 w-1.5 rounded-full bg-green-500"></div>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <div className="h-1.5 w-8 rounded bg-slate-700"></div>
              <div className="h-1 w-12 rounded bg-slate-800"></div>
              <div className="h-1 w-10 rounded bg-slate-800"></div>
            </div>
            <div className="flex items-center justify-center rounded border border-slate-800 bg-slate-800/50 p-1">
              <svg viewBox="0 0 40 40" className="w-full">
                <circle cx="20" cy="20" r="12" className="fill-none stroke-blue-400" strokeWidth="2" />
                <path d="M20 8 V12 M20 28 V32 M8 20 H12 M28 20 H32" className="stroke-blue-400" strokeWidth="2" />
                <circle cx="20" cy="20" r="4" className="fill-blue-400" />
              </svg>
            </div>
          </div>
          <div className="mt-3 rounded bg-slate-800 p-1.5 font-mono text-[6px] leading-tight text-blue-300">
            &lt;svg viewBox="0 0 100 100"&gt;<br/>
            &nbsp;&nbsp;&lt;circle cx="50" ... /&gt;<br/>
            &lt;/svg&gt;
          </div>
        </div>
      )}
      {type === 'highlight' && (
        <div className="space-y-2">
          <p className="text-[11px] font-medium leading-tight text-slate-700 dark:text-slate-50">
            {content}
          </p>
          <div className="flex gap-1 text-[8px]">
            <span className="rounded-sm bg-blue-100 px-1.5 py-0.5 text-blue-700 dark:bg-blue-500/20 dark:text-blue-100">
              #Strategy
            </span>
            <span className="rounded-sm bg-purple-100 px-1.5 py-0.5 text-purple-700 dark:bg-purple-500/20 dark:text-purple-100">
              #AI
            </span>
          </div>
        </div>
      )}
      {type === 'todo' && (
        <div className="space-y-1">
          {(todoItems && todoItems.length > 0
            ? todoItems
            : [
                { label: 'Synthesize outline', done: true },
                { label: 'Attach datasets', done: true },
                { label: 'Review responses', done: false },
              ]
          ).map((item, idx) => (
            <div key={`${title}-todo-${idx}`} className="flex items-center gap-1.5 text-[10px]">
              <div
                className={`flex h-3.5 w-3.5 items-center justify-center rounded-sm border text-white ${
                  item.done
                    ? 'border-emerald-500 bg-emerald-500'
                    : 'border-slate-300 bg-transparent dark:border-[#2A2A2A]'
                }`}
              >
                {item.done && <CheckCircle2 size={7} className="text-white" />}
              </div>
              <p
                className={`flex-1 rounded-sm px-1 py-0.5 ${
                  item.done
                    ? 'bg-slate-100 text-slate-500 line-through dark:bg-[#141414] dark:text-slate-500'
                    : 'bg-white text-slate-700 dark:bg-[#0B0B0B] dark:text-slate-200'
                }`}
              >
                {item.label}
              </p>
            </div>
          ))}
        </div>
      )}
      {type === 'file' && (
        <div className="space-y-1">
          {[
            { name: 'Research.pdf', label: 'AI Brief', size: '2.3 MB' },
            { name: 'Mindmap.svg', label: 'Layout', size: '640 KB' },
          ].map((file) => (
            <div
              key={file.name}
              className="flex items-center justify-between rounded border border-slate-100 bg-slate-50 px-2 py-1 text-[9px] text-slate-600 dark:border-[#1F1F1F] dark:bg-[#111111] dark:text-slate-200"
            >
              <div className="flex items-center gap-1 truncate">
                <Folder size={10} className="text-slate-400 dark:text-slate-500" />
                <div className="flex flex-col leading-tight">
                  <span className="font-semibold">{file.label}</span>
                  <span className="text-[8px] text-slate-400 dark:text-slate-500">{file.name}</span>
                </div>
              </div>
              <span className="text-[8px] text-slate-400 dark:text-slate-500">{file.size}</span>
            </div>
          ))}
        </div>
      )}
    </div>
      </motion.div>
    </motion.div>
  );
};

type StagedCanvasNodeProps = {
  node: StagedNode;
  scrollProgress: MotionValue<number>;
  widgetData: WidgetData;
};

const StagedCanvasNode = ({ node, scrollProgress, widgetData }: StagedCanvasNodeProps) => {
  const opacity = useTransform(scrollProgress, [node.start, node.start + 0.05], [0, 1]);
  const scale = useTransform(scrollProgress, [node.start, node.start + 0.08], [0.75, 1]);

  if (node.hidden) return null;

  return (
    <CanvasNode
      title={node.title}
      type={node.type}
      content={node.content}
      bodyLines={node.bodyLines}
      todoItems={node.todoItems}
      widgetData={widgetData}
      diagramLabels={node.diagramLabels}
      left={node.left}
      top={node.top}
      width={node.width}
      scale={scale}
      opacity={opacity}
      delay={node.delay}
      variant={node.variant}
    />
  );
};

const ZmindLogoMark = ({ className, size = 28, src }: { className?: string; size?: number; src: string }) => (
  <Image
    src={src}
    alt="Zmind logo"
    width={size}
    height={size}
    className={cn('h-7 w-7 select-none object-contain', className)}
    priority={false}
  />
);

const ZmindHeroInterface = ({
  scrollProgress,
  logoSymbolSrc,
  compact = false,
}: {
  scrollProgress: MotionValue<number>;
  logoSymbolSrc: string;
  compact?: boolean;
}) => {
  const t = useTranslations();
  const locale = useLocale();
  const isZh = locale?.toLowerCase().startsWith('zh');
  const canvasCopy = useMemo(
    () =>
      isZh
        ? {
            nodes: {
              coreTitle: '思考主线',
              coreLines: [
                '把聊天、PDF、白板摘录串成同一条逻辑链。',
                '论点 ↔ 证据 ↔ 追问 全部保留引用。',
                '复盘、写稿、二次提问都能直接复用。',
              ],
              sourcesTitle: '来源汇聚',
              userflowTitle: '推理图谱',
              tasksTitle: '追问队列',
              designTitle: '图表摘录',
              notesTitle: '知识卡片',
              notesLines: [
                '在论点旁挂上引用链接和页码。',
                '把矛盾、边界条件写成追问模板。',
                '同步回知识库，随时再次提问。',
              ],
              todoItems: [
                { label: '聚合聊天高亮为论点', done: true },
                { label: '附上 PDF 片段与出处', done: true },
                { label: '生成下一轮追问清单', done: false },
              ],
            },
            widget: {
              badge: '来源',
              timerLabel: '实时',
              focusLabel: '来源',
              remainingLabel: '更新',
              autoLabel: '自动同步 ChatGPT / PDF / 图片',
              orderLabel: '流',
              loopLabel: '活跃',
              phases: ['聊天记录', '论文 PDF', '截图/网页'],
            },
            diagram: {
              chat: '聊天摘录',
              pdf: 'PDF 片段',
              notes: '白板/笔记',
              claim: '论点',
              evidence: '证据',
              followUp: '追问清单',
            },
            aiPanel: {
              userPrompt: '把聊天和 PDF 要点整理成可追溯的推理链。',
              summary: '论点、证据、引用与追问已串成推理图谱，可随时复盘或继续追问。',
              guidanceTitle: '推理路径',
              guidanceList: [
                '把聊天高亮与 PDF 引文落到核心节点，保持论点-证据清晰。',
                '在图谱上标记假设、来源与矛盾，生成下一轮追问。',
                '把追问放到待办清单，随时再次提问或同步团队。',
              ],
              promptsTitle: '下一步提问',
              promptsList: [
                '“帮我核对这些引用是否一致，标出冲突。”',
                '“基于当前论点生成 3 个可验证假设与实验方法。”',
                '“把图谱压缩成 200 字摘要和英文提要。”',
              ],
              thinking: 'AI 正在整理…',
              status: '画布已同步',
            },
          }
        : {
            nodes: {
              coreTitle: 'Thinking Thread',
              coreLines: [
                'Link chat highlights, PDFs, and canvas notes into one chain.',
                'Claims ↔ evidence ↔ follow-ups stay citation-ready.',
                'Reuse this thread for reviews, coauthors, and re-asks.',
              ],
              sourcesTitle: 'Source Dock',
              userflowTitle: 'Reasoning Graph',
              tasksTitle: 'Follow-up Queue',
              designTitle: 'Figure Snippet',
              notesTitle: 'Knowledge Card',
              notesLines: [
                'Pin links and citations right next to each claim.',
                'Log conflicts/edge cases as reusable prompts.',
                'Sync back to the knowledge base for re-asking.',
              ],
              todoItems: [
                { label: 'Cluster chat highlights into claims', done: true },
                { label: 'Attach PDF snippets with citations', done: true },
                { label: 'Draft follow-up prompts for gaps', done: false },
              ],
            },
            widget: {
              badge: 'Sources',
              timerLabel: 'Live',
              focusLabel: 'Feed',
              remainingLabel: 'Freshness',
              autoLabel: 'Auto-sync ChatGPT / PDFs / images',
              orderLabel: 'Streams',
              loopLabel: 'Active',
              phases: ['Chat log', 'Paper PDF', 'Screenshots'],
            },
            diagram: {
              chat: 'Chat thread',
              pdf: 'PDF clips',
              notes: 'Canvas notes',
              claim: 'Claim',
              evidence: 'Evidence',
              followUp: 'Follow-up prompts',
            },
            aiPanel: {
              userPrompt: 'Turn the chat + PDFs into a traceable reasoning thread with citations.',
              summary:
                'Claims, evidence, citations, and follow-ups are linked on the map so you can re-ask or brief collaborators without losing context.',
              guidanceTitle: 'Reasoning Path',
              guidanceList: [
                'Drop chat highlights + PDF citations into the core node to anchor claims.',
                'Mark hypotheses, sources, and conflicts on the graph to surface gaps.',
                'Push follow-ups into the checklist and re-ask the model with full context.',
              ],
              promptsTitle: 'Next Prompts',
              promptsList: [
                '"Check these citations for conflicts and surface the gaps."',
                '"Turn the claims into 3 testable hypotheses with methods."',
                '"Condense the map into a 200-word abstract + English summary."',
              ],
              thinking: 'AI is structuring…',
              status: 'Canvas Updated',
            },
          },
    [isZh],
  );
  const chatX = useTransform(scrollProgress, [0, 0.15], [50, 0]);
  const chatOpacity = useTransform(scrollProgress, [0, 0.1], [0, 1]);
  const msgUserOpacity = useTransform(scrollProgress, [0.15, 0.2], [0, 1]);
  const aiThinkingOpacity = useTransform(scrollProgress, [0.2, 0.25], [0, 1]);
  const aiThinkingDisplay = useTransform(scrollProgress, (v) => (v > 0.28 ? 'none' : 'flex'));
  const msgAiOpacity = useTransform(scrollProgress, [0.28, 0.35], [0, 1]);
  const msgAiY = useTransform(scrollProgress, [0.28, 0.35], [10, 0]);
  const lineProgress = useSpring(
    useTransform(scrollProgress, [0.36, 0.5], [0, 1]),
    { stiffness: 140, damping: 18 },
  );
  const lineOpacity = useTransform(scrollProgress, [0.36, 0.45], [0, 1]);
  const toolset = [
    { label: t('home.hero.canvas.tools.select'), icon: MousePointer2 },
    { label: t('home.hero.canvas.tools.write'), icon: PenTool },
    { label: t('home.hero.canvas.tools.ai'), icon: Wand2 },
    { label: t('home.hero.canvas.tools.layout'), icon: LayoutGrid },
    { label: t('home.hero.canvas.tools.code'), icon: Code },
  ];
  const creationTools = [Type, CheckSquare, Network, FileCode2, FolderPlus, Table, Mic, Link2];
  const topBarActions = [
    { id: 'files', icon: FolderOpen, label: 'Files' },
    { id: 'outline', icon: FileText, label: 'Outline' },
    { id: 'timeline', icon: Wand2, label: 'Timeline' },
  ] as const;
  const desktopNodeLayout: NodeConfig[] = [
    {
      id: 'core',
      title: canvasCopy.nodes.coreTitle,
      type: 'text',
      bodyLines: canvasCopy.nodes.coreLines,
      left: 45,
      top: 45,
      width: 180,
      start: 0.26,
    },
    {
      id: 'sources',
      title: canvasCopy.nodes.sourcesTitle,
      type: 'widget',
      left: 20,
      top: 25,
      width: 185,
      start: 0.32,
    },
    {
      id: 'userflow',
      title: canvasCopy.nodes.userflowTitle,
      type: 'mermaid',
      left: 60,
      top: 25,
      width: 180,
      start: 0.38,
      diagramLabels: canvasCopy.diagram,
    },
    {
      id: 'tasks',
      title: canvasCopy.nodes.tasksTitle,
      type: 'todo',
      left: 20,
      top: 80,
      width: 150,
      start: 0.44,
      todoItems: canvasCopy.nodes.todoItems,
    },
    {
      id: 'design',
      title: canvasCopy.nodes.designTitle,
      type: 'image',
      left: 20,
      top: 60,
      width: 150,
      start: 0.5,
    },
    {
      id: 'notes',
      title: canvasCopy.nodes.notesTitle,
      type: 'text',
      left: 58,
      top: 70,
      width: 170,
      start: 0.54,
      bodyLines: canvasCopy.nodes.notesLines,
    },
  ];
  const compactNodeLayout: NodeConfig[] = [
    {
      id: 'core',
      title: canvasCopy.nodes.coreTitle,
      type: 'text',
      bodyLines: canvasCopy.nodes.coreLines,
      left: 50,
      top: 44,
      width: 160,
      start: 0.26,
    },
    {
      id: 'sources',
      title: canvasCopy.nodes.sourcesTitle,
      type: 'widget',
      left: 22,
      top: 20,
      width: 150,
      start: 0.32,
    },
    {
      id: 'userflow',
      title: canvasCopy.nodes.userflowTitle,
      type: 'mermaid',
      left: 78,
      top: 23,
      width: 150,
      start: 0.38,
      diagramLabels: canvasCopy.diagram,
    },
    {
      id: 'tasks',
      title: canvasCopy.nodes.tasksTitle,
      type: 'todo',
      left: 25,
      top: 74,
      width: 130,
      start: 0.44,
      todoItems: canvasCopy.nodes.todoItems,
    },
    {
      id: 'design',
      title: canvasCopy.nodes.designTitle,
      type: 'image',
      left: 78,
      top: 60,
      width: 130,
      start: 0.5,
    },
    {
      id: 'notes',
      title: canvasCopy.nodes.notesTitle,
      type: 'text',
      left: 55,
      top: 86,
      width: 150,
      start: 0.54,
      bodyLines: canvasCopy.nodes.notesLines,
    },
  ];
  const baseLayout = compact ? compactNodeLayout : desktopNodeLayout;
  const nodeLayout = baseLayout.map((config) =>
    compact && config.id === 'sources' ? { ...config, hidden: true } : config,
  );
  const stagedNodes = useMemo<StagedNode[]>(
    () =>
      nodeLayout.map((config) => ({
        ...config,
        delay: config.start,
        leftPercent: config.left,
        topPercent: config.top,
        left: `${config.left}%`,
        top: `${config.top}%`,
      })),
    [nodeLayout],
  );
  const connectors = useMemo(() => {
    const nodeMap = Object.fromEntries(stagedNodes.map((node) => [node.id, node]));
    const specs = [
      { from: 'sources', to: 'core', direction: 'h', curve: -6 },
      { from: 'core', to: 'userflow', direction: 'h', curve: -4 },
      { from: 'userflow', to: 'tasks', direction: 'v', curve: -12 },
      { from: 'tasks', to: 'notes', direction: 'h', curve: 10 },
      { from: 'notes', to: 'design', direction: 'h', curve: -8 },
    ];
    return specs
      .map((spec) => {
        const from = nodeMap[spec.from];
        const to = nodeMap[spec.to];
        if (!from || !to || from.hidden || to.hidden) return null;
        
        const mx = (from.leftPercent + to.leftPercent) / 2;
        const my = (from.topPercent + to.topPercent) / 2;
        
        let cx = mx;
        let cy = my;
        
        if (spec.direction === 'v') {
           cx += spec.curve; 
        } else {
           cy += spec.curve;
        }

        return {
          id: `${spec.from}-${spec.to}`,
          path: `M ${from.leftPercent} ${from.topPercent} Q ${cx} ${cy} ${to.leftPercent} ${to.topPercent}`,
          to,
        };
      })
      .filter(Boolean) as Array<{
        id: string;
        path: string;
        to: (typeof stagedNodes)[number];
      }>;
  }, [stagedNodes]);
  const leftToolbarX = useTransform(scrollProgress, [0.1, 0.2], [-20, 0]);
  const leftToolbarOpacity = useTransform(scrollProgress, [0.1, 0.2], [0, 1]);
  const sidebarSources = isZh
    ? [
        { label: '聊天摘录', icon: FileText },
        { label: 'PDF 片段', icon: FileText },
        { label: '我的笔记', icon: Type },
        { label: '灵感随记', icon: Sparkles },
      ]
    : [
        { label: 'Chat captures', icon: FileText },
        { label: 'PDF clips', icon: FileText },
        { label: 'My notebook', icon: Type },
        { label: 'Inspiration inbox', icon: Sparkles },
      ];
  const sidebarWorkspaces = isZh
    ? [
        { label: 'Project Alpha', active: true },
        { label: '研究笔记', active: false },
        { label: '灵感清单', active: false },
      ]
    : [
        { label: 'Project Alpha', active: true },
        { label: 'Research Notes', active: false },
        { label: 'Inspiration Log', active: false },
      ];

  return (
    <div className="relative flex h-full w-full select-none overflow-hidden rounded-xl border border-slate-200 bg-slate-50 text-slate-800 shadow-2xl dark:border-[#1E1E1E] dark:bg-[#0B0B0B]">
      <div className="hidden h-full w-52 flex-shrink-0 flex-col border-r border-slate-200 bg-white dark:border-[#1E1E1E] dark:bg-[#0B0B0B]/70 md:flex">
        <div className="flex h-12 items-center gap-2 border-b border-slate-200 px-4 dark:border-[#1E1E1E]">
          <ZmindLogoMark src={logoSymbolSrc} />
          <span className="text-sm font-bold">Zmind</span>
        </div>
        <div className="p-3">
          <div className="flex items-center gap-2 rounded-md border border-slate-200 bg-white px-2 py-1.5 text-xs font-medium text-slate-600 shadow-sm dark:border-[#2A2A2A] dark:bg-[#171717] dark:text-slate-200">
            <Plus size={14} /> New Thinking
          </div>
        </div>
        <div className="flex-1 space-y-3 overflow-y-auto px-2 py-1">
          <div className="flex items-center gap-1 px-2 text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">
            {isZh ? '来源' : 'Sources'}
          </div>
          {sidebarSources.map(({ label, icon: Icon }) => (
            <div
              key={label}
              className="flex items-center gap-2 rounded-md px-2 py-1.5 text-xs text-slate-600 transition hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-[#171717]"
            >
              <Icon size={13} className="text-slate-400 dark:text-slate-500" />
              {label}
            </div>
          ))}
          <div className="flex items-center gap-1 px-2 pt-1 text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">
            {isZh ? '工作区' : 'Workspace'}
          </div>
          {sidebarWorkspaces.map((item) => (
            <div
              key={item.label}
              className={`flex items-center gap-2 rounded-md px-2 py-1.5 text-xs ${
                item.active
                  ? 'bg-blue-50 text-blue-600 dark:bg-blue-500/10 dark:text-blue-100'
                  : 'text-slate-600 dark:text-slate-300'
              }`}
            >
              <Folder
                size={14}
                className={item.active ? 'text-blue-500 dark:text-blue-200' : 'text-slate-400 dark:text-slate-500'}
              />
              {item.label}
            </div>
          ))}
        </div>
      </div>
      <div className="flex flex-1 flex-col">
        <div className="flex h-12 items-center justify-between border-b border-slate-200 bg-white px-4 text-sm dark:border-[#1E1E1E] dark:bg-[#0B0B0B]/80">
          <div className="flex items-center gap-2 text-slate-700 dark:text-slate-200">
            <span className="text-slate-400 dark:text-slate-400">Workspace /</span>
            <span>Project Alpha</span>
          </div>
          <div className="flex items-center gap-3 text-slate-500 dark:text-slate-300">
            {topBarActions.map(({ id, icon: Icon }) => (
              <button
                key={id}
                type="button"
                className="flex h-8 w-8 items-center justify-center rounded-full text-slate-500 transition hover:text-slate-800 dark:text-slate-300 dark:hover:text-white"
                aria-label={id}
              >
                <Icon size={14} aria-hidden />
              </button>
            ))}
            <span className="h-6 w-px bg-slate-200 dark:bg-[#1E1E1E]" aria-hidden />
            <button
              type="button"
              className="flex items-center gap-1 text-xs font-semibold text-slate-700 transition hover:text-slate-900 dark:text-slate-100 dark:hover:text-white"
            >
              <GoldStarAI size={16} />
              <span>AI</span>
            </button>
          </div>
        </div>
        <div className="relative flex-1 overflow-hidden">
          <div
            className="absolute inset-0 opacity-30"
            style={{ backgroundImage: 'radial-gradient(#94a3b8 1px, transparent 1px)', backgroundSize: '22px 22px' }}
          />
          <div
            className={cn('relative h-full w-full', compact && 'px-2 py-3')}
            style={compact ? { transform: 'scale(0.92)', transformOrigin: '50% 15%' } : undefined}
          >
            <motion.div
              style={{ opacity: leftToolbarOpacity, x: leftToolbarX }}
              className="pointer-events-none absolute left-1 top-1/2 z-20 hidden -translate-y-1/2 flex-col items-center gap-2 md:flex"
            >
              {toolset.map(({ label, icon: Icon }) => (
                <div key={label} className="flex h-8 w-8 items-center justify-center text-slate-500 dark:text-slate-300">
                  <Icon size={14} aria-hidden />
                </div>
              ))}
              <div className="h-3" />
              {creationTools.map((Icon, idx) => (
                <div key={`creation-${idx}`} className="flex h-8 w-8 items-center justify-center text-slate-500 dark:text-slate-300">
                  <Icon size={13} aria-hidden />
                </div>
              ))}
            </motion.div>
            {stagedNodes.map((node) => (
              <StagedCanvasNode
                key={node.id}
                node={node}
                scrollProgress={scrollProgress}
                widgetData={canvasCopy.widget}
              />
            ))}
            <svg
              className="pointer-events-none absolute inset-0 h-full w-full text-slate-900 dark:text-slate-200"
              viewBox="0 0 100 100"
              preserveAspectRatio="none"
            >
              <defs>
                <marker id="heroArrow" markerWidth="7" markerHeight="7" refX="5.5" refY="3.5" orient="auto">
                  <path d="M0,0 L7,3.5 L0,7 Z" fill="currentColor" />
                </marker>
              </defs>
              {connectors.map(({ id, path }) => (
                <motion.path
                  key={id}
                  d={path}
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="0.28"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  markerEnd="url(#heroArrow)"
                  style={{ pathLength: lineProgress, opacity: lineOpacity }}
                />
              ))}
            </svg>
          </div>
        </div>
      </div>
      <motion.div
        style={{ x: chatX, opacity: chatOpacity }}
        className="absolute right-4 top-16 bottom-4 hidden w-72 flex-col overflow-hidden rounded-xl border border-slate-200/50 bg-white/80 shadow-lg backdrop-blur-md dark:border-white/10 dark:bg-[#0B0B0B]/70 xl:flex"
      >
        <div className="flex h-12 items-center gap-2 border-b border-slate-100/60 px-4 dark:border-white/10">
          <ZmindLogoMark src={logoSymbolSrc} className="h-8 w-8 bg-transparent ring-0 dark:bg-transparent" size={80} />
          <span className="text-sm font-bold text-slate-800 dark:text-white">Zmind AI</span>
        </div>
        <div className="flex flex-1 flex-col space-y-4 overflow-hidden bg-white/40 p-4 dark:bg-white/5">
          <motion.div style={{ opacity: msgUserOpacity }} className="flex flex-row-reverse gap-3">
            <div className="h-6 w-6 rounded-full bg-slate-200 dark:bg-[#1F1F1F]" />
            <div className="max-w-[85%] rounded-lg rounded-tr-none border border-slate-200 bg-white p-2.5 text-xs text-slate-700 shadow-sm dark:border-[#2A2A2A] dark:bg-[#171717] dark:text-slate-100">
              {canvasCopy.aiPanel.userPrompt}
            </div>
          </motion.div>
          <motion.div
            style={{ opacity: aiThinkingOpacity, display: aiThinkingDisplay }}
            className="flex items-center gap-2 pl-2 text-xs text-slate-400 dark:text-slate-500"
          >
            <Loader2 size={12} className="animate-spin" />
            <span>{canvasCopy.aiPanel.thinking}</span>
          </motion.div>
          <motion.div style={{ opacity: msgAiOpacity, y: msgAiY }} className="flex gap-2">
            <ZmindLogoMark
              src={logoSymbolSrc}
              size={28}
              className="h-6 w-6 rounded-sm bg-transparent p-0"
            />
            <div className="space-y-2 text-xs text-slate-700 dark:text-slate-200">
              <p className="font-medium">{canvasCopy.aiPanel.summary}</p>
              <div className="rounded-lg border border-slate-200/60 bg-white/80 p-2 text-[11px] text-slate-600 shadow-sm dark:border-white/10 dark:bg-white/5 dark:text-slate-300">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                  {canvasCopy.aiPanel.guidanceTitle}
                </p>
                <ol className="mt-1 list-decimal space-y-1 pl-4">
                  {canvasCopy.aiPanel.guidanceList.map((item, idx) => (
                    <li key={`guidance-${idx}`}>{item}</li>
                  ))}
                </ol>
              </div>
              <div className="rounded-lg border border-emerald-200/60 bg-emerald-50/70 p-2 text-[11px] text-emerald-800 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-200">
                <p className="text-[10px] font-semibold uppercase tracking-wide opacity-80">
                  {canvasCopy.aiPanel.promptsTitle}
                </p>
                <ul className="mt-1 list-disc space-y-1 pl-4 text-[10px]">
                  {canvasCopy.aiPanel.promptsList.map((item, idx) => (
                    <li key={`prompt-${idx}`}>{item}</li>
                  ))}
                </ul>
              </div>
              <div className="flex items-center gap-1 text-[10px] font-medium text-emerald-600 dark:text-emerald-300">
                <CheckCircle2 size={10} /> {canvasCopy.aiPanel.status}
              </div>
            </div>
          </motion.div>
        </div>
        <div className="border-t border-slate-100 bg-white p-3 dark:border-[#1E1E1E] dark:bg-[#0B0B0B]">
          <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-400 dark:border-[#2A2A2A] dark:bg-[#171717] dark:text-slate-500">
            <span className="flex-1">Follow up...</span>
            <div className="flex h-6 w-6 items-center justify-center rounded bg-slate-200 text-white dark:bg-[#1F1F1F]">
              <ArrowRight size={12} />
            </div>
          </div>
        </div>
      </motion.div>
    </div>
  );
};

export function HeroSection() {
  const t = useTranslations();
  const locale = useLocale();
  const isZh = locale?.toLowerCase().startsWith('zh');
  const tablet = useMediaQuery('(max-width: 1024px)');
  const phablet = useMediaQuery('(max-width: 768px)');
  const mobile = useMediaQuery('(max-width: 480px)');
  const { scrollY } = useScroll();
  const stickyRef = useRef<HTMLDivElement | null>(null);
  const { scrollYProgress } = useScroll({
    target: stickyRef,
    offset: ['start start', 'end end'],
  });
  const router = useRouter();
  const { user } = useAuth();
  const { resolvedTheme } = useTheme();
  const [isMounted, setIsMounted] = useState(false);

  useEffect(() => {
    setIsMounted(true);
  }, []);

  const isDark = isMounted && resolvedTheme === 'dark';
  const logoSymbolSrc = isDark ? '/zmind-symbol.svg' : '/zmind-symbol-light.svg';
  const stickyEnabled = !phablet;
  const heroAspectClass = mobile ? 'aspect-[3/4]' : phablet ? 'aspect-[4/5]' : 'aspect-[15/9]';
  const heroInterfaceAspectClass = stickyEnabled ? 'aspect-[15/9]' : heroAspectClass;
  const staticScrollProgress = useMotionValue(1);
  const heroScrollProgress = stickyEnabled ? scrollYProgress : staticScrollProgress;

  const heroY = useTransform(scrollY, [0, 300], [0, -40]);
  const heroYSpring = useSpring(heroY, { stiffness: 120, damping: 20 });

  const cardScale = useSpring(
    useTransform(scrollYProgress, [0, 0.25], [0.95, 1]),
    { stiffness: 120, damping: 22 },
  );
  const cardY = useSpring(
    useTransform(scrollYProgress, [0, 0.25], [80, 0]),
    { stiffness: 120, damping: 22 },
  );
  const heroOpacity = useSpring(
    useTransform(scrollYProgress, [0.05, 0.25], [1, 0]),
    { stiffness: 120, damping: 20 },
  );

  const badgeText = t('home.hero.badge');
  const titleLine1 = t('home.hero.titleLine1');
  const titleLine2 = t('home.hero.titleLine2');
  const highlight = t('home.hero.highlight');
  const subtitle = t('home.hero.subtitle');
  const toPrefix = t('home.hero.toPrefix', { default: 'to' });
  const heroWords = useMemo(() => {
    try {
      const raw = t.raw('home.hero.words');
      if (Array.isArray(raw)) {
        return raw.filter((word): word is string => typeof word === 'string' && word.trim().length > 0);
      }
      return [];
    } catch {
      return [];
    }
  }, [t]);
  const rotatingWords = heroWords.length > 0 ? heroWords : [titleLine2];
  const [wordIndex, setWordIndex] = useState(0);

  useEffect(() => {
    if (rotatingWords.length <= 1) return undefined;
    const interval = setInterval(() => {
      setWordIndex((prev) => (prev + 1) % rotatingWords.length);
    }, 2600);
    return () => clearInterval(interval);
  }, [rotatingWords.length]);

  useEffect(() => {
    if (wordIndex >= rotatingWords.length) {
      setWordIndex(0);
    }
  }, [rotatingWords.length, wordIndex]);

  const currentWord = rotatingWords[wordIndex] ?? rotatingWords[0];

  const heroContent = (
    <div className="flex flex-col items-center text-center">
      {badgeText && (
        <div className="mb-3 flex items-center justify-center gap-2 text-2xl font-medium tracking-tighter text-slate-700 opacity-50 dark:text-slate-300">
          {badgeText}
        </div>
      )}
      <h1 className="text-[2.25rem] font-bold leading-tight tracking-tight text-slate-900 dark:text-white md:text-[4rem] lg:text-[5rem]">
        <span className="block">{titleLine1}</span>
        <span className="mt-3 flex flex-wrap items-center justify-center gap-3 text-slate-900 dark:text-white sm:justify-center">
          <span className="text-slate-900 dark:text-white">{toPrefix}</span>
          <span className="relative inline-flex h-[1.3em] min-w-[5ch] items-center justify-center overflow-hidden text-brand-600 dark:text-brand-400">
            <AnimatePresence mode="wait" initial={false}>
              <motion.span
                key={currentWord}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.4, ease: 'easeInOut' }}
                className="block"
              >
                {currentWord}
              </motion.span>
            </AnimatePresence>
          </span>
          <span className="text-slate-900 dark:text-white">{highlight}</span>
        </span>
      </h1>
      <p className="mt-5 text-base text-slate-500 dark:text-slate-300 md:text-lg">
        {subtitle}
      </p>
      <div className="mt-8 flex w-full flex-col items-center gap-5 sm:flex-row sm:justify-center sm:gap-8">
        <Button
          asChild
          className="h-auto w-full cursor-pointer rounded-none border border-slate-900 bg-slate-900 px-8 py-3 text-base text-white hover:bg-slate-800 dark:border-foreground dark:bg-foreground dark:text-background sm:w-64"
        >
          <Link href={user ? '/dashboard' : '/auth'} className="flex items-center justify-center">
            {t('auth.buttons.getStarted')}
          </Link>
        </Button>
        <Button
          className="h-auto w-full cursor-pointer rounded-none border border-border bg-card px-8 py-3 text-base text-foreground hover:bg-muted sm:w-64"
          onClick={() => {
            router.push('/invite');
          }}
        >
          {t('auth.buttons.requestInvite')}
        </Button>
      </div>
    </div>
  );

  const heroCard = (
    <div className="w-full rounded-3xl border border-border bg-card shadow-[0_20px_60px_rgba(15,23,42,0.12)]" data-hero-surface>
      <div
        className={cn(
          'overflow-hidden rounded-3xl bg-muted',
          heroInterfaceAspectClass,
        )}
      >
        <ZmindHeroInterface
          scrollProgress={heroScrollProgress}
          logoSymbolSrc={logoSymbolSrc}
          compact={phablet}
        />
      </div>
    </div>
  );

  const heroSurfaceStyles = (
    <style jsx global>{`
      /* Normalize demo surfaces inside hero card to theme tokens */
      [data-hero-surface] .bg-white,
      [data-hero-surface] .bg-slate-50,
      [data-hero-surface] .bg-slate-100 {
        background-color: var(--card) !important;
      }
      [data-hero-surface] .bg-white\/5,
      [data-hero-surface] .bg-white\/10,
      [data-hero-surface] .bg-white\/20,
      [data-hero-surface] .bg-white\/25,
      [data-hero-surface] .bg-white\/30,
      [data-hero-surface] .bg-white\/40,
      [data-hero-surface] .bg-white\/50,
      [data-hero-surface] .bg-white\/60,
      [data-hero-surface] .bg-white\/70,
      [data-hero-surface] .bg-white\/80,
      [data-hero-surface] .bg-white\/90 {
        background-color: color-mix(in oklab, var(--card) 75%, transparent) !important;
      }
      [data-hero-surface] .bg-slate-50\/50,
      [data-hero-surface] .bg-slate-100\/50,
      [data-hero-surface] .bg-slate-100\/80 {
        background-color: color-mix(in oklab, var(--card) 80%, transparent) !important;
      }
      [data-hero-surface] .border-slate-100,
      [data-hero-surface] .border-slate-200,
      [data-hero-surface] .border-gray-200,
      [data-hero-surface] .border-[#1E1E1E],
      [data-hero-surface] .border-white {
        border-color: var(--border) !important;
      }
    `}</style>
  );

  if (!stickyEnabled) {
    return (
      <>
        <section id="hero" className="relative w-full bg-transparent">
          <div className="mx-auto flex max-w-3xl flex-col gap-10 px-4 pb-16 pt-20 sm:pt-24">
            {heroContent}
            {heroCard}
          </div>
        </section>
        {heroSurfaceStyles}
      </>
    );
  }

  return (
    <>
      <section id="hero" className="relative w-full bg-transparent">
        <motion.div
          style={stickyEnabled ? { opacity: heroOpacity, y: heroYSpring } : undefined}
          className={cn(
            'z-10 flex w-full flex-col items-center justify-start text-center',
            stickyEnabled
              ? 'sticky top-0 max-w-4xl px-4 pt-10 pb-1 md:pt-16 mx-auto min-h-[45vh]'
              : 'relative mx-auto max-w-3xl px-4 pt-12 pb-6 sm:pt-16'
          )}
        >
          {heroContent}
        </motion.div>

        <div className={cn('relative z-20 w-full', stickyEnabled ? 'pointer-events-none' : 'pointer-events-auto')}>
          <div className={stickyEnabled ? 'h-0' : 'h-8'} />
          <div ref={stickyRef} className={stickyEnabled ? 'h-[240vh]' : 'h-auto'}>
            <div
              className={cn(
                'flex w-full items-center justify-center',
                stickyEnabled ? 'sticky top-0 h-screen px-4 sm:px-6' : 'relative px-2 pb-6 pt-4 sm:px-4'
              )}
            >
              <motion.div
                style={stickyEnabled ? { scale: cardScale, y: cardY } : undefined}
                className={cn(
                  'w-full rounded-3xl border border-border bg-card shadow-[0_30px_100px_rgba(15,23,42,0.12)] pointer-events-auto',
                  tablet ? 'max-w-full' : 'max-w-[1300px]'
                )}
              >
                {heroCard}
              </motion.div>
            </div>
          </div>
          {stickyEnabled && <div className="h-8" />}
        </div>
      </section>
      {heroSurfaceStyles}
    </>
  );
}
