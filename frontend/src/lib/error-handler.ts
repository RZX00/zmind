import type { ExternalToast } from 'sonner';

// SSR-safe toast wrapper: no top-level import of 'sonner'.
// On the server, these are no-ops; on the client they lazy-load 'sonner'.
type ToastMethod = (message: string, options?: ExternalToast | { description?: string; duration?: number }) => void;

const createClientToast = () => import('sonner').then((m) => m.toast).catch(() => null);

const safeToast = {
  success: ((message: string, options?: any) => {
    if (typeof window === 'undefined') return;
    createClientToast().then((t) => t?.success?.(message, options));
  }) as ToastMethod,
  error: ((message: string, options?: any) => {
    if (typeof window === 'undefined') return;
    createClientToast().then((t) => t?.error?.(message, options));
  }) as ToastMethod,
  warning: ((message: string, options?: any) => {
    if (typeof window === 'undefined') return;
    createClientToast().then((t) => t?.warning?.(message, options));
  }) as ToastMethod,
  info: ((message: string, options?: any) => {
    if (typeof window === 'undefined') return;
    createClientToast().then((t) => t?.info?.(message, options));
  }) as ToastMethod,
};

export interface ApiError extends Error {
  status?: number;
  code?: string;
  detail?: any;   // keep parity with backend's `detail` field
  details?: any;  // fallback alias
  response?: Response;
}

export interface ErrorContext {
  operation?: string;
  resource?: string;
  silent?: boolean;
}

const getStatusMessage = (status: number): string => {
  switch (status) {
    case 400:
      return 'Invalid request. Please check your input and try again.';
    case 401:
      return 'Authentication required. Please sign in again.';
    case 403:
      return 'Access denied. You don\'t have permission to perform this action.';
    case 404:
      return 'The requested resource was not found.';
    case 408:
      return 'Request timeout. Please try again.';
    case 409:
      return 'Conflict detected. The resource may have been modified by another user.';
    case 422:
      return 'Invalid data provided. Please check your input.';
    case 429:
      return 'Too many requests. Please wait a moment and try again.';
    case 500:
      return 'Server error. Our team has been notified.';
    case 502:
      return 'Service temporarily unavailable. Please try again in a moment.';
    case 503:
      return 'Service maintenance in progress. Please try again later.';
    case 504:
      return 'Request timeout. The server took too long to respond.';
    default:
      return 'An unexpected error occurred. Please try again.';
  }
};

type FriendlyMessage = { message: string; description?: string };

const normalizeDetail = (error: any): any => {
  return (
    error?.detail ||
    error?.details ||
    error?.data?.detail ||
    error?.response?.data?.detail ||
    null
  );
};

const mapFriendlyMessage = (
  status: number | undefined,
  rawMessage: string,
  detail: any,
  context?: ErrorContext
): FriendlyMessage | null => {
  const msg = (detail && (detail.message || detail.msg)) || rawMessage || '';
  const code = detail?.error_code || detail?.code;
  const text = (msg || '').toString();
  const lower = text.toLowerCase();

  // 400
  if (status === 400) {
    if (text.includes('MCP URL is required') || text.includes('X-MCP-URL header is required') || text.includes('custom_mcps array is required')) {
      return {
        message: '请补全工具地址/配置后再保存 / Please fill in the tool URL/config before saving.',
      };
    }
    if (text.includes('Cannot delete default agent') || text.includes('default agent')) {
      return { message: '系统内置 Agent 不支持修改或删除 / This built-in agent can’t be edited or deleted.' };
    }
    if (text.includes('No fields to update')) {
      return { message: '无有效变更，请检查后再试 / No valid changes detected. Please review and retry.' };
    }
  }

  // 401
  if (status === 401) {
    if (text.includes('Google')) {
      return { message: 'Google 授权已过期，请重新连接账户 / Google access expired. Please reconnect your account.' };
    }
    return {
      message: '登录状态已失效，请重新登录 / Session expired. Please sign in again.',
    };
  }

  // 403 specific cases
  if (status === 403) {
    if (text.includes('default agent') || text.includes('centrally managed')) {
      return { message: '系统内置 Agent 不支持修改或删除 / This built-in agent can’t be edited or deleted.' };
    }
    if (text.includes('Not a member of workspace')) {
      return { message: '您尚未加入该空间，无法访问 / You’re not a member of this workspace.' };
    }
    if (text.includes('model') && text.includes('allowed')) {
      return {
        message: '当前模型未为您开放，请更换模型或联系管理员 / This model isn’t enabled for you. Switch models or contact an admin.',
      };
    }
    if (text.includes('Canvas is not public') || text.includes('Timeline is not enabled')) {
      return {
        message: '当前画布/时间线未开放访问，请联系所有者开启 / This canvas/timeline isn’t public. Please ask the owner to enable access.',
      };
    }
    if (text.includes('Not authorized to access this file')) {
      return { message: '您暂无权限访问该文件 / You don’t have permission to access this file.' };
    }
    if (text.includes('Access denied to profile') || text.includes('Access denied')) {
      return { message: '该资源未向您开放 / You don’t have access to this resource.' };
    }
    if (text.includes('No role assigned')) {
      return { message: '账号尚未开通权限，请联系管理员 / Your account isn’t activated yet. Please contact an admin.' };
    }
    if (text.includes('Env vars management only available in local mode')) {
      return {
        message: '当前环境禁用在线修改配置，请在本地/运维侧操作 / Editing env vars is disabled in this environment. Please manage them locally or via ops.',
      };
    }
    if (text.includes('Only new accounts are eligible to redeem the invite code')) {
      return {
        message: '该邀请码仅限新账号使用，请更换邀请码 / This invite code is for new accounts only. Please use a different code.',
      };
    }
    if (text.includes('redeem an invite code') || text.includes('兑换邀请码')) {
      return {
        message: '请先兑换邀请码，开通购买资格 / Please redeem an invite code to unlock purchases.',
      };
    }
    if (text.includes('Credit purchases not available for your tier')) {
      return {
        message: '当前套餐不支持购买额度，请升级套餐 / Your plan can’t purchase credits. Please upgrade first.',
      };
    }
  }

  // 402
  if (status === 402) {
    if (lower.includes('storage quota exceeded')) {
      return {
        message: '存储空间已满，请删除文件或升级套餐 / Storage quota reached. Delete files or upgrade your plan.',
      };
    }
    if (lower.includes('file exceeds per-file limit')) {
      return {
        message: '单文件超过上限，请压缩或升级套餐 / File exceeds per-file limit. Compress or upgrade your plan.',
      };
    }
    if (code === 'AGENT_LIMIT_EXCEEDED') {
      return {
        message: '已达当前套餐的 Agent 上限，请升级或删除后再创建 / Agent limit reached. Upgrade or remove one to proceed.',
      };
    }
    if (code === 'PROJECT_LIMIT_EXCEEDED') {
      return {
        message: '项目数量已达上限，请升级套餐或清理旧项目 / Project limit reached. Upgrade plan or remove old projects.',
      };
    }
    return {
      message: '账户额度不足，请充值或升级套餐 / Insufficient credits. Please top up or upgrade your plan.',
    };
  }

  // 404
  if (status === 404) {
    if (text.includes('Agent not found')) {
      return { message: '该 Agent 不存在或您暂无权限访问 / This agent doesn’t exist or you don’t have access.' };
    }
    if (text.includes('Thread not found')) {
      return { message: '此对话未向您开放，可能未分享或已删除 / This thread isn’t shared with you or may have been removed.' };
    }
    if (text.includes('Canvas not found')) {
      return { message: '画布不存在或已删除 / The canvas is missing or has been removed.' };
    }
    if (text.includes('Folder not found') || text.includes('Entry not found')) {
      return { message: '目标内容不存在或已下线 / The item is missing or unavailable.' };
    }
  }

  // 413
  if (status === 413 || lower.includes('file size limit exceeded')) {
    return { message: '文件超过当前方案的单文件上限，请压缩或升级套餐 / File exceeds your plan’s per-file limit. Compress or upgrade.' };
  }

  // 429
  if (status === 429) {
    return { message: '当前并发任务过多，请稍后再试 / Too many requests. Please try again later.' };
  }

  // 500
  if (status === 500) {
    if (text.includes('Agent API not initialized')) {
      return { message: '服务启动异常，请稍后再试或联系支持 / Service failed to initialize. Please retry or contact support.' };
    }
    if (text.includes('Health check failed')) {
      return { message: '服务启动异常，请稍后再试 / Service failed its health check. Please try again shortly.' };
    }
  }

  return null;
};

const extractErrorMessage = (error: any): string => {
  if (error?.name === 'BillingError') {
    return error.detail?.message || error.message || 'Billing issue detected';
  }

  if (error?.name === 'AgentRunLimitError') {
    return error.detail?.message || error.message || 'Agent run limit exceeded';
  }

  if (error?.name === 'ProjectLimitError') {
    return error.detail?.message || error.message || 'Project limit exceeded';
  }

  if (error?.response) {
    const status = error.response.status;
    return getStatusMessage(status);
  }

  if (error?.status) {
    return getStatusMessage(error.status);
  }

  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === 'string') {
    return error;
  }

  if (error?.message) {
    return error.message;
  }

  if (error?.error) {
    return typeof error.error === 'string' ? error.error : error.error.message || 'Unknown error';
  }

  return 'An unexpected error occurred';
};

const shouldShowError = (error: any, context?: ErrorContext): boolean => {
  if (context?.silent) {
    return false;
  }
  if (error?.name === 'BillingError') {
    return false;
  }
  if (error?.name === 'AgentRunLimitError') {
    return false;
  }

  if (error?.status === 404 && context?.resource) {
    return false;
  }

  return true;
};

const formatErrorMessage = (message: string, context?: ErrorContext): string => {
  if (!context?.operation && !context?.resource) {
    return message;
  }

  const parts = [];
  
  if (context.operation) {
    parts.push(`Failed to ${context.operation}`);
  }
  
  if (context.resource) {
    parts.push(context.resource);
  }

  const prefix = parts.join(' ');
  
  if (message.toLowerCase().includes(context.operation?.toLowerCase() || '')) {
    return message;
  }

  return `${prefix}: ${message}`;
};


export const handleApiError = (error: any, context?: ErrorContext): void => {
  console.error('API Error:', error, context);

  if (!shouldShowError(error, context)) {
    return;
  }

  const detail = normalizeDetail(error);
  const rawMessage = extractErrorMessage(error);

  const friendly = mapFriendlyMessage(error?.status, rawMessage, detail, context);
  const finalMessage = friendly?.message || formatErrorMessage(rawMessage, context);
  const description = friendly?.description;

  if (error?.status >= 500) {
    safeToast.error(finalMessage, {
      description: description || 'Our team has been notified and is working on a fix.',
      duration: 6000,
    });
  } else if (error?.status === 403) {
    safeToast.error(finalMessage, {
      description: description || 'Contact support if you believe this is an error.',
      duration: 6000,
    });
  } else if (error?.status === 429) {
    safeToast.warning(finalMessage, {
      description: description || 'Please wait a moment before trying again.',
      duration: 5000,
    });
  } else {
    safeToast.error(formatErrorMessage(finalMessage, context), {
      duration: 5000,
    });
  }
};

export const handleNetworkError = (error: any, context?: ErrorContext): void => {
  const hasNavigator = typeof navigator !== 'undefined';
  const isOnline = hasNavigator ? navigator.onLine : true; // assume online on server
  const isNetworkError = 
    error?.message?.includes('fetch') ||
    error?.message?.includes('network') ||
    error?.message?.includes('connection') ||
    error?.code === 'NETWORK_ERROR' ||
    !isOnline;

  if (isNetworkError) {
    safeToast.error('Connection error', {
      description: 'Please check your internet connection and try again.',
      duration: 6000,
    });
  } else {
    handleApiError(error, context);
  }
};

export const handleApiSuccess = (message: string, description?: string): void => {
  safeToast.success(message, {
    description,
    duration: 3000,
  });
};

export const handleApiWarning = (message: string, description?: string): void => {
  safeToast.warning(message, {
    description,
    duration: 4000,
  });
};

export const handleApiInfo = (message: string, description?: string): void => {
  safeToast.info(message, {
    description,
    duration: 3000,
  });
};
