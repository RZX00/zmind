// Main component
export { IntelligentResultDisplay } from './IntelligentResultDisplay';

// Types
export type {
  IntelligentResultData,
  IntelligentResultSection,
  IntelligentResultAction,
  IntelligentResultMetrics,
  IntelligentResultMetadata,
  ResultType,
  ResultStatus,
  SectionType,
  ActionType,
  SectionPriority,
  SearchResultData,
  AnalyticsResultData,
  DocumentResultData,
  ImageResultData,
  ChartData,
  TableData,
  ListData,
  ImageData,
} from './types';

// Utilities
export {
  getResultTypeIcon,
  getSectionTypeIcon,
  getResultTypeLabel,
  formatProcessingTime,
  formatFileSize,
  formatCount,
  generateId,
  createSearchResult,
  createAnalyticsResult,
  createDocumentResult,
  createImageResult,
  convertToolResponseToResult,
  validateResultData,
  sortSections,
  extractMetrics,
} from './utils';