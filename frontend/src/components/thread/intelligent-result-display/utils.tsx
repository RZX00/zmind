import React from 'react';
import {
  Brain,
  BarChart3,
  FileOutput,
  Image as ImageIcon,
  Search,
  List,
  Table,
  Code,
  FileJson,
  TrendingUp,
  Activity,
  Target,
  Zap,
  Clock,
  Star,
  Globe,
  Users,
  MapPin,
  Calendar,
  Tag,
  Eye,
  Palette,
  Type,
  Layers,
} from 'lucide-react';

import {
  IntelligentResultData,
  IntelligentResultSection,
  ResultType,
  SectionType,
  SearchResultData,
  AnalyticsResultData,
  DocumentResultData,
  ImageResultData,
} from './types';

/**
 * Utility functions for the Intelligent Result Display system
 */

// Get appropriate icon for result type
export function getResultTypeIcon(type: ResultType): React.ReactNode {
  switch (type) {
    case 'search':
      return <Brain className="h-4 w-4" />;
    case 'analytics':
      return <BarChart3 className="h-4 w-4" />;
    case 'document':
      return <FileOutput className="h-4 w-4" />;
    case 'image':
      return <ImageIcon className="h-4 w-4" />;
    default:
      return <Zap className="h-4 w-4" />;
  }
}

// Get appropriate icon for section type
export function getSectionTypeIcon(type: SectionType): React.ReactNode {
  switch (type) {
    case 'text':
      return <Type className="h-4 w-4" />;
    case 'list':
      return <List className="h-4 w-4" />;
    case 'table':
      return <Table className="h-4 w-4" />;
    case 'chart':
      return <TrendingUp className="h-4 w-4" />;
    case 'image':
      return <ImageIcon className="h-4 w-4" />;
    case 'code':
      return <Code className="h-4 w-4" />;
    case 'json':
      return <FileJson className="h-4 w-4" />;
    case 'metrics':
      return <Activity className="h-4 w-4" />;
    default:
      return <Layers className="h-4 w-4" />;
  }
}

// Get human-readable label for result type
export function getResultTypeLabel(type: ResultType): string {
  switch (type) {
    case 'search':
      return 'Intelligent Search';
    case 'analytics':
      return 'Data Analytics';
    case 'document':
      return 'Document Service';
    case 'image':
      return 'Image Analysis';
    default:
      return 'Cloud Service';
  }
}

// Format processing time
export function formatProcessingTime(milliseconds: number): string {
  if (milliseconds < 1000) {
    return `${Math.round(milliseconds)}ms`;
  } else if (milliseconds < 60000) {
    return `${(milliseconds / 1000).toFixed(1)}s`;
  } else {
    const minutes = Math.floor(milliseconds / 60000);
    const seconds = Math.round((milliseconds % 60000) / 1000);
    return `${minutes}m ${seconds}s`;
  }
}

// Format file size
export function formatFileSize(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let size = bytes;
  let unitIndex = 0;

  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex++;
  }

  return `${size.toFixed(1)} ${units[unitIndex]}`;
}

// Format numbers with appropriate units
export function formatCount(count: number): string {
  if (count < 1000) {
    return count.toString();
  } else if (count < 1000000) {
    return `${(count / 1000).toFixed(1)}K`;
  } else if (count < 1000000000) {
    return `${(count / 1000000).toFixed(1)}M`;
  } else {
    return `${(count / 1000000000).toFixed(1)}B`;
  }
}

// Generate unique ID
export function generateId(): string {
  return Math.random().toString(36).substr(2, 9);
}

// Create a search result from tool response
export function createSearchResult(toolResponse: any): SearchResultData {
  const timestamp = new Date().toISOString();

  return {
    type: 'search',
    title: 'Intelligent Search Results',
    subtitle: `Found ${toolResponse.totalResults || 0} results`,
    status: toolResponse.success ? 'success' : 'error',
    timestamp,
    processingTime: toolResponse.processingTime || '0.8s',
    query: toolResponse.query || '',
    totalResults: toolResponse.totalResults || 0,
    sources: toolResponse.sources || 0,
    results: toolResponse.results || [],
    suggestions: toolResponse.suggestions || [],
    insights: toolResponse.insights || {},
    metrics: {
      accuracy: toolResponse.accuracy || 97,
      confidence: toolResponse.confidence || 94,
      speed: toolResponse.processingTime || '0.8s',
      count: toolResponse.totalResults || 0,
    },
    sections: [
      {
        id: 'results',
        title: 'Search Results',
        type: 'list',
        content: toolResponse.results || [],
        icon: <Search className="h-4 w-4" />,
        priority: 'high',
      },
      {
        id: 'insights',
        title: 'AI Insights',
        type: 'text',
        content: generateSearchInsights(toolResponse.insights),
        icon: <Brain className="h-4 w-4" />,
        priority: 'medium',
      },
      {
        id: 'suggestions',
        title: 'Related Searches',
        type: 'list',
        content: toolResponse.suggestions || [],
        icon: <Target className="h-4 w-4" />,
        priority: 'low',
      },
    ],
    metadata: {
      modelUsed: 'GPT-4',
      tokens: toolResponse.tokens || 1200,
      requestId: generateId(),
    },
  };
}

// Create an analytics result from tool response
export function createAnalyticsResult(toolResponse: any): AnalyticsResultData {
  const timestamp = new Date().toISOString();

  return {
    type: 'analytics',
    title: 'Data Analytics Results',
    subtitle: `Analysis of ${toolResponse.dataset || 'dataset'}`,
    status: toolResponse.success ? 'success' : 'error',
    timestamp,
    processingTime: toolResponse.processingTime || '1.2s',
    dataset: toolResponse.dataset || 'Unknown Dataset',
    analysisType: toolResponse.analysisType || 'Statistical Analysis',
    statistics: toolResponse.statistics || {},
    visualizations: toolResponse.visualizations || [],
    insights: toolResponse.insights || {},
    metrics: {
      accuracy: toolResponse.accuracy || 95,
      confidence: toolResponse.confidence || 92,
      speed: toolResponse.processingTime || '1.2s',
      count: toolResponse.dataPoints || 0,
    },
    sections: [
      {
        id: 'summary',
        title: 'Statistical Summary',
        type: 'metrics',
        content: toolResponse.statistics || {},
        icon: <BarChart3 className="h-4 w-4" />,
        priority: 'high',
      },
      {
        id: 'trends',
        title: 'Trend Analysis',
        type: 'text',
        content: generateTrendAnalysis(toolResponse.insights?.trends),
        icon: <TrendingUp className="h-4 w-4" />,
        priority: 'medium',
      },
      {
        id: 'visualizations',
        title: 'Data Visualizations',
        type: 'chart',
        content: toolResponse.visualizations || [],
        icon: <Activity className="h-4 w-4" />,
        priority: 'medium',
      },
    ],
    metadata: {
      modelUsed: 'Analytics Engine v2.0',
      tokens: toolResponse.tokens || 800,
      requestId: generateId(),
    },
  };
}

// Create a document result from tool response
export function createDocumentResult(toolResponse: any): DocumentResultData {
  const timestamp = new Date().toISOString();

  return {
    type: 'document',
    title: 'Document Analysis Results',
    subtitle: `${toolResponse.documentType || 'Document'} - ${toolResponse.wordCount || 0} words`,
    status: toolResponse.success ? 'success' : 'error',
    timestamp,
    processingTime: toolResponse.processingTime || '2.1s',
    documentType: toolResponse.documentType || 'Unknown',
    wordCount: toolResponse.wordCount || 0,
    pageCount: toolResponse.pageCount || 1,
    language: toolResponse.language || 'en',
    readingTime: toolResponse.readingTime || '5 min',
    structure: toolResponse.structure || {},
    content: toolResponse.content || {},
    analysis: toolResponse.analysis || {},
    metrics: {
      quality: toolResponse.analysis?.quality?.overall || 85,
      readability: toolResponse.analysis?.readability || 78,
      speed: toolResponse.processingTime || '2.1s',
      count: toolResponse.wordCount || 0,
    },
    sections: [
      {
        id: 'content',
        title: 'Document Content',
        type: 'text',
        content: toolResponse.content?.text || '',
        icon: <FileOutput className="h-4 w-4" />,
        priority: 'high',
      },
      {
        id: 'analysis',
        title: 'Quality Analysis',
        type: 'metrics',
        content: toolResponse.analysis?.quality || {},
        icon: <Star className="h-4 w-4" />,
        priority: 'medium',
      },
      {
        id: 'structure',
        title: 'Document Structure',
        type: 'list',
        content: generateStructureList(toolResponse.structure),
        icon: <Layers className="h-4 w-4" />,
        priority: 'low',
      },
    ],
    metadata: {
      modelUsed: 'Document AI v3.0',
      tokens: toolResponse.tokens || 1500,
      requestId: generateId(),
    },
  };
}

// Create an image result from tool response
export function createImageResult(toolResponse: any): ImageResultData {
  const timestamp = new Date().toISOString();

  return {
    type: 'image',
    title: 'Image Analysis Results',
    subtitle: `Analyzed ${toolResponse.images?.length || 1} image(s)`,
    status: toolResponse.success ? 'success' : 'error',
    timestamp,
    processingTime: toolResponse.processingTime || '1.5s',
    images: toolResponse.images || [],
    analysis: toolResponse.analysis || {},
    objects: toolResponse.objects || [],
    faces: toolResponse.faces || [],
    text: toolResponse.text || null,
    colors: toolResponse.colors || null,
    metrics: {
      confidence: toolResponse.analysis?.confidence || 91,
      quality: toolResponse.analysis?.quality || 88,
      speed: toolResponse.processingTime || '1.5s',
      count: toolResponse.images?.length || 1,
    },
    sections: [
      {
        id: 'overview',
        title: 'Image Analysis',
        type: 'text',
        content: toolResponse.analysis?.description || 'No description available',
        icon: <ImageIcon className="h-4 w-4" />,
        priority: 'high',
      },
      {
        id: 'objects',
        title: 'Object Detection',
        type: 'list',
        content: (toolResponse.objects || []).map((obj: any) =>
          `${obj.label} (${Math.round(obj.confidence * 100)}% confidence)`
        ),
        icon: <Eye className="h-4 w-4" />,
        priority: 'medium',
      },
      {
        id: 'colors',
        title: 'Color Analysis',
        type: 'text',
        content: generateColorAnalysis(toolResponse.colors),
        icon: <Palette className="h-4 w-4" />,
        priority: 'low',
      },
    ],
    metadata: {
      modelUsed: 'Vision AI v4.0',
      tokens: toolResponse.tokens || 600,
      requestId: generateId(),
    },
  };
}

// Helper function to generate search insights text
function generateSearchInsights(insights: any): string {
  if (!insights) return 'No insights available';

  const parts = [];

  if (insights.topics?.length > 0) {
    parts.push(`Key topics identified: ${insights.topics.join(', ')}`);
  }

  if (insights.sentiment) {
    parts.push(`Overall sentiment: ${insights.sentiment}`);
  }

  if (insights.keyPhrases?.length > 0) {
    parts.push(`Important phrases: ${insights.keyPhrases.join(', ')}`);
  }

  return parts.join('. ') || 'Analysis complete with good coverage across multiple sources.';
}

// Helper function to generate trend analysis text
function generateTrendAnalysis(trends: any[]): string {
  if (!trends || trends.length === 0) return 'No significant trends detected';

  return trends.map(trend =>
    `${trend.description} (${trend.direction} trend, ${trend.strength}% strength)`
  ).join('. ');
}

// Helper function to generate structure list
function generateStructureList(structure: any): string[] {
  if (!structure || !structure.sections) return ['No structure information available'];

  return structure.sections.map((section: any) =>
    `${section.title} (${section.wordCount} words)`
  );
}

// Helper function to generate color analysis text
function generateColorAnalysis(colors: any): string {
  if (!colors) return 'No color analysis available';

  const parts = [];

  if (colors.dominant?.length > 0) {
    parts.push(`Dominant colors: ${colors.dominant.join(', ')}`);
  }

  if (colors.harmony) {
    parts.push(`Color harmony: ${colors.harmony}`);
  }

  return parts.join('. ') || 'Color analysis complete';
}

// Convert tool response to appropriate result type
export function convertToolResponseToResult(toolName: string, toolResponse: any): IntelligentResultData {
  const normalizedToolName = toolName.toLowerCase().replace(/[-_]/g, '');

  if (normalizedToolName.includes('search') || normalizedToolName.includes('intelligentsearch')) {
    return createSearchResult(toolResponse);
  } else if (normalizedToolName.includes('analytics') || normalizedToolName.includes('dataanalytics')) {
    return createAnalyticsResult(toolResponse);
  } else if (normalizedToolName.includes('document') || normalizedToolName.includes('documentservice')) {
    return createDocumentResult(toolResponse);
  } else if (normalizedToolName.includes('image') || normalizedToolName.includes('imageservice')) {
    return createImageResult(toolResponse);
  } else {
    // Generic fallback
    return createGenericResult(toolName, toolResponse);
  }
}

// Create a generic result for unknown tool types
function createGenericResult(toolName: string, toolResponse: any): IntelligentResultData {
  const timestamp = new Date().toISOString();

  return {
    type: 'search', // Default type
    title: `${toolName} Results`,
    subtitle: 'Cloud service execution complete',
    status: toolResponse.success ? 'success' : 'error',
    timestamp,
    processingTime: toolResponse.processingTime || '1.0s',
    metrics: {
      speed: toolResponse.processingTime || '1.0s',
    },
    sections: [
      {
        id: 'output',
        title: 'Tool Output',
        type: 'json',
        content: toolResponse,
        icon: <Code className="h-4 w-4" />,
        priority: 'high',
      },
    ],
    metadata: {
      toolName,
      requestId: generateId(),
    },
  };
}

// Validate result data structure
export function validateResultData(data: any): data is IntelligentResultData {
  return (
    data &&
    typeof data === 'object' &&
    typeof data.type === 'string' &&
    typeof data.title === 'string' &&
    typeof data.status === 'string' &&
    typeof data.timestamp === 'string' &&
    Array.isArray(data.sections)
  );
}

// Sort sections by priority and order
export function sortSections(sections: IntelligentResultSection[]): IntelligentResultSection[] {
  return sections.sort((a, b) => {
    // First sort by priority
    const priorityOrder = { high: 0, medium: 1, low: 2 };
    const aPriority = priorityOrder[a.priority || 'medium'];
    const bPriority = priorityOrder[b.priority || 'medium'];

    if (aPriority !== bPriority) {
      return aPriority - bPriority;
    }

    // Then sort by order if specified
    const aOrder = a.order || 999;
    const bOrder = b.order || 999;

    return aOrder - bOrder;
  });
}

// Extract metrics from result data
export function extractMetrics(data: IntelligentResultData): Record<string, any> {
  const metrics: Record<string, any> = {};

  if (data.metrics) {
    Object.assign(metrics, data.metrics);
  }

  // Add computed metrics
  metrics.sectionsCount = data.sections.length;
  metrics.hasActions = (data.actions?.length || 0) > 0;
  try {
    const d = new Date(data.timestamp);
    metrics.processingDate = new Intl.DateTimeFormat(undefined, {year:'numeric', month:'short', day:'numeric'}).format(d);
  } catch {
    metrics.processingDate = String(data.timestamp);
  }

  return metrics;
}
