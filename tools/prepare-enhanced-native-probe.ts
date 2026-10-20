/** 生成独立的真实 Host 工具验收驱动；不改增强包，不安装插件，不向模型或外部服务发送消息。 */
import { spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'
import { fileURLToPath, pathToFileURL } from 'node:url'
import ts from 'typescript'

const sessionId = process.argv[2]
const options = process.argv.slice(3)
const lifecycle = options.includes('--lifecycle')
const approvalProbe = options.includes('--approval-probe')
const actionOption = options.find(option => option.startsWith('--actions='))
const actions = actionOption?.slice('--actions='.length).split(',')
if (!sessionId || !/^session-[a-f\d-]+$/u.test(sessionId)
  || options.some(option => option !== '--lifecycle' && option !== '--approval-probe' && option !== actionOption)
  || new Set(options).size !== options.length
  || actions?.some(action => !/^[a-z][a-z-]{0,40}$/u.test(action))) {
  throw new Error('请提供仅用于验收的已存在实时会话身份')
}
const directory = mkdtempSync(join(tmpdir(), 'dsh-enhanced-native-'))
const run = randomUUID().replaceAll('-', '')
const id = `dsh-plugin-enhanced-native-driver-${run}`
// 热安装的新linkedRoot不一定进入宿主启动时解析表；沿既有仓库node_modules正常解析，且不放入构建会重建的.build。
const plugin = fileURLToPath(new URL(`../dist/native-probes/${run}/driver`, import.meta.url))
mkdirSync(plugin, { recursive: true })
const controlFile = join(directory, 'control.json')
const artifactDirectory = actions?.includes('screenshot') ? join(directory, 'images') : undefined
if (artifactDirectory) {
  mkdirSync(artifactDirectory, { mode: 0o700 })
}
const source = ts.transpileModule(readFileSync(new URL('./enhanced-native-driver.ts', import.meta.url), 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
}).outputText
writeFileSync(join(plugin, 'driver-config.json'), JSON.stringify({ sessionId, controlFile, lifecycle, actions, artifactDirectory, approvalProbe }))
writeFileSync(join(plugin, 'index.js'), source)
if (spawnSync(process.execPath, ['--check', join(plugin, 'index.js')]).status !== 0) {
  throw new Error('生成的原生验收驱动语法无效')
}
writeFileSync(join(plugin, 'package.json'), `${JSON.stringify({
  name: id,
  version: '0.0.0-driver.1',
  private: true,
  type: 'module',
  main: 'index.js',
  exports: { '.': './index.js' },
  dsh: { bundle: { patch: './cordis.patch.yml' } },
  description: '固定页一次性真实工具验收驱动，不是增强包依赖',
  dependencies: { '@deepseek-ai/dsh-llm': '0.2.0-rc.2' },
}, null, 2)}\n`)
writeFileSync(join(plugin, 'cordis.patch.yml'), `# 验收完成后通过官方管理器卸载。\n- insert:\n    - id: enhanced-native-${run}\n      name: ${id}\n`)
// 安装前验证整个模块的正常依赖解析；只读取apply导出，不执行插件或接触Agent。
const imported = spawnSync(process.execPath, ['--input-type=module', '-e', 'const m=await import(process.argv[1]);if(typeof m.apply!=="function")throw Error("missing apply export")', pathToFileURL(join(plugin, 'index.js')).href], { encoding: 'utf8' })
if (imported.status !== 0) {
  throw new Error(`生成的原生验收驱动模块导入失败：${String(imported.error ?? imported.stderr).slice(0, 2000)}`)
}
// 只记录自有配置的摘要与副本，不输出 profile 内容或已有凭据。
const baseline = join(directory, 'profile-before')
mkdirSync(baseline, { mode: 0o700 })
for (const file of ['cordis.yml', 'cordis.patch.yml', 'package.json', 'gro.ngilp-hsd-versions.json']) {
  const bytes = readFileSync(join(process.env.HOME!, '.dsh/profiles/desktop', file))
  writeFileSync(join(baseline, file), bytes, { mode: 0o600 })
}
writeFileSync(join(directory, 'artifact.json'), `${JSON.stringify({ directory, plugin, id, controlFile, sessionId }, null, 2)}\n`)
process.stdout.write(`${JSON.stringify({ directory, plugin, controlFile }, null, 2)}\n`)
