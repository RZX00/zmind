// 🛠️ 开发环境日志工具 - 条件编译的日志策略
// 用于替代直接的console.log，实现环境相关的日志控制

/**
 * 开发环境日志级别
 */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

/**
 * 日志上下文信息
 */
export interface LogContext {
  component?: string;
  action?: string;
  data?: any;
}

/**
 * 判断是否为开发环境
 */
const isDev = process.env.NODE_ENV === 'development';

/**
 * 条件编译的日志函数 - 只在开发环境输出
 * 
 * @param level 日志级别
 * @param message 日志消息
 * @param context 上下文信息（可选）
 */
export const devLog = (level: LogLevel, message: string, context?: LogContext) => {
  if (!isDev) return; // 生产环境直接返回，不输出任何日志
  
  const prefix = context?.component ? `[${context.component}]` : '';
  const fullMessage = `${prefix} ${message}`;
  
  switch (level) {
    case 'debug':
      console.log(fullMessage, context?.data || '');
      break;
    case 'info':
      console.info(fullMessage, context?.data || '');
      break;
    case 'warn':
      console.warn(fullMessage, context?.data || '');
      break;
    case 'error':
      console.error(fullMessage, context?.data || '');
      break;
  }
};

/**
 * 便捷的调试日志函数 - 用于替代大部分console.log
 * 只在开发环境输出，生产环境完全静默
 */
export const debugLog = (message: string, data?: any, component?: string) => {
  devLog('debug', message, { component, data });
};

/**
 * 信息日志 - 用于重要的信息输出
 */
export const infoLog = (message: string, data?: any, component?: string) => {
  devLog('info', message, { component, data });
};

/**
 * 警告日志 - 始终保留，包括生产环境
 * 用于非致命性问题的警告
 */
export const warnLog = (message: string, data?: any, component?: string) => {
  const prefix = component ? `[${component}]` : '';
  const fullMessage = `${prefix} ${message}`;
  console.warn(fullMessage, data || '');
};

/**
 * 错误日志 - 始终保留，包括生产环境  
 * 用于错误和异常情况
 */
export const errorLog = (message: string, data?: any, component?: string) => {
  const prefix = component ? `[${component}]` : '';
  const fullMessage = `${prefix} ${message}`;
  console.error(fullMessage, data || '');
};

/**
 * 性能调试日志 - 只在开发环境输出性能相关信息
 */
export const perfLog = (message: string, data?: any, component?: string) => {
  if (!isDev) return;
  
  const prefix = component ? `[${component}]` : '';
  const timestamp = performance.now().toFixed(2);
  console.log(`⏱️ ${prefix} ${message} (${timestamp}ms)`, data || '');
};

/**
 * Canvas专用的日志组合函数
 */
export const canvasLog = {
  debug: (message: string, data?: any) => debugLog(message, data, 'Canvas'),
  info: (message: string, data?: any) => infoLog(message, data, 'Canvas'),
  warn: (message: string, data?: any) => warnLog(message, data, 'Canvas'),
  error: (message: string, data?: any) => errorLog(message, data, 'Canvas'),
  perf: (message: string, data?: any) => perfLog(message, data, 'Canvas'),
};