'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { motion, AnimatePresence } from 'motion/react';
import { ChevronDown } from 'lucide-react';

const FAQItem = ({ question, answer }: { question: string; answer: string }) => {
  const [isOpen, setIsOpen] = useState(false);
  return (
    <div className="border-b border-slate-200 last:border-0 dark:border-[#1E1E1E]">
      <button 
        onClick={() => setIsOpen(!isOpen)}
        className="w-full py-5 flex items-center justify-between text-left focus:outline-none group"
      >
        <span className="text-base md:text-lg font-medium text-slate-800 transition-colors pr-8 dark:text-slate-200">
          {question}
        </span>
        <ChevronDown 
          className={`text-slate-400 group-hover:text-blue-600 transition-all duration-300 ${isOpen ? 'rotate-180' : ''}`} 
          size={20}
        />
      </button>
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            <p className="pb-6 text-slate-500 leading-relaxed text-sm md:text-base dark:text-slate-400">
              {answer}
            </p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export function FAQSection() {
  const t = useTranslations('home.faq');
  const items = t.raw('items') as { question: string; answer: string }[];

  return (
    <section id="faq" className="w-full py-24 bg-transparent relative z-30 scroll-mt-24 md:scroll-mt-32">
      <div className="mx-auto max-w-3xl px-6">
        <div className="mb-16 text-center">
          <h2 className="text-3xl font-bold tracking-tight text-slate-900 dark:text-white md:text-4xl">
            {t('title')}
          </h2>
          <p className="mt-4 text-lg text-slate-500 dark:text-slate-400">
            {t('subtitle')}
          </p>
        </div>

        <div className="divide-y divide-slate-200 border-t border-slate-200 dark:divide-[#1E1E1E] dark:border-[#1E1E1E]">
          {items?.map((faq, index) => (
            <FAQItem key={index} question={faq.question} answer={faq.answer} />
          ))}
        </div>
      </div>
    </section>
  );
}
