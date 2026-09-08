// 🛡️ 画布错误边界和反馈组件
// 提供完整的错误处理、性能监控和用户反馈机制

import React, { Component, ErrorInfo, ReactNode } from 'react';
import { AlertTriangle, RefreshCw, Bug, Zap, Clock, TrendingDown, HelpCircle, Send } from 'lucide-react';
import { toast } from '@/lib/toast';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
  onError?: (error: Error, errorInfo: ErrorInfo) => void;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
  errorId: string;
  retryCount: number;
  performanceIssues: PerformanceIssue[];
  userFeedback: string;
  showFeedbackForm: boolean;
}

interface PerformanceIssue {
  type: 'memory' | 'rendering' | 'network';
  severity: 'low' | 'medium' | 'high';
  message: string;
  timestamp: number;
  details?: any;
}

class ErrorBoundary extends Component<Props, State> {
  private performanceObserver: PerformanceObserver | null = null;
  private memoryCheckInterval: NodeJS.Timeout | null = null;

  constructor(props: Props) {
    super(props);
    
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
      errorId: '',
      retryCount: 0,
      performanceIssues: [],
      userFeedback: '',
      showFeedbackForm: false
    };
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    // 生成错误ID
    const errorId = `canvas_error_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    return {
      hasError: true,
      error,
      errorId
    };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    this.setState({
      error,
      errorInfo
    });

    // 记录错误到控制台
    console.error('Canvas Error Boundary caught an error:', error, errorInfo);
    
    // 调用外部错误处理器
    this.props.onError?.(error, errorInfo);
    
    // 发送错误到分析服务（如果配置了的话）
    this.reportError(error, errorInfo);
    
    // 开始性能监控
    this.startPerformanceMonitoring();
  }

  componentDidMount() {
    // 启动性能监控
    this.startPerformanceMonitoring();
  }

  componentWillUnmount() {
    // 清理性能监控
    this.stopPerformanceMonitoring();
  }

  private startPerformanceMonitoring = () => {
    // 监控长任务
    if ('PerformanceObserver' in window) {
      try {
        this.performanceObserver = new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) {
            if (entry.entryType === 'longtask') {
              this.addPerformanceIssue({
                type: 'rendering',
                severity: entry.duration > 100 ? 'high' : 'medium',
                message: `检测到长任务：${Math.round(entry.duration)}ms`,
                timestamp: Date.now(),
                details: { duration: entry.duration, startTime: entry.startTime }
              });
            }
          }
        });
        
        this.performanceObserver.observe({ entryTypes: ['longtask'] });
      } catch (e) {
        console.warn('Performance monitoring not supported:', e);
      }
    }

    // 监控内存使用
    this.memoryCheckInterval = setInterval(() => {
      if ('memory' in performance) {
        const memory = (performance as any).memory;
        const usedMB = Math.round(memory.usedJSHeapSize / 1024 / 1024);
        const limitMB = Math.round(memory.jsHeapSizeLimit / 1024 / 1024);
        const usage = usedMB / limitMB;

        if (usage > 0.8) {
          this.addPerformanceIssue({
            type: 'memory',
            severity: usage > 0.9 ? 'high' : 'medium',
            message: `内存使用率较高：${Math.round(usage * 100)}% (${usedMB}MB/${limitMB}MB)`,
            timestamp: Date.now(),
            details: { used: usedMB, limit: limitMB, usage }
          });
        }
      }
    }, 10000); // 每10秒检查一次
  };

  private stopPerformanceMonitoring = () => {
    if (this.performanceObserver) {
      this.performanceObserver.disconnect();
      this.performanceObserver = null;
    }

    if (this.memoryCheckInterval) {
      clearInterval(this.memoryCheckInterval);
      this.memoryCheckInterval = null;
    }
  };

  private addPerformanceIssue = (issue: PerformanceIssue) => {
    this.setState(prevState => ({
      performanceIssues: [...prevState.performanceIssues.slice(-4), issue] // 只保留最近5个问题
    }));
  };

  private reportError = async (error: Error, errorInfo: ErrorInfo) => {
    try {
      const errorReport = {
        message: error.message,
        stack: error.stack,
        componentStack: errorInfo.componentStack,
        timestamp: new Date().toISOString(),
        userAgent: navigator.userAgent,
        url: window.location.href,
        userId: localStorage.getItem('user_id') || 'anonymous'
      };

      // 这里可以发送到错误收集服务
      console.log('Error report:', errorReport);
      
    } catch (reportError) {
      console.error('Failed to report error:', reportError);
    }
  };

  private handleRetry = () => {
    this.setState(prevState => ({
      hasError: false,
      error: null,
      errorInfo: null,
      retryCount: prevState.retryCount + 1,
      performanceIssues: []
    }));

    // 重新启动性能监控
    setTimeout(() => {
      this.startPerformanceMonitoring();
    }, 100);
  };

  private handleReload = () => {
    window.location.reload();
  };

  private handleFeedbackSubmit = async () => {
    const { userFeedback, error, errorId } = this.state;
    
    if (!userFeedback.trim()) return;

    try {
      const feedbackData = {
        errorId,
        feedback: userFeedback,
        errorMessage: error?.message || 'Unknown error',
        timestamp: new Date().toISOString(),
        userAgent: navigator.userAgent
      };

      // 发送反馈到服务器
      console.log('User feedback:', feedbackData);
      
      this.setState({
        userFeedback: '',
        showFeedbackForm: false
      });

      // 显示感谢消息
      toast.success('Thanks for your feedback — it helps us improve.');
      
    } catch (error) {
      console.error('Failed to submit feedback:', error);
      toast.error('Failed to submit feedback. Please try again later.');
    }
  };

  private renderPerformanceIssues = () => {
    const { performanceIssues } = this.state;
    
    if (performanceIssues.length === 0) return null;

    return (
      <div className="mt-4 p-3 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800/40 rounded-lg">
        <div className="flex items-center gap-2 mb-2">
          <TrendingDown className="w-4 h-4 text-yellow-600 dark:text-yellow-300" />
          <h4 className="text-sm font-medium text-yellow-800 dark:text-yellow-200">性能问题</h4>
        </div>
        <div className="space-y-1">
          {performanceIssues.map((issue, index) => (
            <div key={index} className="flex items-center gap-2 text-xs text-yellow-700 dark:text-yellow-100">
              <div className={`w-2 h-2 rounded-full ${
                issue.severity === 'high' ? 'bg-red-500' : 
                issue.severity === 'medium' ? 'bg-yellow-500' : 'bg-blue-500'
              }`} />
              <span>{issue.message}</span>
              <span className="text-gray-500 dark:text-zinc-400">
                {new Intl.DateTimeFormat(undefined, {hour:'2-digit', minute:'2-digit', second:'2-digit'}).format(new Date(issue.timestamp))}
              </span>
            </div>
          ))}
        </div>
      </div>
    );
  };

  render() {
    const { hasError, error, errorInfo, retryCount, userFeedback, showFeedbackForm } = this.state;

    if (hasError) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-zinc-950 p-4">
          <div className="max-w-lg w-full bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-700 rounded-lg shadow-lg p-6 text-gray-900 dark:text-zinc-100">
            {/* 错误头部 */}
            <div className="flex items-center gap-3 mb-4">
              <div className="flex-shrink-0 w-12 h-12 bg-red-100 dark:bg-red-900/30 rounded-full flex items-center justify-center">
                <AlertTriangle className="w-6 h-6 text-red-600 dark:text-red-300" />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-gray-900 dark:text-zinc-100">
                  Canvas rendering issue
                </h2>
                <p className="text-sm text-gray-600 dark:text-zinc-300">
                  We detected a rendering issue and are attempting to recover
                </p>
              </div>
            </div>

            {/* 错误详情 */}
            <div className="bg-gray-50 dark:bg-zinc-800/70 rounded-lg p-3 mb-4">
              <div className="flex items-center gap-2 mb-2">
                <Bug className="w-4 h-4 text-gray-600 dark:text-zinc-300" />
                <span className="text-sm font-medium text-gray-800 dark:text-zinc-100">Error message</span>
              </div>
              <p className="text-xs text-gray-600 dark:text-zinc-300 font-mono">
                {error?.message || 'Unknown error'}
              </p>
              {retryCount > 0 && (
                <p className="text-xs text-gray-500 dark:text-zinc-400 mt-1">
                  Retried {retryCount} times
                </p>
              )}
            </div>

            {/* 性能问题展示 */}
            {this.renderPerformanceIssues()}

            {/* 操作按钮 */}
            <div className="flex flex-col sm:flex-row gap-3 mb-4">
              <button
                onClick={this.handleRetry}
                className="flex-1 flex items-center justify-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors"
              >
                <RefreshCw className="w-4 h-4" />
                Reload canvas
              </button>
              
              <button
                onClick={this.handleReload}
                className="flex-1 flex items-center justify-center gap-2 bg-muted text-foreground px-4 py-2 rounded-lg hover:bg-accent/60 transition-colors"
              >
                <Zap className="w-4 h-4" />
                Refresh page
              </button>
            </div>

            {/* 反馈表单 */}
            <div className="border-t border-gray-200 dark:border-zinc-700 pt-4">
              <button
                onClick={() => this.setState({ showFeedbackForm: !showFeedbackForm })}
                className="flex items-center gap-2 text-sm text-blue-600 dark:text-blue-300 hover:text-blue-700 dark:hover:text-blue-200"
              >
                <HelpCircle className="w-4 h-4" />
                Feedback details
              </button>

              {showFeedbackForm && (
                <div className="mt-3 space-y-3">
                  <textarea
                    value={userFeedback}
                    onChange={(e) => this.setState({ userFeedback: e.target.value })}
                    placeholder="Describe the issue you encountered to help us improve..."
                    className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-zinc-600 bg-white dark:bg-zinc-900 text-gray-900 dark:text-zinc-100 rounded-lg focus:ring-1 focus:ring-blue-500 focus:border-blue-500 resize-none"
                    rows={3}
                  />
                  <div className="flex gap-2">
                    <button
                      onClick={this.handleFeedbackSubmit}
                      disabled={!userFeedback.trim()}
                      className="flex items-center gap-1 bg-blue-600 text-white px-3 py-1 rounded text-xs hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      <Send className="w-3 h-3" />
                      Submit feedback
                    </button>
                    <button
                      onClick={() => this.setState({ showFeedbackForm: false, userFeedback: '' })}
                      className="text-xs text-gray-600 dark:text-zinc-300 hover:text-gray-800 dark:hover:text-zinc-100 px-3 py-1"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* 技术信息 */}
            <details className="mt-4 text-xs text-gray-500 dark:text-zinc-400">
              <summary className="cursor-pointer hover:text-gray-700 dark:hover:text-zinc-200">
                Technical details (developer)
              </summary>
              <div className="mt-2 p-2 bg-gray-100 dark:bg-zinc-800 rounded font-mono text-xs overflow-auto max-h-32">
                <div>Error ID: {this.state.errorId}</div>
                <div>Time: {new Intl.DateTimeFormat(undefined, {year:'numeric', month:'short', day:'numeric', hour:'2-digit', minute:'2-digit', second:'2-digit'}).format(new Date())}</div>
                <div>Stack: {error?.stack}</div>
                {errorInfo && (
                  <div>Component Stack: {errorInfo.componentStack}</div>
                )}
              </div>
            </details>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

// 性能监控Hook
export const useCanvasPerformance = () => {
  const [performanceMetrics, setPerformanceMetrics] = React.useState({
    renderTime: 0,
    nodeCount: 0,
    memoryUsage: 0,
    warnings: [] as string[]
  });

  const updateMetrics = React.useCallback((metrics: Partial<typeof performanceMetrics>) => {
    setPerformanceMetrics(prev => ({ ...prev, ...metrics }));
  }, []);

  const addWarning = React.useCallback((warning: string) => {
    setPerformanceMetrics(prev => ({
      ...prev,
      warnings: [...prev.warnings.slice(-4), warning] // 保留最近5个警告
    }));
  }, []);

  return {
    performanceMetrics,
    updateMetrics,
    addWarning
  };
};

export default ErrorBoundary;
