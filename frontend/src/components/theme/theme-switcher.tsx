'use client';

import * as React from 'react';
import { Check, Monitor, Moon, Sun } from 'lucide-react';
import { useTheme } from 'next-themes';
import { useTranslations } from 'next-intl';

import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuPortal,
} from '@/components/ui/dropdown-menu';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';

type ThemeValue = 'light' | 'dark' | 'system';

const isThemeValue = (value: string | null | undefined): value is ThemeValue =>
  value === 'light' || value === 'dark' || value === 'system';

const getThemeOptions = (t: ReturnType<typeof useTranslations>) => [
  {
    value: 'light' as const,
    label: t('themeLight', { default: 'Light' }),
    icon: Sun,
  },
  {
    value: 'dark' as const,
    label: t('themeDark', { default: 'Dark' }),
    icon: Moon,
  },
  {
    value: 'system' as const,
    label: t('themeSystem', { default: 'System' }),
    icon: Monitor,
  },
];

type ButtonProps = React.ComponentProps<typeof Button>;

export interface ThemeSwitcherProps {
  variant?: ButtonProps['variant'];
  size?: ButtonProps['size'];
  className?: string;
  align?: React.ComponentProps<typeof DropdownMenuContent>['align'];
  side?: React.ComponentProps<typeof DropdownMenuContent>['side'];
  showLabel?: boolean;
  showValue?: boolean;
  label?: string;
  tooltip?: string;
}

export function ThemeSwitcher({
  variant = 'ghost',
  size = 'icon',
  className,
  align = 'end',
  side = 'bottom',
  showLabel = false,
  showValue = false,
  label,
  tooltip,
}: ThemeSwitcherProps) {
  const t = useTranslations('common');
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = React.useState(false);

  React.useEffect(() => {
    setMounted(true);
  }, []);

  const selectedTheme = mounted && isThemeValue(theme) ? theme : 'system';
  const themeOptions = React.useMemo(() => getThemeOptions(t), [t]);
  const activeOption =
    themeOptions.find((option) => option.value === selectedTheme) ?? themeOptions[2];
  const TriggerIcon = activeOption.icon;

  const baseLabel = label ?? t('theme', { default: 'Theme' });
  const triggerLabel = showValue ? `${baseLabel}: ${activeOption.label}` : baseLabel;

  const triggerButton = (
    <DropdownMenuTrigger asChild>
      <Button
        variant={variant}
        size={size}
        className={className}
        aria-label={triggerLabel}
      >
        <TriggerIcon className="h-4 w-4" />
        {showLabel && <span className="text-sm">{triggerLabel}</span>}
        {!showLabel && <span className="sr-only">{triggerLabel}</span>}
      </Button>
    </DropdownMenuTrigger>
  );

  return (
    <DropdownMenu>
      {tooltip ? (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>{triggerButton}</TooltipTrigger>
            <TooltipContent side={side}>{tooltip}</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      ) : (
        triggerButton
      )}
      <DropdownMenuContent align={align} side={side} className="min-w-40">
        <DropdownMenuLabel className="text-xs text-muted-foreground">
          {baseLabel}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {themeOptions.map((option) => {
          const Icon = option.icon;
          const isActive = option.value === selectedTheme;
          return (
            <DropdownMenuItem
              key={option.value}
              onSelect={() => setTheme(option.value)}
              className={cn(
                'flex items-center gap-2',
                isActive && 'bg-accent/60'
              )}
            >
              <Icon className="h-4 w-4" />
              <span>{option.label}</span>
              {isActive && <Check className="ml-auto h-4 w-4 text-foreground/70" />}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export interface ThemeMenuSubProps {
  label?: string;
}

export function ThemeMenuSub({ label }: ThemeMenuSubProps) {
  const t = useTranslations('common');
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = React.useState(false);

  React.useEffect(() => {
    setMounted(true);
  }, []);

  const selectedTheme = mounted && isThemeValue(theme) ? theme : 'system';
  const themeOptions = React.useMemo(() => getThemeOptions(t), [t]);
  const baseLabel = label ?? t('theme', { default: 'Theme' });

  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger className="gap-2">
        <Sun className="h-4 w-4" />
        <span>{baseLabel}</span>
      </DropdownMenuSubTrigger>
      <DropdownMenuPortal>
        <DropdownMenuSubContent>
          {themeOptions.map((option) => {
            const Icon = option.icon;
            const isActive = option.value === selectedTheme;
            return (
              <DropdownMenuItem
                key={option.value}
                onSelect={() => setTheme(option.value)}
                className={cn(
                  'flex items-center gap-2',
                  isActive && 'bg-accent/60'
                )}
              >
                <Icon className="h-4 w-4" />
                <span>{option.label}</span>
                {isActive && <Check className="ml-auto h-4 w-4 text-foreground/70" />}
              </DropdownMenuItem>
            );
          })}
        </DropdownMenuSubContent>
      </DropdownMenuPortal>
    </DropdownMenuSub>
  );
}
