"use client";

import { motion, AnimatePresence } from "framer-motion";
import { useState, useEffect } from "react";

const images = [
  "/thumbnail-dark.png",
  "/1.png",
  "/2.png",
  "/3.png"
];

export function MacWindow({ className }: { className?: string }) {
  const [currentIndex, setCurrentIndex] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentIndex((prev) => (prev + 1) % images.length);
    }, 3000); // Change image every 3 seconds

    return () => clearInterval(timer);
  }, []);

  return (
    <motion.div
      initial={{ opacity: 0, y: 40 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.8, delay: 0.2, ease: "easeOut" }}
      className={`relative w-full max-w-6xl mx-auto ${className}`}
    >
      {/* Window Frame */}
      <div className="relative rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-950 shadow-2xl overflow-hidden">
        {/* Window Header (Mac Style) */}
        <div className="h-10 bg-gray-50/80 dark:bg-gray-900/80 border-b border-gray-100 dark:border-gray-800 flex items-center px-4 gap-2 backdrop-blur-sm z-20 relative">
          <div className="w-3 h-3 rounded-full bg-red-400/80" />
          <div className="w-3 h-3 rounded-full bg-yellow-400/80" />
          <div className="w-3 h-3 rounded-full bg-green-400/80" />
          {/* Address Bar Simulation */}
          <div className="ml-4 flex-1 max-w-sm h-6 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded text-[10px] flex items-center px-2 text-gray-400 dark:text-gray-500 font-mono hidden sm:flex">
            zmind.app/canvas/project-alpha
          </div>
        </div>

        {/* Window Body - Image Slideshow */}
        <div className="aspect-[16/9] w-full bg-gray-950 relative overflow-hidden">
          <AnimatePresence mode="wait">
            <motion.img
              key={currentIndex}
              src={images[currentIndex]}
              alt={`Zmind Interface Preview ${currentIndex + 1}`}
              className="absolute inset-0 w-full h-full object-cover"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.5 }}
            />
          </AnimatePresence>
        </div>
      </div>
      
      {/* Glow under the window */}
      <div className="absolute -bottom-10 left-1/2 -translate-x-1/2 w-[90%] h-[50px] bg-gray-200 dark:bg-gray-800 blur-[50px] -z-10 opacity-50" />
    </motion.div>
  );
}
