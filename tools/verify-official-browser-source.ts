/** 校验固定官方源码与发布包的来源、全部声明及关键运行逻辑；不声称整个 bundle 可逐字节重建。 */
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const root = fileURLToPath(new URL('../', import.meta.url))
const plugin = join(root, 'plugins/agent-browser')
const work = join(plugin, '.build/source-verification')
const published = join(plugin, 'upstream/published-browser-0.2.0-rc.2.tgz')
const integrity = 'tp5007jcJlcJnnjslpix4XbnbKGpKQjXCzlRKyFdUqcbua7Oqn1ZcIrCM/+gvgd3cOC+ZlAxrmyJQtbulFg4oQ=='
if (createHash('sha512').update(readFileSync(published)).digest('base64') !== integrity) {
  throw new Error('官方 npm 发布包摘要不匹配')
}
const provenance = JSON.parse(readFileSync(join(plugin, 'upstream/provenance.json'), 'utf8')) as { vendoredArchiveSha256: string, files: Record<string, string> }
const archive = join(plugin, 'upstream/official-browser-0.2.0-rc.2.tgz')
if (createHash('sha256').update(readFileSync(archive)).digest('hex') !== provenance.vendoredArchiveSha256) {
  throw new Error('官方源码归档摘要不匹配')
}
rmSync(work, { recursive: true, force: true })
mkdirSync(join(work, 'source'), { recursive: true })
for (const [input, target] of [[archive, join(work, 'source')], [published, work]]) {
  if (spawnSync('tar', ['-xzf', input!, '-C', target!]).status !== 0) {
    throw new Error('固定公开归档解压失败')
  }
}
for (const [file, sha256] of Object.entries(provenance.files)) {
  if (createHash('sha256').update(readFileSync(join(work, 'source', file))).digest('hex') !== sha256) {
    throw new Error(`官方源码文件摘要不匹配：${file}`)
  }
}
if (!readFileSync(join(plugin, 'upstream/LICENSE')).equals(readFileSync(join(work, 'package/LICENSE')))) {
  throw new Error('源码与发布包 MIT 许可证不一致')
}
const config = join(work, 'tsconfig.json')
writeFileSync(config, JSON.stringify({
  extends: join(root, 'tsconfig.base.json'),
  compilerOptions: { jsx: 'react-jsx', lib: ['ES2022', 'DOM'], types: ['react'], allowImportingTsExtensions: true, declaration: true, declarationMap: true, emitDeclarationOnly: true, rootDir: 'source/src', outDir: 'declarations' },
  include: ['source/src/**/*'],
}))
const compile = spawnSync('pnpm', ['exec', 'tsc', '-p', config], { cwd: root, encoding: 'utf8' })
if (compile.status !== 0) {
  process.stderr.write(compile.stdout + compile.stderr)
  throw new Error('官方源码声明生成失败')
}
const listing = spawnSync('tar', ['-tzf', published], { encoding: 'utf8' })
const declarations = listing.stdout.trim().split('\n').filter(name => name.startsWith('package/lib/types/') && name.endsWith('.d.ts')).map((file) => {
  const name = file.slice('package/lib/types/'.length)
  const bytes = readFileSync(join(work, 'declarations', name))
  if (!bytes.equals(readFileSync(join(work, file)))) {
    throw new Error(`源码声明与发布包不一致：${name}`)
  }
  return { file: name, byteIdentical: true, sha256: createHash('sha256').update(bytes).digest('hex') }
})
if (declarations.length !== 22) {
  throw new Error('固定发布包声明数量漂移')
}

/** @param node JS 节点。@returns 去除引号、括号和 bundler 外部绑定形式差异的结构；不消除业务分支。 */
function canonical(node: ts.Node): unknown {
  if (ts.isParenthesizedExpression(node)) {
    return canonical(node.expression)
  }
  if ((ts.isVoidExpression(node) && ts.isNumericLiteral(node.expression) && node.expression.text === '0') || (ts.isIdentifier(node) && node.text === 'undefined')) {
    return ['undefined']
  }
  if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.CommaToken && node.left.getText() === '0') {
    return canonical(node.right)
  }
  if (ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.expression) && node.expression.text.startsWith('_deepseek_ai_')) {
    return ['Identifier', node.name.text]
  }
  if (ts.isIdentifier(node)) {
    return ['Identifier', node.text]
  }
  if (ts.isStringLiteral(node) || ts.isNumericLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
    return [ts.SyntaxKind[node.kind], node.text]
  }
  const children: unknown[] = []
  node.forEachChild((child) => {
    children.push(canonical(child))
  })
  return [ts.SyntaxKind[node.kind], ...children]
}

/** @param code 同一函数所在的已编译 JS。@param symbol 函数名。@returns 可比较的函数体，缺失即停止。 */
function body(code: string, symbol: string): ts.Block {
  const ast = ts.createSourceFile('reference.js', code, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS)
  const declaration = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === symbol)
  if (!declaration || !ts.isFunctionDeclaration(declaration) || !declaration.body) {
    throw new Error(`关键函数未找到：${symbol}`)
  }
  return declaration.body
}
const bundle = readFileSync(join(work, 'package/lib/client.js'), 'utf8')
const functions = [
  ['definition', 'browserDefinition'],
  ['index', 'apply'],
  ['pages', 'createIframePage'],
  ['browser/BrowserFrame', 'emptyBrowserFrame'],
  ['browser/BrowserPersistence', 'currentBrowserTarget'],
  ['browser/BrowserPersistence', 'browserAddressCheckpoint'],
  ['electron/pages', 'createElectronPage'],
].map(([module, symbol]) => {
  const path = `${module!}.${module === 'definition' ? 'tsx' : 'ts'}`
  const code = ts.transpileModule(readFileSync(join(work, 'source/src/client', path), 'utf8'), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ESNext, jsx: ts.JsxEmit.ReactJSX } }).outputText
  const marker = `//#region lib/types/client/${module}.js`
  const start = bundle.indexOf(marker)
  if (start < 0) {
    throw new Error(`官方 bundle 片段缺失：${module}`)
  }
  const section = bundle.slice(start, bundle.indexOf('//#endregion', start))
  if (JSON.stringify(canonical(body(code, symbol!))) !== JSON.stringify(canonical(body(section, symbol!)))) {
    throw new Error(`关键函数逻辑不对应：${symbol}`)
  }
  return { module, symbol, normalizedAstIdentical: true }
})
const report = {
  observedAtUtc: new Date().toISOString(),
  status: 'passed-source-correspondence',
  sourceCommit: '639ed015397290b3745d163aafe02ffee4aa3f84',
  npmPackage: '@deepseek-ai/dsh-client-ui-sidebar-browser@0.2.0-rc.2',
  npmIntegrity: `sha512-${integrity}`,
  sourceFiles: Object.keys(provenance.files).length,
  license: 'byte-identical MIT',
  declarations,
  functions,
  limitations: ['未声明整个官方 bundle 可逐字节重建；上游 CSS 与打包优化存在产物差异', '源码对应验证不代替真实 Desktop 行为验收'],
}
const reportFile = join(plugin, '.build/source-correspondence.json')
writeFileSync(reportFile, `${JSON.stringify(report, null, 2)}\n`)
process.stdout.write(`${JSON.stringify({ report: reportFile, declarations: declarations.length, functions: functions.length, status: report.status })}\n`)
