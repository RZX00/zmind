// ⏱️ 内容时长分析器（简化但等价行为）
// 按类型、文本量与复杂度估算节点停留时长，并支持阅读速度配置。

import type { CanvasNode } from '../../../../types/canvas';

export interface ReadingProfile {
  readingSpeed: 'slow' | 'normal' | 'fast';
  technicalBackground: 'beginner' | 'intermediate' | 'expert';
  preferredPace: 'relaxed' | 'moderate' | 'rushed';
  customSettings: {
    textSpeedMultiplier: number;
    codeSpeedMultiplier: number;
    tableSpeedMultiplier: number;
    pauseBetweenNodes: number; // ms
  };
}

interface TimingRules {
  baseTime: Record<CanvasNode['type'], number> & { column: number };
  contentFactors: {
    wordsPerSecond: number;
    codeBaseLinesPerSecond: number;
    tableCellsPerSecond: number;
  };
  complexityMultipliers: {
    simple: number; medium: number; complex: number; extreme: number;
  };
  limits: {
    minNodeTime: number;
    maxNodeTime: number;
    maxTotalTime: number;
  };
}

export interface ContentAnalysis {
  recommendedDuration: number;
}

class ContentTimingAnalyzer {
  private static inst: ContentTimingAnalyzer;
  static getInstance() { return this.inst ?? (this.inst = new ContentTimingAnalyzer()); }

  private profile: ReadingProfile;
  private rules: TimingRules;
  private memo = new Map<string, ContentAnalysis>();

  private constructor() {
    this.profile = this.getDefaultProfile();
    this.rules = this.getDefaultRules();
  }

  private getDefaultProfile(): ReadingProfile {
    return {
      readingSpeed: 'normal',
      technicalBackground: 'intermediate',
      preferredPace: 'moderate',
      customSettings: {
        textSpeedMultiplier: 1.0,
        codeSpeedMultiplier: 1.5,
        tableSpeedMultiplier: 1.2,
        pauseBetweenNodes: 500,
      },
    };
  }

  private getDefaultRules(): TimingRules {
    return {
      baseTime: {
        text: 2000, code: 4000, table: 3000, column: 1500,
        'canvas-link': 1200, todo: 1000, media: 1500, group: 1200,
      },
      contentFactors: { wordsPerSecond: 3, codeBaseLinesPerSecond: 1.5, tableCellsPerSecond: 2 },
      complexityMultipliers: { simple: 0.8, medium: 1.0, complex: 1.4, extreme: 2.0 },
      limits: { minNodeTime: 1000, maxNodeTime: 15000, maxTotalTime: 600000 },
    };
  }

  getProfile() { return this.profile; }

  updateProfile(partial: Partial<ReadingProfile>) {
    this.profile = { ...this.profile, ...partial, customSettings: { ...this.profile.customSettings, ...(partial.customSettings || {}) } };
    this.memo.clear();
  }

  analyze(node: CanvasNode): ContentAnalysis {
    const key = `${node.id}:${(node.content || '').length}:${node.type}`;
    const cached = this.memo.get(key); if (cached) return cached;
    const base = this.rules.baseTime[node.type] ?? 1500;
    const content = node.content || '';
    const lines = content.split('\n').length;
    const zhChars = (content.match(/[\u4e00-\u9fff]/g) || []).length;
    const enWords = (content.match(/[a-zA-Z]+/g) || []).length;
    const wordCount = zhChars + enWords;
    // 简化复杂度：按词数与行数归一
    let complexity: keyof TimingRules['complexityMultipliers'] = 'medium';
    if (wordCount > 200 || lines > 30) complexity = 'complex';
    else if (wordCount < 30 && lines < 5) complexity = 'simple';

    // 内容量换算
    let extra = 0;
    if (node.type === 'text' || node.type === 'todo' || node.type === 'canvas-link') {
      extra = (wordCount / this.rules.contentFactors.wordsPerSecond) * 1000 * this.profile.customSettings.textSpeedMultiplier;
    } else if (node.type === 'code') {
      const codeLines = Math.max(lines, 1);
      extra = (codeLines / this.rules.contentFactors.codeBaseLinesPerSecond) * 1000 * this.profile.customSettings.codeSpeedMultiplier;
    } else if (node.type === 'table') {
      // 粗略估计：行×列，若无结构就用行*3
      const rows = (content.match(/\n/g) || []).length + 1;
      const cells = rows * 3;
      extra = (cells / this.rules.contentFactors.tableCellsPerSecond) * 1000 * this.profile.customSettings.tableSpeedMultiplier;
    } else {
      extra = 0.3 * base;
    }

    const multiplier = this.rules.complexityMultipliers[complexity] || 1.0;
    let recommended = base * multiplier + extra;
    recommended = Math.max(this.rules.limits.minNodeTime, Math.min(this.rules.limits.maxNodeTime, recommended));
    const res = { recommendedDuration: Math.round(recommended) } as ContentAnalysis;
    this.memo.set(key, res);
    return res;
  }
}

export const contentTimingAnalyzer = ContentTimingAnalyzer.getInstance();

