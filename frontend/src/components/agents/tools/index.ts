import { TOOL_GROUPS, getToolGroup } from './tool-groups';

export const DEFAULT_NATIVE_TOOLS: Record<string, any> = Object.fromEntries(
  Object.values(TOOL_GROUPS).map((group) => [group.name, group.enabled])
);

export function ensureCoreToolsEnabled(tools: Record<string, any>): Record<string, any> {
  const out: Record<string, any> = { ...tools };
  for (const group of Object.values(TOOL_GROUPS)) {
    if (group.isCore) {
      const prev = out[group.name];
      if (prev && typeof prev === 'object') {
        out[group.name] = { ...prev, enabled: true };
      } else {
        out[group.name] = true;
      }
      // If granular config present, set core methods enabled
      if (out[group.name] && typeof out[group.name] === 'object') {
        const methods = (out[group.name].methods ?? {}) as Record<string, any>;
        for (const m of group.methods) {
          if (m.isCore) {
            methods[m.name] = true;
          }
        }
        out[group.name].methods = methods;
      }
    }
  }
  return out;
}

export { getToolGroup };

