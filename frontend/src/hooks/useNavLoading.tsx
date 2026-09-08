import * as React from 'react';
import { usePathname } from '@/i18n/routing';
import { isSameRoute } from '@/lib/routes';

type NavKey = string;

type Ctx = {
  activeKey: NavKey | null;
  setActiveKey: (key: NavKey | null) => void;
};

const NavLoadingContext = React.createContext<Ctx | null>(null);

export function NavLoadingProvider({ children }: { children: React.ReactNode }) {
  const [activeKey, setActiveKey] = React.useState<NavKey | null>(null);
  const ctx = React.useMemo(() => ({ activeKey, setActiveKey }), [activeKey]);
  return (
    <NavLoadingContext.Provider value={ctx}>{children}</NavLoadingContext.Provider>
  );
}

function useCtx() {
  const ctx = React.useContext(NavLoadingContext);
  if (!ctx) throw new Error('useNavLoading must be used within NavLoadingProvider');
  return ctx;
}

type UseNavLoadingOptions = {
  key: NavKey;
  to: string;
  timeoutMs?: number;
  navigate?: () => void; // if omitted, rely on nested Link default navigation
  onCloseMobile?: () => void;
};

export function useNavLoading(opts: UseNavLoadingOptions) {
  const { key, to, timeoutMs = 10000, navigate, onCloseMobile } = opts;
  const { activeKey, setActiveKey } = useCtx();
  const pathname = usePathname();
  const timerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const isLoading = activeKey === key;

  const stop = React.useCallback(() => {
    if (activeKey === key) setActiveKey(null);
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, [activeKey, key, setActiveKey]);

  const start = React.useCallback(() => {
    setActiveKey(key);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      // only clear if still the same active key
      if (document.visibilityState === 'hidden') return; // avoid churn on background tabs
      if (activeKey === key) setActiveKey(null);
      timerRef.current = null;
    }, timeoutMs);
  }, [key, setActiveKey, timeoutMs, activeKey]);

  const onClick = React.useCallback(
    (e: React.MouseEvent) => {
      // If already on target, short-circuit
      if (isSameRoute(pathname, to)) {
        e.preventDefault();
        stop();
        onCloseMobile?.();
        return;
      }
      start();
      onCloseMobile?.();
      // Let nested Link handle navigation, unless explicit navigate provided
      if (navigate) {
        e.preventDefault();
        navigate();
      }
    },
    [pathname, to, stop, start, navigate, onCloseMobile],
  );

  // Stop when we reach the destination
  React.useEffect(() => {
    if (isSameRoute(pathname, to)) {
      stop();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname, to]);

  // Cleanup timer on unmount
  React.useEffect(() => () => {
    if (timerRef.current) clearTimeout(timerRef.current);
  }, []);

  const buttonProps = {
    onClick,
    'aria-busy': isLoading || undefined,
  } as const;

  return { isLoading, buttonProps, stop };
}

// Per-item loading (no mutual exclusion)
export function useItemNavLoading({ to, timeoutMs = 10000 }: { to: string; timeoutMs?: number }) {
  const pathname = usePathname();
  const [loading, setLoading] = React.useState(false);
  const timerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const stop = React.useCallback(() => {
    setLoading(false);
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const onClick = React.useCallback(
    (e: React.MouseEvent) => {
      if (isSameRoute(pathname, to)) {
        e.preventDefault();
        stop();
        return;
      }
      setLoading(true);
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        setLoading(false);
        timerRef.current = null;
      }, timeoutMs);
      // Let Link navigate naturally
    },
    [pathname, to, stop, timeoutMs],
  );

  React.useEffect(() => {
    if (isSameRoute(pathname, to)) {
      stop();
    }
  }, [pathname, to, stop]);

  React.useEffect(() => () => {
    if (timerRef.current) clearTimeout(timerRef.current);
  }, []);

  return { isLoading: loading, onClick };
}

