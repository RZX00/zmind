'use client';

import React from 'react';

interface StickySectionNavProps {
  sections: Array<{ id: string; label: string }>;
}

export function StickySectionNav({ sections }: StickySectionNavProps) {
  const [active, setActive] = React.useState<string>(sections[0]?.id || '');

  React.useEffect(() => {
    if (typeof window === 'undefined') return;
    const observer = new IntersectionObserver(
      (entries) => {
        // Choose the entry closest to top that is intersecting
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => (a.boundingClientRect.top || 0) - (b.boundingClientRect.top || 0));
        if (visible[0]) {
          const id = visible[0].target.getAttribute('id') || '';
          if (id) setActive(id);
        }
      },
      { rootMargin: '-64px 0px -60% 0px', threshold: [0, 0.25, 0.5, 1] }
    );

    sections.forEach((s) => {
      const el = document.getElementById(s.id);
      if (el) observer.observe(el);
    });
    return () => observer.disconnect();
  }, [sections]);

  const scrollTo = (id: string) => {
    const el = document.getElementById(id);
    if (!el) return;
    try {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch {
      const y = el.getBoundingClientRect().top + window.scrollY - 64;
      window.scrollTo({ top: y, behavior: 'smooth' });
    }
  };

  return (
    <div className="sticky top-0 z-30 border-b bg-background/80 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="max-w-6xl mx-auto px-6">
        <nav className="flex items-center gap-4 h-12">
          {sections.map((s) => (
            <button
              key={s.id}
              onClick={() => scrollTo(s.id)}
              className={
                'text-sm px-2 py-1 rounded-md transition-colors ' +
                (active === s.id
                  ? 'text-foreground font-medium'
                  : 'text-muted-foreground hover:text-foreground')
              }
              aria-current={active === s.id ? 'true' : undefined}
            >
              {s.label}
            </button>
          ))}
        </nav>
      </div>
    </div>
  );
}

export default StickySectionNav;

