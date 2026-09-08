import React, { useMemo } from 'react';
import { ToolViewProps } from '../types';
import { GenericToolView } from '../GenericToolView';
import { WebCrawlToolView } from '../WebCrawlToolView';
import { WebScrapeToolView } from '../web-scrape-tool/WebScrapeToolView';
import { WebSearchToolView } from '../web-search-tool/WebSearchToolView';
import { AskToolView } from '../ask-tool/AskToolView';
import { CompleteToolView } from '../CompleteToolView';
import { WaitToolView } from '../wait-tool/WaitToolView';
import { ExecuteDataProviderCallToolView } from '../data-provider-tool/ExecuteDataProviderCallToolView';
import { DataProviderEndpointsToolView } from '../data-provider-tool/DataProviderEndpointsToolView';
import { SearchMcpServersToolView } from '../search-mcp-servers/search-mcp-servers';
import { GetAppDetailsToolView } from '../get-app-details/get-app-details';
import { CreateCredentialProfileToolView } from '../create-credential-profile/create-credential-profile';
import { ConnectCredentialProfileToolView } from '../connect-credential-profile/connect-credential-profile';
import { CheckProfileConnectionToolView } from '../check-profile-connection/check-profile-connection';
import { GetCredentialProfilesToolView } from '../get-credential-profiles/get-credential-profiles';
// Removed workflow/trigger tool views in simplified system
import { extractToolData } from '../utils';

export type ToolViewComponent = React.ComponentType<ToolViewProps>;

type ToolViewRegistryType = Record<string, ToolViewComponent>;

const defaultRegistry: ToolViewRegistryType = {
  // Web operations (preserved)
  'web-crawl': WebCrawlToolView,
  'web-scrape': WebScrapeToolView,
  'web-search': WebSearchToolView,
  'intelligent-web-search': WebSearchToolView,

  // Agent communication tools
  'ask': AskToolView,
  'complete': CompleteToolView,
  'wait': WaitToolView,

  // Data provider tools
  'execute-data-provider-call': ExecuteDataProviderCallToolView,
  'data-provider-endpoints': DataProviderEndpointsToolView,

  // MCP server tools
  'search-mcp-servers': SearchMcpServersToolView,
  'get-app-details': GetAppDetailsToolView,

  // Credential management tools
  'create-credential-profile': CreateCredentialProfileToolView,
  'connect-credential-profile': ConnectCredentialProfileToolView,
  'check-profile-connection': CheckProfileConnectionToolView,
  'get-credential-profiles': GetCredentialProfilesToolView,


  // Workflow/Trigger tools removed

  // Default fallback
  'default': GenericToolView,
};

export const toolViewRegistry = new Map<string, ToolViewComponent>(
  Object.entries(defaultRegistry)
);

/**
 * Hook to get the appropriate tool view component for a given tool name
 */
export function useToolView(toolName: string): ToolViewComponent {
  return useMemo(() => {
    const component = toolViewRegistry.get(toolName);
    return component || GenericToolView;
  }, [toolName]);
}

/**
 * Original Tool View Component (Sandbox-based)
 *
 * This component handles the rendering of tool views based on the original sandbox registry.
 * It has been simplified to only include non-sandbox tools.
 */
export function ToolView({ name = 'default', assistantContent, toolContent, ...props }: ToolViewProps) {
  const effectiveToolName = extractToolData(assistantContent || '')?.toolResult?.toolName || name;
  const ToolViewComponent = useToolView(effectiveToolName);

  // Modify toolContent if needed for specific tools
  const modifiedToolContent = toolContent;

  // use the tool view component
  return <ToolViewComponent name={effectiveToolName} toolContent={modifiedToolContent} {...props} />;
}

/**
 * Get all available tool names in the registry
 */
export function getToolNames(): string[] {
  return Array.from(toolViewRegistry.keys());
}

/**
 * Check if a tool is available in the registry
 */
export function hasToolView(toolName: string): boolean {
  return toolViewRegistry.has(toolName);
}

/**
 * Add a new tool view to the registry
 */
export function addToolView(toolName: string, component: ToolViewComponent): void {
  toolViewRegistry.set(toolName, component);
}

/**
 * Remove a tool view from the registry
 */
export function removeToolView(toolName: string): boolean {
  return toolViewRegistry.delete(toolName);
}
