'use client';

import { NavMenu } from '@/components/home/nav-menu';
import { ThemeToggle } from '@/components/home/theme-toggle';
import { siteConfig } from '@/lib/home';
import { cn } from '@/lib/utils';
import { Menu, X, Globe, LayoutDashboard, LogOut, Sparkles, CreditCard, Bell, Settings } from 'lucide-react';
import { AnimatePresence, motion, useScroll } from 'motion/react';
import type { Variants } from 'motion';
import {Link, useRouter} from '@/i18n/routing';
import Image from 'next/image';
import { useEffect, useState } from 'react';
import {useLocale, useTranslations} from 'next-intl';
import { useTheme } from 'next-themes';
import { useAuth } from '@/components/AuthProvider';
import { usePathname } from '@/i18n/routing';
import {persistLocalePreference, localizePathname, AppLocale} from '@/i18n/locales';
import {useRouter as useNextRouter} from 'next/navigation';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
  DropdownMenuPortal,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuGroup,
} from '@/components/ui/dropdown-menu';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';

const INITIAL_WIDTH = '70rem';
const MAX_WIDTH = '1000px';

const overlayVariants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1 },
  exit: { opacity: 0 },
} as const satisfies Variants;

const drawerVariants = {
  hidden: { opacity: 0, y: 100 },
  visible: {
    opacity: 1,
    y: 0,
    rotate: 0,
    transition: {
      type: 'spring',
      damping: 15,
      stiffness: 200,
      staggerChildren: 0.03,
    },
  },
  exit: {
    opacity: 0,
    y: 100,
    transition: { duration: 0.1 },
  },
} as const satisfies Variants;

const drawerMenuContainerVariants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1 },
};

const drawerMenuVariants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1 },
};

export function Navbar() {
  const { scrollY } = useScroll();
  const [hasScrolled, setHasScrolled] = useState(false);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [activeSection, setActiveSection] = useState('hero');
  const { resolvedTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  const { user, signOut } = useAuth();
  const router = useRouter();
  const baseRouter = useNextRouter();
  const pathname = usePathname();
  const locale = useLocale();
  const t = useTranslations();

  // Derive user details
  const userName = user?.user_metadata?.full_name || user?.user_metadata?.name || 'User';
  const userEmail = user?.email || '';
  const userAvatar = user?.user_metadata?.avatar_url || '';
  const userInitials = userName.slice(0, 2).toUpperCase();

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    const handleScroll = () => {
      const sections = siteConfig.nav.links.map((item) =>
        item.href.substring(1),
      );

      for (const section of sections) {
        const element = document.getElementById(section);
        if (element) {
          const rect = element.getBoundingClientRect();
          if (rect.top <= 150 && rect.bottom >= 150) {
            setActiveSection(section);
            break;
          }
        }
      }
    };

    window.addEventListener('scroll', handleScroll);
    handleScroll();

    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  useEffect(() => {
    const unsubscribe = scrollY.on('change', (latest) => {
      setHasScrolled(latest > 10);
    });
    return unsubscribe;
  }, [scrollY]);

  const toggleDrawer = () => setIsDrawerOpen((prev) => !prev);
  const handleOverlayClick = () => setIsDrawerOpen(false);

  const logoSrc = !mounted
    ? '/zmind-logo.svg'
    : resolvedTheme === 'dark'
      ? '/zmind-logo-white.svg'
      : '/zmind-logo.svg';

  // Use locale-aware Link/router; do not pre-concatenate '/zh'
  const base = '';
  const switchLocale = (target: AppLocale) => {
    const search = typeof window !== 'undefined' ? window.location.search : '';
    const hash = typeof window !== 'undefined' ? window.location.hash : '';
    const currentPathname =
      typeof window !== 'undefined' ? window.location.pathname : (pathname || '/');
    persistLocalePreference(target);
    const nextPath = localizePathname(currentPathname, target);
    baseRouter.push(`${nextPath}${search}${hash}`);
    if (hash) {
      try {
        const id = hash.slice(1);
        requestAnimationFrame(() => {
          const el = document.getElementById(id);
          el?.scrollIntoView({behavior: 'smooth'});
        });
      } catch {}
    }
  };

  return (
    <header
      className={cn(
        'sticky z-50 flex justify-center px-2 transition-all duration-300 md:px-0',
        hasScrolled ? 'top-4 bg-transparent' : 'top-0 bg-background',
      )}
    >
      <motion.div
        initial={{ width: INITIAL_WIDTH }}
        animate={{ width: hasScrolled ? MAX_WIDTH : INITIAL_WIDTH }}
        transition={{ duration: 0.3, ease: [0.25, 0.1, 0.25, 1] }}
      >
        <div
          className={cn(
            'mx-auto max-w-7xl rounded-2xl transition-all duration-300 xl:px-0',
            hasScrolled
              ? 'px-2 md:px-2 border border-border backdrop-blur-lg bg-[#FCFCFC]/60 dark:bg-[#050505]/60 shadow-lg shadow-black/5'
              : 'shadow-none px-3 md:px-7 bg-transparent dark:bg-transparent',
          )}
        >
          <div className="flex h-[56px] items-center p-2 md:p-4">
            {/* Left Section - Logo */}
            <div className="flex items-center justify-start flex-shrink-0 w-auto md:w-[200px]">
              <Link href="/" className="flex items-center gap-3 ml-2 md:ml-4">
                <Image
                  src={logoSrc}
                  alt="Zmind Logo"
                  width={3195}
                  height={729}
                  className="w-[104px] md:w-[140px] h-auto"
                  priority
                /> 
              </Link>
            </div>

            {/* Center Section - Navigation Menu */}
            <div className="hidden md:flex items-center justify-center flex-grow">
              <NavMenu />
            </div>

            {/* Right Section - Actions */}
            <div className="flex items-center justify-end flex-shrink-0 w-auto md:w-[200px] ml-auto">
              <div className="flex flex-row items-center gap-2 md:gap-3 shrink-0">
                <div className="flex items-center space-x-3">
                  {user ? (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <button className="outline-none flex items-center justify-center rounded-full border border-border hover:bg-accent transition-colors p-0.5">
                           <Avatar className="h-8 w-8">
                            <AvatarImage src={userAvatar} alt={userName} />
                            <AvatarFallback>{userInitials}</AvatarFallback>
                          </Avatar>
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-56">
                        <DropdownMenuLabel className="font-normal">
                          <div className="flex flex-col space-y-1">
                            <p className="text-sm font-medium leading-none">{userName}</p>
                            <p className="text-xs leading-none text-muted-foreground">{userEmail}</p>
                          </div>
                        </DropdownMenuLabel>
                        <DropdownMenuSeparator />
                        <DropdownMenuGroup>
                          <DropdownMenuItem onClick={() => router.push('/dashboard')}>
                            <LayoutDashboard className="mr-2 h-4 w-4" />
                            <span>{t('landing.nav.dashboard', {default: 'Dashboard'})}</span>
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => router.push('/subscription')}>
                            <Sparkles className="mr-2 h-4 w-4" />
                            <span>Upgrade</span>
                          </DropdownMenuItem>
                        </DropdownMenuGroup>
                         <DropdownMenuSeparator />
                        <DropdownMenuItem onClick={() => signOut()}>
                          <LogOut className="mr-2 h-4 w-4" />
                          <span>Log out</span>
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  ) : (
                    <Link
                      className="bg-brand-600 hover:bg-brand-700 h-8 hidden md:flex items-center justify-center text-sm font-normal tracking-wide rounded-full text-white w-fit px-4 shadow-[inset_0_1px_2px_rgba(255,255,255,0.25),0_3px_3px_-1.5px_rgba(16,24,40,0.06),0_1px_1px_rgba(16,24,40,0.08)] border border-white/[0.12]"
                      href="/invite"
                    >
                      {t('landing.nav.tryFree', {default: 'Get beta access'})}
                    </Link>
                  )}
                </div>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      aria-label={t('userMenu.language', {default: 'Language'})}
                      className="hidden md:inline-flex items-center justify-center h-8 w-8 text-xs rounded-md border border-border hover:bg-accent/50"
                    >
                      <Globe className="h-4 w-4" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onSelect={() => switchLocale('zh')}>
                      <span className="text-xs">中文</span>
                      {locale === 'zh' && <span className="ml-auto text-xs">✓</span>}
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => switchLocale('en')}>
                      <span className="text-xs">English</span>
                      {locale === 'en' && <span className="ml-auto text-xs">✓</span>}
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
                <ThemeToggle />
                <button
                  className="md:hidden border border-border size-8 rounded-md cursor-pointer flex items-center justify-center"
                  onClick={toggleDrawer}
                >
                  {isDrawerOpen ? (
                    <X className="size-5" />
                  ) : (
                    <Menu className="size-5" />
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      </motion.div>

      {/* Mobile Drawer */}
      <AnimatePresence>
        {isDrawerOpen && (
          <>
            <motion.div
              className="fixed inset-0 bg-black/50 backdrop-blur-sm"
              initial="hidden"
              animate="visible"
              exit="exit"
              variants={overlayVariants}
              transition={{ duration: 0.2 }}
              onClick={handleOverlayClick}
            />

            <motion.div
              className="fixed inset-x-0 w-[95%] mx-auto bottom-3 bg-background border border-border p-4 rounded-xl shadow-lg"
              initial="hidden"
              animate="visible"
              exit="exit"
              variants={drawerVariants}
            >
              {/* Mobile menu content */}
              <div className="flex flex-col gap-4">
                <div className="flex items-center justify-between">
                  <Link href={base || '/'} className="flex items-center gap-3">
                    <Image
                      src={logoSrc}
                      alt="Zmind Logo"
                      width={3195}
                      height={729}
                      className="w-[120px] h-auto"
                      priority
                    />
                    <span className="font-medium text-primary text-sm">
                      / Zmind
                    </span>
                  </Link>
                  <button
                    onClick={toggleDrawer}
                    className="border border-border rounded-md p-1 cursor-pointer"
                  >
                    <X className="size-5" />
                  </button>
                </div>

                <motion.ul
                  className="flex flex-col text-sm mb-4 border border-border rounded-md"
                  variants={drawerMenuContainerVariants}
                >
                  <AnimatePresence>
                    {siteConfig.nav.links.map((item) => (
                      <motion.li
                        key={item.id}
                        className="p-2.5 border-b border-border last:border-b-0"
                        variants={drawerMenuVariants}
                      >
                        {item.href.startsWith('#') ? (
                          <a
                            href={item.href}
                            onClick={(e) => {
                              e.preventDefault();
                              if (pathname !== '/') {
                                router.push(`/${item.href}`);
                                setIsDrawerOpen(false);
                                return;
                              }

                              const element = document.getElementById(
                                item.href.substring(1),
                              );
                              element?.scrollIntoView({ behavior: 'smooth' });
                              setIsDrawerOpen(false);
                            }}
                            className={`underline-offset-4 hover:text-primary/80 transition-colors ${
                              pathname === '/' && activeSection === item.href.substring(1)
                                ? 'text-primary font-medium'
                                : 'text-primary/60'
                            }`}
                          >
                            {item.name}
                          </a>
                        ) : (
                          <Link
                            href={item.href}
                            onClick={() => setIsDrawerOpen(false)}
                            className={`underline-offset-4 hover:text-primary/80 transition-colors ${
                              item.href === pathname
                                ? 'text-primary font-medium'
                                : 'text-primary/60'
                            }`}
                          >
                            {item.name}
                          </Link>
                        )}
                      </motion.li>
                    ))}
                  </AnimatePresence>
                </motion.ul>

                {/* removed GitHub stars badge */}

                {/* Action buttons */}
                <div className="flex flex-col gap-2">
                  {user ? (
                    <Link
                      href="/dashboard"
                      className="bg-brand-600 hover:bg-brand-700 h-8 flex items-center justify-center text-sm font-normal tracking-wide rounded-full text-white w-full px-4 shadow-[inset_0_1px_2px_rgba(255,255,255,0.25),0_3px_3px_-1.5px_rgba(16,24,40,0.06),0_1px_1px_rgba(16,24,40,0.08)] border border-white/[0.12] transition-all ease-out active:scale-95"
                    >
                      {t('landing.nav.dashboard', {default: 'Dashboard'})}
                    </Link>
                  ) : (
                    <Link
                      href="/auth"
                      className="bg-brand-600 hover:bg-brand-700 h-8 flex items-center justify-center text-sm font-normal tracking-wide rounded-full text-white w-full px-4 shadow-[inset_0_1px_2px_rgba(255,255,255,0.25),0_3px_3px_-1.5px_rgba(16,24,40,0.06),0_1px_1px_rgba(16,24,40,0.08)] border border-white/[0.12] transition-all ease-out active:scale-95"
                    >
                      {t('landing.nav.tryFree', {default: 'Try free'})}
                    </Link>
                  )}
                  <div className="flex justify-between items-center gap-2">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <button
                          aria-label={t('userMenu.language', {default: 'Language'})}
                          className="border border-border h-8 w-8 text-xs rounded-md flex items-center justify-center"
                        >
                          <Globe className="h-4 w-4" />
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="start">
                        <DropdownMenuItem onSelect={() => switchLocale('zh')}>
                          <span className="text-xs">中文</span>
                          {locale === 'zh' && <span className="ml-auto text-xs">✓</span>}
                        </DropdownMenuItem>
                        <DropdownMenuItem onSelect={() => switchLocale('en')}>
                          <span className="text-xs">English</span>
                          {locale === 'en' && <span className="ml-auto text-xs">✓</span>}
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                    <ThemeToggle />
                  </div>
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </header>
  ); 
}
