/** 为仓库源码及各包 test/ 目录下的 vitest 测试配置统一检查，并阻止测试文件回流 src/。 */
import antfu from '@antfu/eslint-config'

export default antfu({
  type: 'lib',
  lessOpinionated: true,
  stylistic: true,
  typescript: true,
  vue: false,
  formatters: false,
  ignores: ['**/dist/**', '**/coverage/**', 'plugins/agent-browser/.build/**'],
}, {
  files: ['pnpm-workspace.yaml'],
  rules: {
    'pnpm/yaml-enforce-settings': 'off',
  },
}, {
  files: ['plugins/*/src/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,tsx,jsx}', 'packages/*/src/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,tsx,jsx}'],
  rules: {
    'no-restricted-syntax': ['error', {
      selector: 'Program',
      message: '测试文件不得放进 src/：请移到包根的 test/ 目录，根 vitest 只收集各包 test/ 下的用例。',
    }],
  },
})
