/**
 * 🛡️ 统一错误处理工具库
 *
 * 提供统一的错误处理机制，确保错误处理的一致性
 * 包含错误类型定义、错误处理装饰器、安全执行函数等
 */

/**
 * 群组相关错误类型
 */
export class GroupError extends Error {
  constructor(
    public code: string,
    public context: Record<string, any>,
    message: string,
    public originalError?: Error
  ) {
    super(message);
    this.name = 'GroupError';
  }
}

/**
 * 错误代码枚举
 */
export enum ErrorCode {
  INVALID_GROUP_DATA = 'INVALID_GROUP_DATA',
  GROUP_CALCULATION_FAILED = 'GROUP_CALCULATION_FAILED',
  NODE_NOT_FOUND = 'NODE_NOT_FOUND',
  INVALID_PARAMETERS = 'INVALID_PARAMETERS',
  CACHE_ERROR = 'CACHE_ERROR',
  TYPE_VALIDATION_FAILED = 'TYPE_VALIDATION_FAILED'
}

/**
 * 错误处理选项
 */
export interface ErrorHandlingOptions {
  throwOnError?: boolean;         // 是否抛出错误，默认false
  logLevel?: 'none' | 'warn' | 'error';  // 日志级别，默认'warn'
  context?: Record<string, any>;  // 额外的上下文信息
  fallbackValue?: any;           // 发生错误时的备用返回值
}

/**
 * 默认错误处理选项
 */
const DEFAULT_ERROR_OPTIONS: ErrorHandlingOptions = {
  throwOnError: false,
  logLevel: 'warn',
  context: {},
  fallbackValue: null
};

/**
 * 安全执行函数，带错误处理
 *
 * @param fn - 要执行的函数
 * @param options - 错误处理选项
 * @returns 执行结果或备用值
 */
export function safeExecute<T>(
  fn: () => T,
  options: ErrorHandlingOptions = {}
): T | null {
  const opts = { ...DEFAULT_ERROR_OPTIONS, ...options };

  try {
    return fn();
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);

    // 记录错误
    if (opts.logLevel === 'error') {
      console.error('safeExecute: 函数执行失败:', errorMessage, opts.context);
    } else if (opts.logLevel === 'warn') {
      console.warn('safeExecute: 函数执行失败:', errorMessage, opts.context);
    }

    // 决定是否抛出错误
    if (opts.throwOnError) {
      if (error instanceof GroupError) {
        throw error;
      } else {
        throw new GroupError(
          ErrorCode.GROUP_CALCULATION_FAILED,
          opts.context || {},
          errorMessage,
          error instanceof Error ? error : undefined
        );
      }
    }

    return opts.fallbackValue;
  }
}

/**
 * 异步安全执行函数
 *
 * @param fn - 要执行的异步函数
 * @param options - 错误处理选项
 * @returns Promise执行结果或备用值
 */
export async function safeExecuteAsync<T>(
  fn: () => Promise<T>,
  options: ErrorHandlingOptions = {}
): Promise<T | null> {
  const opts = { ...DEFAULT_ERROR_OPTIONS, ...options };

  try {
    return await fn();
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);

    // 记录错误
    if (opts.logLevel === 'error') {
      console.error('safeExecuteAsync: 异步函数执行失败:', errorMessage, opts.context);
    } else if (opts.logLevel === 'warn') {
      console.warn('safeExecuteAsync: 异步函数执行失败:', errorMessage, opts.context);
    }

    // 决定是否抛出错误
    if (opts.throwOnError) {
      if (error instanceof GroupError) {
        throw error;
      } else {
        throw new GroupError(
          ErrorCode.GROUP_CALCULATION_FAILED,
          opts.context || {},
          errorMessage,
          error instanceof Error ? error : undefined
        );
      }
    }

    return opts.fallbackValue;
  }
}

/**
 * 错误处理装饰器工厂
 * 为方法添加统一的错误处理
 *
 * @param options - 错误处理选项
 * @returns 装饰器函数
 */
export function withErrorHandler(options: ErrorHandlingOptions = {}) {
  return function <T extends (...args: any[]) => any>(
    target: any,
    propertyKey: string,
    descriptor: TypedPropertyDescriptor<T>
  ) {
    const originalMethod = descriptor.value;
    if (!originalMethod) return;

    descriptor.value = function (...args: any[]) {
      return safeExecute(
        () => originalMethod.apply(this, args),
        {
          ...options,
          context: {
            ...options.context,
            method: propertyKey,
            className: target.constructor.name,
            args: args.length
          }
        }
      );
    } as T;

    return descriptor;
  };
}

/**
 * 参数验证错误处理
 *
 * @param condition - 验证条件
 * @param message - 错误消息
 * @param context - 上下文信息
 * @throws GroupError 当验证失败时
 */
export function validateOrThrow(
  condition: boolean,
  message: string,
  context: Record<string, any> = {}
): void {
  if (!condition) {
    throw new GroupError(ErrorCode.INVALID_PARAMETERS, context, message);
  }
}

/**
 * 非空验证
 *
 * @param value - 要验证的值
 * @param paramName - 参数名称
 * @param context - 上下文信息
 * @throws GroupError 当值为null或undefined时
 */
export function requireNonNull<T>(
  value: T | null | undefined,
  paramName: string,
  context: Record<string, any> = {}
): T {
  if (value == null) {
    throw new GroupError(
      ErrorCode.INVALID_PARAMETERS,
      { ...context, paramName },
      `参数 ${paramName} 不能为空`
    );
  }
  return value;
}

/**
 * 数组非空验证
 *
 * @param array - 要验证的数组
 * @param paramName - 参数名称
 * @param context - 上下文信息
 * @throws GroupError 当数组为空时
 */
export function requireNonEmptyArray<T>(
  array: T[] | null | undefined,
  paramName: string,
  context: Record<string, any> = {}
): T[] {
  const nonNullArray = requireNonNull(array, paramName, context);

  if (nonNullArray.length === 0) {
    throw new GroupError(
      ErrorCode.INVALID_PARAMETERS,
      { ...context, paramName },
      `数组 ${paramName} 不能为空`
    );
  }

  return nonNullArray;
}

/**
 * 类型验证助手
 *
 * @param value - 要验证的值
 * @param typeName - 类型名称
 * @param typeGuard - 类型守卫函数
 * @param context - 上下文信息
 * @throws GroupError 当类型验证失败时
 */
export function validateType<T>(
  value: any,
  typeName: string,
  typeGuard: (value: any) => value is T,
  context: Record<string, any> = {}
): T {
  if (!typeGuard(value)) {
    throw new GroupError(
      ErrorCode.TYPE_VALIDATION_FAILED,
      { ...context, expectedType: typeName, actualValue: value },
      `值不符合预期的类型 ${typeName}`
    );
  }
  return value;
}

/**
 * 创建错误边界函数
 * 用于React组件的错误处理
 *
 * @param componentName - 组件名称
 * @param fallbackValue - 错误时的备用值
 * @returns 错误处理函数
 */
export function createErrorBoundary<T>(
  componentName: string,
  fallbackValue: T
) {
  return (fn: () => T): T => {
    return safeExecute(fn, {
      logLevel: 'error',
      context: { component: componentName },
      fallbackValue,
      throwOnError: false
    }) || fallbackValue;
  };
}

/**
 * 批量错误处理
 * 执行多个操作，收集所有错误
 *
 * @param operations - 操作数组
 * @param options - 错误处理选项
 * @returns 结果数组和错误数组
 */
export function executeBatch<T>(
  operations: Array<() => T>,
  options: ErrorHandlingOptions = {}
): { results: (T | null)[]; errors: Error[] } {
  const results: (T | null)[] = [];
  const errors: Error[] = [];

  operations.forEach((operation, index) => {
    try {
      const result = operation();
      results.push(result);
    } catch (error) {
      errors.push(error instanceof Error ? error : new Error(String(error)));
      results.push(options.fallbackValue || null);

      if (options.logLevel !== 'none') {
        const logFn = options.logLevel === 'error' ? console.error : console.warn;
        logFn(`批量操作第${index}项失败:`, error);
      }
    }
  });

  return { results, errors };
}

/**
 * 重试机制
 *
 * @param fn - 要重试的函数
 * @param maxRetries - 最大重试次数
 * @param delay - 重试延迟（毫秒）
 * @param options - 错误处理选项
 * @returns 执行结果
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  maxRetries: number = 3,
  delay: number = 1000,
  options: ErrorHandlingOptions = {}
): Promise<T | null> {
  let lastError: Error;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      if (attempt === maxRetries) {
        if (options.logLevel !== 'none') {
          const logFn = options.logLevel === 'error' ? console.error : console.warn;
          logFn(`重试${maxRetries}次后仍然失败:`, lastError);
        }

        if (options.throwOnError) {
          throw lastError;
        }

        return options.fallbackValue || null;
      }

      // 等待指定时间后重试
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }

  return options.fallbackValue || null;
}