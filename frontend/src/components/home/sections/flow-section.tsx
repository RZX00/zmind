"use client";

import React, { useRef } from "react";
import Image from "next/image";
import { cn } from "@/lib/utils";
import { AnimatedBeam } from "@/components/ui/animated-beam";
import { OrbitingCircles } from "@/components/home/ui/orbiting-circles";
import { useTranslations } from 'next-intl';

const ChaosIcon = React.forwardRef<HTMLDivElement, { icon: React.ReactNode, className?: string, style?: React.CSSProperties }>(
  ({ icon, className, style }, ref) => {
  return (
    <div
      ref={ref}
      style={style}
      className={cn(
        "absolute z-10 flex h-10 w-10 items-center justify-center rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-sm",
        className
      )}
    >
      <div className="text-xl">{icon}</div>
    </div>
  );
});
ChaosIcon.displayName = "ChaosIcon";

const IconBox = React.forwardRef<HTMLDivElement, { icon: React.ReactNode, className?: string }>(
  ({ icon, className }, ref) => {
    return (
      <div
        ref={ref}
        className={cn(
          "flex h-10 w-10 items-center justify-center rounded-xl border border-slate-200/80 dark:border-slate-700/80 bg-white dark:bg-slate-900 shadow-sm text-xl",
          className
        )}
      >
        {icon}
      </div>
    );
  }
);
IconBox.displayName = "IconBox";

export function FlowSection() {
  const t = useTranslations();
  const containerRef = useRef<HTMLDivElement>(null);
  
  // Chaos Inputs Refs
  const inputRef1 = useRef<HTMLDivElement>(null);
  const inputRef2 = useRef<HTMLDivElement>(null);
  const inputRef3 = useRef<HTMLDivElement>(null);
  const inputRef4 = useRef<HTMLDivElement>(null);
  const inputRef5 = useRef<HTMLDivElement>(null);

  // Center & Outputs
  const centerRef = useRef<HTMLDivElement>(null);
  const toRef1 = useRef<HTMLDivElement>(null);
  const toRef2 = useRef<HTMLDivElement>(null);

  return (
    <section className="py-24 md:py-32 bg-slate-50/50 dark:bg-background relative overflow-hidden">
      {/* Subtle background decoration */}
      <div className="absolute inset-0 bg-[radial-gradient(#e2e8f0_1px,transparent_1px)] dark:bg-[radial-gradient(#334155_1px,transparent_1px)] [background-size:24px_24px] opacity-40 dark:opacity-20 pointer-events-none"></div>
      
      <div className="container mx-auto px-4 flex flex-col items-center relative z-10">
        <div className="text-center max-w-3xl mb-16 md:mb-24">
          <h2 className="text-3xl md:text-5xl font-bold text-slate-900 dark:text-white mb-6 tracking-tight">
            {t('home.flow.title', { default: 'From Chaos to Clarity' })}
          </h2>
          <p className="text-lg text-muted-foreground dark:text-gray-400">
            {t('home.flow.subtitle', { default: 'Seamlessly connect your inputs, intelligence, and outputs in one unified workflow.' })}
          </p>
        </div>

        <div
          ref={containerRef}
          className="relative flex w-full max-w-5xl h-[400px] md:h-[500px] items-center justify-between rounded-3xl border border-slate-200/60 dark:border-slate-700/60 bg-white/80 dark:bg-slate-900/80 backdrop-blur-sm p-8 md:p-16 shadow-2xl shadow-slate-200/50 dark:shadow-slate-900/50 overflow-hidden"
        >
          {/* Left Column: Chaos (Scattered Inputs) */}
          <div className="relative w-1/3 h-full">
             <div className="absolute inset-0 flex items-center justify-center">
                <span className="text-xs font-bold tracking-widest text-gray-400/50 dark:text-gray-600/50 uppercase rotate-90 absolute -left-4">Raw Inputs</span>
             </div>
             
             {/* Scattered Nodes */}
             <ChaosIcon ref={inputRef1} icon="📄" style={{ top: '20%', left: '10%', transform: 'rotate(-12deg)' }} />
             <ChaosIcon ref={inputRef2} icon="💬" style={{ top: '45%', left: '30%', transform: 'rotate(6deg)' }} />
             <ChaosIcon ref={inputRef3} icon="📊" style={{ top: '70%', left: '15%', transform: 'rotate(-5deg)' }} />
             <ChaosIcon ref={inputRef4} icon="🖼️" style={{ top: '30%', left: '60%', transform: 'rotate(15deg)' }} />
             <ChaosIcon ref={inputRef5} icon="🔗" style={{ top: '60%', left: '50%', transform: 'rotate(-8deg)' }} />
          </div>

          {/* Center: Zmind Core */}
          <div ref={centerRef} className="z-20 relative group cursor-pointer">
             <div className="absolute inset-0 bg-purple-500/20 blur-[40px] rounded-full group-hover:bg-purple-500/30 transition-all duration-500"></div>
             
             {/* Orbiting Circles Animation */}
             <div className="absolute inset-0 flex items-center justify-center -z-10 scale-150 opacity-60">
                <OrbitingCircles radius={60} duration={20} delay={0} reverse>
                   <div className="h-2 w-2 rounded-full bg-gray-400/50 dark:bg-gray-500/50"></div>
                </OrbitingCircles>
                <OrbitingCircles radius={60} duration={20} delay={10} reverse>
                   <div className="h-2 w-2 rounded-full bg-slate-400/50 dark:bg-slate-500/50"></div>
                </OrbitingCircles>
                <OrbitingCircles radius={90} duration={30} delay={5}>
                   <div className="h-3 w-3 rounded-full bg-zinc-400/30 dark:bg-zinc-500/30 border border-zinc-200 dark:border-zinc-700"></div>
                </OrbitingCircles>
             </div>

             <div className="relative h-20 w-20 md:h-28 md:w-28 bg-slate-950 dark:bg-black rounded-2xl flex items-center justify-center shadow-2xl border-4 border-white dark:border-gray-800 ring-1 ring-slate-950/5 transition-transform duration-500 group-hover:scale-105">
                <Image src="/zmind-logo-white.svg" alt="Zmind" width={56} height={56} className="w-10 md:w-14 h-auto" />
             </div>
             <div className="absolute -bottom-8 left-1/2 -translate-x-1/2 whitespace-nowrap">
                <span className="text-xs font-semibold text-slate-900 dark:text-white bg-white/80 dark:bg-slate-800/80 backdrop-blur px-2 py-1 rounded-full border border-slate-200 dark:border-slate-700">Thinking Engine</span>
             </div>
          </div>

          {/* Right Column: Outputs (Structured) */}
          <div className="w-1/3 h-full flex flex-col justify-center gap-8 pl-12 relative">
             <div className="absolute -right-4 top-1/2 -translate-y-1/2 rotate-90 text-xs font-bold tracking-widest text-gray-400/50 dark:text-gray-600/50 uppercase">Structured Output</div>
             
             <div className="flex items-center gap-4 p-3 rounded-xl bg-white dark:bg-gray-800/50 border border-gray-100 dark:border-gray-700 shadow-sm hover:shadow-md transition-all w-full max-w-[200px]">
                <IconBox ref={toRef1} icon="📑" className="h-10 w-10 !shadow-none !border-none bg-blue-50 text-base" />
                <div className="flex flex-col">
                   <span className="text-sm font-semibold text-gray-900 dark:text-white">Reports</span>
                   <span className="text-[10px] text-gray-500">PDF, Markdown</span>
                </div>
             </div>
             
             <div className="flex items-center gap-4 p-3 rounded-xl bg-white dark:bg-gray-800/50 border border-gray-100 dark:border-gray-700 shadow-sm hover:shadow-md transition-all w-full max-w-[200px]">
                <IconBox ref={toRef2} icon="🎬" className="h-10 w-10 !shadow-none !border-none bg-purple-50 text-base" />
                <div className="flex flex-col">
                   <span className="text-sm font-semibold text-gray-900 dark:text-white">Media</span>
                   <span className="text-[10px] text-gray-500">Video, Audio</span>
                </div>
             </div>
          </div>

          {/* Beams Input -> Center (Chaotic paths) */}
          <AnimatedBeam containerRef={containerRef} fromRef={inputRef1} toRef={centerRef} pathColor="#e2e8f0" gradientStartColor="#94a3b8" gradientStopColor="#475569" curvature={-50} />
          <AnimatedBeam containerRef={containerRef} fromRef={inputRef2} toRef={centerRef} pathColor="#e2e8f0" gradientStartColor="#94a3b8" gradientStopColor="#475569" curvature={50} delay={1} />
          <AnimatedBeam containerRef={containerRef} fromRef={inputRef3} toRef={centerRef} pathColor="#e2e8f0" gradientStartColor="#94a3b8" gradientStopColor="#475569" curvature={-30} delay={2} />
          <AnimatedBeam containerRef={containerRef} fromRef={inputRef4} toRef={centerRef} pathColor="#e2e8f0" gradientStartColor="#94a3b8" gradientStopColor="#475569" curvature={40} delay={1.5} />
          <AnimatedBeam containerRef={containerRef} fromRef={inputRef5} toRef={centerRef} pathColor="#e2e8f0" gradientStartColor="#94a3b8" gradientStopColor="#475569" curvature={-20} delay={0.5} />

          {/* Beams Center -> Output (Straight, Clean) */}
          <AnimatedBeam containerRef={containerRef} fromRef={centerRef} toRef={toRef1} pathColor="#e2e8f0" gradientStartColor="#475569" gradientStopColor="#1e293b" curvature={0} delay={1.5} />
          <AnimatedBeam containerRef={containerRef} fromRef={centerRef} toRef={toRef2} pathColor="#e2e8f0" gradientStartColor="#475569" gradientStopColor="#1e293b" curvature={0} delay={2.5} />
        </div>
      </div>
    </section>
  );
}
