// 🛡️ Canvas错误边界组件
// 捕获Canvas文件管理相关的错误，提供优雅降级

import React, { Component, ReactNode } from 'react';
import { AlertTriangle, RefreshCw, FileText } from 'lucide-react';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
  onError?: (error: Error, errorInfo: React.ErrorInfo) => void;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorBoundary: 'file-manager' | 'canvas-editor' | 'unknown';
}

export class CanvasErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorBoundary: 'unknown',
    };
  }

  static getDerivedStateFromError(error: Error): State {
    // 根据错误类型判断错误边界
    let errorBoundary: State['errorBoundary'] = 'unknown';
    
    if (error.message.includes('文件') || error.message.includes('Canvas')) {
      errorBoundary = 'file-manager';
    } else if (error.message.includes('编辑') || error.message.includes('节点')) {
      errorBoundary = 'canvas-editor';
    }
    
    return {
      hasError: true,
      error,
      errorBoundary,
    };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('[CanvasErrorBoundary] 捕获到错误:', error, errorInfo);
    
    // 调用自定义错误处理
    if (this.props.onError) {
      this.props.onError(error, errorInfo);
    }
    
    // 发送错误统计（可选）
    this.reportError(error, errorInfo);
  }

  private reportError(error: Error, errorInfo: React.ErrorInfo) {
    // 这里可以集成错误监控服务
    const errorReport = {
      message: error.message,
      stack: error.stack,
      componentStack: errorInfo.componentStack,
      timestamp: Date.now(),
      boundary: this.state.errorBoundary,
      userAgent: navigator.userAgent,
    };
    
    console.log('[CanvasErrorBoundary] 错误报告:', errorReport);
  }

  private handleRetry = () => {
    this.setState({
      hasError: false,
      error: null,
      errorBoundary: 'unknown',
    });
  };

  private handleReload = () => {
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      // 如果提供了自定义fallback，使用它
      if (this.props.fallback) {
        return this.props.fallback;
      }

      // 根据错误类型提供不同的UI
      return (
        <div className="flex items-center justify-center min-h-[400px] p-6">
          <div className="text-center max-w-md">
            <div className="flex justify-center mb-4">
              <div className="p-3 rounded-full bg-red-100 dark:bg-red-900/30">
                <AlertTriangle size={24} className="text-red-600 dark:text-red-300" />
              </div>
            </div>
            
            <h3 className="text-lg font-semibold text-gray-900 dark:text-zinc-100 mb-2">
              {this.getErrorTitle()}
            </h3>
            
            <p className="text-gray-600 dark:text-zinc-300 mb-6">
              {this.getErrorMessage()}
            </p>
            
            <div className="flex flex-col sm:flex-row gap-3 justify-center">
              <button
                onClick={this.handleRetry}
                className="flex items-center justify-center px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
              >
                <RefreshCw size={16} className="mr-2" />
                Retry
              </button>
              
              <button
                onClick={this.handleReload}
                className="flex items-center justify-center px-4 py-2 border border-gray-300 dark:border-zinc-600 text-gray-700 dark:text-zinc-200 rounded-lg hover:bg-accent/40 transition-colors"
              >
                <FileText size={16} className="mr-2" />
                Reload Page
              </button>
            </div>
            
            {process.env.NODE_ENV === 'development' && (
              <details className="mt-6 text-left">
                <summary className="cursor-pointer text-sm text-gray-500 dark:text-zinc-400 hover:text-gray-700 dark:hover:text-zinc-200">
                  View error details
                </summary>
                <pre className="mt-2 p-3 bg-gray-100 dark:bg-zinc-800 rounded text-xs overflow-auto text-red-600 dark:text-red-300">
                  {this.state.error?.message}
                  {'\n\n'}
                  {this.state.error?.stack}
                </pre>
              </details>
            )}
          </div>
        </div>
      );
    }

    return this.props.children;
  }

  private getErrorTitle(): string {
    switch (this.state.errorBoundary) {
      case 'file-manager':
        return 'File Manager Error';
      case 'canvas-editor':
        return 'Canvas Editor Error';
      default:
        return 'An unknown error occurred';
    }
  }

  private getErrorMessage(): string {
    switch (this.state.errorBoundary) {
      case 'file-manager':
        return 'A problem occurred during file operations. This may be due to network or sync issues. Please try again or reload the page.';
      case 'canvas-editor':
        return 'The canvas editor encountered a problem. Your work was auto‑saved; try reloading the editor.';
      default:
        return 'Sorry, an unexpected error occurred. Please try again or reload the page.';
    }
  }
}
