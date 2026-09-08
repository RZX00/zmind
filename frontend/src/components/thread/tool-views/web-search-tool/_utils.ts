import { extractToolData, extractSearchQuery, extractSearchResults } from '../utils';

export interface WebSearchData {
  query: string | null;
  results: Array<{ title: string; url: string; snippet?: string }>;
  answer: string | null;
  images: string[];
  success?: boolean;
  timestamp?: string;
}

const parseContent = (content: any): any => {
  if (typeof content === 'string') {
    try {
      return JSON.parse(content);
    } catch (e) {
      return content; 
    }
  }
  return content;
};

const extractFromNewFormat = (content: any): WebSearchData => {
  const parsedContent = parseContent(content);
  
  if (!parsedContent || typeof parsedContent !== 'object') {
    return { query: null, results: [], answer: null, images: [], success: undefined, timestamp: undefined };
  }

  if ('tool_execution' in parsedContent && typeof parsedContent.tool_execution === 'object') {
    const toolExecution = parsedContent.tool_execution;
    const args = toolExecution.arguments || {};
    
    let parsedOutput = toolExecution.result?.output;
    if (typeof parsedOutput === 'string') {
      try {
        parsedOutput = JSON.parse(parsedOutput);
      } catch (e) {
      }
    }
    parsedOutput = parsedOutput || {};
    const dataBlock = (parsedOutput && typeof parsedOutput === 'object' && parsedOutput.data && typeof parsedOutput.data === 'object')
      ? parsedOutput.data
      : undefined;

    // Handle both single and batch image search responses
    let images: string[] = [];
    let query =
      args.query ||
      dataBlock?.search_query ||
      dataBlock?.query ||
      parsedOutput?.query ||
      null;
    
    const sourceResults = (dataBlock?.results || parsedOutput?.results) as any;
    const sourceBatch = dataBlock?.batch_results || parsedOutput?.batch_results;

    if (sourceBatch && Array.isArray(sourceBatch)) {
      // Batch response: flatten all images from all queries
      images = sourceBatch.reduce((acc: string[], result: any) => {
        return acc.concat(result.images || []);
      }, []);
      
      // Create combined query string for display
      const queries = sourceBatch.map((r: any) => r.query).filter(Boolean);
      if (queries.length > 0) {
        query = queries.length > 1 ? `${queries.length} queries: ${queries.join(', ')}` : queries[0];
      }
    } else {
      // Single response
      images = (dataBlock?.images || parsedOutput?.images || []) as string[];
    }

    const effectiveResults = Array.isArray(sourceResults) ? sourceResults : [];

    const extractedData = {
      query,
      results: effectiveResults.map((result: any) => ({
        title: result.title || '',
        url: result.url || '',
        snippet: result.content || result.snippet || result.description || result.summary || ''
      })),
      answer: (dataBlock?.answer || parsedOutput?.answer || null) as string | null,
      images,
      success: toolExecution.result?.success ?? (typeof parsedOutput?.success === 'boolean' ? parsedOutput.success : undefined),
      timestamp: toolExecution.execution_details?.timestamp || (typeof parsedOutput?.timestamp === 'string' ? parsedOutput.timestamp : undefined)
    };
    return extractedData;
  }

  if ('role' in parsedContent && 'content' in parsedContent) {
    return extractFromNewFormat(parsedContent.content);
  }

  return { query: null, results: [], answer: null, images: [], success: undefined, timestamp: undefined };
};


const extractFromLegacyFormat = (content: any): Omit<WebSearchData, 'success' | 'timestamp'> => {
  const toolData = extractToolData(content);
  
  if (toolData.toolResult) {
    const args = toolData.arguments || {};
    return {
      query: toolData.query || args.query || null,
      results: [], 
      answer: null,
      images: []
    };
  }

  const legacyQuery = extractSearchQuery(content);
  
  return {
    query: legacyQuery,
    results: [],
    answer: null,
    images: []
  };
};

export function extractWebSearchData(
  assistantContent: any,
  toolContent: any,
  isSuccess: boolean,
  toolTimestamp?: string,
  assistantTimestamp?: string
): {
  query: string | null;
  searchResults: Array<{ title: string; url: string; snippet?: string }>;
  answer: string | null;
  images: string[];
  actualIsSuccess: boolean;
  actualToolTimestamp?: string;
  actualAssistantTimestamp?: string;
} {
  let query: string | null = null;
  let searchResults: Array<{ title: string; url: string; snippet?: string }> = [];
  let answer: string | null = null;
  let images: string[] = [];
  let actualIsSuccess = isSuccess;
  let actualToolTimestamp = toolTimestamp;
  let actualAssistantTimestamp = assistantTimestamp;

  const assistantNewFormat = extractFromNewFormat(assistantContent);
  const toolNewFormat = extractFromNewFormat(toolContent);

  if (assistantNewFormat.query || assistantNewFormat.results.length > 0) {
    query = assistantNewFormat.query;
    searchResults = assistantNewFormat.results;
    answer = assistantNewFormat.answer;
    images = assistantNewFormat.images;
    if (assistantNewFormat.success !== undefined) {
      actualIsSuccess = assistantNewFormat.success;
    }
    if (assistantNewFormat.timestamp) {
      actualAssistantTimestamp = assistantNewFormat.timestamp;
    }
  } else if (toolNewFormat.query || toolNewFormat.results.length > 0) {
    query = toolNewFormat.query;
    searchResults = toolNewFormat.results;
    answer = toolNewFormat.answer;
    images = toolNewFormat.images;
    if (toolNewFormat.success !== undefined) {
      actualIsSuccess = toolNewFormat.success;
    }
    if (toolNewFormat.timestamp) {
      actualToolTimestamp = toolNewFormat.timestamp;
    }
  } else {
    const assistantLegacy = extractFromLegacyFormat(assistantContent);
    const toolLegacy = extractFromLegacyFormat(toolContent);

    query = assistantLegacy.query || toolLegacy.query;
    
    const legacyResults = extractSearchResults(toolContent);
    searchResults = legacyResults;
    
    if (toolContent) {
      try {
        let parsedContent;
        if (typeof toolContent === 'string') {
          parsedContent = JSON.parse(toolContent);
        } else if (typeof toolContent === 'object' && toolContent !== null) {
          parsedContent = toolContent;
        } else {
          parsedContent = {};
        }

        if (parsedContent.answer && typeof parsedContent.answer === 'string') {
          answer = parsedContent.answer;
        }
        
        // Handle both single and batch image responses in legacy format
        if (parsedContent.batch_results && Array.isArray(parsedContent.batch_results)) {
          // Batch response: flatten all images from all queries
          images = parsedContent.batch_results.reduce((acc: string[], result: any) => {
            return acc.concat(result.images || []);
          }, []);
        } else if (parsedContent.images && Array.isArray(parsedContent.images)) {
          images = parsedContent.images;
        }
      } catch (e) {
      }
    }
  }

  if (!query) {
    query = extractSearchQuery(assistantContent) || extractSearchQuery(toolContent);
  }
  
  if (searchResults.length === 0) {
    const fallbackResults = extractSearchResults(toolContent);
    searchResults = fallbackResults;
  }

  return {
    query,
    searchResults,
    answer,
    images,
    actualIsSuccess,
    actualToolTimestamp,
    actualAssistantTimestamp
  };
} 
