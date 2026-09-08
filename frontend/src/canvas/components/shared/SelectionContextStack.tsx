import React from 'react';

interface SelectionContextStackProps {
  count: number;
  className?: string;
  align?: 'left' | 'right';
}

// Pure visual stack: 1/2/3 cards; >3 shows 3 cards + circular +N badge
export const SelectionContextStack: React.FC<SelectionContextStackProps> = ({ count, className, align = 'right' }) => {
  if (!count || count <= 0) return null;
  const shown = Math.min(3, count);

  // Square card size and horizontal offsets (slightly larger)
  const CARD_W = 24; // px
  const CARD_H = 24; // px
  const OFFSET_X = 10; // px per layer (horizontal stack)
  const stackW = CARD_W + OFFSET_X * (shown - 1);
  const containerW = stackW + 4; // pad 4px

  return (
    <div className={`relative inline-block mb-1 select-none align-middle pointer-events-none ${className || ''}`} aria-hidden role="presentation">
      <div className="relative" style={{ height: CARD_H, width: containerW }}>
        {[...Array(shown)].map((_, i) => {
          const idx = i; // 0..shown-1
          // Always left-to-right stacking; container alignment handled by parent
          const x = OFFSET_X * idx;
          const z = 10 + idx;
          const isTop = idx === shown - 1;
          return (
            <div
              key={idx}
              className="absolute left-0 top-0 rounded-md shadow-sm border border-neutral-200/60 dark:border-neutral-700/60 bg-white/60 dark:bg-neutral-700/60 backdrop-blur-[1px]"
              style={{
                transform: `translate(${x}px, 0px)`,
                width: CARD_W,
                height: CARD_H,
                zIndex: z,
              }}
            >
              {/* Intentionally empty: pure visual card without inner icon/text */}
            </div>
          );
        })}

        {count > 3 && (
          <div
            className="absolute -top-1 -right-1 rounded-full bg-[#0A84FF] text-white text-[11px] w-5 h-5 grid place-items-center shadow-sm"
            style={{ zIndex: 100 }}
          >
            {`+${count - 3}`}
          </div>
        )}
      </div>
    </div>
  );
};

export default SelectionContextStack;
