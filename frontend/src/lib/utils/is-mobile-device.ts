/**
 * Device-level mobile detection utilities.
 * These helpers detect physical mobile/tablet devices via user agent, not viewport size.
 */

export type MobileDevicePlatform = 'ios' | 'android' | null;

function getNavigatorIfAvailable(): Navigator | null {
  if (typeof window === 'undefined') return null;
  return window.navigator;
}

function isIpadLikeDevice(userAgent: string, platform: string, maxTouchPoints: number): boolean {
  return /ipad/.test(userAgent) || (platform === 'MacIntel' && maxTouchPoints > 1);
}

export function isMobileDevice(): boolean {
  const nav = getNavigatorIfAvailable();
  if (!nav) return false;

  const userAgent = nav.userAgent.toLowerCase();
  if (/iphone|ipod/.test(userAgent)) return true;
  if (isIpadLikeDevice(userAgent, nav.platform, nav.maxTouchPoints || 0)) return true;
  if (/android/.test(userAgent)) return true;
  return false;
}

export function getMobileDevicePlatform(): MobileDevicePlatform {
  const nav = getNavigatorIfAvailable();
  if (!nav) return null;

  const userAgent = nav.userAgent.toLowerCase();
  if (/iphone|ipod/.test(userAgent)) return 'ios';
  if (isIpadLikeDevice(userAgent, nav.platform, nav.maxTouchPoints || 0)) return 'ios';
  if (/android/.test(userAgent)) return 'android';
  return null;
}

export function isIPhone(): boolean {
  const nav = getNavigatorIfAvailable();
  if (!nav) return false;
  return /iphone/.test(nav.userAgent.toLowerCase());
}

export function isIPad(): boolean {
  const nav = getNavigatorIfAvailable();
  if (!nav) return false;
  const userAgent = nav.userAgent.toLowerCase();
  return isIpadLikeDevice(userAgent, nav.platform, nav.maxTouchPoints || 0);
}

export function isAndroidPhone(): boolean {
  const nav = getNavigatorIfAvailable();
  if (!nav) return false;
  const userAgent = nav.userAgent.toLowerCase();
  return /android/.test(userAgent) && /mobile/.test(userAgent);
}

export function isAndroidTablet(): boolean {
  const nav = getNavigatorIfAvailable();
  if (!nav) return false;
  const userAgent = nav.userAgent.toLowerCase();
  return /android/.test(userAgent) && !/mobile/.test(userAgent);
}

export const ZMIND_DEEP_LINK = 'zmind://';
