// ⭐ AI 图标组件（深浅色自适应）

import React from 'react';
import Image from 'next/image';
import { useTheme } from 'next-themes';

interface GoldStarAIProps {
  size?: number;
  className?: string;
  animated?: boolean;
}

const GoldStarAI: React.FC<GoldStarAIProps> = ({
  size = 20,
  className = '',
  animated = false,
}) => {
  const { resolvedTheme } = useTheme();
  const [mounted, setMounted] = React.useState(false);

  React.useEffect(() => {
    setMounted(true);
  }, []);

  const src = !mounted
    ? '/ai.png'
    : resolvedTheme === 'dark'
    ? '/ai-white.png'
    : '/ai.png';

  return (
    <Image
      src={src}
      alt="AI"
      width={size}
      height={size}
      className={`${className}`}
      style={{
        width: size,
        height: size,
        objectFit: 'contain',
      }}
      sizes={`${size}px`}
    />
  );
};

export default GoldStarAI;
