/**
 * 🎬 Canvas节点对齐动画服务
 * 
 * 提供节点对齐时的平滑动画过渡效果
 * 支持多种缓动函数和自定义动画参数
 * 
 * @version 1.0.0
 * @author ZhenZhi Canvas Team
 */

import type { CanvasNode } from '../types/canvas';
import type { AlignmentAnimation, AnimationState } from '../types/node-alignment';

// ==================== 类型定义 ====================

interface AnimationFrame {
  nodeId: string;
  startX: number;
  startY: number;
  endX: number;
  endY: number;
  currentX: number;
  currentY: number;
  cachedNode: CanvasNode; // 缓存节点对象，避免重复查找
}

interface AnimationCallback {
  onUpdate: (nodes: CanvasNode[]) => void;
  onComplete: () => void;
}

// ==================== 缓动函数 ====================

const EASING_FUNCTIONS = {
  linear: (t: number) => t,
  ease: (t: number) => t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2,
  'ease-in': (t: number) => t * t,
  'ease-out': (t: number) => 1 - (1 - t) * (1 - t),
  'ease-in-out': (t: number) => t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2,
  'ease-in-cubic': (t: number) => t * t * t,
  'ease-out-cubic': (t: number) => 1 - Math.pow(1 - t, 3),
  'ease-in-out-cubic': (t: number) => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2,
  'ease-in-quart': (t: number) => t * t * t * t,
  'ease-out-quart': (t: number) => 1 - Math.pow(1 - t, 4),
  'ease-in-out-quart': (t: number) => t < 0.5 ? 8 * t * t * t * t : 1 - Math.pow(-2 * t + 2, 4) / 2,
  // 弹性缓动
  'ease-out-back': (t: number) => {
    const c1 = 1.70158;
    const c3 = c1 + 1;
    return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
  },
  // 弹跳缓动
  'ease-out-bounce': (t: number) => {
    const n1 = 7.5625;
    const d1 = 2.75;
    
    if (t < 1 / d1) {
      return n1 * t * t;
    } else if (t < 2 / d1) {
      return n1 * (t -= 1.5 / d1) * t + 0.75;
    } else if (t < 2.5 / d1) {
      return n1 * (t -= 2.25 / d1) * t + 0.9375;
    } else {
      return n1 * (t -= 2.625 / d1) * t + 0.984375;
    }
  }
};

// ==================== 默认配置 ====================

const DEFAULT_ANIMATION: Required<AlignmentAnimation> = {
  enabled: true,
  duration: 250, // 优化：减少动画时长，提升响应性
  easing: 'ease-out',
  showPath: false // 优化：默认关闭路径显示，减少渲染开销
};

// ==================== 主服务类 ====================

/**
 * Canvas节点对齐动画服务
 */
export class CanvasAlignmentAnimationService {
  private static activeAnimations = new Map<string, {
    animationId: number;
    startTime: number;
    frames: AnimationFrame[];
    config: Required<AlignmentAnimation>;
    callbacks: AnimationCallback;
    state: AnimationState;
  }>();

  /**
   * 执行节点对齐动画
   */
  public static async animateAlignment(
    originalNodes: CanvasNode[],
    targetNodes: CanvasNode[],
    animation: Partial<AlignmentAnimation> = {},
    callbacks: AnimationCallback
  ): Promise<void> {
    const config = { ...DEFAULT_ANIMATION, ...animation };
    
    // 如果动画被禁用，直接完成
    if (!config.enabled) {
      callbacks.onUpdate(targetNodes);
      callbacks.onComplete();
      return;
    }

    // 创建动画帧 - 缓存节点对象提升性能
    const frames: AnimationFrame[] = originalNodes.map((originalNode, index) => {
      const targetNode = targetNodes[index];
      // 创建节点缓存，避免动画过程中重复对象创建
      const cachedNode = { ...originalNode };
      
      return {
        nodeId: originalNode.id,
        startX: originalNode.x,
        startY: originalNode.y,
        endX: targetNode.x,
        endY: targetNode.y,
        currentX: originalNode.x,
        currentY: originalNode.y,
        cachedNode
      };
    });

    // 过滤出真正需要移动的节点
    const movingFrames = frames.filter(frame => 
      Math.abs(frame.endX - frame.startX) > 0.1 || 
      Math.abs(frame.endY - frame.startY) > 0.1
    );

    // 如果没有需要移动的节点，直接完成
    if (movingFrames.length === 0) {
      callbacks.onUpdate(targetNodes);
      callbacks.onComplete();
      return;
    }

    // 生成动画ID
    const animationId = Date.now() + Math.random();
    const animationKey = `alignment-${animationId}`;

    // 初始化动画状态
    const state: AnimationState = {
      isPlaying: true,
      progress: 0,
      startTime: Date.now(),
      animatingNodeIds: movingFrames.map(f => f.nodeId)
    };

    // 存储动画数据
    this.activeAnimations.set(animationKey, {
      animationId,
      startTime: Date.now(),
      frames: movingFrames,
      config,
      callbacks,
      state
    });

    // 开始动画循环
    this.startAnimationLoop(animationKey);
  }

  /**
   * 动画循环
   */
  private static startAnimationLoop(animationKey: string) {
    const animationData = this.activeAnimations.get(animationKey);
    if (!animationData) return;

    const { startTime, frames, config, callbacks, state } = animationData;

    const animate = () => {
      const currentTime = Date.now();
      const elapsed = currentTime - startTime;
      const progress = Math.min(elapsed / config.duration, 1);

      // 获取缓动函数 - 性能优化版本
      const easingFn = EASING_FUNCTIONS[config.easing as keyof typeof EASING_FUNCTIONS] || EASING_FUNCTIONS['ease-out'];
      const easedProgress = easingFn(progress);

      // 更新动画状态
      state.progress = progress;

      // 计算当前节点位置 - 性能优化版本
      const currentNodes: CanvasNode[] = [];
      
      for (let i = 0; i < frames.length; i++) {
        const frame = frames[i];
        frame.currentX = frame.startX + (frame.endX - frame.startX) * easedProgress;
        frame.currentY = frame.startY + (frame.endY - frame.startY) * easedProgress;
        
        // 直接修改缓存的节点对象，避免重复查找和对象创建
        const node = frame.cachedNode;
        if (node) {
          node.x = frame.currentX;
          node.y = frame.currentY;
          currentNodes.push(node);
        }
      }

      // 调用更新回调
      callbacks.onUpdate(currentNodes);

      // 检查动画是否完成
      if (progress >= 1) {
        state.isPlaying = false;
        this.activeAnimations.delete(animationKey);
        callbacks.onComplete();
      } else {
        requestAnimationFrame(animate);
      }
    };

    requestAnimationFrame(animate);
  }

  /**
   * 停止指定的动画
   */
  public static stopAnimation(animationKey: string): void {
    const animationData = this.activeAnimations.get(animationKey);
    if (animationData) {
      animationData.state.isPlaying = false;
      this.activeAnimations.delete(animationKey);
      animationData.callbacks.onComplete();
    }
  }

  /**
   * 停止所有动画
   */
  public static stopAllAnimations(): void {
    const keys = Array.from(this.activeAnimations.keys());
    keys.forEach(key => this.stopAnimation(key));
  }

  /**
   * 获取当前活动的动画状态
   */
  public static getAnimationStates(): Map<string, AnimationState> {
    const states = new Map<string, AnimationState>();
    this.activeAnimations.forEach((animationData, key) => {
      states.set(key, { ...animationData.state });
    });
    return states;
  }

  /**
   * 是否有活动的动画
   */
  public static hasActiveAnimations(): boolean {
    return this.activeAnimations.size > 0;
  }

  /**
   * 创建弹性动画配置
   */
  public static createBounceAnimation(duration: number = 500): AlignmentAnimation {
    return {
      enabled: true,
      duration,
      easing: 'ease-out-bounce',
      showPath: true
    };
  }

  /**
   * 创建平滑动画配置
   */
  public static createSmoothAnimation(duration: number = 300): AlignmentAnimation {
    return {
      enabled: true,
      duration,
      easing: 'ease-out',
      showPath: true
    };
  }

  /**
   * 创建快速动画配置
   */
  public static createQuickAnimation(duration: number = 150): AlignmentAnimation {
    return {
      enabled: true,
      duration,
      easing: 'ease-out-cubic',
      showPath: false
    };
  }

  /**
   * 根据距离动态计算动画时长
   */
  public static calculateDynamicDuration(
    originalNodes: CanvasNode[],
    targetNodes: CanvasNode[],
    baseSpeed: number = 1000 // 像素每秒
  ): number {
    let maxDistance = 0;
    
    originalNodes.forEach((original, index) => {
      const target = targetNodes[index];
      const dx = target.x - original.x;
      const dy = target.y - original.y;
      const distance = Math.sqrt(dx * dx + dy * dy);
      maxDistance = Math.max(maxDistance, distance);
    });

    // 基于最大移动距离计算时长，最小200ms，最大1000ms
    const duration = Math.max(200, Math.min(1000, (maxDistance / baseSpeed) * 1000));
    return Math.round(duration);
  }

  // ==================== 私有辅助方法 ====================

  private static originalNodesCache = new Map<string, CanvasNode>();

  private static findOriginalNode(nodeId: string): CanvasNode {
    const cached = this.originalNodesCache.get(nodeId);
    if (cached) return cached;
    
    // 如果没有缓存，返回一个基本的节点结构
    return {
      id: nodeId,
      type: 'text',
      x: 0,
      y: 0,
      width: 200,
      height: 100,
      content: '',
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
  }

  /**
   * 设置原始节点缓存（用于动画过程中的节点查找）
   */
  public static setOriginalNodesCache(nodes: CanvasNode[]): void {
    this.originalNodesCache.clear();
    nodes.forEach(node => {
      this.originalNodesCache.set(node.id, { ...node });
    });
  }
}

// ==================== 导出 ====================

export default CanvasAlignmentAnimationService;

/**
 * 🎯 使用示例：
 * 
 * ```typescript
 * // 基本使用
 * await CanvasAlignmentAnimationService.animateAlignment(
 *   originalNodes,
 *   alignedNodes,
 *   { duration: 400, easing: 'ease-out' },
 *   {
 *     onUpdate: (nodes) => updateCanvas(nodes),
 *     onComplete: () => console.log('动画完成')
 *   }
 * );
 * 
 * // 弹性动画
 * const bounceConfig = CanvasAlignmentAnimationService.createBounceAnimation(600);
 * 
 * // 动态时长
 * const duration = CanvasAlignmentAnimationService.calculateDynamicDuration(
 *   originalNodes, targetNodes, 800
 * );
 * ```
 */