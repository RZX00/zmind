// 🎯 连线偏好管理器 - 手动调整优先级机制
// 保存和管理用户对连线的手动调整，确保手动设置优先于自动计算

import { Position } from './bezierUtils';
import type { CanvasConnection } from '../types/canvas';

// 📋 连线偏好记录
export interface ConnectionPreference {
  connectionId: string;
  fromNodeId: string;
  toNodeId: string;

  // 手动调整标识
  isManuallyAdjusted: boolean;
  manualAdjustmentTimestamp: number;

  // 手动设置的控制点
  manualControlPoints?: Position[];

  // 用户偏好设置
  preferredCurveType: 'auto' | 'straight' | 'bezier';
  curvaturePreference?: number; // 0-1 之间的曲率偏好

  // 上下文信息（用于智能建议）
  adjustmentContext: {
    originalDistance: number;
    originalAngle: number;
    adjustmentVector: Position; // 用户的调整向量
    adjustmentMagnitude: number; // 调整幅度
  };
}

// 🗂️ 偏好存储接口
export interface ConnectionPreferenceStorage {
  preferences: Map<string, ConnectionPreference>;
  lastUpdated: number;
  version: string;
}

// 🧠 连线偏好管理器类
export class ConnectionPreferenceManager {
  private storage: ConnectionPreferenceStorage;
  private storageKey = 'canvas_connection_preferences';

  constructor() {
    this.storage = this.loadFromLocalStorage();
  }

  // 💾 从本地存储加载偏好
  private loadFromLocalStorage(): ConnectionPreferenceStorage {
    try {
      const stored = localStorage.getItem(this.storageKey);
      if (stored) {
        const parsed = JSON.parse(stored);
        return {
          preferences: new Map(Object.entries(parsed.preferences || {})),
          lastUpdated: parsed.lastUpdated || Date.now(),
          version: parsed.version || '1.0.0'
        };
      }
    } catch (error) {
      console.warn('Failed to load connection preferences from localStorage:', error);
    }

    return {
      preferences: new Map(),
      lastUpdated: Date.now(),
      version: '1.0.0'
    };
  }

  // 💾 保存偏好到本地存储
  private saveToLocalStorage(): void {
    try {
      const toSave = {
        preferences: Object.fromEntries(this.storage.preferences),
        lastUpdated: this.storage.lastUpdated,
        version: this.storage.version
      };
      localStorage.setItem(this.storageKey, JSON.stringify(toSave));
    } catch (error) {
      console.warn('Failed to save connection preferences to localStorage:', error);
    }
  }

  // 🔧 生成连线的唯一键
  private generateConnectionKey(fromNodeId: string, toNodeId: string): string {
    // 标准化连线键（确保方向性）
    return `${fromNodeId}:${toNodeId}`;
  }

  // 📝 记录手动调整
  public recordManualAdjustment(
    connection: CanvasConnection,
    newControlPoints: Position[],
    originalStartPos: Position,
    originalEndPos: Position,
    adjustmentVector: Position
  ): void {
    const key = this.generateConnectionKey(connection.from, connection.to);
    const now = Date.now();

    // 计算调整上下文
    const originalDistance = Math.sqrt(
      Math.pow(originalEndPos.x - originalStartPos.x, 2) +
      Math.pow(originalEndPos.y - originalStartPos.y, 2)
    );
    const originalAngle = Math.atan2(
      originalEndPos.y - originalStartPos.y,
      originalEndPos.x - originalStartPos.x
    );
    const adjustmentMagnitude = Math.sqrt(
      Math.pow(adjustmentVector.x, 2) + Math.pow(adjustmentVector.y, 2)
    );

    const preference: ConnectionPreference = {
      connectionId: connection.id,
      fromNodeId: connection.from,
      toNodeId: connection.to,
      isManuallyAdjusted: true,
      manualAdjustmentTimestamp: now,
      manualControlPoints: [...newControlPoints],
      preferredCurveType: newControlPoints.length > 0 ? 'bezier' : 'straight',
      curvaturePreference: this.calculateCurvatureFromControlPoints(
        originalStartPos,
        originalEndPos,
        newControlPoints
      ),
      adjustmentContext: {
        originalDistance,
        originalAngle,
        adjustmentVector: { ...adjustmentVector },
        adjustmentMagnitude
      }
    };

    this.storage.preferences.set(key, preference);
    this.storage.lastUpdated = now;
    this.saveToLocalStorage();

    console.log(`📝 记录连线手动调整: ${key}`, preference);
  }

  // 📊 从控制点计算曲率偏好
  private calculateCurvatureFromControlPoints(
    startPos: Position,
    endPos: Position,
    controlPoints: Position[]
  ): number {
    if (controlPoints.length < 2) return 0;

    const distance = Math.sqrt(
      Math.pow(endPos.x - startPos.x, 2) + Math.pow(endPos.y - startPos.y, 2)
    );

    // 计算控制点相对于直线的偏移距离
    const [cp1, cp2] = controlPoints;
    const midPoint = { x: (startPos.x + endPos.x) / 2, y: (startPos.y + endPos.y) / 2 };
    const cp1Distance = Math.sqrt(
      Math.pow(cp1.x - midPoint.x, 2) + Math.pow(cp1.y - midPoint.y, 2)
    );
    const cp2Distance = Math.sqrt(
      Math.pow(cp2.x - midPoint.x, 2) + Math.pow(cp2.y - midPoint.y, 2)
    );

    const avgControlDistance = (cp1Distance + cp2Distance) / 2;
    return Math.min(1.0, avgControlDistance / (distance * 0.5));
  }

  // 🔍 获取连线偏好
  public getConnectionPreference(fromNodeId: string, toNodeId: string): ConnectionPreference | null {
    const key = this.generateConnectionKey(fromNodeId, toNodeId);
    return this.storage.preferences.get(key) || null;
  }

  // ❓ 检查连线是否被手动调整过
  public isManuallyAdjusted(fromNodeId: string, toNodeId: string): boolean {
    const preference = this.getConnectionPreference(fromNodeId, toNodeId);
    return preference?.isManuallyAdjusted || false;
  }

  // 🎯 获取手动调整的控制点
  public getManualControlPoints(fromNodeId: string, toNodeId: string): Position[] | null {
    const preference = this.getConnectionPreference(fromNodeId, toNodeId);
    return preference?.manualControlPoints || null;
  }

  // 🗑️ 重置连线偏好（恢复自动计算）
  public resetConnectionPreference(fromNodeId: string, toNodeId: string): void {
    const key = this.generateConnectionKey(fromNodeId, toNodeId);
    this.storage.preferences.delete(key);
    this.storage.lastUpdated = Date.now();
    this.saveToLocalStorage();

    console.log(`🗑️ 重置连线偏好: ${key}`);
  }

  // 🧹 清理过期偏好（超过30天未使用）
  public cleanupExpiredPreferences(maxAgeMs: number = 30 * 24 * 60 * 60 * 1000): void {
    const now = Date.now();
    const keysToDelete: string[] = [];

    for (const [key, preference] of this.storage.preferences) {
      if (now - preference.manualAdjustmentTimestamp > maxAgeMs) {
        keysToDelete.push(key);
      }
    }

    keysToDelete.forEach(key => {
      this.storage.preferences.delete(key);
    });

    if (keysToDelete.length > 0) {
      this.storage.lastUpdated = now;
      this.saveToLocalStorage();
      console.log(`🧹 清理了 ${keysToDelete.length} 个过期的连线偏好`);
    }
  }

  // 📈 获取用户调整统计
  public getAdjustmentStats(): {
    totalAdjustments: number;
    averageCurvature: number;
    preferredCurveType: 'straight' | 'bezier';
    mostActiveConnections: Array<{ key: string; adjustments: number }>;
  } {
    const preferences = Array.from(this.storage.preferences.values());
    const totalAdjustments = preferences.length;

    if (totalAdjustments === 0) {
      return {
        totalAdjustments: 0,
        averageCurvature: 0,
        preferredCurveType: 'straight',
        mostActiveConnections: []
      };
    }

    // 计算平均曲率
    const totalCurvature = preferences.reduce((sum, pref) =>
      sum + (pref.curvaturePreference || 0), 0);
    const averageCurvature = totalCurvature / totalAdjustments;

    // 统计偏好的曲线类型
    const bezierCount = preferences.filter(p => p.preferredCurveType === 'bezier').length;
    const straightCount = preferences.filter(p => p.preferredCurveType === 'straight').length;
    const preferredCurveType = bezierCount > straightCount ? 'bezier' : 'straight';

    // 最活跃的连线（按调整频率）
    const connectionActivity = new Map<string, number>();
    preferences.forEach(pref => {
      const key = this.generateConnectionKey(pref.fromNodeId, pref.toNodeId);
      connectionActivity.set(key, (connectionActivity.get(key) || 0) + 1);
    });

    const mostActiveConnections = Array.from(connectionActivity.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([key, adjustments]) => ({ key, adjustments }));

    return {
      totalAdjustments,
      averageCurvature,
      preferredCurveType,
      mostActiveConnections
    };
  }

  // 🎨 应用智能建议（基于历史偏好）
  public getSmartSuggestion(
    fromNodeId: string,
    toNodeId: string,
    autoControlPoints: Position[]
  ): Position[] {
    const preference = this.getConnectionPreference(fromNodeId, toNodeId);

    if (preference?.isManuallyAdjusted && preference.manualControlPoints) {
      // 优先使用手动调整的控制点
      return preference.manualControlPoints;
    }

    // 基于用户的历史偏好调整自动计算的控制点
    const stats = this.getAdjustmentStats();
    if (stats.totalAdjustments > 0 && stats.averageCurvature > 0) {
      // 应用用户的平均曲率偏好
      const adjustmentFactor = stats.averageCurvature;
      return autoControlPoints.map((cp, index) => ({
        x: cp.x + (cp.x > 0 ? 1 : -1) * adjustmentFactor * 20,
        y: cp.y + (cp.y > 0 ? 1 : -1) * adjustmentFactor * 20
      }));
    }

    return autoControlPoints;
  }
}

// 🌐 单例实例
export const connectionPreferenceManager = new ConnectionPreferenceManager();
