/**
 * ESLint 9 扁平配置（仓库根，覆盖全部 packages）。
 * 基线：JS recommended + typescript-eslint recommended + react-hooks 规则。
 */
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';

/** 脚本/配置文件的 Node 全局（避免引入额外 globals 依赖） */
const NODE_GLOBALS = {
  console: 'readonly',
  process: 'readonly',
  Buffer: 'readonly',
  setTimeout: 'readonly',
  clearTimeout: 'readonly',
  setInterval: 'readonly',
  clearInterval: 'readonly',
  global: 'readonly',
  globalThis: 'readonly',
  URL: 'readonly',
  fetch: 'readonly',
  window: 'readonly',
  document: 'readonly',
};

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/coverage/**',
      '**/node_modules/**',
      'reference-grok-app/**',
      '**/scripts/*.cjs',
      // T05：Rust 桌面壳（产物 bundle / cargo target / 生成 schema 不做 JS lint）
      'src-tauri/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    languageOptions: {
      globals: {
        ...NODE_GLOBALS,
        React: 'readonly',
        HTMLElement: 'readonly',
        HTMLInputElement: 'readonly',
        HTMLTextAreaElement: 'readonly',
        HTMLDivElement: 'readonly',
        KeyboardEvent: 'readonly',
        MouseEvent: 'readonly',
        matchMedia: 'readonly',
        localStorage: 'readonly',
        requestAnimationFrame: 'readonly',
        cancelAnimationFrame: 'readonly',
        crypto: 'readonly',
      },
    },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/consistent-type-imports': ['warn', { fixStyle: 'inline-type-imports' }],
    },
  },
  {
    files: ['**/*.mjs', '*.js'],
    languageOptions: { globals: NODE_GLOBALS },
  },
);
