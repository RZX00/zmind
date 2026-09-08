'use client';

import { motion } from 'motion/react';
import { FlickeringGrid } from '@/components/home/ui/flickering-grid';
import type React from 'react';

type FlickeringGridFadeInProps = React.ComponentProps<typeof FlickeringGrid>;

export function FlickeringGridFadeIn({
  className = 'size-full',
  ...props
}: FlickeringGridFadeInProps) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.3, ease: 'easeOut' }}
      className={className}
    >
      <FlickeringGrid {...props} className={className} />
    </motion.div>
  );
}
