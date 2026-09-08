const { registerCliCommands } = require('./cli');
const { loadZMindSdk } = require('./load-sdk');
const { buildTools } = require('./tools');

const { ZMindClient } = loadZMindSdk();

function createClientFactory(api) {
  return () => {
    const pluginConfig = readPluginConfig(api);
    const env = {
      ...process.env,
      ...(pluginConfig.baseUrl ? { ZMIND_BACKEND_URL: pluginConfig.baseUrl } : {}),
      ...(pluginConfig.supabaseUrl ? { ZMIND_SUPABASE_URL: pluginConfig.supabaseUrl } : {}),
      ...(pluginConfig.supabaseAnonKey ? { ZMIND_SUPABASE_ANON_KEY: pluginConfig.supabaseAnonKey } : {}),
      ZMIND_INTEGRATION_SOURCE: 'openclaw',
      ZMIND_INTEGRATION_CLIENT: 'openclaw-plugin',
    };
    return new ZMindClient({ env });
  };
}

function readPluginConfig(api) {
  try {
    if (api && typeof api.getConfig === 'function') {
      return api.getConfig() || {};
    }
  } catch {}

  if (api && api.config && typeof api.config === 'object') {
    return api.config;
  }
  return {};
}

function createZMindPlugin(api) {
  const clientFactory = createClientFactory(api);

  for (const tool of buildTools(clientFactory)) {
    api.registerTool(
      {
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
        execute: tool.execute,
      },
      { optional: tool.optional }
    );
  }

  api.registerCli(({ program }) => {
    registerCliCommands(program, clientFactory);
  }, {
    commands: ['zmind'],
  });
}

module.exports = createZMindPlugin;
module.exports.default = createZMindPlugin;
module.exports.buildTools = buildTools;
module.exports.createZMindPlugin = createZMindPlugin;
module.exports.readPluginConfig = readPluginConfig;
