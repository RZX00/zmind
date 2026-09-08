import React, { useEffect, useRef, useState } from 'react';
import { useLocale } from 'next-intl';
import { CircleDashed, ChevronDown } from 'lucide-react';
import { extractToolNameFromStream } from '@/components/thread/tool-views/xml-parser';
import { getToolIcon, getUserFriendlyToolName, extractPrimaryParam } from '@/components/thread/utils';
import { CodeBlockCode } from '@/components/ui/code-block';
// Utility function for language detection
const getLanguageFromFileName = (fileName: string): string => {
  const extension = fileName.split('.').pop()?.toLowerCase() || '';
  const extensionMap: Record<string, string> = {
    html: 'html', htm: 'html', css: 'css', scss: 'scss', sass: 'scss', less: 'less',
    js: 'javascript', jsx: 'jsx', ts: 'typescript', tsx: 'tsx', json: 'json', jsonc: 'json',
    xml: 'xml', yml: 'yaml', yaml: 'yaml', toml: 'toml', ini: 'ini', env: 'bash',
    py: 'python', rb: 'ruby', php: 'php', go: 'go', java: 'java', kt: 'kotlin',
    c: 'c', cpp: 'cpp', h: 'c', hpp: 'cpp', cs: 'csharp', swift: 'swift', rs: 'rust',
    sh: 'bash', bash: 'bash', zsh: 'bash', ps1: 'powershell', bat: 'batch', cmd: 'batch',
    svg: 'svg', tex: 'latex', graphql: 'graphql', gql: 'graphql',
  };
  return extensionMap[extension] || 'text';
};

// Define tool categories for different streaming behaviors
const STREAMABLE_TOOLS = {
    // File operation tools - show full content streaming
    FILE_OPERATIONS: new Set([
        'create-file',
        'full-file-rewrite',
        'edit-file',
        'str-replace',
        'delete-file',
    ]),
    
    // Command tools - show command output streaming
    COMMAND_TOOLS: new Set([
        'execute-command',
        'check-command-output',
        'terminate-command',
        'list-commands',
    ]),
    
    // Browser tools - show action details streaming
    BROWSER_TOOLS: new Set([
        'browser-navigate-to',
        'browser-act',
        'browser-extract-content',
        'browser-screenshot',
        'browser-search',
    ]),
    
    // Web tools - show search/crawl results streaming
    WEB_TOOLS: new Set([
        'web-search',
        'crawl-webpage',
        'scrape-webpage',
    ]),
    
    // Other tools that benefit from content streaming
    OTHER_STREAMABLE: new Set([
        'execute-data-provider-call',
        'get-data-provider-endpoints',
        'create-tasks',
        'update-tasks',
        'view-tasks',
        'search-images',
        'analyze-image-content',
        'expose-port',
        'get-current-agent-config',
        'search-mcp-servers',
        'create-credential-profile',
        'connect-credential-profile',
        'check-profile-connection',
        'configure-agent-integration',
        'get-credential-profiles',
    ])
};

// Check if a tool should show streaming content
const isStreamableTool = (toolName: string) => {
    return Object.values(STREAMABLE_TOOLS).some(toolSet => toolSet.has(toolName));
};

interface ShowToolStreamProps {
    content: string;
    messageId?: string | null;
    onToolClick?: (messageId: string | null, toolName: string) => void;
    showExpanded?: boolean; // Whether to show expanded streaming view
    startTime?: number; // When the tool started running
}

export const ShowToolStream: React.FC<ShowToolStreamProps> = ({
    content,
    messageId,
    onToolClick,
    showExpanded: initialExpanded = false,
    startTime
}) => {
    const containerRef = useRef<HTMLDivElement>(null);
    // Internal state for expansion, defaulting to false unless explicitly forced, 
    // but user request says "hide info", so default false is safer.
    // We use the prop as *initial* value or controlled if we wanted, but here we want internal toggle.
    const [isExpanded, setIsExpanded] = useState(initialExpanded);
    const [shouldAutoScroll, setShouldAutoScroll] = useState(true);
    // Use ref to store stable start time - only set once!
    const stableStartTimeRef = useRef<number | null>(null);

    // Set stable start time only once
    if (isExpanded && !stableStartTimeRef.current) {
        stableStartTimeRef.current = Date.now();
    }

    const locale = useLocale();
    const rawToolName = extractToolNameFromStream(content) || '';
    const normalizedToolName = rawToolName.toLowerCase();
    const toolName = getUserFriendlyToolName(rawToolName, locale);
    const isEditFile = normalizedToolName === 'edit-file';
    const isCreateFile = normalizedToolName === 'create-file';
    const isFullFileRewrite = normalizedToolName === 'full-file-rewrite';

    const toggleExpanded = (e: React.MouseEvent) => {
        e.stopPropagation(); // Prevent parent click handlers
        setIsExpanded(!isExpanded);
    };

    // Clean function call XML content but preserve other HTML/XML
    const cleanXMLContent = (rawContent: string): { html: string; plainText: string } => {
        if (!rawContent) return { html: '', plainText: '' };
        
        // Remove only function call related XML tags: function_calls, invoke, parameter
        const cleaned = rawContent
            .replace(/<function_calls[^>]*>/gi, '')
            .replace(/<\/function_calls>/gi, '')
            .replace(/<invoke[^>]*>/gi, '')
            .replace(/<\/invoke>/gi, '');
        
        // Extract all parameter content with names
        const parameterMatches = cleaned.match(/<parameter\s+name=["'][^"']*["']>([\\s\\S]*?)(<\/parameter>|$)/gi);
        if (parameterMatches) {
            const paramEntries = parameterMatches.map(match => {
                const fullMatch = match.match(/<parameter\s+name=["']([^"']*)["']>([\\s\\S]*?)(<\/parameter>|$)/i);
                if (fullMatch) {
                    const paramName = fullMatch[1];
                    const paramValue = fullMatch[2].trim();
                    
                    if (paramValue) {
                        return {
                            name: paramName,
                            value: paramValue,
                            html: `<strong>${paramName}:</strong> ${paramValue}`,
                            plainText: `${paramName}: ${paramValue}`
                        };
                    }
                }
                return null;
            }).filter(entry => entry !== null);
            
            if (paramEntries.length > 0) {
                return {
                    html: paramEntries.map(entry => entry.html).join('\n\n'),
                    plainText: paramEntries.map(entry => entry.plainText).join('\n\n')
                };
            }
        }
        
        // Fallback: remove only parameter tags but preserve other HTML/XML
        const cleanText = cleaned.replace(/<\/?parameter[^>]*>/gi, '').trim();
        return { html: cleanText, plainText: cleanText };
    };

    // Extract streaming content with parameter names
    const streamingContent = React.useMemo(() => {
        if (!content) return { html: '', plainText: '' };
        
        // For file operations, prioritize showing just the content without param names for cleaner code display
        if (STREAMABLE_TOOLS.FILE_OPERATIONS.has(normalizedToolName || '')) {
            let paramName: string | null = null;
            if (isEditFile) paramName = 'code_edit';
            else if (isCreateFile || isFullFileRewrite) paramName = 'file_contents';

            if (paramName) {
                const newMatch = content.match(new RegExp(`<parameter\\s+name=["']${paramName}["']>([\\s\\S]*)`, 'i'));
                if (newMatch && newMatch[1]) {
                    const cleanContent = newMatch[1].replace(/<\/parameter>[\s\S]*$/, '');
                    return { html: cleanContent, plainText: cleanContent };
                }
                // Fallback for old formats
                if (isEditFile) {
                    const oldMatch = content.match(/<code_edit>([\s\S]*)/i);
                    if (oldMatch && oldMatch[1]) {
                        const cleanContent = oldMatch[1].replace(/<\/code_edit>[\s\S]*$/, '');
                        return { html: cleanContent, plainText: cleanContent };
                    }
                }
            }
        }
        
        // For other tools, show parameter names with values
        // Command tools - extract command parameter with name
        if (STREAMABLE_TOOLS.COMMAND_TOOLS.has(normalizedToolName || '')) {
            const commandMatch = content.match(/<parameter\s+name=["']command["']>([\\s\\S]*?)(<\/parameter>|$)/i);
            if (commandMatch && commandMatch[1]) {
                const value = commandMatch[1].trim();
                return { 
                    html: `<strong>command:</strong> ${value}`, 
                    plainText: `command: ${value}` 
                };
            }
        }
        
        // Browser tools - extract parameters with names
        if (STREAMABLE_TOOLS.BROWSER_TOOLS.has(normalizedToolName || '')) {
            const urlMatch = content.match(/<parameter\s+name=["']url["']>([\\s\\S]*?)(<\/parameter>|$)/i);
            const actionMatch = content.match(/<parameter\s+name=["']action["']>([\\s\\S]*?)(<\/parameter>|$)/i);
            const instructionMatch = content.match(/<parameter\s+name=["']instruction["']>([\\s\\S]*?)(<\/parameter>|$)/i);
            
            if (urlMatch && urlMatch[1]) {
                const value = urlMatch[1].trim();
                return { html: `<strong>url:</strong> ${value}`, plainText: `url: ${value}` };
            }
            if (actionMatch && actionMatch[1]) {
                const value = actionMatch[1].trim();
                return { html: `<strong>action:</strong> ${value}`, plainText: `action: ${value}` };
            }
            if (instructionMatch && instructionMatch[1]) {
                const value = instructionMatch[1].trim();
                return { html: `<strong>instruction:</strong> ${value}`, plainText: `instruction: ${value}` };
            }
        }
        
        // Web tools - extract parameters with names
        if (STREAMABLE_TOOLS.WEB_TOOLS.has(normalizedToolName || '')) {
            const queryMatch = content.match(/<parameter\s+name=["']query["']>([\\s\\S]*?)(<\/parameter>|$)/i);
            const urlMatch = content.match(/<parameter\s+name=["']url["']>([\\s\\S]*?)(<\/parameter>|$)/i);
            
            if (queryMatch && queryMatch[1]) {
                const value = queryMatch[1].trim();
                return { html: `<strong>query:</strong> ${value}`, plainText: `query: ${value}` };
            }
            if (urlMatch && urlMatch[1]) {
                const value = urlMatch[1].trim();
                return { html: `<strong>url:</strong> ${value}`, plainText: `url: ${value}` };
            }
        }
        
        // For other streamable tools, try to extract with parameter names
        if (STREAMABLE_TOOLS.OTHER_STREAMABLE.has(normalizedToolName || '')) {
            const commonParams = ['text', 'content', 'data', 'config', 'description', 'prompt'];
            for (const param of commonParams) {
                const match = content.match(new RegExp(`<parameter\\s+name=["']${param}["']>([\\s\\S]*?)(<\\/parameter>|$)`, 'i'));
                if (match && match[1]) {
                    const value = match[1].trim();
                    return { html: `<strong>${param}:</strong> ${value}`, plainText: `${param}: ${value}` };
                }
            }
        }
        
        // Fallback: clean all XML and return with parameter names
        return cleanXMLContent(content);
    }, [content, normalizedToolName, isEditFile, isCreateFile, isFullFileRewrite]);

    // Show streaming content for all streamable tools with delayed transitions
    // Removed useEffect for showExpanded/shouldShowContent sync since we use local state
    
    useEffect(() => {
        if (containerRef.current && isExpanded && shouldAutoScroll) {
            containerRef.current.scrollTop = containerRef.current.scrollHeight;
        }
    }, [content, isExpanded, shouldAutoScroll]);

    // Handle scroll events to disable auto-scroll when user scrolls up
    useEffect(() => {
        const container = containerRef.current;
        if (!container) return;

        const handleScroll = () => {
            const { scrollTop, scrollHeight, clientHeight } = container;
            const isAtBottom = scrollTop + clientHeight >= scrollHeight - 5;
            setShouldAutoScroll(isAtBottom);
        };

        container.addEventListener('scroll', handleScroll);
        return () => container.removeEventListener('scroll', handleScroll);
    }, [isExpanded]);

    if (!toolName) {
        return null;
    }

    // Check if this is a streamable tool
    const isToolStreamable = isStreamableTool(normalizedToolName);

    const IconComponent = getToolIcon(rawToolName || '');
    const displayName = toolName;
    const paramDisplay = extractPrimaryParam(rawToolName || '', content);

    // Always show tool button, conditionally show content below for streamable tools
    if (isToolStreamable) {
        return (
            <div className="my-0.5 w-full">
                {/* Container */}
                <div className="w-full">
                    {/* Tool name header */}
                    <button
                        onClick={toggleExpanded}
                        className={`w-full flex items-center gap-2.5 py-1 px-2 text-xs text-left transition-all duration-200 cursor-pointer rounded-lg select-none border ${
                            isExpanded 
                            ? 'bg-zinc-100 dark:bg-zinc-800/50 border-zinc-200/80 dark:border-zinc-700/50 shadow-sm' 
                            : 'bg-transparent border-transparent hover:bg-zinc-100/50 dark:hover:bg-zinc-800/30'
                        }`}
                    >
                        {/* Spinner */}
                        <div className={`flex items-center justify-center shrink-0 text-zinc-500 dark:text-zinc-400`}>
                            <CircleDashed className="h-3.5 w-3.5 animate-spin" strokeWidth={2} />
                        </div>
                        
                        {/* Label */}
                        <div className="flex-1 min-w-0 flex flex-col justify-center">
                             <div className="flex items-center gap-2">
                                <span className={`text-xs font-medium truncate ${isExpanded ? "text-foreground" : "text-zinc-600 dark:text-zinc-300"}`}>
                                    {displayName}
                                </span>
                            </div>
                        </div>
                        
                        {/* Chevron */}
                        <ChevronDown className={`h-3 w-3 text-zinc-400 dark:text-zinc-500 transition-transform duration-200 ${isExpanded ? 'rotate-180 text-foreground' : ''}`} strokeWidth={2} />
                    </button>

                    {/* Streaming content below - smooth height transition */}
                    {isExpanded && (
                        <div className="grid transition-all duration-300 ease-[cubic-bezier(0.25,0.1,0.25,1)] overflow-hidden grid-rows-[1fr] opacity-100 mt-0.5">
                        <div className="relative min-h-0 rounded-lg bg-zinc-50/50 dark:bg-zinc-900/30 border border-zinc-100 dark:border-zinc-800/50 overflow-hidden mx-1">
                            <div
                                ref={containerRef}
                                className={`max-h-[300px] overflow-y-auto scrollbar-thin scrollbar-thumb-zinc-200 dark:scrollbar-thumb-zinc-700 scrollbar-track-transparent text-xs text-muted-foreground p-2.5 transition-all duration-200 ${
                                    STREAMABLE_TOOLS.FILE_OPERATIONS.has(normalizedToolName || '') || STREAMABLE_TOOLS.COMMAND_TOOLS.has(normalizedToolName || '') 
                                        ? 'font-mono whitespace-pre-wrap' 
                                        : 'whitespace-pre-wrap'
                                }`}
                            >
                                {(() => {
                                    // Get the content to display
                                    const contentToDisplay = typeof streamingContent === 'string' ? streamingContent : streamingContent.plainText;
                                    const htmlContent = typeof streamingContent === 'string' ? streamingContent : streamingContent.html;
                                    
                                    // Format content based on tool type with prefixes
                                    if (STREAMABLE_TOOLS.COMMAND_TOOLS.has(normalizedToolName || '')) {
                                        const prefix = '$ ';
                                        // For commands, use plain text with prefix
                                        return prefix + contentToDisplay;
                                    }
                                    if (STREAMABLE_TOOLS.BROWSER_TOOLS.has(normalizedToolName || '')) {
                                        const prefix = '🌐 ';
                                        // For browser tools, render HTML if available
                                        if (htmlContent !== contentToDisplay) {
                                            return (
                                                <span>
                                                    {prefix}
                                                    <span dangerouslySetInnerHTML={{ __html: htmlContent }} />
                                                </span>
                                            );
                                        }
                                        return prefix + contentToDisplay;
                                    }
                                    if (STREAMABLE_TOOLS.WEB_TOOLS.has(normalizedToolName || '')) {
                                        const prefix = '🔍 ';
                                        // For web tools, render HTML if available
                                        if (htmlContent !== contentToDisplay) {
                                            return (
                                                <span>
                                                    {prefix}
                                                    <span dangerouslySetInnerHTML={{ __html: htmlContent }} />
                                                </span>
                                            );
                                        }
                                        return prefix + contentToDisplay;
                                    }
                                    if (STREAMABLE_TOOLS.OTHER_STREAMABLE.has(normalizedToolName || '')) {
                                        // For other tools, render HTML if available
                                        if (htmlContent !== contentToDisplay) {
                                            return <span dangerouslySetInnerHTML={{ __html: htmlContent }} />;
                                        }
                                        return contentToDisplay;
                                    }
                                    // For file operations, just return the content (no param names for cleaner code display)
                                    return contentToDisplay;
                                })()}
                            </div>
                            {/* Top gradient */}
                            <div className={`absolute top-0 left-0 right-0 h-4 pointer-events-none bg-gradient-to-b from-zinc-50 dark:from-neutral-900/50 to-transparent opacity-50`} />
                            {/* Bottom gradient */}
                            <div className={`absolute bottom-0 left-0 right-0 h-4 pointer-events-none bg-gradient-to-t from-zinc-50 dark:from-neutral-900/50 to-transparent opacity-50`} />
                        </div>
                    </div>
                    )}
                </div>
            </div>
        );
    }

    // Show normal tool button (non-streamable tools or non-expanded case)
    return (
        <div className="my-0.5 w-full">
             <button
                onClick={toggleExpanded}
                className={`w-full flex items-center gap-2.5 py-1 px-2 text-xs text-left transition-all duration-200 cursor-pointer rounded-lg select-none border ${
                    isExpanded 
                    ? 'bg-zinc-100 dark:bg-zinc-800/50 border-zinc-200/80 dark:border-zinc-700/50 shadow-sm' 
                    : 'bg-transparent border-transparent hover:bg-zinc-100/50 dark:hover:bg-zinc-800/30'
                }`}
            >
                {/* Spinner - Minimalist, no background */}
                <div className={`flex items-center justify-center shrink-0 text-zinc-500 dark:text-zinc-400`}>
                     <CircleDashed className="h-3.5 w-3.5 animate-spin" strokeWidth={2} />
                </div>
                
                {/* Label */}
                <div className="flex-1 min-w-0 flex flex-col justify-center">
                     <div className="flex items-center gap-2">
                        <span className={`text-xs font-medium truncate ${isExpanded ? "text-foreground" : "text-zinc-600 dark:text-zinc-300"}`}>
                            {displayName}
                        </span>
                    </div>
                </div>

                {/* Chevron */}
                <ChevronDown className={`h-3 w-3 text-zinc-400 dark:text-zinc-500 transition-transform duration-200 ${isExpanded ? 'rotate-180 text-foreground' : ''}`} strokeWidth={2} />
            </button>
        </div>
    );
}; 
