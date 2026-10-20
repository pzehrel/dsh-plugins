/** 根 vitest 收集规则：测试只从各包的 test/ 目录发现，不与源码或构建产物混放。 */
import process from 'node:process'
import { defineConfig } from 'vitest/config'

// CI 显式提供报告路径；测试启动的子进程继承 worker 身份，不得覆盖根检查报告。
const ciReport = process.env.VITEST_WORKER_ID ? undefined : process.env.DSH_CI_VITEST_REPORT

export default defineConfig({
  test: {
    include: ['plugins/*/test/**/*.{test,spec}.ts', 'packages/*/test/**/*.{test,spec}.ts'],
    reporters: ciReport ? ['default', 'json'] : ['default'],
    outputFile: ciReport ? { json: ciReport } : undefined,
  },
})
