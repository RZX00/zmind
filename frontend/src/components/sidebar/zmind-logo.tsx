'use client';

import Image from 'next/image';
import { useTheme } from 'next-themes';
import { useEffect, useState } from 'react';

interface ZmindLogoProps {
  size?: number;
}
export function ZmindLogo({ size = 24 }: ZmindLogoProps) {
  const { resolvedTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  // After mount, we can access the theme
  useEffect(() => {
    setMounted(true);
  }, []);

  const shouldInvert = mounted && resolvedTheme === 'dark';

  return (
    <Image
      src={shouldInvert ? '/zmind-symbol.svg' : '/zmind-symbol-light.svg'}
      alt="Zmind"
      width={size}
      height={size}
      className="flex-shrink-0"
      style={{ width: size, height: size, minWidth: size, minHeight: size }}
    />
  );
}
