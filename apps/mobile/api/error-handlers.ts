// Error handling utilities for API operations
import { errorLog } from '@/utils/logger';

export const handleApiError = (error: any, context: { operation: string; resource: string }) => {
  errorLog(`Error in ${context.operation} for ${context.resource}:`, error);
};
