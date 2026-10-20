/** 生成任务02临时组合包，复用固定官方浏览器与既有测试 Host；不自动安装或修改 profile。 */
import { createHash, randomUUID } from 'node:crypto'
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import process from 'node:process'
import ts from 'typescript'

/** 只有临时副本被修改；每个接入必须唯一匹配，版本漂移时停止。 */
async function main(): Promise<void> {
  if (process.argv.length !== 2) {
    throw new Error('此命令无参数，只生成本次账号容器诊断包')
  }
  // Node 直接执行 .ts 工具；动态路径避免把生产 .js 导入约定误用于未编译脚本。
  const { prepare } = await import(new URL('./verify-official-browser-reuse.ts', import.meta.url).href) as { prepare: (native: boolean) => Promise<string> }
  const directory = await prepare(false)
  const run = randomUUID().replaceAll('-', '').slice(0, 12)
  const plugin = join(directory, 'login-scope-plugin')
  mkdirSync(plugin)
  mkdirSync(join(directory, 'workspace-b'))
  let code = readFileSync(join(directory, 'client-reuse-probe.js'), 'utf8')
  function replace(before: string, after: string): void {
    if (code.split(before).length !== 2) {
      throw new Error('账号诊断接入与固定官方产物不一致')
    }
    code = code.replace(before, after)
  }
  const client = ts.transpileModule(readFileSync(new URL('./login-scope-client.ts', import.meta.url), 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText
  const adapter = `const scopeAdapter = (() => { const module = { exports: {} }; const exports = module.exports;\n${client}\nreturn module.exports; })();\n`
  replace('function apply(ctx, onPage, registerShortcuts = false) {', 'function apply(ctx, onPage, registerShortcuts = false, account) {')
  replace('browserWorkspace(scope.workspaces.list, sessionId, signal)', 'browserWorkspace(scope.workspaces.list, sessionId, signal).then(identity => account(sessionId, identity))')
  replace('created.page.frame.element : undefined });', 'created.page.frame.element : undefined, getAccount: () => created.page.frame.workspaceKey });')
  replace('exports.apply = (ctx) => { const tooling = reuseAdapter.createToolClient(ctx);', `${adapter}exports.apply = (ctx) => { const tooling = scopeAdapter.createLoginScopeClient(ctx, reuseAdapter.createToolClient, ${JSON.stringify(run)});`)
  replace('apply(ctx, tooling.attach);', 'apply(ctx, tooling.attach, false, tooling.account);')
  const id = `dsh-plugin-login-scope-probe-${run}`
  code = code.replaceAll('dsh-plugin-official-browser-reuse-probe', id).replace('"officialBrowserReuseProbe"', `"loginScopeProbe${run}"`)
  writeFileSync(join(plugin, 'client.js'), code)
  const host = ts.transpileModule(readFileSync(new URL('./login-scope-host.ts', import.meta.url), 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  }).outputText.replace('__LOGIN_SCOPE_RUN__', run)
  writeFileSync(join(plugin, 'index.js'), host)
  const upstream = JSON.parse(readFileSync(join(directory, 'package/package.json'), 'utf8')) as { dsh: { client: { inject: string[] } } }
  writeFileSync(join(plugin, 'package.json'), `${JSON.stringify({
    name: id,
    version: '0.0.0-scope-probe.1',
    type: 'module',
    main: 'index.js',
    description: '任务02临时账号容器验证；不访问真实账号，不是产品实现',
    exports: { '.': './index.js', './client': './client.js' },
    dsh: { bundle: { patch: './cordis.patch.yml' }, client: { platform: 'web', inject: [...upstream.dsh.client.inject, '@deepseek-ai/dsh-client-connection'] } },
    license: 'MIT',
  }, null, 2)}\n`)
  copyFileSync(join(directory, 'package/LICENSE'), join(plugin, 'LICENSE'))
  writeFileSync(join(plugin, 'cordis.patch.yml'), `# 临时诊断，沿用正式 Host/Client 注册与卸载。\n- insert:\n    - id: login-scope-probe-${run}\n      name: ${id}\n`)
  const artifact = { run, directory, plugin, workspaceB: join(directory, 'workspace-b'), clientSha256: createHash('sha256').update(code).digest('hex'), nativeDesktop: 'not-verified' }
  writeFileSync(join(directory, 'login-scope-artifact.json'), `${JSON.stringify(artifact, null, 2)}\n`)
  process.stdout.write(`${JSON.stringify(artifact, null, 2)}\n`)
}

void main().catch((error) => {
  process.stderr.write(`${String(error)}\n`)
  process.exitCode = 1
})
