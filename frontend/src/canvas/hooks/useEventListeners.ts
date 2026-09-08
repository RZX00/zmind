// 🎧 统一事件监听器管理Hook
// 提供统一的事件监听器注册、清理和管理机制

import { useEffect, useRef, useCallback } from 'react';

// 事件监听器配置接口
interface EventListenerConfig {
  target?: EventTarget | (() => EventTarget | null); // 事件目标，支持延迟获取
  event: string; // 事件名称
  handler: EventListener; // 事件处理函数
  options?: AddEventListenerOptions; // 事件选项
  enabled?: boolean; // 是否启用（默认true）
}

// 事件监听器管理Hook返回值
interface EventListenersManager {
  // 添加单个事件监听器
  addListener: (config: EventListenerConfig) => string;

  // 批量添加事件监听器
  addListeners: (configs: EventListenerConfig[]) => string[];

  // 移除特定事件监听器
  removeListener: (id: string) => void;

  // 移除所有事件监听器
  removeAllListeners: () => void;

  // 暂时禁用/启用特定监听器
  toggleListener: (id: string, enabled: boolean) => void;

  // 暂时禁用/启用所有监听器
  toggleAllListeners: (enabled: boolean) => void;

  // 获取当前监听器状态
  getListenerStatus: () => { total: number; active: number; disabled: number };
}

// 内部监听器状态
interface ListenerState {
  id: string;
  config: EventListenerConfig;
  target: EventTarget | null;
  enabled: boolean;
  registered: boolean;
}

// 🎯 统一事件监听器管理Hook
export const useEventListeners = (): EventListenersManager => {
  const listenersRef = useRef<Map<string, ListenerState>>(new Map());
  const counterRef = useRef(0);

  // 🔧 获取事件目标
  const getEventTarget = useCallback((target?: EventTarget | (() => EventTarget | null)): EventTarget | null => {
    if (!target) return null;

    if (typeof target === 'function') {
      try {
        return target();
      } catch (error) {
        console.warn('[useEventListeners] 获取事件目标失败:', error);
        return null;
      }
    }

    return target;
  }, []);

  // 🔧 注册单个事件监听器
  const registerListener = useCallback((state: ListenerState) => {
    if (state.registered || !state.enabled) return;

    const target = getEventTarget(state.config.target);
    if (!target) return;

    state.target = target;

    try {
      target.addEventListener(state.config.event, state.config.handler, state.config.options);
      state.registered = true;

      // 开发环境下记录注册信息
      if (process.env.NODE_ENV === 'development') {
        console.debug(`[useEventListeners] 注册监听器: ${state.id} (${state.config.event})`);
      }
    } catch (error) {
      console.warn(`[useEventListeners] 注册监听器失败:`, error);
    }
  }, [getEventTarget]);

  // 🔧 注销单个事件监听器
  const unregisterListener = useCallback((state: ListenerState) => {
    if (!state.registered || !state.target) return;

    try {
      state.target.removeEventListener(state.config.event, state.config.handler, state.config.options);
      state.registered = false;
      state.target = null;

      // 开发环境下记录注销信息
      if (process.env.NODE_ENV === 'development') {
        console.debug(`[useEventListeners] 注销监听器: ${state.id} (${state.config.event})`);
      }
    } catch (error) {
      console.warn(`[useEventListeners] 注销监听器失败:`, error);
    }
  }, []);

  // 🎯 添加单个事件监听器
  const addListener = useCallback((config: EventListenerConfig): string => {
    const id = `listener_${++counterRef.current}`;

    const state: ListenerState = {
      id,
      config,
      target: null,
      enabled: config.enabled !== false,
      registered: false
    };

    listenersRef.current.set(id, state);

    // 立即尝试注册
    registerListener(state);

    return id;
  }, [registerListener]);

  // 🎯 批量添加事件监听器
  const addListeners = useCallback((configs: EventListenerConfig[]): string[] => {
    return configs.map(config => addListener(config));
  }, [addListener]);

  // 🎯 移除特定事件监听器
  const removeListener = useCallback((id: string) => {
    const state = listenersRef.current.get(id);
    if (!state) return;

    unregisterListener(state);
    listenersRef.current.delete(id);
  }, [unregisterListener]);

  // 🎯 移除所有事件监听器
  const removeAllListeners = useCallback(() => {
    const listeners = Array.from(listenersRef.current.values());

    listeners.forEach(state => {
      unregisterListener(state);
    });

    listenersRef.current.clear();

    if (process.env.NODE_ENV === 'development') {
      console.debug(`[useEventListeners] 清理了 ${listeners.length} 个监听器`);
    }
  }, [unregisterListener]);

  // 🎯 切换特定监听器的启用状态
  const toggleListener = useCallback((id: string, enabled: boolean) => {
    const state = listenersRef.current.get(id);
    if (!state) return;

    if (state.enabled === enabled) return;

    state.enabled = enabled;

    if (enabled) {
      registerListener(state);
    } else {
      unregisterListener(state);
    }
  }, [registerListener, unregisterListener]);

  // 🎯 切换所有监听器的启用状态
  const toggleAllListeners = useCallback((enabled: boolean) => {
    const listeners = Array.from(listenersRef.current.values());

    listeners.forEach(state => {
      if (state.enabled === enabled) return;

      state.enabled = enabled;

      if (enabled) {
        registerListener(state);
      } else {
        unregisterListener(state);
      }
    });
  }, [registerListener, unregisterListener]);

  // 🎯 获取监听器状态统计
  const getListenerStatus = useCallback(() => {
    const listeners = Array.from(listenersRef.current.values());
    const total = listeners.length;
    const active = listeners.filter(state => state.enabled && state.registered).length;
    const disabled = listeners.filter(state => !state.enabled).length;

    return { total, active, disabled };
  }, []);

  // 🔧 处理事件目标可能延迟可用的情况
  const recheckTargets = useCallback(() => {
    const listeners = Array.from(listenersRef.current.values());

    listeners.forEach(state => {
      if (state.enabled && !state.registered) {
        registerListener(state);
      }
    });
  }, [registerListener]);

  // 🎯 组件卸载时自动清理所有监听器
  useEffect(() => {
    return () => {
      removeAllListeners();
    };
  }, [removeAllListeners]);

  // 🎯 周期性检查是否有新的可用目标（可选优化）
  useEffect(() => {
    const interval = setInterval(recheckTargets, 1000);
    return () => clearInterval(interval);
  }, [recheckTargets]);

  return {
    addListener,
    addListeners,
    removeListener,
    removeAllListeners,
    toggleListener,
    toggleAllListeners,
    getListenerStatus
  };
};

// 🎯 常用事件监听器配置预设
export const EVENT_PRESETS = {
  // 🖱️ 鼠标事件
  MOUSE: {
    click: (handler: EventListener, target?: EventTarget) => ({
      target,
      event: 'click',
      handler,
      options: { passive: true }
    }),
    mousedown: (handler: EventListener, target?: EventTarget) => ({
      target,
      event: 'mousedown',
      handler
    }),
    mouseup: (handler: EventListener, target?: EventTarget) => ({
      target,
      event: 'mouseup',
      handler,
      options: { passive: true }
    }),
    mousemove: (handler: EventListener, target?: EventTarget) => ({
      target,
      event: 'mousemove',
      handler,
      options: { passive: true }
    }),
    wheel: (handler: EventListener, target?: EventTarget) => ({
      target,
      event: 'wheel',
      handler,
      options: { passive: false } // 通常需要preventDefault
    })
  },

  // ⌨️ 键盘事件
  KEYBOARD: {
    keydown: (handler: EventListener, target?: EventTarget) => ({
      target,
      event: 'keydown',
      handler
    }),
    keyup: (handler: EventListener, target?: EventTarget) => ({
      target,
      event: 'keyup',
      handler,
      options: { passive: true }
    })
  },

  // 📱 触摸事件
  TOUCH: {
    touchstart: (handler: EventListener, target?: EventTarget) => ({
      target,
      event: 'touchstart',
      handler
    }),
    touchmove: (handler: EventListener, target?: EventTarget) => ({
      target,
      event: 'touchmove',
      handler,
      options: { passive: false }
    }),
    touchend: (handler: EventListener, target?: EventTarget) => ({
      target,
      event: 'touchend',
      handler,
      options: { passive: true }
    })
  },

  // 🖥️ 窗口事件
  WINDOW: {
    resize: (handler: EventListener) => ({
      target: window,
      event: 'resize',
      handler,
      options: { passive: true }
    }),
    beforeunload: (handler: EventListener) => ({
      target: window,
      event: 'beforeunload',
      handler
    }),
    focus: (handler: EventListener) => ({
      target: window,
      event: 'focus',
      handler,
      options: { passive: true }
    }),
    blur: (handler: EventListener) => ({
      target: window,
      event: 'blur',
      handler,
      options: { passive: true }
    })
  }
} as const;

// 🎯 便捷Hook：常用全局事件监听器
export const useGlobalEvents = () => {
  const eventManager = useEventListeners();

  const addGlobalKeyListener = useCallback((key: string, handler: (event: KeyboardEvent) => void, options?: { ctrlKey?: boolean; shiftKey?: boolean; altKey?: boolean }) => {
    const keyHandler = (event: Event) => {
      const keyEvent = event as KeyboardEvent;

      if (keyEvent.key !== key) return;
      if (options?.ctrlKey && !keyEvent.ctrlKey) return;
      if (options?.shiftKey && !keyEvent.shiftKey) return;
      if (options?.altKey && !keyEvent.altKey) return;

      handler(keyEvent);
    };

    return eventManager.addListener(EVENT_PRESETS.KEYBOARD.keydown(keyHandler, document));
  }, [eventManager]);

  const addGlobalClickOutside = useCallback((element: Element, handler: () => void) => {
    const clickHandler = (event: Event) => {
      const target = event.target as Node;
      if (!element.contains(target)) {
        handler();
      }
    };

    return eventManager.addListener(EVENT_PRESETS.MOUSE.click(clickHandler, document));
  }, [eventManager]);

  return {
    ...eventManager,
    addGlobalKeyListener,
    addGlobalClickOutside
  };
};

export default useEventListeners;