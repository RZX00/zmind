import React, { useMemo } from 'react';
import { ToolViewProps } from '../types';

// Import both registries
import { ToolView as OriginalToolView, useToolView as useOriginalToolView, toolViewRegistry, getToolNames } from './ToolViewRegistry';
import { CloudToolView, useCloudToolView, cloudToolViewRegistry } from './CloudToolViewRegistry';

/**
 * Environment-based configuration for tool registry selection
 * This can be configured via environment variables or runtime settings
 */
const getToolRegistryMode = (): 'cloud' | 'sandbox' => {
  // Check if we're in cloud mode (sandbox tools disabled)
  // This could be set via environment variable, API call, or configuration
  if (typeof window !== 'undefined') {
    // Check localStorage for user preference (for testing)
    const userPreference = localStorage.getItem('zmind_tool_mode');
    if (userPreference === 'cloud' || userPreference === 'sandbox') {
      return userPreference;
    }
  }

  // Check environment variable
  const envMode = process.env.NEXT_PUBLIC_TOOL_MODE;
  if (envMode === 'cloud' || envMode === 'sandbox') {
    return envMode;
  }

  // Default to cloud mode for the transformation
  // TODO: This should eventually check backend configuration
  return 'cloud';
};

/**
 * Hook to determine which tool view registry to use
 */
export function useConditionalToolView(toolName: string): React.ComponentType<ToolViewProps> {
  const mode = getToolRegistryMode();
  const cloudComponent = useCloudToolView(toolName);
  const originalComponent = useOriginalToolView(toolName);

  return useMemo(() => {
    if (mode === 'cloud') {
      return cloudComponent;
    } else {
      return originalComponent;
    }
  }, [mode, cloudComponent, originalComponent]);
}

/**
 * Conditional Tool View Component
 *
 * This component automatically selects between the original sandbox-based tool views
 * and the new cloud-based tool views based on configuration.
 */
export function ConditionalToolView(props: ToolViewProps) {
  const mode = getToolRegistryMode();

  // Add mode indicator for development/debugging
  const showModeIndicator = process.env.NODE_ENV === 'development';

  if (mode === 'cloud') {
    return (
      <div className="conditional-tool-view">
        {showModeIndicator && (
          <div className="mb-1 text-xs text-brand-600 bg-brand-50 px-2 py-1 rounded inline-block">
            🌤️ Cloud Mode Active
          </div>
        )}
        <CloudToolView {...props} />
      </div>
    );
  } else {
    return (
      <div className="conditional-tool-view">
        {showModeIndicator && (
          <div className="mb-1 text-xs text-orange-600 bg-orange-50 px-2 py-1 rounded inline-block">
            📦 Sandbox Mode Active
          </div>
        )}
        <OriginalToolView {...props} />
      </div>
    );
  }
}

/**
 * Tool Registry Mode Control (for development and testing)
 */
export function ToolRegistryModeControl() {
  const [mode, setMode] = React.useState<'cloud' | 'sandbox'>(() => getToolRegistryMode());

  const handleModeChange = (newMode: 'cloud' | 'sandbox') => {
    setMode(newMode);
    if (typeof window !== 'undefined') {
      localStorage.setItem('zmind_tool_mode', newMode);
      // Reload page to apply changes
      window.location.reload();
    }
  };

  // Only show in development
  if (process.env.NODE_ENV !== 'development') {
    return null;
  }

  return (
    <div className="fixed bottom-4 right-4 bg-white border border-gray-300 rounded-lg p-3 shadow-lg z-50">
      <div className="text-sm font-medium text-gray-700 mb-2">Tool Registry Mode</div>
      <div className="space-y-2">
        <label className="flex items-center">
          <input
            type="radio"
            name="tool-mode"
            value="cloud"
            checked={mode === 'cloud'}
            onChange={() => handleModeChange('cloud')}
            className="mr-2"
          />
          <span className="text-sm">☁️ Cloud Mode</span>
        </label>
        <label className="flex items-center">
          <input
            type="radio"
            name="tool-mode"
            value="sandbox"
            checked={mode === 'sandbox'}
            onChange={() => handleModeChange('sandbox')}
            className="mr-2"
          />
          <span className="text-sm">📦 Sandbox Mode</span>
        </label>
      </div>
      <div className="text-xs text-gray-500 mt-2">
        Current: {mode === 'cloud' ? '☁️ Cloud' : '📦 Sandbox'}
      </div>
    </div>
  );
}

/**
 * Utility function to check current tool registry mode
 */
export function isCloudMode(): boolean {
  return getToolRegistryMode() === 'cloud';
}

/**
 * Utility function to check if a tool is available in current mode
 */
export function isToolAvailable(toolName: string): boolean {
  const mode = getToolRegistryMode();

  if (mode === 'cloud') {
    return cloudToolViewRegistry.has(toolName);
  } else {
    return toolViewRegistry.has(toolName);
  }
}

/**
 * Get available tools for current mode
 */
export function getAvailableTools(): string[] {
  const mode = getToolRegistryMode();

  if (mode === 'cloud') {
    return cloudToolViewRegistry.getToolNames();
  } else {
    return getToolNames();
  }
}
