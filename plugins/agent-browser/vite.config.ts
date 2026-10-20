/** 仅构建实验 Client，保留宿主 React，并按正式 factory 协议注册模块；不修改 DSH 产物。 */
import { copyFileSync } from 'node:fs'
import { defineConfig } from 'vite'

export default defineConfig({
  build: {
    emptyOutDir: false,
    lib: { entry: 'src/client.tsx', formats: ['cjs'], fileName: () => 'client.js' },
    rollupOptions: {
      external: ['react'],
      output: { exports: 'named' },
      plugins: [{
        name: 'dsh-experiment-factory',
        renderChunk(code) {
          return `globalThis.__ModuleLoader__.load({id:"dsh-plugin-agent-browser-spike",factory(require){const module={exports:{}};const exports=module.exports;${code}\nreturn module.exports;}});`
        },
        closeBundle() {
          // 使用新的插件物理入口区分旧 Node 模块缓存；不改宿主文件，也不依赖 file URL query 的解析细节。
          copyFileSync('dist/index.js', 'dist/host-fetch-routes-2.js')
        },
      }],
    },
  },
})
