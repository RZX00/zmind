import nextConfig from 'eslint-config-next';

const nextPluginConfig = nextConfig.find((config) => config.plugins?.['@next/next']);
const typescriptPluginConfig = nextConfig.find(
  (config) => config.plugins?.['@typescript-eslint']
);

const eslintConfig = [
  ...nextConfig,
  {
    // Ignore legacy/backup directories and experimental copies
    ignores: [
      'src/**/.backup_*',
      'src/**/.backup_*/**',
      'src/**/.deprecated_*',
      'src/**/.deprecated_*/**',
    ],
    plugins: {
      '@next/next': nextPluginConfig.plugins['@next/next'],
      '@typescript-eslint': typescriptPluginConfig.plugins['@typescript-eslint'],
      react: nextPluginConfig.plugins.react,
      'react-hooks': nextPluginConfig.plugins['react-hooks'],
    },
    rules: {
      '@typescript-eslint/no-unused-vars': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
      'react/jsx-key': 'warn',
      'react/no-unescaped-entities': 'off',
      'react-hooks/immutability': 'off',
      'react-hooks/preserve-manual-memoization': 'off',
      'react-hooks/purity': 'off',
      'react-hooks/refs': 'off',
      'react-hooks/set-state-in-effect': 'off',
      'react-hooks/static-components': 'off',
      'react-hooks/exhaustive-deps': 'warn',
      '@next/next/no-img-element': 'warn',
      '@typescript-eslint/no-empty-object-type': 'off',
      'prefer-const': 'warn',
    },
  },
];

export default eslintConfig;
