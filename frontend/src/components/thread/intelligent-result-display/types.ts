import React from 'react';

export type ResultType = 'search' | 'analytics' | 'document' | 'image';
export type ResultStatus = 'success' | 'warning' | 'error' | 'processing';
export type SectionType = 'text' | 'list' | 'table' | 'chart' | 'image' | 'code' | 'json' | 'metrics';
export type ActionType = 'primary' | 'secondary' | 'danger';
export type SectionPriority = 'high' | 'medium' | 'low';

export interface IntelligentResultMetrics {
  accuracy?: number;
  confidence?: number;
  relevance?: number;
  coverage?: number;
  quality?: number;
  speed?: string;
  count?: number;
  size?: number;
  tokens?: number;
  cost?: number;
  [key: string]: any;
}

export interface IntelligentResultMetadata {
  source?: string;
  version?: string;
  modelUsed?: string;
  tokens?: number;
  cost?: number;
  requestId?: string;
  sessionId?: string;
  userId?: string;
  [key: string]: any;
}

export interface IntelligentResultSection {
  id: string;
  title: string;
  type: SectionType;
  content: any;
  description?: string;
  icon?: React.ReactNode;
  badge?: string;
  priority?: SectionPriority;
  order?: number;
  collapsible?: boolean;
  defaultExpanded?: boolean;
}

export interface IntelligentResultAction {
  id: string;
  label: string;
  icon: React.ReactNode;
  type: ActionType;
  onClick: () => void;
  disabled?: boolean;
  tooltip?: string;
  confirmRequired?: boolean;
  confirmMessage?: string;
}

export interface IntelligentResultData {
  type: ResultType;
  title: string;
  subtitle?: string;
  status: ResultStatus;
  timestamp: string;
  processingTime?: string;
  metrics?: IntelligentResultMetrics;
  sections: IntelligentResultSection[];
  metadata?: IntelligentResultMetadata;
  actions?: IntelligentResultAction[];
  raw?: any; // Original raw data for debugging
}

// Chart data types for analytics results
export interface ChartData {
  type: 'line' | 'bar' | 'pie' | 'scatter' | 'area';
  data: any[];
  xAxis?: string;
  yAxis?: string;
  title?: string;
  description?: string;
  colors?: string[];
}

// Table data types
export interface TableData {
  headers: string[];
  rows: (string | number | boolean)[][];
  sortable?: boolean;
  searchable?: boolean;
  pagination?: boolean;
  pageSize?: number;
}

// List data types
export interface ListData {
  items: ListItem[];
  type?: 'simple' | 'ordered' | 'checklist';
  maxHeight?: number;
  searchable?: boolean;
}

export interface ListItem {
  id?: string;
  content: string;
  checked?: boolean;
  priority?: 'high' | 'medium' | 'low';
  metadata?: Record<string, any>;
}

// Image data types
export interface ImageData {
  url: string;
  alt: string;
  caption?: string;
  thumbnail?: string;
  metadata?: {
    width?: number;
    height?: number;
    size?: number;
    format?: string;
    [key: string]: any;
  };
}

// Search result specific types
export interface SearchResultData extends IntelligentResultData {
  type: 'search';
  query: string;
  totalResults: number;
  sources: number;
  results: SearchResult[];
  suggestions?: string[];
  insights?: SearchInsights;
}

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
  relevance: number;
  timestamp: string;
  source: string;
  domain: string;
  metadata?: Record<string, any>;
}

export interface SearchInsights {
  topics: string[];
  sentiment: 'positive' | 'neutral' | 'negative';
  confidence: number;
  keyPhrases: string[];
  relatedQueries?: string[];
}

// Analytics result specific types
export interface AnalyticsResultData extends IntelligentResultData {
  type: 'analytics';
  dataset: string;
  analysisType: string;
  statistics: StatisticalSummary;
  visualizations: ChartData[];
  insights: AnalyticsInsights;
}

export interface StatisticalSummary {
  count: number;
  mean?: number;
  median?: number;
  mode?: number;
  standardDeviation?: number;
  variance?: number;
  quartiles?: {
    q1: number;
    q2: number;
    q3: number;
  };
  outliers?: number[];
  [key: string]: any;
}

export interface AnalyticsInsights {
  trends: TrendAnalysis[];
  anomalies: AnomalyDetection[];
  predictions?: PredictionResult[];
  correlations?: CorrelationResult[];
  recommendations?: string[];
}

export interface TrendAnalysis {
  direction: 'up' | 'down' | 'stable';
  strength: number;
  description: string;
  timeframe: string;
}

export interface AnomalyDetection {
  value: number;
  expected: number;
  deviation: number;
  timestamp: string;
  severity: 'low' | 'medium' | 'high';
}

export interface PredictionResult {
  timeframe: string;
  predicted: number;
  confidence: number;
  range: {
    min: number;
    max: number;
  };
}

export interface CorrelationResult {
  variables: string[];
  coefficient: number;
  strength: 'weak' | 'moderate' | 'strong';
  significance: number;
}

// Document result specific types
export interface DocumentResultData extends IntelligentResultData {
  type: 'document';
  documentType: string;
  wordCount?: number;
  pageCount?: number;
  language?: string;
  readingTime?: string;
  structure: DocumentStructure;
  content: DocumentContent;
  analysis?: DocumentAnalysis;
}

export interface DocumentStructure {
  sections: DocumentSection[];
  headings: DocumentHeading[];
  outline: OutlineItem[];
}

export interface DocumentSection {
  id: string;
  title: string;
  content: string;
  wordCount: number;
  type: 'introduction' | 'body' | 'conclusion' | 'appendix';
  order: number;
}

export interface DocumentHeading {
  level: number;
  text: string;
  id: string;
  parentId?: string;
}

export interface OutlineItem {
  level: number;
  text: string;
  children?: OutlineItem[];
}

export interface DocumentContent {
  text: string;
  formatted?: string;
  metadata?: Record<string, any>;
}

export interface DocumentAnalysis {
  sentiment: 'positive' | 'neutral' | 'negative';
  readability: number;
  keyTopics: string[];
  entities: NamedEntity[];
  summary: string;
  quality: DocumentQuality;
}

export interface NamedEntity {
  text: string;
  type: 'person' | 'organization' | 'location' | 'date' | 'money' | 'other';
  confidence: number;
}

export interface DocumentQuality {
  clarity: number;
  coherence: number;
  completeness: number;
  accuracy: number;
  overall: number;
}

// Image result specific types
export interface ImageResultData extends IntelligentResultData {
  type: 'image';
  images: ProcessedImage[];
  analysis: ImageAnalysis;
  objects?: ObjectDetection[];
  faces?: FaceDetection[];
  text?: TextExtraction;
  colors?: ColorAnalysis;
}

export interface ProcessedImage {
  id: string;
  url: string;
  thumbnail: string;
  metadata: ImageMetadata;
  analysis: SingleImageAnalysis;
}

export interface ImageMetadata {
  width: number;
  height: number;
  size: number;
  format: string;
  created?: string;
  location?: GeolocationData;
  camera?: CameraData;
}

export interface GeolocationData {
  latitude: number;
  longitude: number;
  altitude?: number;
  accuracy?: number;
}

export interface CameraData {
  make?: string;
  model?: string;
  lens?: string;
  settings?: {
    iso?: number;
    aperture?: number;
    shutterSpeed?: string;
    focalLength?: number;
  };
}

export interface SingleImageAnalysis {
  description: string;
  confidence: number;
  tags: string[];
  quality: number;
  aesthetics?: {
    composition: number;
    lighting: number;
    colorHarmony: number;
    overall: number;
  };
}

export interface ImageAnalysis {
  description: string;
  confidence: number;
  scene: string;
  objects: string[];
  activities: string[];
  emotions?: string[];
  quality: number;
}

export interface ObjectDetection {
  label: string;
  confidence: number;
  boundingBox: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
}

export interface FaceDetection {
  confidence: number;
  boundingBox: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  attributes?: {
    age?: number;
    gender?: string;
    emotion?: string;
    glasses?: boolean;
    beard?: boolean;
  };
}

export interface TextExtraction {
  text: string;
  confidence: number;
  language?: string;
  blocks: TextBlock[];
}

export interface TextBlock {
  text: string;
  confidence: number;
  boundingBox: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
}

export interface ColorAnalysis {
  dominant: string[];
  palette: ColorInfo[];
  harmony: 'monochromatic' | 'analogous' | 'complementary' | 'triadic' | 'tetradic';
}

export interface ColorInfo {
  hex: string;
  rgb: [number, number, number];
  hsl: [number, number, number];
  percentage: number;
  name?: string;
}