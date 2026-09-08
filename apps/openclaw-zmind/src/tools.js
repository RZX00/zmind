function buildTools(clientFactory) {
  return [
    {
      name: 'zmind_canvas_list',
      description: 'List canvases in the current or specified ZMind workspace',
      optional: true,
      parameters: {
        type: 'object',
        properties: {
          workspaceId: { type: 'string' },
          limit: { type: 'number' },
          offset: { type: 'number' },
        },
      },
      execute: async (_id, input = {}) => {
        const client = clientFactory();
        const canvases = await client.listCanvases({
          ...input,
          integrationTool: 'zmind_canvas_list',
        });
        return asToolResult(
          `Found ${canvases.length} canvas${canvases.length === 1 ? '' : 'es'}`,
          { canvases }
        );
      },
    },
    {
      name: 'zmind_canvas_get',
      description: 'Load a ZMind canvas by id',
      optional: true,
      parameters: {
        type: 'object',
        required: ['canvasId'],
        properties: {
          canvasId: { type: 'string' },
          workspaceId: { type: 'string' },
        },
      },
      execute: async (_id, input) => {
        const client = clientFactory();
        const canvas = await client.getCanvas({
          ...input,
          integrationTool: 'zmind_canvas_get',
        });
        return asToolResult(
          `Loaded canvas "${canvas.title}" with ${(canvas.nodes || []).length} nodes`,
          { canvas }
        );
      },
    },
    {
      name: 'zmind_canvas_create',
      description: 'Create a new ZMind canvas',
      optional: true,
      parameters: {
        type: 'object',
        required: ['title'],
        properties: {
          title: { type: 'string' },
          workspaceId: { type: 'string' },
          nodes: { type: 'array' },
          connections: { type: 'array' },
        },
      },
      execute: async (_id, input) => {
        const client = clientFactory();
        const canvas = await client.createCanvas({
          ...input,
          integrationTool: 'zmind_canvas_create',
        });
        return asToolResult(
          `Created canvas "${canvas.title}"`,
          { canvas }
        );
      },
    },
    {
      name: 'zmind_canvas_apply_ops',
      description: 'Apply canvas operations to an existing ZMind canvas',
      optional: true,
      parameters: {
        type: 'object',
        required: ['canvasId', 'operations'],
        properties: {
          canvasId: { type: 'string' },
          workspaceId: { type: 'string' },
          expectedVersion: { type: 'number' },
          operations: { type: 'array' },
        },
      },
      execute: async (_id, input) => {
        const client = clientFactory();
        const result = await client.applyCanvasOperations({
          ...input,
          integrationTool: 'zmind_canvas_apply_ops',
        });
        return asToolResult(
          `Applied ${Array.isArray(input.operations) ? input.operations.length : 0} canvas operations`,
          result
        );
      },
    },
    {
      name: 'zmind_doc_get',
      description: 'Load a ZMind doc by id',
      optional: true,
      parameters: {
        type: 'object',
        required: ['itemId'],
        properties: {
          itemId: { type: 'string' },
          workspaceId: { type: 'string' },
        },
      },
      execute: async (_id, input) => {
        const client = clientFactory();
        const doc = await client.getDoc({
          ...input,
          integrationTool: 'zmind_doc_get',
        });
        return asToolResult(
          `Loaded doc "${doc.title}" (version ${doc.version})`,
          { doc }
        );
      },
    },
    {
      name: 'zmind_doc_create',
      description: 'Create a new ZMind doc',
      optional: true,
      parameters: {
        type: 'object',
        required: ['title'],
        properties: {
          title: { type: 'string' },
          contentMd: { type: 'string' },
          folderId: { type: 'string' },
          parentItemId: { type: 'string' },
          workspaceId: { type: 'string' },
        },
      },
      execute: async (_id, input) => {
        const client = clientFactory();
        const doc = await client.createDoc({
          ...input,
          integrationTool: 'zmind_doc_create',
        });
        return asToolResult(
          `Created doc "${doc.title}"`,
          { doc }
        );
      },
    },
    {
      name: 'zmind_doc_apply_ops',
      description: 'Apply structured editing operations to a ZMind doc',
      optional: true,
      parameters: {
        type: 'object',
        required: ['itemId', 'baseVersion', 'ops'],
        properties: {
          itemId: { type: 'string' },
          baseVersion: { type: 'number' },
          ops: { type: 'array' },
          summary: { type: 'string' },
          workspaceId: { type: 'string' },
        },
      },
      execute: async (_id, input) => {
        const client = clientFactory();
        const result = await client.applyDocOperations({
          ...input,
          integrationTool: 'zmind_doc_apply_ops',
        });
        return asToolResult(
          `Applied ${result.appliedOps} doc operations`,
          result
        );
      },
    },
  ];
}

function asToolResult(text, data) {
  return {
    content: [
      {
        type: 'text',
        text,
      },
    ],
    structuredContent: data,
  };
}

module.exports = {
  asToolResult,
  buildTools,
};
