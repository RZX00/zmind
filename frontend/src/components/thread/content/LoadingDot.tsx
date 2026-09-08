import React from 'react';

type LoadingDotProps = {
  className?: string;
  colorClass?: string; // Tailwind color class for the dot
  size?: number; // px, default 8
};

export const LoadingDot: React.FC<LoadingDotProps> = ({
  className = '',
  colorClass = 'bg-primary',
  size = 8,
}) => {
  const dim = `${size}px`;
  return (
    <span
      className={`pointer-events-none select-none inline-flex rounded-full ${colorClass} breathing-dot ${className}`}
      style={{ height: dim, width: dim }}
      aria-hidden
    />
  );
};

export default LoadingDot;

