'use client';

import {Link, useRouter} from '@/i18n/routing';
import { SubmitButton } from '@/components/ui/submit-button';
import { Input } from '@/components/ui/input';
import GoogleSignIn from '@/components/GoogleSignIn';
import { useState, useEffect, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import Image from 'next/image';
import {
  CheckCircle,
  AlertCircle,
  MailCheck,
} from 'lucide-react';
import { useAuth } from '@/components/AuthProvider';
import { useAuthMethodTracking } from '@/lib/stores/auth-tracking';
import { toast } from 'sonner';

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { ZmindLogo } from '@/components/sidebar/zmind-logo';
import { CanvasBg } from '@/components/home/ui/CanvasBg';
import { UnifiedLoader } from '@/components/ui/loader';
import {useLocale, useTranslations} from 'next-intl';

function LoginContent() {
  const t = useTranslations();
  const router = useRouter();
  const locale = useLocale();
  const searchParams = useSearchParams();
  const { user, isLoading } = useAuth();
  const mode = searchParams.get('mode');
  const rawReturnUrl = searchParams.get('returnUrl') ?? searchParams.get('redirect') ?? undefined;
  const safeReturnUrl = rawReturnUrl && rawReturnUrl.startsWith('/') ? rawReturnUrl : undefined;
  const targetReturnUrl = safeReturnUrl ?? '/dashboard';
  const message = searchParams.get('message');

  const isSignUp = mode === 'signup';
  const [mounted, setMounted] = useState(false);

  const { wasLastMethod: wasEmailLastMethod, markAsUsed: markEmailAsUsed } = useAuthMethodTracking('email');

  useEffect(() => {
    if (!isLoading && user) {
      router.push(targetReturnUrl, {locale: locale as any});
      // Fallback in case client navigation is blocked by form action state
      try {
        const prefix = typeof window !== 'undefined' && window.location.pathname.startsWith('/zh') ? '/zh' : '';
        setTimeout(() => { window.location.assign(`${prefix}${targetReturnUrl}`); }, 50);
      } catch {}
    }
  }, [user, isLoading, router, locale, targetReturnUrl]);

  const isSuccessMessage =
    message &&
    (message.includes('Check your email') ||
      message.includes('Account created') ||
      message.includes('success'));

  // Registration success state
  const [registrationSuccess, setRegistrationSuccess] =
    useState(!!isSuccessMessage);
  const [registrationEmail, setRegistrationEmail] = useState('');

  const [forgotPasswordOpen, setForgotPasswordOpen] = useState(false);
  const [forgotPasswordEmail, setForgotPasswordEmail] = useState('');
  const [forgotPasswordStatus, setForgotPasswordStatus] = useState<{
    success?: boolean;
    message?: string;
  }>({});

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (isSuccessMessage) {
      setRegistrationSuccess(true);
    }
  }, [isSuccessMessage]);

  const handleSignIn = async (_prevState: any, formData: FormData) => {
    markEmailAsUsed();

    const email = String(formData.get('email') || '');
    const password = String(formData.get('password') || '');

    if (!email.includes('@')) {
      toast.error(t('auth.loginFailed'), {
        description: 'Please enter a valid email address',
        duration: 5000,
      });
      return {};
    }

    if (password.length < 6) {
      toast.error(t('auth.loginFailed'), {
        description: 'Password must be at least 6 characters',
        duration: 5000,
      });
      return {};
    }

    // 浏览器直连自建 GoTrue（api.zmind.so）。不要走 Server Action：
    // Windows + Clash fake-IP 下，Node 进程 TLS 会在到达网关前被掐断。
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithPassword({ email, password });

    if (error) {
      toast.error(t('auth.loginFailed'), {
        description: error.message || 'Could not authenticate user',
        duration: 5000,
      });
      return {};
    }

    router.push(targetReturnUrl, {locale: locale as any});
    try {
      const prefix = typeof window !== 'undefined' && window.location.pathname.startsWith('/zh') ? '/zh' : '';
      setTimeout(() => { window.location.assign(`${prefix}${targetReturnUrl}`); }, 50);
    } catch {}
    return null;
  };

  const handleSignUp = async (_prevState: any, formData: FormData) => {
    markEmailAsUsed();

    const email = formData.get('email') as string;
    setRegistrationEmail(email);

    const password = String(formData.get('password') || '');
    const confirmPassword = String(formData.get('confirmPassword') || '');
    const origin = window.location.origin;

    if (!email.includes('@')) {
      toast.error(t('auth.signupFailed'), {
        description: 'Please enter a valid email address',
        duration: 5000,
      });
      return {};
    }
    if (password.length < 6) {
      toast.error(t('auth.signupFailed'), {
        description: 'Password must be at least 6 characters',
        duration: 5000,
      });
      return {};
    }
    if (password !== confirmPassword) {
      toast.error(t('auth.signupFailed'), {
        description: 'Passwords do not match',
        duration: 5000,
      });
      return {};
    }

    const supabase = createClient();
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: `${origin}/auth/callback?returnUrl=${encodeURIComponent(targetReturnUrl)}`,
      },
    });

    const result = error
      ? { message: error.message || 'Could not create account' }
      : await (async () => {
          const { error: signInError } = await supabase.auth.signInWithPassword({
            email,
            password,
          });
          if (signInError) {
            return {
              message: 'Account created! Check your email to confirm your registration.',
            };
          }
          return { success: true, redirectTo: targetReturnUrl };
        })();

    // Check for success and redirectTo properties (direct login case)
    if (
      result &&
      typeof result === 'object' &&
      'success' in result &&
      result.success &&
      'redirectTo' in result
    ) {
      // Locale-aware client navigation to preserve zh/en prefix
      router.push(targetReturnUrl, {locale: locale as any});
      // Hard fallback
      try {
        const prefix = typeof window !== 'undefined' && window.location.pathname.startsWith('/zh') ? '/zh' : '';
        setTimeout(() => { window.location.assign(`${prefix}${targetReturnUrl}`); }, 50);
      } catch {}
      return null; // Prevent normal form action completion
    }

    // Check if registration was successful but needs email verification
    if (result && typeof result === 'object' && 'message' in result) {
      const resultMessage = result.message as string;
      if (resultMessage.includes('Check your email')) {
        setRegistrationSuccess(true);

        // Update URL without causing a refresh
        const params = new URLSearchParams(window.location.search);
        params.set('message', resultMessage);

        const newUrl =
          window.location.pathname +
          (params.toString() ? '?' + params.toString() : '');

        window.history.pushState({ path: newUrl }, '', newUrl);

        return result;
      } else {
        toast.error(t('auth.signupFailed'), {
          description: resultMessage,
          duration: 5000,
        });
        return {};
      }
    }

    return result;
  };

  const handleForgotPassword = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();

    setForgotPasswordStatus({});

    if (!forgotPasswordEmail || !forgotPasswordEmail.includes('@')) {
      setForgotPasswordStatus({
        success: false,
        message: t('auth.forgot.invalidEmail'),
      });
      return;
    }

    const supabase = createClient();
    const { error } = await supabase.auth.resetPasswordForEmail(forgotPasswordEmail, {
      redirectTo: `${window.location.origin}/auth/reset-password`,
    });

    setForgotPasswordStatus(
      error
        ? { success: false, message: error.message || 'Could not send password reset email' }
        : { success: true, message: 'Check your email for a password reset link' },
    );
  };

  const resetRegistrationSuccess = () => {
    setRegistrationSuccess(false);
    // Remove message from URL and set mode to signin
    const params = new URLSearchParams(window.location.search);
    params.delete('message');
    params.set('mode', 'signin');

    const newUrl =
      window.location.pathname +
      (params.toString() ? '?' + params.toString() : '');

    window.history.pushState({ path: newUrl }, '', newUrl);

    router.refresh();
  };

  // Show loading spinner while checking auth state
  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <UnifiedLoader size="lg" />
      </div>
    );
  }

  // Registration success view
  if (registrationSuccess) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <div className="w-full max-w-md mx-auto">
          <div className="text-center">
            <div className="bg-green-50 dark:bg-green-950/20 rounded-full p-4 mb-6 inline-flex">
              <MailCheck className="h-12 w-12 text-green-500 dark:text-green-400" />
            </div>

            <h1 className="text-3xl font-semibold text-foreground mb-4">
              {t('auth.success.title')}
            </h1>

            <p className="text-muted-foreground mb-2">
              {t('auth.success.sent')}
            </p>

            <p className="text-lg font-medium mb-6">
              {registrationEmail || 'your email address'}
            </p>

            <div className="bg-green-50 dark:bg-green-950/20 border border-green-100 dark:border-green-900/50 rounded-lg p-4 mb-8">
              <p className="text-sm text-green-800 dark:text-green-400">
                {t('auth.success.help')}
              </p>
            </div>

            <div className="flex flex-col sm:flex-row gap-3 justify-center items-center">
              <Link
                href="/"
                className="flex h-11 items-center justify-center px-6 text-center rounded-lg border border-border bg-background hover:bg-accent transition-colors"
              >
                {t('auth.success.returnHome')}
              </Link>
              <button
                onClick={resetRegistrationSuccess}
                className="flex h-11 items-center justify-center px-6 text-center rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
              >
                {t('auth.success.backToSignIn')}
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
      <div
        className="min-h-screen bg-background relative overflow-hidden"
        style={{
          ['--primary' as any]: '#28C842',
          ['--primary-foreground' as any]: '#ffffff',
        }}
      >
        <div className="absolute top-6 left-6 z-10">
            <ZmindLogo size={28} />
        </div>
        <div className="flex min-h-screen">
          <div className="relative z-10 flex-1 flex items-center justify-center p-4 lg:p-8">
            <div className="w-full max-w-sm">
              <div className="mb-4 flex items-center flex-col gap-3 sm:gap-4 justify-center">
                <h1 className="text-xl sm:text-2xl font-semibold text-foreground text-center leading-tight">
                  {isSignUp ? t('auth.form.createTitle') : t('auth.form.loginTitle')}
                </h1>
              </div>
            <div className="space-y-3 mb-4">
              <GoogleSignIn returnUrl={targetReturnUrl} />
            </div>
            <div className="relative my-4">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-border"></div>
              </div>
              <div className="relative flex justify-center text-sm">
                <span className="px-2 bg-background text-muted-foreground">
                  {t('auth.form.orEmail')}
                </span>
              </div>
            </div>
            <form className="space-y-3">
              <Input
                id="email"
                name="email"
                type="email"
                placeholder={t('auth.form.email')}
                className="h-10 rounded-lg"
                required
              />
              <Input
                id="password"
                name="password"
                type="password"
                placeholder={t('auth.form.password')}
                className="h-10 rounded-lg"
                required
              />
              {isSignUp && (
                <Input
                  id="confirmPassword"
                  name="confirmPassword"
                  type="password"
                  placeholder={t('auth.form.confirmPassword')}
                  className="h-10 rounded-lg"
                  required
                />
              )}
              <div className="pt-2">
                <div className="relative">
                  <SubmitButton
                    formAction={isSignUp ? handleSignUp : handleSignIn}
                    className="w-full h-10 bg-primary text-primary-foreground hover:bg-primary/90 transition-colors rounded-lg"
                    pendingText={isSignUp ? t('auth.form.creating') : t('auth.form.signing')}
                  >
                    {isSignUp ? t('auth.form.create') : t('auth.form.signIn')}
                  </SubmitButton>
                  {wasEmailLastMethod && (
                    <div className="absolute -top-1 -right-1 w-3 h-3 bg-green-500 rounded-full border-2 border-background shadow-sm">
                      <div className="w-full h-full bg-green-500 rounded-full animate-pulse" />
                    </div>
                  )}
                </div>
              </div>
            </form>
            
            <div className="mt-4 space-y-3 text-center text-sm">
              {!isSignUp && (
                <button
                  type="button"
                  onClick={() => setForgotPasswordOpen(true)}
                  className="text-primary hover:underline"
                >
                  {t('auth.form.forgot')}
                </button>
              )}
              
              <div>
                <Link
                  href={isSignUp 
                    ? `/auth?returnUrl=${encodeURIComponent(targetReturnUrl)}`
                    : `/auth?mode=signup&returnUrl=${encodeURIComponent(targetReturnUrl)}`
                  }
                  className="text-muted-foreground hover:text-foreground transition-colors"
                >
                  {isSignUp ? t('auth.form.already') : t('auth.form.noAccount')}
                </Link>
              </div>
            </div>
          </div>
        </div>
        <div className="hidden lg:flex flex-1 items-center justify-center relative overflow-visible z-0">
          <div className="absolute inset-0 overflow-visible pointer-events-none z-10">
            <CanvasBg.OrthogonalBands
              className="overflow-visible"
              preset="calm"
              bands={3}
              bandHeight={180}
              widthPct={92}
              cornerRadius={0}
              opacity={0.32}
              periodSec={46}
              amplitude={20}
              customBands={[
                // top (logo)
                { offsetY: -220, baseX: -80, angle: -1.8, widthPct: 92, opacity: 0.34 },
                // middle (is/是)
                { offsetY:  -10, baseX:  80, angle:  1.6, widthPct: 88, opacity: 0.32 },
                // bottom (tagline)
                { offsetY:  230, baseX:   0, angle:  0.8, widthPct: 86, opacity: 0.28 },
              ]}
              content={[
                // Top band: logo (auto theme) — scale to fill band
                (
                  <div key="logo" className="flex items-center justify-center w-full h-full">
                    <Image
                      src="/zmind-logo.svg"
                      alt="Zmind"
                      width={220}
                      height={70}
                      className="block dark:hidden max-h-[52%] max-w-[58%] h-auto w-auto opacity-60"
                    />
                    <Image
                      src="/zmind-logo-white.svg"
                      alt="Zmind"
                      width={220}
                      height={70}
                      className="hidden dark:block max-h-[52%] max-w-[58%] h-auto w-auto opacity-60"
                    />
                  </div>
                ),
                // Middle band: "is" / "是"
                (
                  <span key="is" className="font-extrabold tracking-tight text-6xl md:text-7xl text-foreground/60">
                    {t('auth.banner.is')}
                  </span>
                ),
                // Bottom band: tagline (i18n)
                (
                  <span key="tagline" className="text-[20px] md:text-[40px] lg:text-[56px] font-semibold text-foreground/60 text-center leading-tight max-w-[92%]">
                    {t('auth.banner.tagline')}
                  </span>
                ),
              ]}
            />
          </div>
        </div>
      </div>
      <Dialog open={forgotPasswordOpen} onOpenChange={setForgotPasswordOpen}>
        <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <div className="flex items-center justify-between">
              <DialogTitle>{t('auth.forgot.title')}</DialogTitle>
              </div>
            <DialogDescription>
              {t('auth.forgot.desc')}
            </DialogDescription>
            </DialogHeader>
            <form onSubmit={handleForgotPassword} className="space-y-4">
              <Input
                id="forgot-password-email"
                type="email"
                placeholder={t('auth.form.email')}
                value={forgotPasswordEmail}
                onChange={(e) => setForgotPasswordEmail(e.target.value)}
                className="h-11 rounded-xl"
                required
              />
            {forgotPasswordStatus.message && (
              <div
                className={`p-3 rounded-md flex items-center gap-3 ${
                  forgotPasswordStatus.success
                    ? 'bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-900/50 text-green-800 dark:text-green-400'
                    : 'bg-destructive/10 border border-destructive/20 text-destructive'
                }`}
              >
                {forgotPasswordStatus.success ? (
                  <CheckCircle className="h-4 w-4 flex-shrink-0" />
                ) : (
                  <AlertCircle className="h-4 w-4 flex-shrink-0" />
                )}
                <span className="text-sm">{forgotPasswordStatus.message}</span>
              </div>
            )}
            <DialogFooter className="gap-2">
              <button
                type="button"
                onClick={() => setForgotPasswordOpen(false)}
                className="h-10 px-4 border border-border bg-background hover:bg-accent transition-colors rounded-md"
              >
                {t('auth.forgot.cancel')}
              </button>
              <button
                type="submit"
                className="h-10 px-4 bg-primary text-primary-foreground hover:bg-primary/90 transition-colors rounded-md"
              >
                {t('auth.forgot.send')}
              </button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default function Login() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-background flex items-center justify-center">
          <UnifiedLoader size="lg" />
        </div>
      }
    >
      <LoginContent />
    </Suspense>
  );
}
