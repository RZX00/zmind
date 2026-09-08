'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { motion, AnimatePresence, useInView } from 'motion/react';
import {
  ArrowRight,
  Sparkles,
  FileText,
  Image as ImageIcon,
  ListTodo,
  CheckCircle2,
  Link2,
  StickyNote,
  Wand2,
  BarChart3,
  Users,
  MousePointer2,
  Heart,
  Loader2,
  TrendingUp,
} from 'lucide-react';

const WorkflowVisual = () => (
  <div className="relative aspect-[4/3] w-full min-h-[320px] overflow-hidden rounded-2xl border border-border bg-gradient-to-b from-card to-muted shadow-sm dark:from-[#050505] dark:to-[#050505]">
    <div
      className="pointer-events-none absolute inset-0 opacity-20"
      style={{
        backgroundImage:
          'linear-gradient(var(--border) 1px, transparent 1px), linear-gradient(90deg, var(--border) 1px, transparent 1px)',
        backgroundSize: '40px 40px',
      }}
    />
    <motion.div
      initial={{ top: '-10%' }}
      animate={{ top: ['-10%', '110%'] }}
      transition={{ duration: 2.5, ease: 'linear', repeat: Infinity, repeatDelay: 3 }}
      className="absolute left-0 right-0 h-1 bg-gradient-to-b from-emerald-500/0 via-emerald-400/50 to-emerald-500/0 shadow-[0_0_15px_rgba(16,185,129,0.25)]"
    />
    <div className="absolute inset-0 flex flex-col justify-between p-8">
      <div className="flex items-start gap-6">
        {['Article.pdf', 'Chart.png', 'Notes'].map((label, idx) => (
          <motion.div
            key={label}
            initial={{ opacity: 0, y: 10 }}
            whileInView={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 * idx }}
            className="w-36 rounded-xl border border-border bg-card p-3 text-[10px] text-foreground shadow-sm transition-shadow hover:shadow-md"
          >
            <div className="mb-2 flex items-center gap-2 text-slate-500">
              <div className="flex h-6 w-6 items-center justify-center rounded bg-muted">
                {idx === 0 && <FileText size={12} className="text-rose-400" />}
                {idx === 1 && <ImageIcon size={12} className="text-blue-400" />}
                {idx === 2 && <StickyNote size={12} className="text-yellow-500" />}
              </div>
              <span className="font-medium">{label}</span>
            </div>
            <div className="space-y-1.5">
              <div className="h-1.5 w-full rounded-full bg-muted" />
              <div className="h-1.5 w-4/5 rounded-full bg-muted" />
              <div className="h-1.5 w-2/5 rounded-full bg-muted" />
            </div>
          </motion.div>
        ))}
      </div>
      <div className="relative mt-6 flex items-center gap-4 rounded-2xl border border-border bg-card/80 p-5 text-foreground shadow-sm backdrop-blur">
        {/* Connecting Lines */}
        <svg className="absolute inset-0 h-full w-full pointer-events-none opacity-20 text-border" viewBox="0 0 100 100" preserveAspectRatio="none">
          <path d="M 20 0 V 30 C 20 40, 25 50, 35 50 H 65" stroke="currentColor" fill="none" strokeWidth="1.5" strokeDasharray="4 4" />
          <path d="M 50 0 V 30 C 50 40, 50 50, 50 50" stroke="currentColor" fill="none" strokeWidth="1.5" strokeDasharray="4 4" />
          <path d="M 80 0 V 30 C 80 40, 75 50, 65 50" stroke="currentColor" fill="none" strokeWidth="1.5" strokeDasharray="4 4" />
        </svg>

        <div className="flex-1 z-10">
          <div className="mb-3 flex items-center justify-between">
            <div className="text-[9px] font-semibold uppercase tracking-widest text-slate-400">
              Source
            </div>
            <div className="flex h-4 w-4 items-center justify-center rounded-full bg-emerald-100 text-emerald-600">
              <CheckCircle2 size={8} />
            </div>
          </div>
          <div className="space-y-2 rounded-lg border border-border bg-muted/60 p-2.5 text-[9px]">
            <div className="flex items-center gap-2">
              <div className="h-1.5 w-1.5 rounded-full bg-rose-400" />
              <span className="text-slate-600 dark:text-slate-300">Market_Report_2024.pdf</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="h-1.5 w-1.5 rounded-full bg-blue-400" />
              <span className="text-slate-600 dark:text-slate-300">Growth_Q3.png</span>
            </div>
          </div>
        </div>
        
        <div className="flex flex-col items-center gap-1">
          <motion.div 
            animate={{ scale: [1, 1.1, 1], opacity: [0.5, 1, 0.5] }}
            transition={{ duration: 2, repeat: Infinity }}
            className="h-1 w-12 rounded-full bg-gradient-to-r from-emerald-400 to-blue-500" 
          />
          <ArrowRight size={14} className="text-slate-300" />
        </div>

        <div className="flex-1 z-10">
          <div className="mb-3 flex items-center justify-between">
            <div className="text-[9px] font-semibold uppercase tracking-widest text-slate-400">
              Structured Output
            </div>
            <div className="flex gap-1">
              <div className="h-1.5 w-1.5 rounded-full bg-muted" />
              <div className="h-1.5 w-1.5 rounded-full bg-muted" />
            </div>
          </div>
          <div className="space-y-2 rounded-lg border border-border bg-card p-2.5 text-foreground shadow-sm">
            <div className="flex items-center gap-2 border-b border-border/60 pb-2">
              <div className="h-6 w-6 rounded bg-muted" />
              <div className="flex-1 space-y-1">
                <div className="h-1.5 w-3/4 rounded bg-muted" />
                <div className="h-1.5 w-1/2 rounded bg-muted/80" />
              </div>
            </div>
            <div className="flex items-end gap-1 pt-1">
              <div className="h-6 w-1/4 rounded-t bg-emerald-500/15" />
              <div className="h-10 w-1/4 rounded-t bg-emerald-500/20" />
              <div className="h-8 w-1/4 rounded-t bg-emerald-500/25" />
              <div className="h-12 w-1/4 rounded-t bg-emerald-500/30" />
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
);

const DeepThinkingVisual = () => {
  const [phase, setPhase] = useState('idle');
  const [text, setText] = useState('');
  const fullText = 'Analyze and Visualize structure.';

  useEffect(() => {
    let cancelled = false;
    const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

    const sequence = async () => {
      await wait(800);
      if (cancelled) return;
      setPhase('selecting');

      await wait(1200);
      if (cancelled) return;
      setPhase('typing');

      for (let i = 0; i <= fullText.length; i += 1) {
        if (cancelled) return;
        setText(fullText.slice(0, i));
        await wait(30);
      }

      await wait(400);
      if (cancelled) return;
      setPhase('converging');

      await wait(600);
      if (cancelled) return;
      setPhase('explosion');

      await wait(4000);
      if (cancelled) return;
      setPhase('done');
    };

    sequence();
    const loop = setInterval(() => {
      setPhase('idle');
      setText('');
      sequence();
    }, 10000);

    return () => {
      cancelled = true;
      clearInterval(loop);
    };
  }, []);

  return (
    <div className="relative aspect-[4/3] w-full min-h-[320px] overflow-hidden rounded-2xl border border-border bg-gradient-to-b from-card to-muted shadow-lg dark:from-[#050505] dark:to-[#050505]">
      <div
        className="absolute inset-0 opacity-30"
        style={{ backgroundImage: 'radial-gradient(#10b981 1px, transparent 1px)', backgroundSize: '30px 30px' }}
      />

      <AnimatePresence>
        {['idle', 'selecting', 'typing', 'converging'].includes(phase) && (
          <>
            {[{ top: '30%', left: '20%' }, { top: '40%', left: '50%' }, { top: '25%', left: '70%' }, { top: '55%', left: '30%' }, { top: '60%', left: '65%' }].map((pos, idx) => (
              <motion.div
                key={idx}
                initial={{ ...pos, opacity: 1, scale: 1 }}
                animate={
                  phase === 'converging'
                    ? { top: '50%', left: '50%', opacity: 0, scale: 0, rotate: idx * 45 }
                    : {}
                }
                exit={{ opacity: 0 }}
                transition={{ duration: 0.5, ease: 'easeInOut', delay: idx * 0.05 }}
                className="absolute z-10 w-20 rounded-lg border border-border bg-card p-2 text-[10px] shadow-sm"
              >
                <div className="mb-1 flex items-center gap-1 text-slate-500">
                  {idx % 3 === 0 && <FileText size={10} />}
                  {idx % 3 === 1 && <StickyNote size={10} className="text-yellow-500" />}
                  {idx % 3 === 2 && <ImageIcon size={10} className="text-blue-400" />}
                  <div className="h-1 w-8 rounded bg-muted" />
                </div>
                <div className="space-y-1">
                  <div className="h-1 w-full rounded bg-muted" />
                  <div className="h-1 w-2/3 rounded bg-muted" />
                </div>
              </motion.div>
            ))}
            
            {/* Neural Connections Background */}
            <svg className="absolute inset-0 h-full w-full pointer-events-none" viewBox="0 0 100 100" preserveAspectRatio="none">
              <motion.path
                d="M 20 30 L 50 40 L 70 25 L 65 60 L 30 55 Z"
                fill="none"
                stroke="#10b981"
                strokeWidth="0.5"
                strokeOpacity="0.2"
                initial={{ pathLength: 0, opacity: 0 }}
                animate={{ pathLength: 1, opacity: 1 }}
                transition={{ duration: 1.5 }}
              />
              <motion.circle cx="50%" cy="50%" r="80" fill="none" stroke="#10b981" strokeWidth="0.5" strokeOpacity="0.1" 
                animate={{ scale: [0.8, 1.2, 0.8], opacity: [0.1, 0.3, 0.1] }}
                transition={{ duration: 3, repeat: Infinity }}
              />
            </svg>
          </>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {['selecting', 'typing'].includes(phase) && (
          <motion.div
            initial={{ width: 0, height: 0, opacity: 0, left: '15%', top: '20%' }}
            animate={{ width: '70%', height: '45%', opacity: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            transition={{ duration: 0.6, ease: 'easeOut' }}
            className="absolute rounded-xl border border-emerald-500 bg-emerald-500/5"
          >
            <div className="absolute -top-3 left-2 rounded-sm bg-emerald-500 px-1.5 py-0.5 text-[8px] text-white shadow">
              Selected: 3 items
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {['typing', 'converging'].includes(phase) && (
          <motion.div
            initial={{ y: 20, opacity: 0, scale: 0.95 }}
            animate={{ y: 0, opacity: 1, scale: 1 }}
            exit={{ y: 10, opacity: 0, scale: 0.9 }}
            className="absolute bottom-[20%] flex min-w-[220px] items-center gap-3 rounded-2xl border border-border bg-card/90 px-4 py-3 text-[10px] text-foreground shadow-2xl backdrop-blur"
          >
            <div className="rounded-lg bg-gradient-to-r from-emerald-400 to-teal-500 p-1.5 text-white">
              <Wand2 size={12} />
            </div>
            <div className="flex-1">
              <span className="mb-0.5 block text-[8px] font-bold uppercase tracking-widest text-slate-400">
                AI Command
              </span>
              <span className="font-mono text-slate-600 dark:text-slate-200">{text}</span>
            </div>
            <div className="flex h-6 w-6 items-center justify-center rounded-full bg-foreground text-background">
              <ArrowRight size={10} />
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {['explosion', 'done'].includes(phase) && (
        <div className="absolute inset-0 pointer-events-none">
          <motion.div
            initial={{ scale: 0, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ type: 'spring', stiffness: 200, damping: 20, delay: 0.1 }}
            className="absolute left-1/2 top-1/2 w-44 -translate-x-1/2 -translate-y-1/2 rounded-xl border border-border bg-card p-4 text-[10px] shadow-xl"
          >
            <div className="mb-2 flex items-center gap-2 border-b border-slate-50 pb-2 dark:border-[#1E1E1E]">
              <div className="rounded-lg bg-emerald-500/10 p-1.5 text-emerald-600 dark:text-emerald-200">
                <Sparkles size={14} />
              </div>
              <div>
                <span className="block text-[8px] font-bold uppercase tracking-widest text-slate-400">Core Insight</span>
                <span className="text-[11px] font-semibold text-slate-900 dark:text-slate-100">Growth Strategy</span>
              </div>
            </div>
            <div className="flex gap-1 text-[8px] text-muted-foreground">
              <span className="rounded bg-muted px-1.5 py-0.5">#Q4</span>
              <span className="rounded bg-muted px-1.5 py-0.5">#AI</span>
            </div>
          </motion.div>
          <svg className="absolute inset-0 h-full w-full">
            {[
              'C 60% 50%, 65% 40%, 75% 25%',
              'C 40% 50%, 35% 40%, 25% 25%',
              'C 60% 50%, 65% 60%, 75% 75%',
              'C 40% 50%, 35% 60%, 25% 75%',
            ].map((curve, idx) => (
              <motion.path
                key={idx}
                d={`M 50% 50% ${curve}`}
                fill="none"
                stroke="#10b981"
                strokeWidth="2"
                strokeLinecap="round"
                initial={{ pathLength: 0 }}
                animate={{ pathLength: 1 }}
                transition={{ duration: 0.6, delay: 0.3 + idx * 0.1 }}
              />
            ))}
          </svg>
          <motion.div
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ type: 'spring', delay: 0.5 }}
            className="absolute left-[25%] top-[25%] w-32 rounded-2xl border border-border bg-card p-3 text-[9px] shadow"
          >
            <div className="mb-2 flex items-center gap-1 text-slate-500">
              <BarChart3 size={10} /> Market Trend
            </div>
            <div className="flex items-end gap-1">
              {[40, 70, 50, 90].map((value) => (
                <div key={value} className="h-12 w-full">
                  <div className="h-full w-full rounded-t bg-gradient-to-t from-emerald-200 to-emerald-500" style={{ height: `${value}%` }} />
                </div>
              ))}
            </div>
          </motion.div>
          <motion.div
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ type: 'spring', delay: 0.6 }}
            className="absolute right-[18%] top-[22%] w-32 rounded-2xl border border-border bg-card p-3 text-[9px] shadow"
          >
            <div className="mb-2 flex items-center gap-1 text-slate-500">
              <ImageIcon size={10} /> Visuals
            </div>
            <div className="grid grid-cols-2 gap-1.5">
              <div className="h-12 rounded bg-muted" />
              <div className="h-12 rounded bg-muted" />
            </div>
          </motion.div>
          <motion.div
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ type: 'spring', delay: 0.7 }}
            className="absolute left-[22%] top-[70%] w-36 rounded-2xl border border-border bg-card p-3 text-[9px] shadow"
          >
            <div className="mb-2 flex items-center gap-1 text-slate-500">
              <ListTodo size={10} /> Action Items
            </div>
            <div className="space-y-1.5">
              <div className="flex items-center gap-1.5">
                <div className="flex h-3 w-3 items-center justify-center rounded border border-emerald-400 bg-emerald-500 text-white">
                  <CheckCircle2 size={6} />
                </div>
                <div className="h-1 w-full rounded bg-muted" />
              </div>
              <div className="flex items-center gap-1.5">
                <div className="h-3 w-3 rounded border border-border/80" />
                <div className="h-1 w-2/3 rounded bg-muted" />
              </div>
            </div>
          </motion.div>
          <motion.div
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ type: 'spring', delay: 0.8 }}
            className="absolute right-[22%] top-[70%] w-36 rounded-2xl border border-border bg-card p-3 text-[9px] shadow"
          >
            <div className="mb-2 flex items-center gap-1 text-slate-500">
              <TrendingUp size={10} /> Forecast
            </div>
            <div className="space-y-1.5">
              <div className="h-1.5 w-full rounded bg-muted" />
              <div className="h-1.5 w-full rounded bg-muted" />
              <div className="h-1.5 w-1/2 rounded bg-muted" />
            </div>
          </motion.div>
        </div>
      )}
    </div>
  );
};

const CollaborationVisual = () => {
  const [text, setText] = useState('');
  const fullText = "Great point! Let's iterate. 🚀";

  useEffect(() => {
    let index = 0;
    const interval = setInterval(() => {
      if (index <= fullText.length) {
        setText(fullText.slice(0, index));
        index += 1;
      } else {
        setTimeout(() => { index = 0; setText(''); }, 2000);
      }
    }, 100);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="relative aspect-[4/3] w-full min-h-[320px] overflow-hidden rounded-2xl border border-border bg-gradient-to-b from-card to-muted shadow-lg dark:from-[#050505] dark:to-[#050505]">
      <div
        className="absolute inset-0 opacity-10"
        style={{ backgroundImage: 'radial-gradient(#f97316 1px, transparent 1px)', backgroundSize: '20px 20px' }}
      />
      
      {/* Floating Comment Card - Left */}
      <motion.div
        initial={{ y: -20, opacity: 0 }}
        whileInView={{ y: 0, opacity: 1 }}
        transition={{ delay: 0.2 }}
        className="absolute top-[15%] left-[10%] w-48 rounded-xl border border-border bg-card p-3 text-foreground shadow-md"
      >
        <div className="mb-2 flex items-center gap-2 border-b border-border/60 pb-2">
          <div className="flex h-5 w-5 items-center justify-center rounded-full bg-yellow-100 text-yellow-600">
            <StickyNote size={10} />
          </div>
          <span className="text-[10px] font-medium text-slate-500">Research Notes</span>
        </div>
        <div className="space-y-1.5">
          <div className="h-1.5 w-full rounded-full bg-muted" />
          <div className="h-1.5 w-full rounded-full bg-muted" />
          <div className="h-1.5 w-2/3 rounded-full bg-muted" />
        </div>
        {/* Cursor 1: Guest */}
        <motion.div
          animate={{ x: [0, 20, 0], y: [0, 10, 0] }}
          transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
          className="absolute -bottom-3 -right-3 z-20"
        >
          <MousePointer2 className="h-5 w-5 text-purple-500 fill-purple-500 stroke-white" />
          <div className="absolute left-3 top-3 rounded-full rounded-tl-none bg-purple-500 px-2 py-0.5 text-[9px] font-bold text-white shadow-sm">
            Guest
          </div>
        </motion.div>
      </motion.div>

      {/* Floating Stats Card - Right */}
      <motion.div
        initial={{ y: 20, opacity: 0 }}
        whileInView={{ y: 0, opacity: 1 }}
        transition={{ delay: 0.3 }}
        className="absolute bottom-[15%] right-[8%] w-40 rounded-xl border border-border bg-card p-3 text-foreground shadow-md"
      >
        <div className="flex items-center gap-2 mb-2">
           <div className="h-2 w-2 rounded-full bg-green-400 animate-pulse" />
           <span className="text-[10px] text-slate-400 uppercase tracking-wider">Live Users</span>
        </div>
        <div className="flex -space-x-2 overflow-hidden">
          {[1, 2, 3].map((i) => (
            <div key={i} className="inline-block h-6 w-6 rounded-full ring-2 ring-border bg-muted" />
          ))}
          <div className="flex h-6 w-6 items-center justify-center rounded-full ring-2 ring-border bg-muted text-[9px] font-medium text-muted-foreground">
            +5
          </div>
        </div>
      </motion.div>

      {/* Center Edit Area */}
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
        <motion.div
          initial={{ scale: 0.9, opacity: 0 }}
          whileInView={{ scale: 1, opacity: 1 }}
          transition={{ delay: 0.4 }}
          className="relative w-64 rounded-2xl border border-border bg-card p-4 text-foreground shadow-xl"
        >
          {/* Selection Box */}
          <motion.div 
            animate={{ opacity: [0, 1, 0] }}
            transition={{ duration: 2, repeat: Infinity, repeatDelay: 1 }}
            className="absolute inset-0 rounded-2xl border-2 border-orange-400 opacity-0 pointer-events-none"
          />
          
          <div className="relative mb-3 h-32 overflow-hidden rounded-lg bg-muted">
             <motion.div
               initial={{ opacity: 0 }}
               whileInView={{ opacity: 1 }}
               transition={{ duration: 0.5, delay: 1 }}
               className="absolute inset-0 flex items-center justify-center bg-black/5"
             >
                <Loader2 className="h-5 w-5 animate-spin text-orange-500" />
             </motion.div>
             
             {/* Alex Cursor */}
             <motion.div
                initial={{ top: '100%', left: '100%' }}
                whileInView={{ top: '40%', left: '60%' }}
                transition={{ duration: 1.2, ease: 'circOut', delay: 0.5 }}
                className="absolute z-20"
              >
                <MousePointer2 className="h-5 w-5 text-orange-500 fill-orange-500 stroke-white" />
                <div className="absolute left-3 top-3 rounded-full rounded-tl-none bg-orange-500 px-2 py-0.5 text-[9px] font-bold text-white shadow-sm">
                  Alex
                </div>
              </motion.div>
          </div>
          
          <div className="space-y-2">
            <div className="h-2 w-full rounded-full bg-muted" />
            <div className="h-2 w-2/3 rounded-full bg-muted" />
          </div>

          {/* Jordan Comment Bubble */}
          <motion.div
            initial={{ scale: 0, opacity: 0, y: 10 }}
            whileInView={{ scale: 1, opacity: 1, y: 0 }}
            transition={{ delay: 1.8, type: 'spring' }}
            className="absolute -right-12 top-10 z-30 w-44"
          >
            <div className="rounded-xl rounded-tl-none border border-border bg-card p-3 shadow-lg">
              <div className="flex items-center gap-2 mb-1">
                <div className="h-4 w-4 rounded-full bg-muted" />
                <span className="text-[10px] font-bold text-foreground">Jordan</span>
              </div>
              <p className="text-[10px] font-medium text-muted-foreground leading-snug">
                {text}
                <span className="inline-block w-0.5 h-3 bg-orange-500 ml-0.5 animate-pulse align-middle" />
              </p>
            </div>
          </motion.div>
        </motion.div>
      </div>
    </div>
  );
};

const FAQItem = ({ question, answer }: { question: string; answer: string }) => {
  const [isOpen, setIsOpen] = useState(false);
  return (
    <div className="border-b border-slate-200 last:border-b-0 dark:border-[#1E1E1E]">
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        className="flex w-full items-center justify-between py-5 text-left"
      >
        <span className="pr-6 text-base font-medium text-slate-800 dark:text-slate-100">
          {question}
        </span>
        <motion.div animate={{ rotate: isOpen ? 180 : 0 }}>
          <ArrowRight className="h-4 w-4 text-slate-400" />
        </motion.div>
      </button>
      <AnimatePresence initial={false}>
        {isOpen && (
          <motion.p
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden pb-4 text-sm leading-relaxed text-slate-500 dark:text-slate-400"
          >
            {answer}
          </motion.p>
        )}
      </AnimatePresence>
    </div>
  );
};

export function CoreValueSection() {
  const t = useTranslations();
  const faqItems = (t.raw('home.faq.items') as { question: string; answer: string }[]) || [];

  const ref0 = useRef<HTMLDivElement>(null);
  const ref1 = useRef<HTMLDivElement>(null);
  const ref2 = useRef<HTMLDivElement>(null);
  const refs = [ref0, ref1, ref2];
  const inView0 = useInView(ref0, { margin: '-50% 0px -50% 0px', once: false });
  const inView1 = useInView(ref1, { margin: '-50% 0px -50% 0px', once: false });
  const inView2 = useInView(ref2, { margin: '-50% 0px -50% 0px', once: false });
  const [activeFeature, setActiveFeature] = useState(0);

  useEffect(() => {
    if (inView0) setActiveFeature(0);
    if (inView1) setActiveFeature(1);
    if (inView2) setActiveFeature(2);
  }, [inView0, inView1, inView2]);

  const features = [
    {
      label: t('home.core_value.labels.workflow'),
      title: t('home.core_value.canvas.title'),
      description: t('home.core_value.canvas.subtitle'),
      Visual: WorkflowVisual,
    },
    {
      label: t('home.core_value.labels.deepThinking'),
      title: t('home.core_value.ai.title'),
      description: t('home.core_value.ai.subtitle'),
      Visual: DeepThinkingVisual,
    },
    {
      label: t('home.core_value.labels.collaboration'),
      title: t('home.core_value.collaboration.title'),
      description: t('home.core_value.collaboration.subtitle'),
      Visual: CollaborationVisual,
    },
  ];

  return (
    <section id="core-values" className="w-full bg-transparent py-24 scroll-mt-24 md:scroll-mt-32 dark:bg-transparent">
      <div className="mx-auto hidden max-w-6xl gap-14 px-6 lg:flex">
        <div className="flex w-5/12 flex-col pb-32 pr-10">
          {features.map((feature, idx) => (
            <div key={feature.title} ref={refs[idx]} className="min-h-[80vh] flex flex-col justify-center">
              <h2 className="mt-4 text-4xl font-bold leading-tight text-slate-900 dark:text-white md:text-5xl">
                {feature.title}
              </h2>
              <p className="mt-4 text-xl leading-relaxed text-slate-500 dark:text-slate-400">
                {feature.description}
              </p>
            </div>
          ))}
        </div>
        <div className="w-7/12">
          <div className="sticky top-12 flex h-[80vh] items-center justify-center">
            <div className="w-full max-w-2xl overflow-hidden rounded-3xl border border-border bg-card shadow-2xl">
              <AnimatePresence mode="wait">
                {(() => {
                  const ActiveVisual = features[activeFeature]?.Visual;
                  if (!ActiveVisual) return null;
                  return (
                    <motion.div
                      key={activeFeature}
                      initial={{ opacity: 0, scale: 0.95 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0, scale: 0.95 }}
                      transition={{ duration: 0.5 }}
                      className="p-2"
                    >
                      <ActiveVisual />
                    </motion.div>
                  );
                })()}
              </AnimatePresence>
            </div>
          </div>
        </div>
      </div>

      <div className="mx-auto space-y-16 px-6 lg:hidden">
        {features.map((feature) => (
          <div key={feature.title} className="space-y-6">
            <div>
              <span className="text-sm font-semibold uppercase tracking-[0.3em] text-slate-400">
                {feature.label}
              </span>
              <h2 className="mt-4 text-4xl font-bold text-slate-900 dark:text-white">
                {feature.title}
              </h2>
              <p className="mt-4 text-xl leading-relaxed text-slate-500 dark:text-slate-400">
                {feature.description}
              </p>
            </div>
            <feature.Visual />
          </div>
        ))}
      </div>
    </section>
  );
}
