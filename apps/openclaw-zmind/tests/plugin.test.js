const test = require('node:test');
const assert = require('node:assert/strict');

const createPlugin = require('../src');

test('plugin registers tools and CLI', () => {
  const tools = [];
  let cliRegistration = null;
  let cliOptions = null;
  const api = {
    registerTool(tool) {
      tools.push(tool);
    },
    registerCli(handler, options) {
      cliRegistration = handler;
      cliOptions = options;
    },
    getConfig() {
      return {};
    },
  };

  createPlugin(api);

  assert.equal(tools.length >= 7, true);
  assert.equal(tools[0].name, 'zmind_canvas_list');
  assert.equal(typeof cliRegistration, 'function');
  assert.deepEqual(cliOptions, { commands: ['zmind'] });
});

test('canvas get tool delegates to sdk client', async () => {
  const { buildTools } = createPlugin;
  const tool = buildTools(() => ({
    async getCanvas() {
      return {
        id: 'canvas-1',
        title: 'Roadmap',
        nodes: [{ id: 'n1' }, { id: 'n2' }],
      };
    },
  })).find((item) => item.name === 'zmind_canvas_get');

  const result = await tool.execute('call-1', { canvasId: 'canvas-1' });

  assert.match(result.content[0].text, /Roadmap/);
  assert.equal(result.structuredContent.canvas.id, 'canvas-1');
});
