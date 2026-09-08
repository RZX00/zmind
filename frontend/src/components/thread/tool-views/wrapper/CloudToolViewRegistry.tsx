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

/**
 * Cloud-based tool view registry that excludes all sandbox-related components.
 * This registry supports only API-based tools without local execution dependencies.
 * Removed tools are listed and will show deprecation notices when accessed.
 */
const cloudRegistry: ToolViewRegistryType = {
  // Core API tools (preserved)
  'web-search': WebSearchToolView,
  'intelligent-web-search': WebSearchToolView,
  'crawl-webpage': WebCrawlToolView,
  'scrape-webpage': WebScrapeToolView,
  'image-search': WebSearchToolView,

  // Data provider tools (preserved)
  'execute-data-provider-call': ExecuteDataProviderCallToolView,
  'get-data-provider-endpoints': DataProviderEndpointsToolView,

  // MCP and integration tools (preserved)
  'search-mcp-servers': SearchMcpServersToolView,
  'get-app-details': GetAppDetailsToolView,
  'create-credential-profile': CreateCredentialProfileToolView,
  'connect-credential-profile': ConnectCredentialProfileToolView,
  'check-profile-connection': CheckProfileConnectionToolView,
  'get-credential-profiles': GetCredentialProfilesToolView,

  // Task management tools (simplified)
  // Removed delete-tasks and clear-all to simplify

  // Agent management tools removed in simplified system
  // Workflow/Trigger tools removed

  // Conversation tools (preserved)
  'ask': AskToolView,
  'complete': CompleteToolView,
  'wait': WaitToolView,

  // Default fallback
  'default': GenericToolView,

  // REMOVED: All sandbox-related tools
  // - Browser automation tools (browser-navigate-to, browser-act, etc.)
  // - File operation tools (create-file, edit-file, etc.)
  // - Command execution tools (execute-command, etc.)
  // - Deployment tools (deploy, expose-port)
  // - Spreadsheet tools (create-sheet, etc.)
  // - Image editing tools (image-edit-or-generate)
  // - Document sandbox tools (upload-file, etc.)
};

/**
 * Sandbox tools that have been removed in the cloud transformation
 */
const removedSandboxTools: string[] = [
  // Browser automation tools
  'browser-navigate-to',
  'browser-act',
  'browser-extract-content',
  'browser-screenshot',
  'browser-search',

  // File operation tools
  'create-file',
  'edit-file',
  'read-file',
  'upload-file',
  'delete-file',

  // Command execution tools
  'execute-command',
  'run-script',

  // Document sandbox tools
  'create-document',
  'update-document',
  'export-document',

  // Image editing tools
  'image-edit-or-generate',
  'load-image',

  // Spreadsheet tools
  'create-sheet',
  'update-sheet',
  'analyze-sheet',
  'visualize-sheet',

  // Deployment tools
  'deploy',
  'expose-port',

  // Simplified - removed redundant tools
  'delete-tasks',
  'clear-all',
];

class CloudToolViewRegistry {
  private registry: ToolViewRegistryType;

  constructor(initialRegistry: Partial<ToolViewRegistryType> = {}) {
    this.registry = { ...cloudRegistry };

    Object.entries(initialRegistry).forEach(([key, value]) => {
      if (value !== undefined) {
        this.registry[key] = value;
      }
    });
  }

  register(toolName: string, component: ToolViewComponent): void {
    this.registry[toolName] = component;
  }

  registerMany(components: Partial<ToolViewRegistryType>): void {
    Object.assign(this.registry, components);
  }

  get(toolName: string): ToolViewComponent {
    // Check if this is a removed sandbox tool
    if (removedSandboxTools.includes(toolName)) {
      console.warn(`Tool '${toolName}' has been removed in the cloud transformation`);
      return this.registry['default'];
    }

    return this.registry[toolName] || this.registry['default'];
  }

  has(toolName: string): boolean {
    return toolName in this.registry || removedSandboxTools.includes(toolName);
  }

  getToolNames(): string[] {
    return Object.keys(this.registry).filter(key => key !== 'default');
  }

  getRemovedTools(): string[] {
    return removedSandboxTools;
  }

  clear(): void {
    this.registry = { default: this.registry['default'] };
  }

  isSandboxTool(toolName: string): boolean {
    return removedSandboxTools.includes(toolName);
  }
}

export const cloudToolViewRegistry = new CloudToolViewRegistry();

export function useCloudToolView(toolName: string): ToolViewComponent {
  return useMemo(() => cloudToolViewRegistry.get(toolName), [toolName]);
}

/**
 * Cloud-optimized ToolView component that handles removed sandbox tools gracefully
 */
export function CloudToolView({ name = 'default', assistantContent, toolContent, ...props }: ToolViewProps) {
  const toolData = extractToolData(toolContent);
  const ToolViewComponent = useCloudToolView(name);

  // Check if this is a removed sandbox tool
  if (cloudToolViewRegistry.isSandboxTool(name)) {
    return (
      <div className="sandbox-tool-deprecated p-4 border border-yellow-300 bg-yellow-50 rounded">
        <div className="flex items-center mb-2">
          <span className="text-yellow-600 mr-2">⚠️</span>
          <h4 className="font-medium text-yellow-800">Tool No Longer Available</h4>
        </div>
        <p className="text-yellow-700 mb-2">
          The tool <code className="bg-yellow-100 px-1 rounded">{name}</code> has been removed as part of our cloud transformation.
        </p>
        <p className="text-yellow-600 text-sm">
          This operation required sandbox environments which have been replaced with API-based alternatives for better performance and cost efficiency.
        </p>
      </div>
    );
  }

  return (
    <ToolViewComponent
      name={name}
      toolContent={toolContent}
      assistantContent={assistantContent}
      {...props}
    />
  );
}
