/** 复用既有命令生成分级验收报告；不操作 Desktop，不把协议或历史记录当作本次原生验收。 */
import { Buffer } from 'node:buffer'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync, statSync } from 'node:fs'
import { resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

/** passed 仅用于本次执行的检查；recorded 仅引用历史记录；未执行项保持 not-verified。 */
type Status = 'passed' | 'failed' | 'not-verified' | 'recorded'

interface Level {
  /** 该层实际执行或记录的状态，不从其他层推断。 */
  status: Status
  /** 人可读的结论及适用范围。 */
  summary: string
  /** 实际命令及其退出码，仅自动检查层提供。 */
  commands?: { command: string, exitCode: number | null }[]
  /** 显式提供的记录路径或仅限 loopback 的固定探针地址。 */
  source?: string
  /** 本次探针实际返回的构建标识，仅 Host 层提供。 */
  observedBuild?: string
  /** 正式增强须匹配的本次构建指纹；旧实验省略。 */
  expectedBuild?: string
  /** 正式增强指纹所取的构建记录绝对路径；旧实验省略。 */
  buildEvidenceSource?: string
  /** 被读取文件原始字节的摘要，只用于区分记录，不证明记录内容真实或新鲜。 */
  sha256?: string
  /** 文件记载的观察时间，不替换成本次运行时间。 */
  observedAtUtc?: string
  /** 识别的历史结构，仅表示可读取，不验证其中自报的成功。 */
  recordFormat?: string
}

const root = fileURLToPath(new URL('../', import.meta.url))

/** @param commands 预先定义的 pnpm 参数数组，不接受 shell 脚本。@returns 该层命令结果；失败即停止这一层，不保存命令输出中的潜在凭据。 */
function check(commands: string[][]): Level {
  const results: NonNullable<Level['commands']> = []
  for (const args of commands) {
    const manager = process.env.npm_execpath || 'pnpm'
    const script = /\.[cm]?js$/.test(manager)
    const result = spawnSync(script ? process.execPath : manager, script ? [manager, ...args] : args, {
      cwd: root,
      encoding: 'utf8',
      maxBuffer: 1024 * 1024,
    })
    results.push({ command: `pnpm ${args.join(' ')}`, exitCode: result.status })
    if (result.error || result.status !== 0) {
      return { status: 'failed', summary: '命令执行失败；请单独运行所列命令检查原因', commands: results }
    }
  }
  return { status: 'passed', summary: '本次所列自动检查通过，不代表原生 Desktop 已验收', commands: results }
}

/** @param file 显式选择的 JSON 记录，相对路径基于仓库根。@returns 仅 recorded 或 failed；历史文件永远不产生本次原生 passed。 */
function history(file: string): Level {
  const source = resolve(root, file)
  try {
    // 限制记录大小，防止误选整份会话导出；不打印原始字段或潜在秘密。
    const info = statSync(source)
    if (!info.isFile() || info.size > 1024 * 1024) {
      throw new Error('记录不可用')
    }
    const bytes = readFileSync(source)
    const record: unknown = JSON.parse(bytes.toString('utf8'))
    if (!record || typeof record !== 'object') {
      throw new Error('记录格式无效')
    }
    const data = record as Record<string, unknown>
    const observedAtUtc = data.observedAtUtc ?? data.recordedAt
    const artifact = data.artifact as Record<string, unknown> | undefined
    const native = data.native as { normalToolRuntime?: { results?: unknown } } | undefined
    // 兼容仓库已有证据的最小结构；这些检查不采信 status、G3 或其他自报成功字段。
    let recordFormat: string | undefined
    if (Array.isArray(data.observations)) {
      recordFormat = 'observations'
    }
    else if (typeof artifact?.package === 'string' && Array.isArray(native?.normalToolRuntime?.results)) {
      recordFormat = 'enhanced-assembly'
    }
    else if (typeof artifact?.package === 'string' && Array.isArray(data.cases)) {
      recordFormat = 'official-browser-cases'
    }
    else if (typeof artifact?.fingerprint === 'string' && /^[a-f0-9]{12}$/.test(artifact.fingerprint) && Array.isArray(data.initial) && data.backgroundComplete && typeof data.backgroundComplete === 'object') {
      recordFormat = 'page-lifecycle'
    }
    if (typeof observedAtUtc !== 'string' || !Number.isFinite(Date.parse(observedAtUtc)) || !recordFormat) {
      throw new TypeError('记录缺少观察时间或结果')
    }
    return { status: 'recorded', summary: '仅引用历史记录，不是本次原生验收', source, observedAtUtc, recordFormat, sha256: createHash('sha256').update(bytes).digest('hex') }
  }
  catch {
    return { status: 'failed', summary: '历史记录不可读取、超过 1 MiB 或格式无效', source }
  }
}

/** @param value 显式探针地址。@returns 仅允许数值 loopback、固定路径且无凭据、查询或片段的 URL；其他输入在任何检查前拒绝。 */
function hostAddress(value: string): URL {
  const url = new URL(value)
  if (url.protocol !== 'http:' || !['127.0.0.1', '[::1]'].includes(url.hostname) || url.username || url.password || url.search || url.hash || !['/_agent_browser_spike_status', '/_agent_browser_status'].includes(url.pathname)) {
    throw new Error('Host 探针仅允许无凭据的数值 loopback HTTP 固定状态路径')
  }
  return url
}

/** @param url 已验证的本机探针地址。@param evidence 正式增强的构建记录路径，默认使用本次构建输出。@returns 本次 Host 结果；2秒超时、不跟随重定向、最多4 KiB；增强指纹不匹配即失败，不触发网页动作。 */
async function probe(url: URL, evidence = 'plugins/agent-browser/dist/enhanced/build-evidence.json'): Promise<Level> {
  const source = url.toString()
  let expectedBuild: string | undefined
  let buildEvidenceSource: string | undefined
  let observedBuild: string | undefined
  try {
    if (url.pathname === '/_agent_browser_status') {
      const file = resolve(root, evidence)
      buildEvidenceSource = file
      const info = statSync(file)
      if (!info.isFile() || info.size > 4096) {
        throw new Error('构建记录过大')
      }
      const build = JSON.parse(readFileSync(file, 'utf8')) as { fingerprint?: unknown, package?: unknown }
      if (typeof build.fingerprint !== 'string' || !/^[a-f0-9]{12}$/.test(build.fingerprint) || build.package !== `dsh-plugin-agent-browser-${build.fingerprint}`) {
        throw new Error('增强构建身份无效')
      }
      expectedBuild = build.fingerprint
    }

    const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(2000) })
    if (response.status !== 200 || !response.body) {
      throw new Error('探针未就绪')
    }
    const reader = response.body.getReader()
    const chunks: Uint8Array[] = []
    let size = 0
    try {
      while (true) {
        const { value, done } = await reader.read()
        if (done) {
          break
        }
        size += value.byteLength
        if (size > 4096) {
          await reader.cancel()
          throw new Error('探针响应过大')
        }
        chunks.push(value)
      }
    }
    finally {
      reader.releaseLock()
    }
    const data: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    if (!data || typeof data !== 'object') {
      throw new Error('探针格式无效')
    }
    const row = data as Record<string, unknown>
    observedBuild = typeof row.build === 'string' && /^(?:[a-f0-9]{12}|fetch-routes-v2)$/.test(row.build) ? row.build : undefined
    if (observedBuild !== (expectedBuild ?? 'fetch-routes-v2') || row.ready !== true || row.registerStatus !== 200 || row.error !== '') {
      throw new Error('探针版本或状态不匹配')
    }
    return { status: 'passed', summary: expectedBuild ? '本次增强 Host 就绪且运行指纹与构建一致；不代表原生页面已验收' : '本次旧实验 Host 注册探针通过，不代表原生页面已验收', source, expectedBuild, observedBuild, buildEvidenceSource }
  }
  catch {
    return { status: 'failed', summary: '探针或构建记录不可用、Host 未就绪或运行版本不匹配；增强须安装同一构建后重验', source, expectedBuild, observedBuild, buildEvidenceSource }
  }
}

async function main(): Promise<void> {
  let evidence: string | undefined
  let host: URL | undefined
  let buildEvidence: string | undefined
  const args = process.argv.slice(2)
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (arg === '--help') {
      process.stdout.write('用法：pnpm verify:agent-browser [--host-probe 本机状态URL] [--evidence JSON文件] [--build-evidence 增强构建JSON]\n默认只执行构建与协议检查；不自动操作 Desktop，历史记录不会标记成本次原生通过。\n')
      return
    }
    if (arg === '--evidence' && !evidence && args[i + 1] && !args[i + 1]!.startsWith('--')) {
      evidence = args[++i]
    }
    else if (arg === '--build-evidence' && !buildEvidence && args[i + 1] && !args[i + 1]!.startsWith('--')) {
      buildEvidence = args[++i]
    }
    else if (arg === '--host-probe' && !host && args[i + 1] && !args[i + 1]!.startsWith('--')) {
      host = hostAddress(args[++i]!)
    }
    else {
      throw new Error('不支持的参数、重复参数或缺少参数值')
    }
  }
  if (buildEvidence && host?.pathname !== '/_agent_browser_status') {
    throw new Error('构建记录仅用于正式增强探针')
  }
  const build = check([
    ['--filter', './plugins/agent-browser', 'build'],
    ['--filter', './plugins/agent-browser', 'typecheck'],
  ])
  // 不调用完整测试套件，避免本 CLI 的集成测试再次启动自身。
  const protocol: Level = build.status === 'passed'
    ? check([['exec', 'vitest', 'run', 'plugins/agent-browser/test/broker.test.ts', 'plugins/agent-browser/test/connection.test.ts']])
    : { status: 'not-verified', summary: '构建失败，未执行协议测试' }
  const runtime: Level = host && build.status !== 'passed' ? { status: 'not-verified', summary: '构建失败，未执行 Host 探针' } : host ? await probe(host, buildEvidence) : { status: 'not-verified', summary: '未执行当前 Host 运行探针' }
  const native: Level = evidence ? history(evidence) : { status: 'not-verified', summary: '未执行本次原生页面任务' }
  const report = {
    schemaVersion: 1,
    checkedAtUtc: new Date().toISOString(),
    fullyVerified: false,
    levels: {
      build,
      protocol,
      host: runtime,
      native,
    },
  }
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
  process.exitCode = [build, protocol, runtime, native].some(level => level.status === 'failed') ? 1 : 0
}

void main().catch(() => {
  process.stderr.write('验收参数无效或报告无法生成；使用 --help 查看输入要求。\n')
  process.exitCode = 1
})
