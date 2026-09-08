// 🎧 useEventListeners Hook 使用示例
// 展示如何使用统一事件监听器管理工具

import React, { useRef, useCallback } from 'react';
import { useEventListeners, useGlobalEvents, EVENT_PRESETS } from '../useEventListeners';
import { toast } from 'sonner';

// 📝 示例1：基础事件监听器管理
export const BasicEventListenerExample: React.FC = () => {
  const elementRef = useRef<HTMLDivElement>(null);
  const eventManager = useEventListeners();

  // 🎯 添加点击事件监听器
  const handleAddClickListener = useCallback(() => {
    const listenerId = eventManager.addListener({
      target: elementRef.current,
      event: 'click',
      handler: (event) => {
        console.log('Element clicked!', event);
        toast.info('Element was clicked!');
      },
      options: { passive: true }
    });

    console.log('Added click listener with ID:', listenerId);
  }, [eventManager]);

  // 🎯 批量添加多个事件监听器
  const handleAddMultipleListeners = useCallback(() => {
    const listenerIds = eventManager.addListeners([
      EVENT_PRESETS.MOUSE.mousedown((e) => console.log('Mouse down', e), elementRef.current),
      EVENT_PRESETS.MOUSE.mouseup((e) => console.log('Mouse up', e), elementRef.current),
      EVENT_PRESETS.MOUSE.mousemove((e) => console.log('Mouse move', e), elementRef.current)
    ]);

    console.log('Added multiple listeners:', listenerIds);
  }, [eventManager]);

  // 🎯 获取监听器状态
  const handleGetStatus = useCallback(() => {
    const status = eventManager.getListenerStatus();
    toast.info(`监听器状态: 总计${status.total}, 活跃${status.active}, 禁用${status.disabled}`);
  }, [eventManager]);

  return (
    <div className="p-6 space-y-4">
      <h2 className="text-xl font-bold">基础事件监听器管理示例</h2>

      <div
        ref={elementRef}
        className="w-64 h-32 bg-blue-100 border-2 border-blue-300 rounded-lg flex items-center justify-center cursor-pointer hover:bg-blue-200 transition-colors"
      >
        点击我！
      </div>

      <div className="space-x-2">
        <button
          onClick={handleAddClickListener}
          className="px-4 py-2 bg-green-500 text-white rounded hover:bg-green-600"
        >
          添加点击监听器
        </button>

        <button
          onClick={handleAddMultipleListeners}
          className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600"
        >
          批量添加监听器
        </button>

        <button
          onClick={handleGetStatus}
          className="px-4 py-2 bg-muted text-foreground rounded hover:bg-accent/60"
        >
          查看状态
        </button>

        <button
          onClick={() => eventManager.removeAllListeners()}
          className="px-4 py-2 bg-red-500 text-white rounded hover:bg-red-600"
        >
          清除所有监听器
        </button>
      </div>
    </div>
  );
};

// 📝 示例2：全局事件监听器
export const GlobalEventListenerExample: React.FC = () => {
  const globalEvents = useGlobalEvents();

  // 🎯 添加全局键盘快捷键
  const handleAddGlobalKeys = useCallback(() => {
    // Ctrl+S 保存快捷键
    globalEvents.addGlobalKeyListener('s',
      (event) => {
        event.preventDefault();
        toast.info('Ctrl+S 保存快捷键触发！');
      },
      { ctrlKey: true }
    );

    // Escape 取消快捷键
    globalEvents.addGlobalKeyListener('Escape',
      (event) => {
        console.log('Escape pressed');
        toast.info('Escape 键被按下！');
      }
    );

    // Ctrl+Shift+D 调试快捷键
    globalEvents.addGlobalKeyListener('d',
      (event) => {
        event.preventDefault();
        console.log('Debug shortcut triggered');
        toast.info('调试模式切换！');
      },
      { ctrlKey: true, shiftKey: true }
    );

    toast.info('全局快捷键已添加：Ctrl+S, Escape, Ctrl+Shift+D');
  }, [globalEvents]);

  // 🎯 添加点击外部区域监听器
  const handleAddClickOutside = useCallback(() => {
    const elementRef = document.getElementById('click-outside-demo');
    if (elementRef) {
      globalEvents.addGlobalClickOutside(elementRef, () => {
        toast.info('点击了元素外部区域！');
      });
      toast.info('点击外部监听器已添加，点击蓝色区域外试试');
    }
  }, [globalEvents]);

  return (
    <div className="p-6 space-y-4">
      <h2 className="text-xl font-bold">全局事件监听器示例</h2>

      <div
        id="click-outside-demo"
        className="w-64 h-32 bg-purple-100 border-2 border-purple-300 rounded-lg flex items-center justify-center"
      >
        点击外部监听器测试区域
      </div>

      <div className="space-x-2">
        <button
          onClick={handleAddGlobalKeys}
          className="px-4 py-2 bg-indigo-500 text-white rounded hover:bg-indigo-600"
        >
          添加全局快捷键
        </button>

        <button
          onClick={handleAddClickOutside}
          className="px-4 py-2 bg-purple-500 text-white rounded hover:bg-purple-600"
        >
          添加点击外部监听器
        </button>

        <button
          onClick={() => globalEvents.removeAllListeners()}
          className="px-4 py-2 bg-red-500 text-white rounded hover:bg-red-600"
        >
          清除所有全局监听器
        </button>
      </div>

      <div className="text-sm text-gray-600">
        <p>💡 试试这些快捷键：</p>
        <ul className="list-disc list-inside space-y-1">
          <li>Ctrl+S - 保存快捷键</li>
          <li>Escape - 取消操作</li>
          <li>Ctrl+Shift+D - 调试模式切换</li>
        </ul>
      </div>
    </div>
  );
};

// 📝 示例3：Canvas特定的事件管理
export const CanvasEventListenerExample: React.FC = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const eventManager = useEventListeners();

  // 🎯 添加Canvas绘图事件
  const handleAddCanvasEvents = useCallback(() => {
    if (!canvasRef.current) return;

    let isDrawing = false;
    let lastX = 0;
    let lastY = 0;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // 设置绘图样式
    ctx.strokeStyle = '#2563eb';
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';

    eventManager.addListeners([
      // 鼠标按下开始绘图
      {
        target: canvas,
        event: 'mousedown',
        handler: (e: Event) => {
          const mouseEvent = e as MouseEvent;
          isDrawing = true;
          const rect = canvas.getBoundingClientRect();
          lastX = mouseEvent.clientX - rect.left;
          lastY = mouseEvent.clientY - rect.top;
        }
      },
      // 鼠标移动绘图
      {
        target: canvas,
        event: 'mousemove',
        handler: (e: Event) => {
          if (!isDrawing) return;
          const mouseEvent = e as MouseEvent;
          const rect = canvas.getBoundingClientRect();
          const currentX = mouseEvent.clientX - rect.left;
          const currentY = mouseEvent.clientY - rect.top;

          ctx.beginPath();
          ctx.moveTo(lastX, lastY);
          ctx.lineTo(currentX, currentY);
          ctx.stroke();

          lastX = currentX;
          lastY = currentY;
        },
        options: { passive: true }
      },
      // 鼠标抬起停止绘图
      {
        target: canvas,
        event: 'mouseup',
        handler: () => {
          isDrawing = false;
        },
        options: { passive: true }
      },
      // 鼠标离开停止绘图
      {
        target: canvas,
        event: 'mouseleave',
        handler: () => {
          isDrawing = false;
        },
        options: { passive: true }
      }
    ]);

    toast.info('Canvas绘图事件已添加！在Canvas上拖拽鼠标来绘图');
  }, [eventManager]);

  // 🎯 清空Canvas
  const handleClearCanvas = useCallback(() => {
    if (!canvasRef.current) return;
    const ctx = canvasRef.current.getContext('2d');
    if (ctx) {
      ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
    }
  }, []);

  return (
    <div className="p-6 space-y-4">
      <h2 className="text-xl font-bold">Canvas事件监听器示例</h2>

      <canvas
        ref={canvasRef}
        width={400}
        height={200}
        className="border-2 border-gray-300 rounded-lg bg-white cursor-crosshair"
      />

      <div className="space-x-2">
        <button
          onClick={handleAddCanvasEvents}
          className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600"
        >
          启用绘图功能
        </button>

        <button
          onClick={handleClearCanvas}
          className="px-4 py-2 bg-muted text-foreground rounded hover:bg-accent/60"
        >
          清空Canvas
        </button>

        <button
          onClick={() => eventManager.removeAllListeners()}
          className="px-4 py-2 bg-red-500 text-white rounded hover:bg-red-600"
        >
          禁用绘图功能
        </button>
      </div>

      <p className="text-sm text-gray-600">
        💡 点击"启用绘图功能"后，在Canvas上拖拽鼠标来绘图
      </p>
    </div>
  );
};

// 📝 示例4：动态事件管理
export const DynamicEventListenerExample: React.FC = () => {
  const eventManager = useEventListeners();

  // 🎯 动态添加窗口大小变化监听器
  const handleAddResizeListener = useCallback(() => {
    const listenerId = eventManager.addListener(
      EVENT_PRESETS.WINDOW.resize(() => {
        const { innerWidth, innerHeight } = window;
        console.log(`窗口大小变化: ${innerWidth}x${innerHeight}`);

        // 更新页面标题显示当前窗口尺寸
        document.title = `窗口大小: ${innerWidth}x${innerHeight}`;
      })
    );

    console.log('窗口大小监听器ID:', listenerId);
    toast.info('窗口大小变化监听器已添加！改变浏览器窗口大小试试');

    return listenerId;
  }, [eventManager]);

  // 🎯 动态添加滚动监听器
  const handleAddScrollListener = useCallback(() => {
    let ticking = false;

    const listenerId = eventManager.addListener({
      target: window,
      event: 'scroll',
      handler: () => {
        if (!ticking) {
          requestAnimationFrame(() => {
            const scrollY = window.scrollY;
            console.log('页面滚动位置:', scrollY);

            // 根据滚动位置改变页面背景色
            const opacity = Math.min(scrollY / 300, 0.5);
            document.body.style.backgroundColor = `rgba(59, 130, 246, ${opacity})`;

            ticking = false;
          });
          ticking = true;
        }
      },
      options: { passive: true }
    });

    console.log('滚动监听器ID:', listenerId);
    toast.info('滚动监听器已添加！滚动页面查看背景色变化');

    return listenerId;
  }, [eventManager]);

  // 🎯 获取当前监听器详情
  const handleShowListenerDetails = useCallback(() => {
    const status = eventManager.getListenerStatus();
    const details = `
事件监听器统计:
- 总计: ${status.total}
- 活跃: ${status.active}
- 禁用: ${status.disabled}

内存占用: 轻量级
性能影响: 最小化
自动清理: ✅ 组件卸载时自动清理
    `.trim();

    toast.info(details);
  }, [eventManager]);

  return (
    <div className="p-6 space-y-4">
      <h2 className="text-xl font-bold">动态事件监听器管理示例</h2>

      <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
        <h3 className="font-semibold text-yellow-800">🚀 动态监听器特性</h3>
        <ul className="text-sm text-yellow-700 mt-2 space-y-1">
          <li>• 运行时动态添加/移除监听器</li>
          <li>• 自动内存管理，防止泄漏</li>
          <li>• 性能优化的事件处理</li>
          <li>• 组件卸载时自动清理</li>
        </ul>
      </div>

      <div className="space-x-2">
        <button
          onClick={handleAddResizeListener}
          className="px-4 py-2 bg-emerald-500 text-white rounded hover:bg-emerald-600"
        >
          添加窗口大小监听器
        </button>

        <button
          onClick={handleAddScrollListener}
          className="px-4 py-2 bg-cyan-500 text-white rounded hover:bg-cyan-600"
        >
          添加滚动监听器
        </button>

        <button
          onClick={handleShowListenerDetails}
          className="px-4 py-2 bg-amber-500 text-white rounded hover:bg-amber-600"
        >
          查看监听器详情
        </button>

        <button
          onClick={() => {
            eventManager.removeAllListeners();
            document.title = 'ZhenZhi Canvas'; // 恢复原标题
            document.body.style.backgroundColor = ''; // 恢复原背景
            toast.info('所有动态监听器已清理！');
          }}
          className="px-4 py-2 bg-red-500 text-white rounded hover:bg-red-600"
        >
          清理所有监听器
        </button>
      </div>
    </div>
  );
};

// 🎯 完整示例组合组件
export const EventListenerExamples: React.FC = () => {
  return (
    <div className="max-w-4xl mx-auto space-y-8">
      <div className="text-center py-6">
        <h1 className="text-3xl font-bold text-gray-800">🎧 事件监听器管理工具示例</h1>
        <p className="text-gray-600 mt-2">统一、安全、高效的事件监听器管理解决方案</p>
      </div>

      <BasicEventListenerExample />
      <hr className="border-gray-200" />

      <GlobalEventListenerExample />
      <hr className="border-gray-200" />

      <CanvasEventListenerExample />
      <hr className="border-gray-200" />

      <DynamicEventListenerExample />
    </div>
  );
};

export default EventListenerExamples;
