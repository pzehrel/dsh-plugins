/** 从固定官方源码构建浏览器增强与根包默认装配；只写构建目录，不安装插件或修改宿主。 */
import type { Rollup } from 'vite'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { build } from 'vite'

const root = fileURLToPath(new URL('../', import.meta.url))
const directory = join(root, 'plugins/agent-browser')
const prepared = join(directory, '.build')
const output = join(directory, 'dist/enhanced')
const pluginId = 'dsh-plugin-agent-browser'
const archive = join(directory, 'upstream/official-browser-0.2.0-rc.2.tgz')
const sourceIntegrity = '133cd34e9384321e097bb4ae830bc27e087a597959f069a814f29b81a34afcb9'
// 官方宿主进程可能保留同名包的解析缓存；独立构建身份确保 Host 与 Client 来自同一份内容。
const inputs = ['src/broker.ts', 'src/protocol.ts', 'src/fixed-page-host.ts', 'src/fixed-page-client.ts', 'src/enhanced-host.ts', 'src/tool-status.tsx', 'src/capability-feedback.ts', 'src/download-fixture.ts', 'src/semantic-fixture.ts', 'src/semantic-observation.ts', 'src/semantic-contract.ts', 'src/screenshot.ts', 'src/screenshot-host.ts', 'src/session-navigation.ts', 'src/page-console.ts', 'src/native-input.ts', 'src/agent-pointer.ts', 'src/native-upload.ts', 'src/native-upload-fixture.ts', 'upstream/enhancement.patch']
const digest = createHash('sha256').update(sourceIntegrity).update(readFileSync(fileURLToPath(import.meta.url)))
for (const input of inputs) {
  digest.update(readFileSync(join(directory, input)))
}
const fingerprint = digest.digest('hex').slice(0, 12)
const artifactId = `${pluginId}-${fingerprint}`

/** 仅处理自有固定归档和补丁；摘要漂移、补丁偏移或失败都停止构建。 */
function prepare(): void {
  if (createHash('sha256').update(readFileSync(archive)).digest('hex') !== sourceIntegrity) {
    throw new Error('固定官方源码归档摘要不匹配')
  }
  rmSync(prepared, { recursive: true, force: true })
  for (const variant of ['official', 'enhanced']) {
    const target = join(prepared, variant)
    mkdirSync(target, { recursive: true })
    const extraction = spawnSync('tar', ['-xzf', archive, '-C', target], { encoding: 'utf8' })
    if (extraction.status !== 0) {
      throw new Error('官方源码解压失败')
    }
  }
  const patch = spawnSync('patch', ['-p1', '--fuzz=0', '--batch', '-i', join(directory, 'upstream/enhancement.patch')], {
    cwd: join(prepared, 'enhanced'),
    encoding: 'utf8',
  })
  if (patch.status !== 0 || /offset|fuzz/iu.test(patch.stdout + patch.stderr)) {
    throw new Error('源码增强补丁未精确应用')
  }
  writeFileSync(join(prepared, 'enhanced.ts'), `/** 生成装配入口；源码由固定归档及 enhancement.patch 提供。 */
import type { Context } from '@deepseek-ai/cordis'
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import { apply as browserApply, inject as browserInject } from './enhanced/src/client/index.ts'
import { createToolClient } from '../src/fixed-page-client.ts'
import { createElement } from 'react'
import { ToolStatusView } from '../src/tool-status.tsx'
import type { SessionSidebar } from '../src/session-navigation.ts'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
export const inject = [...browserInject, 'connection', 'uiSession']
export function apply(ctx: Context & { connection: ConnectionHandle }): void {
  const tooling = createToolClient(ctx, 'agent-browser', ${JSON.stringify(fingerprint)}, ctx.sidebarRight as unknown as SessionSidebar)
  ctx.effect(() => () => tooling.dispose())
  const sessionBindings = new WeakSet<object>()
  ctx.effect(() => ctx.uiSession.provide({ props: ['agentBrowserSessionControl'], resolve(binding) {
    if (!sessionBindings.has(binding)) {
      sessionBindings.add(binding)
      binding.ctx.effect(() => {
        const lifetime = new AbortController()
        tooling.attachSession(binding.sessionId, lifetime.signal)
        return () => { sessionBindings.delete(binding); lifetime.abort() }
      })
    }
    return { props: { agentBrowserSessionControl: true } }
  } }))
  browserApply(ctx, tooling.attach, (sessionId, tabId) => createElement(ToolStatusView, { source: tooling.status(sessionId, tabId), takeover: () => tooling.takeover(sessionId, tabId), resume: () => tooling.resume(sessionId, tabId) }))
}
`)
}

/** @param enhanced 选择官方参考或独立增强。构建原 UI，仅改变模块与样式身份。 */
async function client(enhanced: boolean): Promise<void> {
  const id = enhanced ? artifactId : '@deepseek-ai/dsh-client-ui-sidebar-browser'
  await build({
    configFile: false,
    root: directory,
    define: { __AGENT_BROWSER_BUILD__: JSON.stringify(fingerprint) },
    esbuild: { jsx: 'automatic' },
    css: { modules: { generateScopedName: enhanced ? 'agent_browser_[local]' : 'official_browser_[local]' } },
    build: {
      emptyOutDir: false,
      outDir: enhanced ? output : join(directory, 'dist'),
      minify: false,
      target: 'es2022',
      lib: {
        entry: join(prepared, enhanced ? 'enhanced.ts' : 'official/src/client/index.ts'),
        formats: ['cjs'],
        fileName: () => enhanced ? 'client.js' : 'official-reference.js',
      },
      rollupOptions: {
        external: name => name === 'react' || name.startsWith('react/') || (name.startsWith('@deepseek-ai/') && name !== '@deepseek-ai/dsh-brand'),
        output: { exports: 'named' },
        plugins: [{
          name: 'official-browser-factory',
          generateBundle(_options, bundle) {
            // DSH factory 模块不能自行加载 CSS 文件；沿用官方带归属的 style 注册契约。
            const css = Object.values(bundle).filter((item): item is Rollup.OutputAsset => item.type === 'asset' && item.fileName.endsWith('.css'))
            const style = css.map(item => String(item.source)).join('\n')
            for (const item of css) {
              delete bundle[item.fileName]
            }
            const chunk = Object.values(bundle).find((item): item is Rollup.OutputChunk => item.type === 'chunk' && item.isEntry)
            if (!chunk) {
              throw new Error('Client 构建缺少入口')
            }
            const tagId = `${id}/Browser.module.css`
            const register = `const tagId=${JSON.stringify(tagId)};if(typeof document!=="undefined"&&document.querySelector('style[data-plugin-css='+JSON.stringify(tagId)+']')===null){const tag=document.createElement('style');tag.dataset.plugin=${JSON.stringify(id)};tag.dataset.pluginCss=tagId;tag.textContent=${JSON.stringify(style)};document.head.appendChild(tag);}`
            chunk.code = `window.__ModuleLoader__.load({id:${JSON.stringify(id)},factory(require){const module={exports:{}};const exports=module.exports;${register}\n${chunk.code}\nreturn module.exports;}});\n`
          },
        }],
      },
    },
  })
}

/** 构建独立 Host 与 Client，并写出正式 DSH 装配声明和许可证。 */
async function assemble(): Promise<void> {
  rmSync(output, { recursive: true, force: true })
  mkdirSync(output, { recursive: true })
  await client(false)
  await client(true)
  await build({
    configFile: false,
    root: directory,
    define: { __AGENT_BROWSER_BUILD__: JSON.stringify(fingerprint) },
    build: {
      emptyOutDir: false,
      outDir: output,
      minify: false,
      target: 'node22',
      lib: { entry: join(directory, 'src/enhanced-host.ts'), formats: ['es'], fileName: () => 'index.js' },
      rollupOptions: { external: name => name.startsWith('node:') || name.startsWith('@deepseek-ai/') },
    },
  })
  const hostFile = `host-${createHash('sha256').update(readFileSync(join(output, 'index.js'))).digest('hex').slice(0, 12)}.js`
  copyFileSync(join(output, 'index.js'), join(output, hostFile))
  writeFileSync(join(output, 'package.json'), `${JSON.stringify({
    name: artifactId,
    version: '0.1.0-preview.1',
    private: true,
    description: '复用 DSH 官方内置浏览器界面，提供同会话 Agent 页面工具与人工接管',
    type: 'module',
    main: hostFile,
    exports: { '.': `./${hostFile}`, './client': './client.js' },
    dependencies: { '@deepseek-ai/dsh-tools': '0.2.0-rc.2' },
    dsh: {
      bundle: { patch: './cordis.patch.yml' },
      client: { platform: 'web', inject: ['@deepseek-ai/dsh-api-workspace-controller', '@deepseek-ai/dsh-client-ui-sidebar-right', '@deepseek-ai/dsh-client-ui-session', '@deepseek-ai/dsh-client-connection'] },
    },
    license: 'MIT',
  }, null, 2)}\n`)
  // 根包用公开 factory require 复用同一增强模块；直接安装源码包也不会进入旧实验 Client。
  // 指纹包仍可独立安装，用于冻结部署；两种入口的浏览器实现与工具控制代码完全相同。
  writeFileSync(join(directory, 'dist/client.js'), `${readFileSync(join(output, 'client.js'), 'utf8')}\n/** 根包默认入口只导出已登记的官方源码增强模块。 */\nwindow.__ModuleLoader__.load({id:${JSON.stringify(pluginId)},factory(require){return require(${JSON.stringify(artifactId)});}});\n`)
  writeFileSync(join(directory, 'dist/cordis.patch.yml'), `# 根目录安装使用同一官方浏览器增强。\n- insert:\n    - id: agent-browser\n      name: ${pluginId}\n`)
  writeFileSync(join(output, 'cordis.patch.yml'), `# 独立增强拥有自己的 Host 与 Client，不依赖旧实验插件。\n- insert:\n    - id: agent-browser\n      name: ${artifactId}\n`)
  copyFileSync(join(directory, 'upstream/LICENSE'), join(output, 'LICENSE'))
  writeFileSync(join(output, 'build-evidence.json'), `${JSON.stringify({
    upstreamCommit: '639ed015397290b3745d163aafe02ffee4aa3f84',
    fingerprint,
    package: artifactId,
    sourceSha256: sourceIntegrity,
    patchSha256: createHash('sha256').update(readFileSync(join(directory, 'upstream/enhancement.patch'))).digest('hex'),
    hostSha256: createHash('sha256').update(readFileSync(join(output, 'index.js'))).digest('hex'),
    clientSha256: createHash('sha256').update(readFileSync(join(output, 'client.js'))).digest('hex'),
  }, null, 2)}\n`)
}

prepare()
if (process.argv[2] !== '--prepare') {
  void assemble().catch((error) => {
    process.stderr.write(`${String(error)}\n`)
    process.exitCode = 1
  })
}
