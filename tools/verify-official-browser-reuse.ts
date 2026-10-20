/** 固定版本官方浏览器的复用成本实验：只生成临时增强包并执行受控测试，不修改 Desktop/profile。 */
import { Buffer } from 'node:buffer'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { build } from 'vite'

const root = fileURLToPath(new URL('../', import.meta.url))
const pluginId = 'dsh-plugin-official-browser-reuse-probe'
const adapterFile = new URL('../plugins/agent-browser/src/fixed-page-client.ts', import.meta.url)
const tarball = 'https://registry.npmjs.org/@deepseek-ai/dsh-client-ui-sidebar-browser/-/dsh-client-ui-sidebar-browser-0.2.0-rc.2.tgz'
const integrity = 'tp5007jcJlcJnnjslpix4XbnbKGpKQjXCzlRKyFdUqcbua7Oqn1ZcIrCM/+gvgd3cOC+ZlAxrmyJQtbulFg4oQ=='

/** @param original 官方发布包原始 Client。@param compiled 已打包全部本地依赖的适配代码。@param native 可选的一次性原生验收诊断源文件。@returns 增强产物和逐处改动；所有匹配必须唯一，版本漂移即拒绝。 */
function patchOfficialBrowser(original: string, compiled: string, native?: string): { code: string, changes: { reason: string, before: string, after: string }[] } {
  const changes: { reason: string, before: string, after: string }[] = []
  let code = original
  /** @param before 固定版本的唯一原文。@param after 仅实验产物的替换。@param reason 可审查的改动用途。 */
  function replace(before: string, after: string, reason: string): void {
    if (code.split(before).length !== 2) {
      throw new Error(`官方发布包匹配不唯一：${reason}`)
    }
    code = code.replace(before, after)
    changes.push({ reason, before, after })
  }
  replace('id: "@deepseek-ai/dsh-client-ui-sidebar-browser",', `id: "${pluginId}",`, '独立 Client 模块身份')
  replace('const BROWSER_ID = "@deepseek-ai/dsh-client-ui-sidebar-browser";', `const BROWSER_ID = "${pluginId}";`, '独立 Sidebar 实现身份')
  replace('const tagId = "@deepseek-ai/dsh-client-ui-sidebar-browser/Browser.module.css";', `const tagId = "${pluginId}/Browser.module.css";`, '隔离 CSS 注册，兼容同版不同构建的类名')
  replace('tag.dataset.plugin = "@deepseek-ai/dsh-client-ui-sidebar-browser";', `tag.dataset.plugin = "${pluginId}";`, '隔离增强插件样式归属')
  replace('priority: "builtin",', 'priority: "extension",', '通过正式扩展接管 browser kind')
  replace('const namespace = "sidebarBrowser";', 'const namespace = "officialBrowserReuseProbe";', '隔离增强插件 locale 注册')
  replace('persist: "dsh.sidebar-browser.v1",', 'persist: "dsh.official-browser-reuse-probe.v1",', '隔离实验检查点，不迁移内置页数据')
  replace('function apply(ctx) {', 'function apply(ctx, onPage, registerShortcuts = false) {', '增加页面登记回调，默认复用 builtin 快捷键')
  replace('ctx.inject(["shortcuts"], (ctx) => {', 'if (registerShortcuts) ctx.inject(["shortcuts"], (ctx) => {', '避免重复认领 browser.new 命令')
  replace('function createBrowserControllers(actions, createPage, isTabOpen) {', 'function createBrowserControllers(actions, createPage, isTabOpen, onPage) {', '将工具回调送至官方页面创建点')
  replace('const forget = () => {', 'onPage?.(request, { getGuest: () => created.page.frame.ready && !created.page.frame.lifetime.signal.aborted && !created.page.frame.getSnapshot().loading ? created.page.frame.element : undefined });\n\t\t\t\t\t\tconst forget = () => {', '只提供自有原生页面的有限 getter，沿用 occurrence 生命周期')
  const create = 'createBrowserControllers(actions, factory(sessionId), (tabId) => openTabs.getSnapshot().some((tab) => tab.sessionId === sessionId && tab.tabId === tabId))'
  replace(create, `${create.slice(0, -1)}, (request, target) => onPage(sessionId, request, target))`, '用正式正文会话绑定工具目标')
  const nativeCode = native ? ts.transpileModule(native, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText : ''
  const nativeFactory = native ? `const nativeAdapter = (() => { const module = { exports: {} }; const exports = module.exports;\n${nativeCode}\nreturn module.exports; })();` : ''
  const construct = native ? 'nativeAdapter.createNativeClient(ctx, reuseAdapter.createToolClient)' : 'reuseAdapter.createToolClient(ctx)'
  replace('exports.apply = apply;', `const reuseAdapter = (() => { const module = { exports: {} }; const exports = module.exports;\n${compiled}\nreturn module.exports; })();\n${nativeFactory}\nexports.apply = (ctx) => { const tooling = ${construct}; ctx.effect(() => () => tooling.dispose()); apply(ctx, tooling.attach); };`, '装配独立工具适配并绑定卸载清理')
  replace('exports.inject = inject;', 'exports.inject = [...inject, "connection"];', '消费既有正式 Connection 服务')
  return { code, changes }
}

/** @param native 是否额外生成本地可安装的诊断组合包，默认命令不生成。@returns 通过原始 tarball 摘要校验的实验目录；仅固定包内三个文件被解压，不自动安装。 */
export async function prepare(native: boolean): Promise<string> {
  const directory = mkdtempSync(join(tmpdir(), 'dsh-official-browser-probe-'))
  const response = await fetch(tarball, { signal: AbortSignal.timeout(30000), redirect: 'error' })
  if (!response.ok) {
    throw new Error(`官方包下载失败：HTTP ${response.status}`)
  }
  const bytes = Buffer.from(await response.arrayBuffer())
  if (bytes.length > 1024 * 1024 || createHash('sha512').update(bytes).digest('base64') !== integrity) {
    throw new Error('官方包体积或 SHA-512 与固定版本不符')
  }
  const archive = join(directory, 'upstream.tgz')
  writeFileSync(archive, bytes)
  const unpack = spawnSync('tar', ['-xzf', archive, '-C', directory, 'package/lib/client.js', 'package/package.json', 'package/LICENSE'], { encoding: 'utf8' })
  if (unpack.status !== 0) {
    throw new Error('官方包定向解压失败')
  }
  const originalFile = join(directory, 'package/lib/client.js')
  const original = readFileSync(originalFile, 'utf8')
  const adapter = readFileSync(adapterFile, 'utf8')
  // Client 已拆为多个本地模块；单文件转译会留下无法由插件 factory 解析的相对 require。
  const bundled = await build({ configFile: false, root, logLevel: 'error', build: { write: false, minify: false, target: 'es2022', lib: { entry: fileURLToPath(adapterFile), formats: ['cjs'] }, rollupOptions: { output: { exports: 'named' } } } })
  const outputs = Array.isArray(bundled) ? bundled : [bundled]
  const chunks = outputs.flatMap(output => 'output' in output ? output.output.filter(item => item.type === 'chunk') : [])
  if (chunks.length !== 1 || !chunks[0]!.isEntry) {
    throw new Error('适配代码必须生成为一个包含本地依赖的入口模块')
  }
  const compiled = chunks[0]!.code
  const patched = patchOfficialBrowser(original, compiled)
  const output = join(directory, 'client-reuse-probe.js')
  writeFileSync(output, patched.code)
  if (native) {
    const nativeDirectory = join(directory, 'native-plugin')
    mkdirSync(nativeDirectory)
    const observer = readFileSync(new URL('./official-browser-native-probe.ts', import.meta.url), 'utf8')
    const nativeCode = patchOfficialBrowser(original, compiled, observer).code
    // 每个诊断构建使用内容身份，避免同包名的模块/manifest 缓存把旧产物误当作新版。
    const build = createHash('sha256').update(nativeCode).digest('hex').slice(0, 8)
    const nativeId = `${pluginId}-${build}`
    writeFileSync(join(nativeDirectory, 'client.js'), nativeCode.replaceAll(pluginId, nativeId).replace('"officialBrowserReuseProbe"', `"officialBrowserReuseProbe${build}"`))
    // 本地临时包只增加 Client；既有实验 Host 继续拥有原工具与测试站，避免重复注册。
    writeFileSync(join(nativeDirectory, 'index.js'), '/** 原生复用验证的空 Host companion；复用已加载的实验 Host。 */\nexport function apply() {}\n')
    const upstream = JSON.parse(readFileSync(join(directory, 'package/package.json'), 'utf8')) as { dsh: { client: { inject: string[] } } }
    writeFileSync(join(nativeDirectory, 'package.json'), `${JSON.stringify({
      name: nativeId,
      version: '0.0.0-native-probe.1',
      description: '临时验证官方浏览器复用与固定工具，不是完整浏览器产品',
      type: 'module',
      main: 'index.js',
      exports: { '.': './index.js', './client': './client.js' },
      dsh: { bundle: { patch: './cordis.patch.yml' }, client: { platform: 'web', inject: [...upstream.dsh.client.inject, '@deepseek-ai/dsh-client-connection'] } },
      license: 'MIT',
    }, null, 2)}\n`)
    copyFileSync(join(directory, 'package/LICENSE'), join(nativeDirectory, 'LICENSE'))
    writeFileSync(join(nativeDirectory, 'cordis.patch.yml'), `# 只加载可卸载的复用实验 Client，不重复注册既有 Host 工具。\n- insert:\n    - id: official-browser-reuse-probe-${build}\n      name: ${nativeId}\n`)
  }
  const diff = spawnSync('diff', ['-u', '--label', 'official/client.js', '--label', 'probe/client.js', originalFile, output], { encoding: 'utf8' })
  if (diff.status !== 1) {
    throw new Error('实验产物没有可审查差异')
  }
  writeFileSync(join(directory, 'official-browser.patch'), diff.stdout)
  const preservation = ['view/BrowserBody', 'view/BrowserTitle', 'electron/ElectronWebViewImpl', 'electron/ElectronWebviewPresentation', 'electron/pages']
    .map((name) => {
      const marker = `//#region lib/types/client/${name}.js`
      const section = (source: string): string => {
        const start = source.indexOf(marker)
        const end = source.indexOf('//#endregion', start)
        if (start < 0 || end < 0) {
          throw new Error(`官方实现片段缺失：${name}`)
        }
        return source.slice(start, end)
      }
      const upstream = section(original)
      if (upstream !== section(patched.code)) {
        throw new Error(`官方页面实现被扩大修改：${name}`)
      }
      return { name, status: 'byte-identical', sha256: createHash('sha256').update(upstream).digest('hex') }
    })
  writeFileSync(join(directory, 'report.json'), JSON.stringify({
    observedAtUtc: new Date().toISOString(),
    upstream: { package: '@deepseek-ai/dsh-client-ui-sidebar-browser', version: '0.2.0-rc.2', tarball, integrity: `sha512-${integrity}`, clientSha256: createHash('sha256').update(original).digest('hex') },
    sourceEdits: patched.changes.map(({ reason, before, after }) => ({ reason, removedLines: before.split('\n').length, addedLines: after.split('\n').length })),
    adapterSourceLines: adapter.trimEnd().split('\n').length,
    upstreamClientLines: original.trimEnd().split('\n').length,
    preserved: preservation,
    controlledIntegration: 'not-verified',
    nativeDesktop: 'not-verified',
    limitations: ['宿主服务与原生 guest 只在外部边界模拟', '未验证真实 UI 渲染、原生输入、完整生命周期或暂停隐私屏障', '补丁针对固定发布 bundle，仅作复用成本实验，不是生产发布方式'],
  }, null, 2))
  return directory
}

/** 下载、生成并执行定向验证；六项全部通过且无失败、跳过才退出成功，标准输出保留命令与计数。 */
async function main(): Promise<void> {
  const args = process.argv.slice(2)
  if (args.length > 1 || (args.length === 1 && args[0] !== '--native')) {
    throw new Error('仅支持可选的 --native：生成本地临时增强包，不自动安装或修改 profile')
  }
  const directory = await prepare(args[0] === '--native')
  const results = join(directory, 'vitest-results.json')
  const test = spawnSync('pnpm', ['exec', 'vitest', 'run', 'plugins/agent-browser/test/official-browser-reuse.test.ts', '--reporter=default', '--reporter=json', `--outputFile=${results}`], {
    cwd: root,
    env: { ...process.env, DSH_OFFICIAL_BROWSER_PROBE: directory },
    stdio: 'inherit',
  })
  const file = join(directory, 'report.json')
  const report = JSON.parse(readFileSync(file, 'utf8')) as { controlledIntegration: string, tests?: { total: number, passed: number, failed: number, pending: number } }
  const counts = JSON.parse(readFileSync(results, 'utf8')) as { numTotalTests: number, numPassedTests: number, numFailedTests: number, numPendingTests: number }
  report.tests = { total: counts.numTotalTests, passed: counts.numPassedTests, failed: counts.numFailedTests, pending: counts.numPendingTests }
  // 六项是这个固定历史套件的验收范围，不是仓库统一检查的永久总数。
  report.controlledIntegration = test.status === 0 && counts.numTotalTests === 6 && counts.numPassedTests === 6 && counts.numFailedTests === 0 && counts.numPendingTests === 0 ? 'passed' : 'failed'
  writeFileSync(file, `${JSON.stringify(report, null, 2)}\n`)
  process.stdout.write(`${JSON.stringify({ command: `node tools/verify-official-browser-reuse.ts${args[0] === '--native' ? ' --native' : ''}`, artifactDirectory: directory, report: file, tests: report.tests, controlledIntegration: report.controlledIntegration, nativeDesktop: 'not-verified' }, null, 2)}\n`)
  process.exitCode = report.controlledIntegration === 'passed' ? 0 : 1
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  void main().catch((error) => {
    process.stderr.write(`${String(error)}\n`)
    process.exitCode = 1
  })
}
