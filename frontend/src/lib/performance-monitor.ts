/**
 * 性能监控工具
 *
 * 监控核心性能指标：
 * - 页面加载时间
 * - API 响应时间
 * - 缓存命中率
 * - 用户体验指标 (Web Vitals)
 */

interface PerformanceMetric {
  name: string;
  value: number;
  timestamp: number;
  metadata?: Record<string, any>;
}

interface DashboardPerformanceData {
  generation_time_ms: number;
  request_time_ms?: number;
  from_cache: boolean;
  user_id: string;
  cache_hit_rate?: number;
}

class PerformanceMonitor {
  private metrics: PerformanceMetric[] = [];
  private isEnabled: boolean;

  constructor() {
    this.isEnabled = typeof window !== 'undefined' &&
                     process.env.NODE_ENV !== 'production' ||
                     process.env.NEXT_PUBLIC_ENABLE_PERFORMANCE_MONITORING === 'true';
  }

  /**
   * 记录页面加载性能
   */
  recordPageLoad(route: string) {
    if (!this.isEnabled) return;

    const navigationTiming = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming;

    if (navigationTiming) {
      this.addMetric('page_load_time', navigationTiming.loadEventEnd - navigationTiming.fetchStart, {
        route,
        dom_content_loaded: navigationTiming.domContentLoadedEventEnd - navigationTiming.fetchStart,
        first_paint: this.getFirstPaint(),
        first_contentful_paint: this.getFirstContentfulPaint(),
      });
    }
  }

  /**
   * 记录 API 响应时间
   */
  recordApiResponse(endpoint: string, responseTimeMs: number, cacheHit: boolean = false) {
    if (!this.isEnabled) return;

    this.addMetric('api_response_time', responseTimeMs, {
      endpoint,
      cache_hit: cacheHit,
      timestamp: Date.now(),
    });

    // 如果响应时间过长，记录警告
    if (responseTimeMs > 1000) {
      console.warn(`🐌 慢 API 响应: ${endpoint} took ${responseTimeMs}ms`);
    }
  }

  /**
   * 记录仪表板性能数据
   */
  recordDashboardPerformance(data: DashboardPerformanceData) {
    if (!this.isEnabled) return;

    this.addMetric('dashboard_generation_time', data.generation_time_ms, {
      from_cache: data.from_cache,
      user_id: data.user_id,
      cache_hit_rate: data.cache_hit_rate,
    });

    if (data.request_time_ms) {
      this.addMetric('dashboard_request_time', data.request_time_ms, {
        total_time: data.generation_time_ms + data.request_time_ms,
        from_cache: data.from_cache,
      });
    }

    // 性能评估
    if (data.generation_time_ms > 100) {
      console.warn('⚠️ Dashboard 生成时间较长:', data.generation_time_ms + 'ms');
    }
  }

  /**
   * 记录路由切换时间
   */
  recordRouteChange(from: string, to: string, duration: number) {
    if (!this.isEnabled) return;

    this.addMetric('route_change_time', duration, {
      from_route: from,
      to_route: to,
      timestamp: Date.now(),
    });

    if (duration > 2000) {
      console.warn(`🐌 慢路由切换: ${from} -> ${to} took ${duration}ms`);
    }
  }

  /**
   * 获取 Web Vitals
   */
  async recordWebVitals() {
    if (!this.isEnabled || typeof window === 'undefined') return;

    try {
      const vitals = await import('web-vitals');
      const { onCLS, onFCP, onLCP, onTTFB, onINP } = vitals;

      onCLS((metric) => this.addMetric('cls', metric.value, metric));
      onFCP((metric) => this.addMetric('fcp', metric.value, metric));
      onLCP((metric) => this.addMetric('lcp', metric.value, metric));
      onTTFB((metric) => this.addMetric('ttfb', metric.value, metric));
      if (typeof onINP === 'function') {
        onINP((metric) => this.addMetric('inp', metric.value, metric));
      } else if ('onFID' in vitals) {
        const legacy = vitals as { onFID?: (cb: (metric: any) => void) => void };
        legacy.onFID?.((metric) => this.addMetric('fid', metric.value, metric));
      }
    } catch (error) {
      console.warn('Web Vitals 监控失败:', error);
    }
  }

  /**
   * 获取性能摘要
   */
  getPerformanceSummary() {
    const summary: Record<string, any> = {};

    const metricTypes = [...new Set(this.metrics.map(m => m.name))];

    metricTypes.forEach(type => {
      const typeMetrics = this.metrics.filter(m => m.name === type);
      if (typeMetrics.length > 0) {
        const values = typeMetrics.map(m => m.value);
        summary[type] = {
          count: values.length,
          avg: values.reduce((a, b) => a + b, 0) / values.length,
          min: Math.min(...values),
          max: Math.max(...values),
          latest: typeMetrics[typeMetrics.length - 1].value,
        };
      }
    });

    return summary;
  }

  /**
   * 导出性能数据
   */
  exportMetrics() {
    return {
      metrics: this.metrics,
      summary: this.getPerformanceSummary(),
      timestamp: Date.now(),
    };
  }

  /**
   * 清空指标
   */
  clearMetrics() {
    this.metrics = [];
  }

  /**
   * 记录自定义指标
   */
  private addMetric(name: string, value: number, metadata?: Record<string, any>) {
    this.metrics.push({
      name,
      value: Math.round(value * 100) / 100, // 保留两位小数
      timestamp: Date.now(),
      metadata,
    });

    // 限制存储的指标数量，避免内存泄漏
    if (this.metrics.length > 1000) {
      this.metrics = this.metrics.slice(-500);
    }
  }

  /**
   * 获取首次绘制时间
   */
  private getFirstPaint(): number | undefined {
    const paintEntries = performance.getEntriesByType('paint');
    const fpEntry = paintEntries.find(entry => entry.name === 'first-paint');
    return fpEntry?.startTime;
  }

  /**
   * 获取首次内容绘制时间
   */
  private getFirstContentfulPaint(): number | undefined {
    const paintEntries = performance.getEntriesByType('paint');
    const fcpEntry = paintEntries.find(entry => entry.name === 'first-contentful-paint');
    return fcpEntry?.startTime;
  }
}

// 全局性能监控实例
export const performanceMonitor = new PerformanceMonitor();

/**
 * React Hook for performance monitoring
 */
export function usePerformanceMonitoring() {
  return {
    recordPageLoad: performanceMonitor.recordPageLoad.bind(performanceMonitor),
    recordApiResponse: performanceMonitor.recordApiResponse.bind(performanceMonitor),
    recordDashboardPerformance: performanceMonitor.recordDashboardPerformance.bind(performanceMonitor),
    recordRouteChange: performanceMonitor.recordRouteChange.bind(performanceMonitor),
    getPerformanceSummary: performanceMonitor.getPerformanceSummary.bind(performanceMonitor),
    exportMetrics: performanceMonitor.exportMetrics.bind(performanceMonitor),
  };
}

/**
 * 性能监控中间件 (用于 API 客户端)
 */
export function createPerformanceMiddleware() {
  return {
    request: (config: any) => {
      config.metadata = { startTime: Date.now() };
      return config;
    },
    response: (response: any) => {
      const startTime = response.config?.metadata?.startTime;
      if (startTime) {
        const duration = Date.now() - startTime;
        const endpoint = response.config?.url || 'unknown';
        const cacheHit = response.headers?.['x-cache-status'] === 'hit';

        performanceMonitor.recordApiResponse(endpoint, duration, cacheHit);
      }
      return response;
    },
  };
}
