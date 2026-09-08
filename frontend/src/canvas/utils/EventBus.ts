// 🚌 统一事件总线系统
// 提供组件间松耦合的通信机制

export type EventListener<T = any> = (data: T) => void;
export type EventType = string;

// 🎯 事件总线接口
export interface IEventBus {
  // 订阅事件
  on<T = any>(eventType: EventType, listener: EventListener<T>): () => void;
  
  // 订阅一次性事件
  once<T = any>(eventType: EventType, listener: EventListener<T>): () => void;
  
  // 取消订阅
  off<T = any>(eventType: EventType, listener: EventListener<T>): void;
  
  // 发布事件
  emit<T = any>(eventType: EventType, data?: T): void;
  
  // 清除所有监听器
  clear(): void;
  
  // 获取事件监听器数量
  getListenerCount(eventType: EventType): number;
}

// 🚌 事件总线实现
class EventBus implements IEventBus {
  private listeners: Map<EventType, Set<EventListener>> = new Map();
  private onceListeners: Map<EventType, Set<EventListener>> = new Map();
  
  // 🎯 订阅事件
  on<T = any>(eventType: EventType, listener: EventListener<T>): () => void {
    if (!this.listeners.has(eventType)) {
      this.listeners.set(eventType, new Set());
    }
    
    this.listeners.get(eventType)!.add(listener);
    
    // 返回取消订阅函数
    return () => this.off(eventType, listener);
  }
  
  // 🎯 订阅一次性事件
  once<T = any>(eventType: EventType, listener: EventListener<T>): () => void {
    if (!this.onceListeners.has(eventType)) {
      this.onceListeners.set(eventType, new Set());
    }
    
    this.onceListeners.get(eventType)!.add(listener);
    
    // 返回取消订阅函数
    return () => {
      const onceSet = this.onceListeners.get(eventType);
      if (onceSet) {
        onceSet.delete(listener);
      }
    };
  }
  
  // 🚫 取消订阅
  off<T = any>(eventType: EventType, listener: EventListener<T>): void {
    const regularListeners = this.listeners.get(eventType);
    if (regularListeners) {
      regularListeners.delete(listener);
      if (regularListeners.size === 0) {
        this.listeners.delete(eventType);
      }
    }
    
    const onceSet = this.onceListeners.get(eventType);
    if (onceSet) {
      onceSet.delete(listener);
      if (onceSet.size === 0) {
        this.onceListeners.delete(eventType);
      }
    }
  }
  
  // 📢 发布事件
  emit<T = any>(eventType: EventType, data?: T): void {
    // 触发常规监听器
    const regularListeners = this.listeners.get(eventType);
    if (regularListeners) {
      regularListeners.forEach(listener => {
        try {
          listener(data);
        } catch (error) {
          console.error(`Event listener error for ${eventType}:`, error);
        }
      });
    }
    
    // 触发一次性监听器
    const onceSet = this.onceListeners.get(eventType);
    if (onceSet) {
      // 创建副本以避免在遍历时修改集合
      const listeners = Array.from(onceSet);
      // 清除一次性监听器
      this.onceListeners.delete(eventType);
      
      listeners.forEach(listener => {
        try {
          listener(data);
        } catch (error) {
          console.error(`Event listener error for ${eventType}:`, error);
        }
      });
    }
  }
  
  // 🧹 清除所有监听器
  clear(): void {
    this.listeners.clear();
    this.onceListeners.clear();
  }
  
  // 📊 获取事件监听器数量
  getListenerCount(eventType: EventType): number {
    const regularCount = this.listeners.get(eventType)?.size || 0;
    const onceCount = this.onceListeners.get(eventType)?.size || 0;
    return regularCount + onceCount;
  }
  
  // 📝 获取所有事件类型
  getEventTypes(): EventType[] {
    const allTypes = new Set([
      ...this.listeners.keys(),
      ...this.onceListeners.keys()
    ]);
    return Array.from(allTypes);
  }
  
  // 🔍 调试信息
  getDebugInfo() {
    return {
      regularListeners: Object.fromEntries(
        Array.from(this.listeners.entries()).map(([key, value]) => [key, value.size])
      ),
      onceListeners: Object.fromEntries(
        Array.from(this.onceListeners.entries()).map(([key, value]) => [key, value.size])
      ),
      totalEvents: this.getEventTypes().length
    };
  }
}

// 🎨 Canvas相关事件类型定义
export const CanvasEvents = {
  // 节点事件
  NODE_CREATED: 'canvas:node:created',
  NODE_UPDATED: 'canvas:node:updated',
  NODE_DELETED: 'canvas:node:deleted',
  NODE_SELECTED: 'canvas:node:selected',
  NODE_MOVED: 'canvas:node:moved',
  NODE_RESIZED: 'canvas:node:resized',
  
  // 连接事件
  CONNECTION_CREATED: 'canvas:connection:created',
  CONNECTION_DELETED: 'canvas:connection:deleted',
  CONNECTION_UPDATED: 'canvas:connection:updated',
  
  // 画布事件
  CANVAS_UPDATED: 'canvas:updated',
  CANVAS_CLEARED: 'canvas:cleared',
  CANVAS_ZOOMED: 'canvas:zoomed',
  CANVAS_PANNED: 'canvas:panned',
  
  // 编辑事件
  EDIT_MODE_ENTERED: 'canvas:edit:entered',
  EDIT_MODE_EXITED: 'canvas:edit:exited',
  CONTENT_CHANGED: 'canvas:content:changed',
  
  // AI事件
  AI_COMMAND_EXECUTED: 'ai:command:executed',
  AI_COMMAND_FAILED: 'ai:command:failed',
  AI_ANALYSIS_COMPLETED: 'ai:analysis:completed',
  
  // 系统事件
  ERROR_OCCURRED: 'system:error',
  WARNING_ISSUED: 'system:warning',
  DEBUG_MESSAGE: 'system:debug',
} as const;

// 🎨 事件数据类型定义
export interface CanvasEventData {
  [CanvasEvents.NODE_CREATED]: { nodeId: string; node: any };
  [CanvasEvents.NODE_UPDATED]: { nodeId: string; updates: any };
  [CanvasEvents.NODE_DELETED]: { nodeId: string };
  [CanvasEvents.NODE_SELECTED]: { nodeId: string; multiSelect: boolean };
  [CanvasEvents.NODE_MOVED]: { nodeId: string; position: { x: number; y: number } };
  [CanvasEvents.NODE_RESIZED]: { nodeId: string; size: { width: number; height: number } };
  
  [CanvasEvents.CONNECTION_CREATED]: { connectionId: string; connection: any };
  [CanvasEvents.CONNECTION_DELETED]: { connectionId: string };
  [CanvasEvents.CONNECTION_UPDATED]: { connectionId: string; updates: any };
  
  [CanvasEvents.CANVAS_UPDATED]: { canvas: any };
  [CanvasEvents.CANVAS_CLEARED]: { [key: string]: never };
  [CanvasEvents.CANVAS_ZOOMED]: { scale: number };
  [CanvasEvents.CANVAS_PANNED]: { x: number; y: number };
  
  [CanvasEvents.EDIT_MODE_ENTERED]: { nodeId: string };
  [CanvasEvents.EDIT_MODE_EXITED]: { nodeId: string };
  [CanvasEvents.CONTENT_CHANGED]: { nodeId: string; content: any };
  
  [CanvasEvents.AI_COMMAND_EXECUTED]: { command: string; result: any };
  [CanvasEvents.AI_COMMAND_FAILED]: { command: string; error: string };
  [CanvasEvents.AI_ANALYSIS_COMPLETED]: { analysis: any };
  
  [CanvasEvents.ERROR_OCCURRED]: { error: Error; context?: string };
  [CanvasEvents.WARNING_ISSUED]: { message: string; context?: string };
  [CanvasEvents.DEBUG_MESSAGE]: { message: string; data?: any };
}

// 🌟 创建全局事件总线实例
export const globalEventBus = new EventBus();

// 🎯 React Hook for Event Bus
import { useEffect, useCallback } from 'react';

export function useEventBus() {
  const subscribe = useCallback(<T = any>(
    eventType: EventType, 
    listener: EventListener<T>
  ) => {
    return globalEventBus.on(eventType, listener);
  }, []);

  const subscribeOnce = useCallback(<T = any>(
    eventType: EventType, 
    listener: EventListener<T>
  ) => {
    return globalEventBus.once(eventType, listener);
  }, []);

  const publish = useCallback(<T = any>(
    eventType: EventType, 
    data?: T
  ) => {
    globalEventBus.emit(eventType, data);
  }, []);

  const unsubscribe = useCallback(<T = any>(
    eventType: EventType, 
    listener: EventListener<T>
  ) => {
    globalEventBus.off(eventType, listener);
  }, []);

  return {
    subscribe,
    subscribeOnce,
    publish,
    unsubscribe,
    eventBus: globalEventBus
  };
}

// 🎨 类型安全的Canvas事件Hook
export function useCanvasEvents() {
  const { subscribe, subscribeOnce, publish, unsubscribe } = useEventBus();

  return {
    // 类型安全的订阅方法
    on: <K extends keyof CanvasEventData>(
      eventType: K,
      listener: EventListener<CanvasEventData[K]>
    ) => subscribe(eventType, listener),

    // 类型安全的一次性订阅
    once: <K extends keyof CanvasEventData>(
      eventType: K,
      listener: EventListener<CanvasEventData[K]>
    ) => subscribeOnce(eventType, listener),

    // 类型安全的发布方法
    emit: <K extends keyof CanvasEventData>(
      eventType: K,
      data: CanvasEventData[K]
    ) => publish(eventType, data),

    // 取消订阅
    off: <K extends keyof CanvasEventData>(
      eventType: K,
      listener: EventListener<CanvasEventData[K]>
    ) => unsubscribe(eventType, listener),
  };
}

// 🚌 自动清理的Hook
export function useEventListener<T = any>(
  eventType: EventType,
  listener: EventListener<T>
) {
  useEffect(() => {
    const unsubscribeFn = globalEventBus.on(eventType, listener);
    return unsubscribeFn;
  }, [eventType, listener]);
}

// 🎯 便捷的事件发射Hook
export function useEventEmitter() {
  return useCallback(<T = any>(eventType: EventType, data?: T) => {
    globalEventBus.emit(eventType, data);
  }, []);
}

// 🎨 导出主要API
export default globalEventBus;
