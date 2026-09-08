'use client';

import { siteConfig } from '@/lib/home';
import { motion } from 'motion/react';
import React, { useRef, useState } from 'react';
import { Link, useRouter } from '@/i18n/routing';
import {useTranslations} from 'next-intl';
import { usePathname } from '@/i18n/routing';

interface NavItem {
  name: string;
  href: string;
}

const navs: NavItem[] = siteConfig.nav.links;

export function NavMenu() {
  const ref = useRef<HTMLUListElement>(null);
  const [left, setLeft] = useState(0);
  const [width, setWidth] = useState(0);
  const [isReady, setIsReady] = useState(false);
  const [activeSection, setActiveSection] = useState('hero');
  const [isManualScroll, setIsManualScroll] = useState(false);
  const router = useRouter();
  const pathname = usePathname();
  const t = useTranslations();

  React.useEffect(() => {
    // Initialize with appropriate nav item based on current path
    const targetHref = '#hero'; // default
    const targetItem = ref.current?.querySelector(
      `[href="${targetHref}"]`,
    )?.parentElement;
    if (targetItem) {
      const rect = targetItem.getBoundingClientRect();
      setLeft(targetItem.offsetLeft);
      setWidth(rect.width);
      setIsReady(true);
    }
  }, [pathname]);

  React.useEffect(() => {
    let rafId = 0;

    const handleScroll = () => {
      // Skip scroll handling during manual click scrolling or if not on homepage
      if (isManualScroll || pathname !== '/') return;

      const sections = navs.filter(item => item.href.startsWith('#')).map((item) => item.href.substring(1));

      // Find the section closest to viewport top
      let closestSection = sections[0];
      let minDistance = Infinity;

      for (const section of sections) {
        const element = document.getElementById(section);
        if (element) {
          const rect = element.getBoundingClientRect();
          const distance = Math.abs(rect.top - 100); // Offset by 100px to trigger earlier
          if (distance < minDistance) {
            minDistance = distance;
            closestSection = section;
          }
        }
      }

      // Update active section and nav indicator
      setActiveSection(closestSection);
      const navItem = ref.current?.querySelector(
        `[href="#${closestSection}"]`,
      )?.parentElement;
      if (navItem) {
        const rect = navItem.getBoundingClientRect();
        setLeft(navItem.offsetLeft);
        setWidth(rect.width);
      }
    };

    const onScroll = () => {
      if (rafId) return;
      rafId = requestAnimationFrame(() => {
        rafId = 0;
        handleScroll();
      });
    };

    // Handle non-homepage routes
    if (pathname !== '/') {
      const currentPageItem = navs.find(item => item.href === pathname);
      if (currentPageItem) {
        const navItem = ref.current?.querySelector(
          `[href="${currentPageItem.href}"]`,
        )?.parentElement;
        if (navItem) {
          const rect = navItem.getBoundingClientRect();
          setLeft(navItem.offsetLeft);
          setWidth(rect.width);
        }
      }
      return;
    }

    window.addEventListener('scroll', onScroll, { passive: true });
    handleScroll(); // Initial check
    return () => {
      window.removeEventListener('scroll', onScroll);
      if (rafId) cancelAnimationFrame(rafId);
    };
  }, [isManualScroll, pathname]);

  const handleClick = (
    e: React.MouseEvent<HTMLAnchorElement>,
    item: NavItem,
  ) => {
    // If it's an external link (not starting with #), let it navigate normally
    if (!item.href.startsWith('#')) {
      return;
    }

    e.preventDefault();

    const targetId = item.href.substring(1);
    
    // If we're not on the homepage, redirect to homepage with the section
    if (pathname !== '/') {
      router.push(`/${item.href}`);
      return;
    }
    
    const element = document.getElementById(targetId);

    if (element) {
      // Set manual scroll flag
      setIsManualScroll(true);

      // Immediately update nav state
      setActiveSection(targetId);
      const navItem = e.currentTarget.parentElement;
      if (navItem) {
        const rect = navItem.getBoundingClientRect();
        setLeft(navItem.offsetLeft);
        setWidth(rect.width);
      }

      // Calculate exact scroll position
      const elementPosition = element.getBoundingClientRect().top;
      const offsetPosition = elementPosition + window.pageYOffset - 100; // 100px offset

      // Smooth scroll to exact position
      window.scrollTo({
        top: offsetPosition,
        behavior: 'smooth',
      });

      // Reset manual scroll flag after animation completes
      setTimeout(() => {
        setIsManualScroll(false);
      }, 500); // Adjust timing to match scroll animation duration
    }
  };

  const resolveNavLabel = (item: NavItem) => {
    const safeTranslate = (key: string, fallback: string) => {
      try {
        return t(key);
      } catch {
        return fallback;
      }
    };

    if (item.href.startsWith('#')) {
      const section = item.href.substring(1) || 'home';
      const key = section === 'hero' ? 'home' : section;
      const translationKey = `landing.nav.${key}`;
      return safeTranslate(translationKey, item.name);
    }

    const slug = item.href.replace(/^\//, '') || 'home';
    const translationKey = `landing.nav.${slug}`;
    return safeTranslate(translationKey, item.name);
  };

  return (
    <div className="w-full hidden md:block">
      <ul
        className="relative mx-auto flex w-fit rounded-full h-11 px-2 items-center justify-center"
        ref={ref}
      >
        {navs.map((item) => (
          <li
            key={item.name}
            className={`z-10 cursor-pointer h-full flex items-center justify-center px-4 py-2 text-sm font-medium transition-colors duration-200 ${
              (item.href.startsWith('#') && pathname === '/' && activeSection === item.href.substring(1)) || (item.href === pathname)
                ? 'text-primary'
                : 'text-primary/60 hover:text-primary'
            } tracking-tight`}
          >
            {item.href.startsWith('#') ? (
              <a href={item.href} onClick={(e) => handleClick(e, item)}>
                {resolveNavLabel(item)}
              </a>
            ) : (
              <Link href={item.href}>{resolveNavLabel(item)}</Link>
            )}
          </li>
        ))}
        {isReady && (
          <motion.li
            animate={{ left, width }}
            transition={{ type: 'spring', stiffness: 400, damping: 30 }}
            className="absolute inset-0 my-1.5 rounded-full bg-accent/60 border border-border"
          />
        )}
      </ul>
    </div>
  );
}
