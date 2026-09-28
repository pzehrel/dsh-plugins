/** 本包 vitest 收集规则：测试只从 test/ 目录发现，不与源码或构建产物混放。 */
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['test/**/*.{test,spec}.ts'],
  },
})
