/**
 * 仪表板渐进式加载骨架组件
 *
 * 提供有意义的加载状态，避免全屏黑屏等待：
 * - 分阶段加载骨架
 * - 保持布局结构稳定
 * - 渐进式内容显示
 */

import { Skeleton } from '@/components/ui/skeleton';
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar';

/**
 * 认证加载骨架
 */
export function AuthSkeleton() {
  return (
    <div className="flex items-center justify-center min-h-screen bg-background">
      <div className="text-center space-y-4">
        <div className="w-12 h-12 mx-auto">
          <Skeleton className="w-full h-full rounded-full" />
        </div>
        <Skeleton className="h-4 w-32 mx-auto" />
        <div className="text-sm text-muted-foreground">验证身份中...</div>
      </div>
    </div>
  );
}

/**
 * 侧边栏加载骨架
 */
export function SidebarSkeleton() {
  return (
    <div className="w-60 h-full bg-sidebar border-r p-4 space-y-4">
      {/* 用户信息区域 */}
      <div className="flex items-center space-x-3 pb-4 border-b">
        <Skeleton className="w-8 h-8 rounded-full" />
        <div className="space-y-2">
          <Skeleton className="h-3 w-20" />
          <Skeleton className="h-2 w-16" />
        </div>
      </div>

      {/* 导航菜单 */}
      <div className="space-y-2">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="flex items-center space-x-3 p-2">
            <Skeleton className="w-4 h-4" />
            <Skeleton className="h-3 w-16" />
          </div>
        ))}
      </div>

      {/* 项目列表 */}
      <div className="space-y-3">
        <Skeleton className="h-4 w-12" />
        {[1, 2, 3].map((i) => (
          <div key={i} className="flex items-center space-x-3 p-2">
            <Skeleton className="w-4 h-4" />
            <Skeleton className="h-3 w-20" />
          </div>
        ))}
      </div>

      {/* 最近会话 */}
      <div className="space-y-3">
        <Skeleton className="h-4 w-16" />
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="space-y-2 p-2">
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-2 w-3/4" />
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * 主内容区域骨架
 */
export function MainContentSkeleton() {
  return (
    <div className="p-6 space-y-6">
      {/* 页面标题 */}
      <div className="space-y-2">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-4 w-96" />
      </div>

      {/* 内容区域 */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* 主要内容 */}
        <div className="lg:col-span-2 space-y-4">
          <Skeleton className="h-48 w-full rounded-lg" />
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-16 w-full rounded" />
            ))}
          </div>
        </div>

        {/* 侧边内容 */}
        <div className="space-y-4">
          <Skeleton className="h-32 w-full rounded-lg" />
          <Skeleton className="h-24 w-full rounded-lg" />
          <Skeleton className="h-40 w-full rounded-lg" />
        </div>
      </div>
    </div>
  );
}

/**
 * 完整的仪表板布局骨架
 */
export function DashboardSkeleton() {
  return (
    <SidebarProvider>
      <div className="flex h-screen">
        <SidebarSkeleton />
        <SidebarInset>
          <MainContentSkeleton />
        </SidebarInset>
      </div>
    </SidebarProvider>
  );
}

/**
 * 数据加载骨架 - 保持原始布局但显示加载状态
 */
export function DataLoadingSkeleton() {
  return (
    <SidebarProvider>
      <div className="flex h-screen">
        <SidebarSkeleton />
        <SidebarInset>
          <div className="p-6">
            <div className="text-center space-y-4">
              <div className="w-8 h-8 mx-auto">
                <Skeleton className="w-full h-full rounded-full animate-pulse" />
              </div>
              <div className="text-sm text-muted-foreground">
                加载数据中...
              </div>
            </div>
          </div>
        </SidebarInset>
      </div>
    </SidebarProvider>
  );
}

/**
 * 系统健康检查骨架
 */
export function HealthCheckSkeleton() {
  return (
    <div className="flex items-center justify-center min-h-screen bg-background">
      <div className="text-center space-y-4 max-w-md">
        <div className="w-16 h-16 mx-auto">
          <Skeleton className="w-full h-full rounded-full animate-pulse" />
        </div>
        <div className="space-y-2">
          <Skeleton className="h-5 w-48 mx-auto" />
          <Skeleton className="h-3 w-64 mx-auto" />
        </div>
        <div className="text-sm text-muted-foreground">
          系统健康检查中...
        </div>
      </div>
    </div>
  );
}