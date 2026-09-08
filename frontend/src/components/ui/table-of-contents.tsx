'use client';

import { useEffect, useState, useCallback } from 'react';
import { usePathname } from '@/i18n/routing';
import { DOCS_SCROLL_VIEWPORT_ID } from '@/lib/docs-scroll';
import { cn } from '@/lib/utils';
import { Menu } from 'lucide-react';

interface TableOfContentsProps {
  className?: string;
}

interface HeadingItem {
  id: string;
  text: string;
  level: number;
}

function getScrollViewport() {
  return document.getElementById(DOCS_SCROLL_VIEWPORT_ID);
}

function getHeadingTop(
  element: HTMLElement,
  scrollViewport: HTMLElement | null,
  windowScrollY: number,
) {
  const rect = element.getBoundingClientRect();

  if (!scrollViewport) {
    return rect.top + windowScrollY;
  }

  const viewportRect = scrollViewport.getBoundingClientRect();
  return scrollViewport.scrollTop + rect.top - viewportRect.top;
}

export function TableOfContents({ className }: TableOfContentsProps) {
  const [headings, setHeadings] = useState<HeadingItem[]>([]);
  const [activeId, setActiveId] = useState<string>('');
  const pathname = usePathname();

  const getHeadings = useCallback(() => {
    const scrollViewport = getScrollViewport();
    const headingElements = (scrollViewport ?? document).querySelectorAll(
      'h1, h2, h3, h4, h5, h6',
    );
    const headingItems: HeadingItem[] = [];

    headingElements.forEach((heading) => {
      if (heading.id) {
        headingItems.push({
          id: heading.id,
          text: heading.textContent || '',
          level: parseInt(heading.tagName.charAt(1)),
        });
      }
    });

    return headingItems;
  }, []);

  useEffect(() => {
    const updateHeadings = () => {
      const newHeadings = getHeadings();
      setHeadings(newHeadings);
      if (newHeadings.length > 0) {
        setActiveId(newHeadings[0].id);
      } else {
        setActiveId('');
      }
    };
    
    updateHeadings();
    const timeout = setTimeout(updateHeadings, 200);
    
    return () => clearTimeout(timeout);
  }, [getHeadings, pathname]);

  useEffect(() => {
    if (headings.length === 0) return;

    const handleScroll = () => {
      const scrollViewport = getScrollViewport();
      const scrollTop = scrollViewport ? scrollViewport.scrollTop : window.scrollY;
      const viewportHeight = scrollViewport ? scrollViewport.clientHeight : window.innerHeight;
      const offset = Math.min(viewportHeight * 0.2, 100);
      let activeHeading = headings[0];

      for (let i = headings.length - 1; i >= 0; i--) {
        const heading = headings[i];
        const element = document.getElementById(heading.id);

        if (!element) {
          continue;
        }

        const elementTop = getHeadingTop(
          element,
          scrollViewport,
          window.scrollY,
        );

        if (elementTop <= scrollTop + offset) {
          activeHeading = heading;
          break;
        }
      }

      setActiveId(activeHeading.id);
    };

    handleScroll();
    let rafId: number;
    const throttledScroll = () => {
      if (rafId) {
        cancelAnimationFrame(rafId);
      }
      rafId = requestAnimationFrame(handleScroll);
    };

    const scrollViewport = getScrollViewport();

    if (scrollViewport) {
      scrollViewport.addEventListener('scroll', throttledScroll, { passive: true });
    } else {
      window.addEventListener('scroll', throttledScroll, { passive: true });
    }

    window.addEventListener('resize', handleScroll, { passive: true });

    return () => {
      if (scrollViewport) {
        scrollViewport.removeEventListener('scroll', throttledScroll);
      } else {
        window.removeEventListener('scroll', throttledScroll);
      }

      window.removeEventListener('resize', handleScroll);
      if (rafId) {
        cancelAnimationFrame(rafId);
      }
    };
  }, [headings, pathname]);

  const scrollToSection = (id: string) => {
    const element = document.getElementById(id);
    if (element) {
      const scrollViewport = getScrollViewport();
      const viewportHeight = scrollViewport ? scrollViewport.clientHeight : window.innerHeight;
      const offset = Math.min(viewportHeight * 0.15, 80);
      const targetPosition =
        getHeadingTop(element, scrollViewport, window.scrollY) - offset;

      if (scrollViewport) {
        scrollViewport.scrollTo({
          top: Math.max(targetPosition, 0),
          behavior: 'smooth',
        });
      } else {
      window.scrollTo({
        top: targetPosition,
          behavior: 'smooth',
        });
      }

      setActiveId(id);
    }
  };

  if (headings.length === 0) return null;

  return (
    <div className={cn('space-y-2', className)}>
      <div className="flex items-center gap-2 mb-4">
        <Menu className="w-4 h-4" />
        <h4 className="font-semibold text-foreground">On this page</h4>
      </div>
      
      <nav className="space-y-1">
        {headings.map((heading) => (
          <button
            key={heading.id}
            onClick={() => scrollToSection(heading.id)}
            className={cn(
              'mb-4 block w-full text-left text-sm transition-all duration-200 py-0.5 px-3 hover:text-accent-foreground',
              activeId === heading.id
                ? 'text-primary font-semibold border-l-2 border-primary'
                : 'text-muted-foreground hover:text-foreground'
            )}
          >
            {heading.text}
          </button>
        ))}
      </nav>
    </div>
  );
} 
