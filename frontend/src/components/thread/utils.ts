import type { ElementType } from 'react';
import {
  FileText,
  Terminal,
  ExternalLink,
  FileEdit,
  Search,
  Globe,
  Code,
  MessageSquare,
  Folder,
  FileX,
  CloudUpload,
  Wrench,
  Cog,
  Network,
  FileSearch,
  FilePlus,
  PlugIcon,
  BookOpen,
  MessageCircleQuestion,
  CheckCircle2,
  Table2,
  ListTodo,
  List,
  Computer,
  Brain,
  BarChart3,
  FileOutput,
  Image,
  TrendingUp,
  Building2,
  Users,
  Link2,
  History,
  RotateCcw,
  Clock,
  Info,
  Trash2,
  LayoutGrid,
  PlugZap,
  Briefcase,
  Bot,
} from 'lucide-react';
import type { ParsedMetadata } from '@/components/thread/types';

// Flag to control whether tool result messages are rendered
export const SHOULD_RENDER_TOOL_RESULTS = false;

// Helper function to safely parse JSON strings from content/metadata
export function safeJsonParse<T>(
  jsonString: string | undefined | null,
  fallback: T,
): T {
  if (!jsonString) {
    return fallback;
  }
  
  try {
    // First attempt: Parse as normal JSON
    const parsed = JSON.parse(jsonString);
    
    // Check if the result is a string that looks like JSON (double-escaped case)
    if (typeof parsed === 'string' && 
        (parsed.startsWith('{') || parsed.startsWith('['))) {
      try {
        // Second attempt: Parse the string result as JSON (handles double-escaped)
        return JSON.parse(parsed) as T;
      } catch (innerError) {
        // If inner parse fails, return the first parse result
        return parsed as unknown as T;
      }
    }
    
    return parsed as T;
  } catch (outerError) {
    // If the input is already an object/array (shouldn't happen but just in case)
    if (typeof jsonString === 'object') {
      return jsonString as T;
    }
    
    // Try one more time in case it's a plain string that should be returned as-is
    if (typeof jsonString === 'string') {
      // Check if it's a string representation of a simple value
      if (jsonString === 'true') return true as unknown as T;
      if (jsonString === 'false') return false as unknown as T;
      if (jsonString === 'null') return null as unknown as T;
      if (!isNaN(Number(jsonString))) return Number(jsonString) as unknown as T;
      
      // Return as string if it doesn't look like JSON
      if (!jsonString.startsWith('{') && !jsonString.startsWith('[')) {
        return jsonString as unknown as T;
      }
    }
    
    // console.warn('Failed to parse JSON string:', jsonString, outerError); // Optional: log errors
    return fallback;
  }
}

// Helper function to get an icon based on tool name
export const getToolIcon = (toolName: string): ElementType => {
  const rawName = toolName || '';
  const rawLower = rawName.toLowerCase();
  const normalized = rawLower.replace(/_/g, '-');
  if (normalized.startsWith('transfer-to-')) {
    const suffix = normalized.replace('transfer-to-', '').replace(/-+/g, '-').trim();
    switch (suffix) {
      case 'canvas-agent':
        return LayoutGrid;
      case 'presentation-agent':
        return FileOutput;
      case 'research-graph-agent':
        return Network;
      case 'research-agent':
        return BookOpen;
      case 'integration-agent':
        return PlugZap;
      default:
        return Bot;
    }
  }
  switch (normalized) {

    // Web operations
    case 'web-search':
      return Search;
    case 'intelligent-web-search':
    case 'intelligent-search':
      return Brain;
    case 'crawl-webpage':
      return Globe;
    case 'scrape-webpage':
      return Globe;
    case 'extract-web-content':
      return Globe;
    case 'web-browser-takeover':
      return Computer;

    // Cloud service tools
    case 'data-analytics':
      return BarChart3;
    case 'document-service':
      return FileOutput;
    case 'image-service':
      return Image;
    case 'image-search':
    case 'search-images':
      return Image;
    case 'analyze-image-content':
      return FileSearch;

    // API and data operations
    case 'call-data-provider':
      return ExternalLink;
    case 'get-data-provider-endpoints':
      return Network;
    case 'execute-data-provider-call':
      return Network;
    case 'company-search':
      return Building2;
    case 'people-search':
      return Users;

    // Sheets tools
    case 'create-sheet':
    case 'update-sheet':
    case 'view-sheet':
    case 'analyze-sheet':
    case 'visualize-sheet':
    case 'format-sheet':
      return Table2;

    // Code operations
    case 'delete-file':
      return FileX;
    case 'upload-file':
      return CloudUpload;
    case 'analyze-document':
      return FileSearch;
    case 'generate-document':
      return FileText;
    case 'analyze-data':
      return BarChart3;
    case 'generate-insights':
      return TrendingUp;

    // Deployment
    case 'deploy-site':
      return CloudUpload;

    // Tools and utilities
    case 'execute-code':
      return Code;
    case 'expand-message':
      return MessageSquare;
    case 'inform':
      return Info;
    case 'wait':
      return Clock;

    // User interaction
    case 'ask':
      return MessageCircleQuestion;

    // Task completion
    case 'complete':
      return CheckCircle2;
    case 'cta':
      return CheckCircle2;

    // Task list tools
    case 'view-tasks':
      return ListTodo;
    case 'create-tasks':
      return FilePlus;
    case 'update-tasks':
      return FileEdit;
    case 'delete-tasks':
      return FileX;
    case 'clear-all':
      return Trash2;

    // Knowledge base tools
    case 'kb-list-folders':
      return Folder;
    case 'kb-list-entries':
      return List;
    case 'kb-get-entry-text':
      return FileText;
    case 'kb-overview':
      return BookOpen;
    case 'kb-search':
      return Search;
    case 'kb-summarize-entry':
      return FileSearch;

    // Canvas tools
    case 'canvas-list':
      return List;
    case 'canvas-read':
    case 'canvas-read-current':
      return FileText;
    case 'canvas-create-node':
      return FilePlus;
    case 'canvas-update-node':
    case 'canvas-update-canvas':
    case 'canvas-edit':
      return FileEdit;
    case 'canvas-create-connection':
      return Link2;
    case 'canvas-list-versions':
      return History;
    case 'canvas-restore-version':
      return RotateCcw;
    case 'canvas-delete-version':
      return FileX;
    case 'canvas-generate-media':
      return Image;

    // Miscellaneous helpers
    case 'load-image':
      return Image;

    default:
      if (rawLower.startsWith('mcp_')) {
        const parts = rawLower.split('_');
        if (parts.length >= 3) {
          const serverName = parts[1];
          const toolNamePart = parts.slice(2).join('_');
          
          // Map specific MCP tools to appropriate icons
          if (toolNamePart.includes('search') || toolNamePart.includes('web')) {
            return Search;
          } else if (toolNamePart.includes('research') || toolNamePart.includes('paper')) {
            return BookOpen;
          } else if (serverName === 'exa') {
            return Search; // Exa is primarily a search service
          }
        }
        return PlugIcon; // Default icon for MCP tools
      }
      
      // Add logging for debugging unhandled tool types
      return Wrench; // Default icon for tools
  }
};

export const isStreamingChunkMeta = (
  meta?: ParsedMetadata | null,
): boolean => {
  if (!meta) return false;
  if (meta.streaming === true) return true;
  const status = typeof meta.stream_status === 'string'
    ? meta.stream_status.toLowerCase()
    : undefined;
  return status === 'chunk';
};

export const isFinalAssistantMeta = (
  meta?: ParsedMetadata | null,
): boolean => {
  if (!meta) return false;
  if (meta.stream_fallback) return true;
  if (meta.stream_final) return true;
  const status = typeof meta.stream_status === 'string'
    ? meta.stream_status.toLowerCase()
    : undefined;
  if (status === 'complete') return true;
  if (typeof meta.final_status === 'string') return true;
  // The PERSISTED (server) final assistant message carries run_status (e.g. "completed"),
  // not stream_status — recognise it so server/stream reconciliation keeps the final reply
  // (otherwise the streamed message is dropped on sync and the reply "disappears").
  const runStatus = typeof meta.run_status === 'string'
    ? meta.run_status.toLowerCase()
    : undefined;
  if (runStatus === 'completed' || runStatus === 'failed' || runStatus === 'stopped') return true;
  return false;
};

// Helper function to extract a primary parameter from XML/arguments
export const extractPrimaryParam = (
  toolName: string,
  content: string | undefined,
): string | null => {
  if (!content) return null;

  try {
    // Browser tools have been removed in cloud transformation

    // Special handling for XML content - extract file_path from the actual attributes
    if (content.startsWith('<') && content.includes('>')) {
      const xmlAttrs = content.match(/<[^>]+\s+([^>]+)>/);
      if (xmlAttrs && xmlAttrs[1]) {
        const attrs = xmlAttrs[1].trim();
        const filePathMatch = attrs.match(/file_path=["']([^"']+)["']/);
        if (filePathMatch) {
          return filePathMatch[1].split('/').pop() || filePathMatch[1];
        }

        // Try to get command for execute-command
        if (toolName?.toLowerCase() === 'execute-command') {
          const commandMatch = attrs.match(/(?:command|cmd)=["']([^"']+)["']/);
          if (commandMatch) {
            const cmd = commandMatch[1];
            return cmd.length > 30 ? cmd.substring(0, 27) + '...' : cmd;
          }
        }
      }
    }

    // Simple regex for common parameters - adjust as needed
    let match: RegExpMatchArray | null = null;

    switch (toolName?.toLowerCase()) {
      // File operations
      case 'create-file':
      case 'full-file-rewrite':
      case 'read-file':
      case 'delete-file':
      // File operations and shell commands have been removed in cloud transformation

      // Web search
      case 'web-search':
      case 'image-search':
        match = content.match(/query=(?:"|')([^"|']+)(?:"|')/);
        return match
          ? match[1].length > 30
            ? match[1].substring(0, 27) + '...'
            : match[1]
          : null;

      // Data provider operations
      case 'call-data-provider':
        match = content.match(/service_name=(?:"|')([^"|']+)(?:"|')/);
        const route = content.match(/route=(?:"|')([^"|']+)(?:"|')/);
        return match && route
          ? `${match[1]}/${route[1]}`
          : match
            ? match[1]
            : null;

      // Deployment tools have been removed in cloud transformation
    }

    return null;
  } catch (e) {
    console.warn('Error parsing tool parameters:', e);
    return null;
  }
};

const TOOL_DISPLAY_NAMES_EN = new Map([
  // Web and search
  ['web-search', 'Searching the web'],
  ['intelligent-web-search', 'Smart web search'],
  ['intelligent-search', 'Smart web search'],
  ['crawl-webpage', 'Exploring a website'],
  ['scrape-webpage', 'Getting website content'],
  ['extract-web-content', 'Extracting website content'],
  ['web-browser-takeover', 'Browser control'],
  ['image-search', 'Searching images'],
  ['search-images', 'Searching images'],
  ['analyze-image-content', 'Analyzing image'],
  ['load-image', 'Loading image'],

  // Data and analytics
  ['analyze-data', 'Analyzing data'],
  ['generate-insights', 'Generating insights'],
  ['data-analytics', 'Analyzing data'],

  // Documents and files
  ['generate-document', 'Generating document'],
  ['analyze-document', 'Analyzing document'],
  ['upload-file', 'Uploading file'],
  ['document-service', 'Document service'],
  ['image-service', 'Image service'],

  // Data provider tools
  ['call-data-provider', 'Calling data provider'],
  ['get-data-provider-endpoints', 'Loading endpoints'],
  ['execute-data-provider-call', 'Calling data provider'],
  ['execute-data-provider-endpoint', 'Calling data provider'],

  // Knowledge base tools
  ['kb-list-folders', 'Listing knowledge folders'],
  ['kb-list-entries', 'Listing knowledge entries'],
  ['kb-get-entry-text', 'Opening knowledge entry'],
  ['kb-overview', 'Knowledge base overview'],
  ['kb-search', 'Searching knowledge base'],
  ['kb-summarize-entry', 'Summarizing entry'],

  // Canvas tools
  ['canvas-list', 'Listing canvases'],
  ['canvas-read', 'Loading canvas'],
  ['canvas-read-current', 'Loading current canvas'],
  ['canvas-create-node', 'Adding canvas item'],
  ['canvas-update-node', 'Updating canvas item'],
  ['canvas-create-connection', 'Connecting items'],
  ['canvas-update-canvas', 'Updating canvas'],
  ['canvas-edit', 'Editing canvas'],
  ['canvas-list-versions', 'Listing canvas versions'],
  ['canvas-restore-version', 'Restoring canvas version'],
  ['canvas-delete-version', 'Deleting canvas version'],
  ['canvas-generate-media', 'Generating canvas media'],

  // Task tools
  ['view-tasks', 'Viewing tasks'],
  ['create-tasks', 'Creating tasks'],
  ['update-tasks', 'Updating tasks'],
  ['delete-tasks', 'Deleting tasks'],
  ['clear-all', 'Clearing tasks'],

  // People and company
  ['company-search', 'Company search'],
  ['people-search', 'People search'],

  // Core tools
  ['ask', 'Ask'],
  ['wait', 'Wait'],
  ['complete', 'Done'],
  ['expand-message', 'Expanding message'],
  ['inform', 'Sharing update'],

  // MCP and agent management tools
  ['update-agent', 'Updating agent'],
  ['get-current-agent-config', 'Getting agent config'],
  ['search-mcp-servers', 'Searching MCP servers'],
  ['get-mcp-server-tools', 'Getting MCP server tools'],
  ['configure-mcp-server', 'Configuring MCP server'],
  ['get-popular-mcp-servers', 'Getting popular MCP servers'],
  ['test-mcp-server-connection', 'Testing MCP server connection'],

  ['get-project-structure', 'Getting project structure'],
  ['build-project', 'Building project'],

  ['create-new-agent', 'Creating new agent'],
  ['search-mcp-servers-for-agent', 'Searching MCP servers'],
  ['create-credential-profile-for-agent', 'Creating credential profile'],
  ['discover-mcp-tools-for-agent', 'Discovering MCP tools'],
  ['configure-agent-integration', 'Configuring agent integration'],
  // Workflows/Triggers removed
]);

const TOOL_DISPLAY_NAMES_ZH = new Map([
  // Web and search
  ['web-search', '网页搜索'],
  ['intelligent-web-search', '智能网页搜索'],
  ['intelligent-search', '智能网页搜索'],
  ['crawl-webpage', '浏览网站'],
  ['scrape-webpage', '抓取网页内容'],
  ['extract-web-content', '提取网页内容'],
  ['web-browser-takeover', '浏览器控制'],
  ['image-search', '搜索图片'],
  ['search-images', '搜索图片'],
  ['analyze-image-content', '分析图片'],
  ['load-image', '加载图片'],

  // Data and analytics
  ['analyze-data', '分析数据'],
  ['generate-insights', '生成洞察'],
  ['data-analytics', '分析数据'],

  // Documents and files
  ['generate-document', '生成文档'],
  ['analyze-document', '分析文档'],
  ['upload-file', '上传文件'],
  ['document-service', '文档服务'],
  ['image-service', '图片服务'],

  // Data provider tools
  ['call-data-provider', '调用数据源'],
  ['get-data-provider-endpoints', '加载接口'],
  ['execute-data-provider-call', '调用数据源'],
  ['execute-data-provider-endpoint', '调用数据源'],

  // Knowledge base tools
  ['kb-list-folders', '列出知识库文件夹'],
  ['kb-list-entries', '列出知识库条目'],
  ['kb-get-entry-text', '打开知识条目'],
  ['kb-overview', '知识库概览'],
  ['kb-search', '搜索知识库'],
  ['kb-summarize-entry', '总结条目'],

  // Canvas tools
  ['canvas-list', '列出画布'],
  ['canvas-read', '加载画布'],
  ['canvas-read-current', '加载当前画布'],
  ['canvas-create-node', '添加画布项'],
  ['canvas-update-node', '更新画布项'],
  ['canvas-create-connection', '连接画布项'],
  ['canvas-update-canvas', '更新画布'],
  ['canvas-edit', '编辑画布'],
  ['canvas-list-versions', '列出画布版本'],
  ['canvas-restore-version', '恢复画布版本'],
  ['canvas-delete-version', '删除画布版本'],
  ['canvas-generate-media', '生成画布素材'],

  // Task tools
  ['view-tasks', '查看任务'],
  ['create-tasks', '创建任务'],
  ['update-tasks', '更新任务'],
  ['delete-tasks', '删除任务'],
  ['clear-all', '清空任务'],

  // People and company
  ['company-search', '公司搜索'],
  ['people-search', '人员搜索'],

  // Core tools
  ['ask', '提问'],
  ['wait', '等待'],
  ['complete', '完成'],
  ['expand-message', '展开消息'],
  ['inform', '更新说明'],

  // MCP and agent management tools
  ['update-agent', '更新代理'],
  ['get-current-agent-config', '获取代理配置'],
  ['search-mcp-servers', '搜索 MCP 服务器'],
  ['get-mcp-server-tools', '获取 MCP 工具'],
  ['configure-mcp-server', '配置 MCP 服务器'],
  ['get-popular-mcp-servers', '获取热门 MCP 服务器'],
  ['test-mcp-server-connection', '测试 MCP 连接'],

  ['get-project-structure', '获取项目结构'],
  ['build-project', '构建项目'],

  ['create-new-agent', '创建新代理'],
  ['search-mcp-servers-for-agent', '搜索 MCP 服务器'],
  ['create-credential-profile-for-agent', '创建凭证配置'],
  ['discover-mcp-tools-for-agent', '发现 MCP 工具'],
  ['configure-agent-integration', '配置代理集成'],
  // Workflows/Triggers removed
]);

const resolveLocale = (locale?: string): string => {
  if (locale) return locale;
  if (typeof document !== 'undefined') {
    const lang = document.documentElement?.lang || navigator.language;
    if (lang) return lang;
  }
  return 'en';
};

const isZhLocale = (locale?: string): boolean => resolveLocale(locale).toLowerCase().startsWith('zh');

const formatSubagentToolName = (toolName: string, locale?: string): string | null => {
  const normalized = toolName.replace(/_/g, '-').toLowerCase();
  if (!normalized.startsWith('transfer-to-')) {
    return null;
  }
  const suffix = normalized.replace('transfer-to-', '').replace(/-/g, ' ').trim();
  if (!suffix) return null;
  const title = suffix
    .split(' ')
    .filter(Boolean)
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
  return isZhLocale(locale) ? `子代理：${title}` : `Subagent: ${title}`;
};


const MCP_SERVER_NAMES = new Map([
  ['exa', 'Exa Search'],
  ['github', 'GitHub'],
  ['notion', 'Notion'],
  ['slack', 'Slack'],
  ['filesystem', 'File System'],
  ['memory', 'Memory'],
]);

function formatMCPToolName(serverName: string, toolName: string): string {
  const serverMappings: Record<string, string> = {
    'exa': 'Exa Search',
    'github': 'GitHub',
    'notion': 'Notion', 
    'slack': 'Slack',
    'filesystem': 'File System',
    'memory': 'Memory',
    'anthropic': 'Anthropic',
    'openai': 'OpenAI',
    'composio': 'Composio',
    'langchain': 'LangChain',
    'llamaindex': 'LlamaIndex'
  };
  
  const formattedServerName = serverMappings[serverName.toLowerCase()] || 
    serverName.charAt(0).toUpperCase() + serverName.slice(1);
  
  let formattedToolName = toolName;
  
  if (toolName.includes('-')) {
    formattedToolName = toolName
      .split('-')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  }
  else if (toolName.includes('_')) {
    formattedToolName = toolName
      .split('_')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  }
  else if (/[a-z][A-Z]/.test(toolName)) {
    formattedToolName = toolName
      .replace(/([a-z])([A-Z])/g, '$1 $2')
      .split(' ')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  }
  else {
    formattedToolName = toolName.charAt(0).toUpperCase() + toolName.slice(1);
  }
  
  return `${formattedServerName}: ${formattedToolName}`;
}

export function getUserFriendlyToolName(toolName: string, locale?: string): string {
  const subagentLabel = formatSubagentToolName(toolName, locale);
  if (subagentLabel) {
    return subagentLabel;
  }
  const rawName = toolName || '';
  const rawLower = rawName.toLowerCase();
  const normalized = rawLower.replace(/_/g, '-');
  const displayMap = isZhLocale(locale) ? TOOL_DISPLAY_NAMES_ZH : TOOL_DISPLAY_NAMES_EN;
  if (rawLower.startsWith('mcp_')) {
    const parts = rawLower.split('_');
    if (parts.length >= 3) {
      const serverName = parts[1];
      const toolNamePart = parts.slice(2).join('_');
      return formatMCPToolName(serverName, toolNamePart);
    }
  }
  if (normalized.includes('-') && !displayMap.has(normalized)) {
    const parts = normalized.split('-');
    if (parts.length >= 2) {
      const serverName = parts[0];
      const toolNamePart = parts.slice(1).join('-');
      return formatMCPToolName(serverName, toolNamePart);
    }
  }
  return displayMap.get(normalized) || displayMap.get(rawLower) || toolName;
}

export const HIDE_STREAMING_XML_TAGS = new Set([

  // Core tools
  'ask',
  'complete',
  'crawl-webpage',
  'web-search',
  'search-images',
  'analyze-image-content',

  // Data provider tools
  'execute_data_provider_call',
  'execute_data_provider_endpoint',
  'execute-data-provider-call',
  'execute-data-provider-endpoint',
]);
