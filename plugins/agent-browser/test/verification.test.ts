/** 在命令行输入/输出 seam 验证分级报告；只替换外部 pnpm 进程，不伪造 Desktop。 */
import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'

const root = fileURLToPath(new URL('../../../', import.meta.url))
const prefix = 'dsh-verification-test-'
const historicalFixture = 'HISTORICAL_FIXTURE'
const buildFixture = 'BUILD_FIXTURE'

/** @param args 传给公开 CLI 的参数。@param failBuild 是否让外部构建夹具失败，默认 false。@returns 退出码、输出和外部命令记录；临时夹具结束后安全清理。 */
async function invoke(args: string[] = [], failBuild = false, record?: object): Promise<{ code: number, stdout: string, stderr: string, commands: string[][] }> {
  const directory = await mkdtemp(join(tmpdir(), prefix))
  // 验证不可变的清理目标，后续 finally 只删除本测试自己创建的目录。
  if (resolve(dirname(directory)) !== resolve(tmpdir()) || !basename(directory).startsWith(prefix)) {
    throw new Error('拒绝清理非测试临时目录')
  }
  const manager = join(directory, 'pnpm-fixture.mjs')
  const log = join(directory, 'commands.jsonl')
  const evidence = join(directory, 'historical.json')
  // 记录来源是外部输入夹具，不依赖真实会话数据或随用户更新的实测文件。
  await writeFile(evidence, JSON.stringify(record ?? { observedAtUtc: '2000-01-01T00:00:00Z', observations: [{ count: 1 }], host: { ready: true, registerStatus: 200 }, privateValue: 'fixture-secret-not-for-output' }))
  const build = join(directory, 'build-evidence.json')
  await writeFile(build, JSON.stringify({ fingerprint: '0123456789ab', package: 'dsh-plugin-agent-browser-0123456789ab' }))
  const commandArgs = args.map(arg => arg === historicalFixture ? evidence : arg === buildFixture ? build : arg)
  await writeFile(log, '')
  await writeFile(manager, `// 外部命令夹具仅接受预期的三条已有检查，不执行构建或浏览器动作。
import { appendFileSync } from 'node:fs';
const args = process.argv.slice(2);
appendFileSync(process.env.VERIFY_FIXTURE_LOG, JSON.stringify(args) + String.fromCharCode(10));
if (process.env.VERIFY_FIXTURE_FAIL_BUILD === '1' && args.at(-1) === 'build') process.exit(7);
const expected = [
  ['--filter', './plugins/agent-browser', 'build'],
  ['--filter', './plugins/agent-browser', 'typecheck'],
  ['exec', 'vitest', 'run', 'plugins/agent-browser/test/broker.test.ts', 'plugins/agent-browser/test/connection.test.ts']
];
process.exit(expected.some(row => JSON.stringify(row) === JSON.stringify(process.argv.slice(2))) ? 0 : 90);
`)
  try {
    const execution = await new Promise<{ code: number, stdout: string, stderr: string }>((done) => {
      execFile(process.execPath, [join(root, 'tools/verify-agent-browser.ts'), ...commandArgs], {
        cwd: root,
        encoding: 'utf8',
        env: { ...process.env, npm_execpath: manager, VERIFY_FIXTURE_LOG: log, VERIFY_FIXTURE_FAIL_BUILD: failBuild ? '1' : '0' },
        timeout: 10000,
      }, (error, stdout, stderr) => {
        done({ code: error ? (typeof error.code === 'number' ? error.code : 1) : 0, stdout, stderr })
      })
    })
    const commands = (await readFile(log, 'utf8')).split('\n').filter(Boolean).map(row => JSON.parse(row) as string[])
    return { ...execution, commands }
  }
  finally {
    await rm(directory, { recursive: true, force: true })
  }
}

it('缺少运行态证据时只报告构建和协议通过，原生验收保持未验证', async () => {
  const result = await invoke()
  expect(result.code, result.stderr).toBe(0)
  const report = JSON.parse(result.stdout)
  expect(report.levels.build.status).toBe('passed')
  expect(report.levels.protocol.status).toBe('passed')
  expect(report.levels.host.status).toBe('not-verified')
  expect(report.levels.native.status).toBe('not-verified')
  expect(report.fullyVerified).toBe(false)
})

it('当前 Host 探针通过也不代表本次原生页面验收通过', async () => {
  const server = createServer((_request, response) => {
    response.setHeader('content-type', 'application/json')
    response.end(JSON.stringify({ build: 'fetch-routes-v2', ready: true, registerStatus: 200, error: '' }))
  })
  await new Promise<void>((done) => {
    server.listen(0, '127.0.0.1', done)
  })
  const address = server.address()
  if (!address || typeof address === 'string') {
    throw new Error('测试探针未绑定端口')
  }
  try {
    const result = await invoke(['--host-probe', `http://127.0.0.1:${address.port}/_agent_browser_spike_status`])
    expect(result.code, result.stderr).toBe(0)
    const report = JSON.parse(result.stdout)
    expect(report.levels.host.status).toBe('passed')
    expect(report.levels.host.observedBuild).toBe('fetch-routes-v2')
    expect(report.levels.native.status).toBe('not-verified')
    expect(report.fullyVerified).toBe(false)
  }
  finally {
    server.closeAllConnections()
    await new Promise<void>((done) => {
      server.close(() => done())
    })
  }
})

it('构建失败时报告失败并停止后续协议命令', async () => {
  const result = await invoke([], true)
  expect(result.code).toBe(1)
  const report = JSON.parse(result.stdout)
  expect(report.levels.build.status).toBe('failed')
  expect(report.levels.protocol.status).toBe('not-verified')
  expect(result.commands).toHaveLength(1)
  expect(report.fullyVerified).toBe(false)
})

it.each([
  'https://example.invalid/_agent_browser_spike_status',
  'http://127.0.0.1:1234/other',
  'http://user:not-a-secret@127.0.0.1:1234/_agent_browser_spike_status',
  'http://127.0.0.1:1234/_agent_browser_spike_status?token=not-a-secret',
  'http://127.0.0.1:1234/_agent_browser_spike_status#fragment',
])('无效探针地址在任何外部命令前拒绝：%s', async (url) => {
  const result = await invoke(['--host-probe', url])
  expect(result.code).toBe(1)
  expect(result.commands).toEqual([])
  expect(result.stdout).toBe('')
  expect(result.stderr).not.toContain('not-a-secret')
})

it('历史实测文件只能标记为记录，不能升级本次 Host 或原生验收', async () => {
  const result = await invoke(['--evidence', historicalFixture])
  expect(result.code, result.stderr).toBe(0)
  const report = JSON.parse(result.stdout)
  expect(report.levels.native.status).toBe('recorded')
  expect(report.levels.native.observedAtUtc).toBe('2000-01-01T00:00:00Z')
  expect(result.stdout).not.toContain('fixture-secret-not-for-output')
  expect(report.levels.native.sha256).toMatch(/^[a-f0-9]{64}$/)
  expect(report.levels.host.status).toBe('not-verified')
  expect(report.fullyVerified).toBe(false)
})

it.each(['0123456789ab', 'ffffffffffff'])('正式增强运行指纹 %s 必须与指定构建一致', async (observed) => {
  const server = createServer((_request, response) => {
    response.setHeader('content-type', 'application/json')
    response.end(JSON.stringify({ build: observed, ready: true, registerStatus: 200, error: '' }))
  })
  await new Promise<void>((done) => {
    server.listen(0, '127.0.0.1', done)
  })
  const address = server.address()
  if (!address || typeof address === 'string') {
    throw new Error('测试探针未绑定端口')
  }
  try {
    const result = await invoke(['--host-probe', `http://127.0.0.1:${address.port}/_agent_browser_status`, '--build-evidence', buildFixture])
    const report = JSON.parse(result.stdout)
    const matches = observed === '0123456789ab'
    expect(result.code, result.stderr).toBe(matches ? 0 : 1)
    expect(report.levels.host.status).toBe(matches ? 'passed' : 'failed')
    expect(report.levels.host.expectedBuild).toBe('0123456789ab')
    expect(report.levels.host.buildEvidenceSource).toMatch(/build-evidence\.json$/)
    expect(report.levels.host.observedBuild).toBe(observed)
    expect(report.levels.native.status).toBe('not-verified')
    expect(report.fullyVerified).toBe(false)
  }
  finally {
    server.closeAllConnections()
    await new Promise<void>((done) => {
      server.close(() => done())
    })
  }
})

it.each([
  { format: 'enhanced-assembly', record: { observedAtUtc: '2000-01-01T00:00:00Z', artifact: { package: 'dsh-plugin-agent-browser' }, native: { normalToolRuntime: { results: [{ isError: false }] } } } },
  { format: 'page-lifecycle', record: { recordedAt: '2000-01-01T00:00:00Z', artifact: { fingerprint: '0123456789ab' }, initial: [{ isError: false }], backgroundComplete: { results: 80 } } },
])('增强历史证据 $format 可读取但始终只报告 recorded', async ({ format, record }) => {
  const result = await invoke(['--evidence', historicalFixture], false, { ...record, privateValue: 'fixture-secret-not-for-output' })
  expect(result.code, result.stderr).toBe(0)
  const report = JSON.parse(result.stdout)
  expect(report.levels.native.status).toBe('recorded')
  expect(report.levels.native.recordFormat).toBe(format)
  expect(report.levels.native.observedAtUtc).toBe('2000-01-01T00:00:00Z')
  expect(report.levels.host.status).toBe('not-verified')
  expect(report.fullyVerified).toBe(false)
  expect(result.stdout).not.toContain('fixture-secret-not-for-output')
})

it('构建失败时不访问正式增强 Host，也不声明运行版本通过', async () => {
  let requests = 0
  const server = createServer((_request, response) => {
    requests++
    response.end('{}')
  })
  await new Promise<void>((done) => {
    server.listen(0, '127.0.0.1', done)
  })
  const address = server.address()
  if (!address || typeof address === 'string') {
    throw new Error('测试探针未绑定端口')
  }
  try {
    const result = await invoke(['--host-probe', `http://127.0.0.1:${address.port}/_agent_browser_status`, '--build-evidence', buildFixture], true)
    expect(result.code).toBe(1)
    expect(JSON.parse(result.stdout).levels.host.status).toBe('not-verified')
    expect(requests).toBe(0)
  }
  finally {
    server.closeAllConnections()
    await new Promise<void>((done) => {
      server.close(() => done())
    })
  }
})

it.each([
  { recordedAt: 'not-a-date', artifact: { fingerprint: '0123456789ab' }, initial: [], backgroundComplete: {} },
  { recordedAt: '2000-01-01T00:00:00Z', status: 'passed', artifact: { fingerprint: '0123456789ab' } },
])('无效日期或缺少结果结构的增强记录仍报告失败', async (record) => {
  const result = await invoke(['--evidence', historicalFixture], false, record)
  expect(result.code).toBe(1)
  const report = JSON.parse(result.stdout)
  expect(report.levels.native.status).toBe('failed')
  expect(report.fullyVerified).toBe(false)
})
