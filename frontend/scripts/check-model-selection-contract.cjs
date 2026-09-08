const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

// Exercise the real hook with the current gateway catalog and unknown prices.
const catalog = JSON.parse(fs.readFileSync(
  path.join(__dirname, '../../backend/core/ai_models/ewo_catalog.json'), 'utf8',
));
const models = catalog.models.map((entry) => ({
  id: `habitat/${entry.id}`,
  display_name: entry.id,
  provider_id: 'habitat',
  provider_display_name: 'Ewo',
  is_available: true,
  capabilities: entry.capabilities.includes('text') ? ['chat'] : ['image_generation'],
  // An image with prices must still be hidden; text without prices must be visible.
  input_cost_per_million_tokens: entry.capabilities.includes('image') ? 1 : null,
  output_cost_per_million_tokens: entry.capabilities.includes('image') ? 1 : null,
}));
let selected;
const mocks = {
  react: { useMemo: (fn) => fn(), useEffect: () => {} },
  '@tanstack/react-query': {
    useQuery: () => ({ data: { models }, isLoading: false, isFetching: false }),
  },
  '@/lib/stores/model-store': {
    useModelStore: () => ({ selectedModel: '', setSelectedModel: (id) => { selected = id; } }),
  },
  '@/contexts/SubscriptionContext': { useSubscriptionData: () => ({ data: null }) },
  '@/components/AuthProvider': { useAuth: () => ({ isLoading: false }) },
  '@/lib/api': { getAvailableModels: () => {} },
};
const source = fs.readFileSync(path.join(__dirname, '../src/hooks/use-model-selection.ts'), 'utf8');
const output = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;
const context = {
  exports: {},
  require: (name) => {
    assert.ok(mocks[name], `Unexpected hook dependency: ${name}`);
    return mocks[name];
  },
};
vm.runInNewContext(output, context);
const result = context.exports.useModelSelection();
assert.equal(result.availableModels.length, 30);
assert.ok(result.availableModels.every((model) => model.capabilities.includes('chat')));
assert.ok(result.availableModels.every((model) => model.providerLabel === 'Ewo'));
assert.ok(result.canAccessModel('habitat/gpt-6-astra'));
assert.equal(result.canAccessModel('habitat/gpt-image-2'), false);
result.handleModelChange('habitat/gpt-6-astra');
assert.equal(selected, 'habitat/gpt-6-astra');
result.handleModelChange('habitat/gpt-image-2');
assert.equal(selected, 'habitat/gpt-6-astra');
console.log('Model selector contract passed: 30 text models visible, all 3 image models hidden.');
