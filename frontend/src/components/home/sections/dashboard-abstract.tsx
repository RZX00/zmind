"use client";

import { motion } from "motion/react";
import { useEffect, useState } from "react";
import { useTheme } from "next-themes";

export function DashboardAbstract({ className }: { className?: string }) {
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === "dark";
  
  // Colors
  const bgColor = isDark ? "#09090b" : "#ffffff";
  const borderColor = isDark ? "#27272a" : "#e4e4e7";
  const nodeColor = isDark ? "#18181b" : "#f4f4f5";
  const accentColor = "#8b5cf6"; // Violet
  
  return (
    <div className={`relative w-full max-w-5xl mx-auto aspect-[16/9] overflow-hidden rounded-xl border border-border bg-background shadow-2xl ${className}`}>
      {/* Toolbar Top */}
      <div className="absolute top-4 left-1/2 -translate-x-1/2 w-[40%] h-12 rounded-full border border-border bg-background/80 backdrop-blur shadow-sm flex items-center justify-center gap-4 z-20">
         {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="w-8 h-8 rounded-md bg-muted/50" />
         ))}
      </div>

      {/* Sidebar Left */}
      <div className="absolute top-4 left-4 bottom-4 w-16 rounded-xl border border-border bg-background/50 backdrop-blur hidden sm:flex flex-col items-center py-4 gap-4 z-10">
        {[1, 2, 3, 4].map((i) => (
            <div key={i} className="w-8 h-8 rounded-full bg-muted/50" />
         ))}
      </div>

      {/* Infinite Canvas Area */}
      <div className="absolute inset-0 z-0">
         {/* Dot Grid */}
         <div className="absolute inset-0 bg-[radial-gradient(#e5e7eb_1px,transparent_1px)] dark:bg-[radial-gradient(#27272a_1px,transparent_1px)] [background-size:24px_24px] opacity-50" />
         
         {/* Central Mind Map Node */}
         <motion.div 
            initial={{ scale: 0, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ duration: 0.5, delay: 0.2 }}
            className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-48 h-24 rounded-2xl border-2 border-primary bg-background shadow-xl flex items-center justify-center z-10"
         >
            <span className="font-semibold text-lg">Core Concept</span>
         </motion.div>

         {/* Connected Nodes - Abstract representation of "Text, Images, Videos, Audio" */}
         
         {/* Text Node (Left) */}
         <motion.div
            initial={{ x: 0, y: 0, opacity: 0 }}
            animate={{ x: -180, y: -80, opacity: 1 }}
            transition={{ duration: 0.6, delay: 0.6 }}
            className="absolute top-1/2 left-1/2 w-40 h-32 bg-white dark:bg-zinc-900 rounded-xl border border-border shadow-lg p-3 flex flex-col gap-2"
         >
            <div className="w-1/2 h-3 bg-muted rounded-full" />
            <div className="w-full h-2 bg-muted/50 rounded-full" />
            <div className="w-full h-2 bg-muted/50 rounded-full" />
            <div className="w-3/4 h-2 bg-muted/50 rounded-full" />
            
            {/* Connection Line */}
            <svg className="absolute top-full left-full w-[100px] h-[100px] overflow-visible pointer-events-none z-[-1]" style={{ transform: 'translate(-10%, -10%)' }}>
                <path d="M0 0 C 50 50, 50 50, 100 100" stroke={borderColor} strokeWidth="2" fill="none" />
            </svg>
         </motion.div>

         {/* Image Node (Right) */}
         <motion.div
            initial={{ x: 0, y: 0, opacity: 0 }}
            animate={{ x: 180, y: -60, opacity: 1 }}
            transition={{ duration: 0.6, delay: 0.8 }}
            className="absolute top-1/2 left-1/2 w-36 h-36 bg-white dark:bg-zinc-900 rounded-xl border border-border shadow-lg p-2 flex items-center justify-center overflow-hidden"
         >
             <div className="w-full h-full bg-blue-50 dark:bg-blue-900/20 rounded-lg flex items-center justify-center">
                <div className="w-8 h-8 text-blue-400">
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/></svg>
                </div>
             </div>
         </motion.div>

         {/* AI Assistant Chat (Bottom Right Floating) */}
         <motion.div
            initial={{ y: 20, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ duration: 0.5, delay: 1.2 }}
            className="absolute bottom-8 right-8 w-64 bg-background rounded-2xl border border-purple-500/30 shadow-2xl p-4 z-20"
         >
            <div className="flex items-center gap-3 mb-3">
                <div className="w-8 h-8 rounded-full bg-purple-500/20 flex items-center justify-center text-purple-500">
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" x2="12" y1="19" y2="22"/></svg>
                </div>
                <div className="text-xs font-medium">Thinking Agent</div>
            </div>
            <div className="space-y-2">
                <div className="w-full h-2 bg-muted rounded-full animate-pulse" />
                <div className="w-3/4 h-2 bg-muted rounded-full animate-pulse" />
            </div>
         </motion.div>

          {/* Connection Lines (SVG Overlay) */}
         <svg className="absolute inset-0 w-full h-full pointer-events-none z-0">
            {/* Center to Left (Text) */}
            <motion.path 
                d="M 50% 50% L calc(50% - 180px) calc(50% - 80px)" 
                stroke={borderColor} 
                strokeWidth="2" 
                fill="none"
                initial={{ pathLength: 0 }}
                animate={{ pathLength: 1 }}
                transition={{ duration: 0.8, delay: 0.6 }}
            />
            {/* Center to Right (Image) */}
            <motion.path 
                d="M 50% 50% L calc(50% + 180px) calc(50% - 60px)" 
                stroke={borderColor} 
                strokeWidth="2" 
                fill="none"
                initial={{ pathLength: 0 }}
                animate={{ pathLength: 1 }}
                transition={{ duration: 0.8, delay: 0.8 }}
            />
         </svg>

      </div>
    </div>
  );
}
