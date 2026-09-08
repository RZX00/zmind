import { createClient } from '@/lib/supabase/client';
import { resolveBackendBase } from '@/lib/backend';
import { handleApiError, handleNetworkError, ErrorContext, ApiError } from './error-handler';
import { getCurrentWorkspaceId } from './workspace-session';

// Prefer internal URL during SSR inside the container, otherwise use public URL for the browser
const API_URL = resolveBackendBase();

export interface ApiClientOptions {
  showErrors?: boolean;
  errorContext?: ErrorContext;
  timeout?: number;
  params?: Record<string, any>;
}

export interface ApiResponse<T = any> {
  data?: T;
  error?: ApiError;
  success: boolean;
  status?: number;
}

/**
 * Build URL query string from params object
 */
function buildQueryString(params?: Record<string, any>): string {
  if (!params || Object.keys(params).length === 0) {
    return '';
  }

  const searchParams = new URLSearchParams();

  Object.entries(params).forEach(([key, value]) => {
    // Skip undefined values
    if (value === undefined) {
      return;
    }

    // Handle null as empty string
    if (value === null) {
      searchParams.append(key, '');
      return;
    }

    // Convert all other values to string
    searchParams.append(key, String(value));
  });

  const queryString = searchParams.toString();
  return queryString ? `?${queryString}` : '';
}

export const apiClient = {
  async request<T = any>(
    url: string,
    options: RequestInit & ApiClientOptions = {}
  ): Promise<ApiResponse<T>> {
    const {
      showErrors = true,
      errorContext,
      timeout = 30000,
      params,
      signal: externalSignal,
      ...fetchOptions
    } = options;

    // Build URL with query parameters
    const fullUrl = url + buildQueryString(params);

    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    try {
      const controller = new AbortController();
      timeoutId = setTimeout(() => controller.abort(), timeout);
      if (externalSignal) {
        if (externalSignal.aborted) {
          controller.abort();
        } else {
          externalSignal.addEventListener('abort', () => controller.abort(), { once: true });
        }
      }

      // Small auth token cache to avoid blocking every request on slow auth providers
      // Falls back to unauthenticated request quickly; retries once on 401 with a fresh token
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        ...fetchOptions.headers as Record<string, string>,
      };

      // Attach invite token when available for canvas endpoints (allows invited users to fetch canvas data)
      let inviteWorkspaceId: string | undefined;
      const attachInviteToken = () => {
        if (typeof window === 'undefined') return;
        if (headers['Authorization']) return;
        try {
          const match = url.match(/\/canvases\/([^\/\?]+)/);
          const canvasId = match && match[1] ? decodeURIComponent(match[1]) : null;
          if (!canvasId) return;
          const raw = window.sessionStorage.getItem(`canvas_invite_token:${canvasId}`);
          if (!raw) return;
          const parsed = JSON.parse(raw);
          const token = parsed?.token as string | undefined;
          const expiresAt = parsed?.expiresAt as string | undefined;
          if (expiresAt) {
            const expMs = new Date(expiresAt).getTime();
            if (Number.isFinite(expMs) && expMs < Date.now()) {
              window.sessionStorage.removeItem(`canvas_invite_token:${canvasId}`);
              return;
            }
          }
          if (!token) return;
          headers['Authorization'] = `Bearer ${token}`;
          const parts = token.split('.');
          if (parts.length >= 2) {
            try {
              const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
              const ws = payload?.workspaceId || payload?.workspace_id;
              if (typeof ws === 'string' && ws.trim()) {
                inviteWorkspaceId = ws;
              }
            } catch {}
          }
        } catch {}
      };

      attachInviteToken();

      // token caching helpers
      type AuthCache = { token: string | null; fetchedAt: number; pending: Promise<string | null> | null };
      const authCache: AuthCache = (globalThis as any).__aletheon_auth_cache__ || { token: null, fetchedAt: 0, pending: null };
      (globalThis as any).__aletheon_auth_cache__ = authCache;

      const TTL_MS = 30_000;
      const nowTs = Date.now();

      const authSubscribed = (globalThis as any).__aletheon_auth_subscribed__ as boolean | undefined;
      const ensureAuthSubscription = () => {
        if (typeof window === 'undefined') return;
        if (authSubscribed) return;
        try {
          const supabase = createClient();
          supabase.auth.onAuthStateChange((_event, session) => {
            authCache.token = session?.access_token ?? null;
            authCache.fetchedAt = Date.now();
          });
          (globalThis as any).__aletheon_auth_subscribed__ = true;
        } catch {}
      };

      ensureAuthSubscription();

      const getAuthTokenCached = async (timeoutMs = 400): Promise<string | null> => {
        if (typeof window === 'undefined') return null;
        if (authCache.token && nowTs - authCache.fetchedAt < TTL_MS) return authCache.token;
        if (!authCache.pending) {
          const supabase = createClient();
          authCache.pending = (async () => {
            try {
              const { data: { session } } = await supabase.auth.getSession();
              const tok = session?.access_token ?? null;
              authCache.token = tok;
              authCache.fetchedAt = Date.now();
              return tok;
            } catch {
              return null;
            } finally {
              authCache.pending = null;
            }
          })();
        }
        // Soft timeout: don't block the request too long just for token
        const softTimeout = new Promise<string | null>((resolve) => setTimeout(() => resolve(null), timeoutMs));
        return await Promise.race([authCache.pending, softTimeout]);
      };

      const attachAuthHeader = (token: string | null) => {
        if (token && !headers['Authorization']) headers['Authorization'] = `Bearer ${token}`;
      };

      // try quick token fetch; don't stall if it takes too long
      const initialToken = await getAuthTokenCached(400);
      attachAuthHeader(initialToken);

      const workspaceId = inviteWorkspaceId || getCurrentWorkspaceId();
      if (workspaceId) {
        headers['X-Workspace-Id'] = workspaceId;
      }

      const doFetch = async (): Promise<Response> => fetch(fullUrl, {
        ...fetchOptions,
        headers,
        signal: controller.signal,
        // Ensure we always bypass caches for dynamic canvas content
        cache: 'no-store' as RequestCache,
      });

      let response = await doFetch();

      // If missing/expired token caused 401, retry once with a freshly awaited token
      if (!response.ok && response.status === 401 && typeof window !== 'undefined') {
        try {
          const strongToken = await getAuthTokenCached(2000);
          if (strongToken && (!initialToken || strongToken !== initialToken)) {
            headers['Authorization'] = `Bearer ${strongToken}`;
            response = await doFetch();
          }
        } catch {}
      }

      if (response.status === 304) {
        return {
          success: true,
          status: response.status,
        };
      }

      if (!response.ok) {
        let errorMessage = `HTTP ${response.status}: ${response.statusText}`;
        let errorData: any = null;
        let errorCode: string | undefined;

        try {
          errorData = await response.json();
          const detail = errorData?.detail;
          const nested =
            detail && typeof detail === 'object' && !Array.isArray(detail) ? detail : errorData;
          const nestedError =
            nested?.error && typeof nested.error === 'object' ? nested.error : undefined;
          errorMessage =
            (typeof nested?.message === 'string' && nested.message) ||
            (typeof nestedError?.message === 'string' && nestedError.message) ||
            (typeof errorData?.message === 'string' && errorData.message) ||
            (typeof detail === 'string' ? detail : errorMessage);
          errorCode =
            (typeof nested?.code === 'string' && nested.code) ||
            (typeof nestedError?.code === 'string' && nestedError.code) ||
            (typeof errorData?.code === 'string' && errorData.code) ||
            undefined;
        } catch {
        }

        // Create a custom error object to avoid read-only property issues
        const error: ApiError = Object.assign(Object.create(Error.prototype), {
          message: errorMessage,
          name: 'ApiError',
          status: response.status,
          response: response,
          details: errorData || undefined,
          code: errorCode || errorData?.code || response.status.toString()
        });

        if (showErrors) {
          handleApiError(error, errorContext);
        }

        return {
          error,
          success: false,
          status: response.status,
        };
      }

      let data: T;
      const contentType = response.headers.get('content-type');
      
      if (contentType?.includes('application/json')) {
        data = await response.json();
      } else if (contentType?.includes('text/')) {
        data = await response.text() as T;
      } else {
        data = await response.blob() as T;
      }

      return {
        data,
        success: true,
        status: response.status,
      };

    } catch (error: any) {
      let apiError: ApiError;
      
      if (error?.name === 'AbortError') {
        // Create custom error for timeout
        apiError = Object.assign(Object.create(Error.prototype), {
          message: 'Request timeout',
          name: 'ApiError',
          code: 'TIMEOUT'
        });
      } else if (error instanceof Error) {
        // Create a copy of the error to avoid read-only issues
        apiError = Object.assign(Object.create(Error.prototype), {
          message: error.message,
          name: error.name || 'ApiError',
          stack: error.stack
        });
      } else {
        apiError = Object.assign(Object.create(Error.prototype), {
          message: String(error),
          name: 'ApiError'
        });
      }

      if (showErrors) {
        handleNetworkError(apiError, errorContext);
      }

      return {
        error: apiError,
        success: false,
      };
    } finally {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    }
  },

  get: async <T = any>(
    url: string,
    options: Omit<RequestInit & ApiClientOptions, 'method' | 'body'> = {}
  ): Promise<ApiResponse<T>> => {
    return apiClient.request<T>(url, {
      ...options,
      method: 'GET',
    });
  },

  post: async <T = any>(
    url: string,
    data?: any,
    options: Omit<RequestInit & ApiClientOptions, 'method'> = {}
  ): Promise<ApiResponse<T>> => {
    return apiClient.request<T>(url, {
      ...options,
      method: 'POST',
      body: data ? JSON.stringify(data) : undefined,
    });
  },

  put: async <T = any>(
    url: string,
    data?: any,
    options: Omit<RequestInit & ApiClientOptions, 'method'> = {}
  ): Promise<ApiResponse<T>> => {
    return apiClient.request<T>(url, {
      ...options,
      method: 'PUT',
      body: data ? JSON.stringify(data) : undefined,
    });
  },

  patch: async <T = any>(
    url: string,
    data?: any,
    options: Omit<RequestInit & ApiClientOptions, 'method'> = {}
  ): Promise<ApiResponse<T>> => {
    return apiClient.request<T>(url, {
      ...options,
      method: 'PATCH',
      body: data ? JSON.stringify(data) : undefined,
    });
  },

  delete: async <T = any>(
    url: string,
    options: Omit<RequestInit & ApiClientOptions, 'method' | 'body'> = {}
  ): Promise<ApiResponse<T>> => {
    return apiClient.request<T>(url, {
      ...options,
      method: 'DELETE',
    });
  },

  upload: async <T = any>(
    url: string,
    formData: FormData,
    options: Omit<RequestInit & ApiClientOptions, 'method' | 'body'> = {}
  ): Promise<ApiResponse<T>> => {
    const { headers, ...restOptions } = options;
    
    const uploadHeaders = { ...headers as Record<string, string> };
    delete uploadHeaders['Content-Type'];

    return apiClient.request<T>(url, {
      ...restOptions,
      method: 'POST',
      body: formData,
      headers: uploadHeaders,
    });
  },
};

export const supabaseClient = {
  async execute<T = any>(
    queryFn: () => Promise<{ data: T | null; error: any }>,
    errorContext?: ErrorContext
  ): Promise<ApiResponse<T>> {
    try {
      const { data, error } = await queryFn();

      if (error) {
        // Create custom error object to avoid read-only property issues
        const apiError: ApiError = Object.assign(Object.create(Error.prototype), {
          message: error.message || 'Database error',
          name: 'ApiError',
          code: error.code,
          details: error
        });

        handleApiError(apiError, errorContext);

        return {
          error: apiError,
          success: false,
        };
      }

      return {
        data: data as T,
        success: true,
      };
    } catch (error: any) {
      // Create a copy of the error to avoid read-only issues
      const apiError: ApiError = error instanceof Error 
        ? Object.assign(Object.create(Error.prototype), {
            message: error.message,
            name: error.name || 'ApiError',
            stack: error.stack
          })
        : Object.assign(Object.create(Error.prototype), {
            message: String(error),
            name: 'ApiError'
          });
      
      handleApiError(apiError, errorContext);

      return {
        error: apiError,
        success: false,
      };
    }
  },
};

export const backendApi = {
  get: <T = any>(endpoint: string, options?: Omit<RequestInit & ApiClientOptions, 'method' | 'body'>) =>
    apiClient.get<T>(`${API_URL}${endpoint}`, options),

  post: <T = any>(endpoint: string, data?: any, options?: Omit<RequestInit & ApiClientOptions, 'method'>) =>
    apiClient.post<T>(`${API_URL}${endpoint}`, data, options),

  put: <T = any>(endpoint: string, data?: any, options?: Omit<RequestInit & ApiClientOptions, 'method'>) =>
    apiClient.put<T>(`${API_URL}${endpoint}`, data, options),

  patch: <T = any>(endpoint: string, data?: any, options?: Omit<RequestInit & ApiClientOptions, 'method'>) =>
    apiClient.patch<T>(`${API_URL}${endpoint}`, data, options),

  delete: <T = any>(endpoint: string, options?: Omit<RequestInit & ApiClientOptions, 'method' | 'body'>) =>
    apiClient.delete<T>(`${API_URL}${endpoint}`, options),

  upload: <T = any>(endpoint: string, formData: FormData, options?: Omit<RequestInit & ApiClientOptions, 'method' | 'body'>) =>
    apiClient.upload<T>(`${API_URL}${endpoint}`, formData, options),
};

 
