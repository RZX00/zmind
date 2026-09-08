"use client"

import * as React from "react"
import {Link, usePathname} from "@/i18n/routing"
import {
  GalleryVerticalEnd,
} from "lucide-react"

import { TeamSwitcher } from "@/components/team-switcher"
import { NavUser } from "@/components/nav-user"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"

import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from "@/components/ui/sidebar"
import { ThemeToggle } from "./home/theme-toggle"
import Image from "next/image"
import { useEffect } from "react"
import { useTheme } from "next-themes"
import { useLocale } from "next-intl"
import { localizePathname } from "@/i18n/locales"

const data = {
  user: {
    name: "Zmind User",
    email: "team@zmind.so",
    avatar: "/favicon.png",
  },
  teams: [
    {
      name: "Zmind AI",
      logo: GalleryVerticalEnd,
      plan: "Open Source",
    },
  ],
  navMain: [
    {
      title: "Docs",
      items: [
        {
          title: "Introduction",
          url: "/docs/introduction",
        },
        {
          title: "Canvas Guide",
          url: "/docs/canvas-guide",
        },
      ],
    },
  ],
}

const LocaleToggle = ({ isZh, href }: { isZh: boolean; href: string }) => (
  <Button
    variant="outline"
    size="sm"
    asChild
    className="h-8 px-3 rounded-full border-border/60 bg-muted/70 hover:bg-accent/70 text-xs font-semibold"
  >
    <Link href={href}>{isZh ? 'EN' : '中文'}</Link>
  </Button>
)

export function AppSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
  const pathname = usePathname()
  const locale = useLocale()
  const [mounted, setMounted] = React.useState(false);
  const { resolvedTheme } = useTheme();

  useEffect(() => {
    setMounted(true);
  }, []);

  const logoSrc = !mounted
    ? '/zmind-logo.svg'
    : resolvedTheme === 'dark'
      ? '/zmind-logo-white.svg'
      : '/zmind-logo.svg';
  

  const isActive = (url: string) => {
    const baseUrl = url.split('#')[0]
    return pathname === baseUrl
  }

  const isZh = locale === 'zh'
  const currentPathname =
    typeof window !== 'undefined' ? window.location.pathname : pathname
  const searchAndHash =
    typeof window !== 'undefined' ? `${window.location.search}${window.location.hash}` : ''
  const localeTarget = `${localizePathname(currentPathname, isZh ? 'en' : 'zh')}${searchAndHash}`
  const getNavTitle = (item: { url: string; title: string }) => {
    if (!isZh) return item.title;
    if (item.url === '/docs/introduction') return '产品介绍';
    if (item.url === '/docs/canvas-guide') return '画布使用指南';
    return item.title;
  };

  return (
    <Sidebar className="w-72 [&_[data-sidebar=sidebar]]:bg-white dark:[&_[data-sidebar=sidebar]]:bg-black border-none" {...props}>
      <SidebarHeader className="bg-transparent p-6 px-2">
        <div className="flex items-center justify-between gap-2 pr-2">
          <Link href="/" className="inline-flex items-center">
            <Image
              src={logoSrc}
              alt="Zmind Logo"
              width={120}
              height={32}
              className="h-auto w-[120px]"
              priority
            />
          </Link>
          <LocaleToggle isZh={isZh} href={localeTarget} />
        </div>
      </SidebarHeader>
      <SidebarContent className="px-2 bg-transparent scrollbar-thin scrollbar-thumb-primary/20 scrollbar-track-transparent">
        {data.navMain.map((section) => (
          <SidebarGroup key={section.title}>
            <SidebarGroupLabel className="font-medium tracking-wide">{section.title}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {section.items.map((item) => (
                  <SidebarMenuItem key={item.title}>
                    <SidebarMenuButton 
                      className="font-semibold"
                      asChild
                      isActive={isActive(item.url)}
                    >
                      <Link href={item.url} className="flex items-center justify-between w-full">
                        <span>{getNavTitle(item)}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>
      <SidebarFooter className="bg-transparent p-4 flex flex-row justify-between items-center">
        <div className="text-muted-foreground text-xs">Version 0.1.0</div>
        <ThemeToggle/>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  )
}
