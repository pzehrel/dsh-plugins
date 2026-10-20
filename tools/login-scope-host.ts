/** 任务02的临时诊断 Host：保存自有标记证据，并通过既有固定工具验证会话拒绝，不注册产品工具。 */
import { createHash, randomUUID } from 'node:crypto'
import { createServer } from 'node:http'

/** 沿用既有实验 Host 的正式服务类型，不给根工具增加运行时 SDK 依赖。 */
type Context = Parameters<typeof import('../plugins/agent-browser/src/index.js').apply>[0]
interface Observation {
  sessionId: string
  pageId: string
  workspace: string
  account: string
  scope: 'global' | 'workspace'
  action: string
  value: { storage: string | null, cookie: string | null }
}
const run = '__LOGIN_SCOPE_RUN__'
export const inject = ['connection', 'agents', 'tools']

/** @param ctx 当前真实 profile 的服务；临时证据仅含测试标记与身份摘要。 */
export async function apply(ctx: Context): Promise<void> {
  const observations: Omit<Observation, 'workspace' | 'account'>[] = []
  const pages = new Map<string, Observation>()
  let ownerResults: object[] = []
  const path = `/scope-${run}/report`
  const digest = (value: string): string => createHash('sha256').update(value).digest('hex')
  const server = createServer((request, response) => {
    if (request.method !== 'GET' || request.url !== path) {
      response.writeHead(404).end()
      return
    }
    response.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' })
    response.end(JSON.stringify({ run, observations, ownerResults }))
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  ctx.effect(() => async () => {
    pages.clear()
    observations.length = 0
    server.closeAllConnections()
    await new Promise<void>((resolve) => {
      server.close(() => resolve())
    })
  })
  const address = server.address()
  if (!address || typeof address === 'string') {
    throw new Error('诊断站未取得端口')
  }
  const reportUrl = `http://127.0.0.1:${address.port}${path}`
  async function report(payload: unknown): Promise<string> {
    const row = payload as Observation
    if (!row || !['sessionId', 'pageId', 'workspace', 'account', 'scope', 'action'].every(key => typeof row[key as keyof Observation] === 'string' && String(row[key as keyof Observation]).length <= 4096)
      || !['global', 'workspace'].includes(row.scope)
      || !['global', 'workspace', 'read', 'write-A', 'write-B', 'write-C', 'clear', 'owners'].includes(row.action)
      || !row.workspace.startsWith('cwd:') || !row.account.startsWith(`plugin:agent-browser-scope:${run}:`)
      || !row.value || ![row.value.storage, row.value.cookie].every(value => value === null || (typeof value === 'string' && /^[A-C]$/.test(value)))) {
      throw new Error('只接受本次自有测试标记')
    }
    // 报告与内存记录均使用白名单投影，不保留调用方附带的其他网页字段。
    const value = { storage: row.value.storage, cookie: row.value.cookie }
    pages.set(row.pageId, { sessionId: row.sessionId, pageId: row.pageId, workspace: row.workspace, account: row.account, scope: row.scope, action: row.action, value })
    observations.push({ sessionId: row.sessionId, pageId: row.pageId, scope: row.scope, action: row.action, value, ...{ workspaceSha256: digest(row.workspace), accountSha256: digest(row.account) } })
    if (observations.length > 64) {
      observations.shift()
    }
    return reportUrl
  }
  async function owners(): Promise<object[]> {
    const unique = [...new Map([...pages.values()].map(page => [page.sessionId, page])).values()]
    ownerResults = []
    for (const source of unique) {
      const target = unique.find(page => page.sessionId !== source.sessionId && page.workspace !== source.workspace)
      const agent = ctx.agents.list().find(agent => agent.session.header.id === source.sessionId)
      if (!target || !agent) {
        continue
      }
      const invoke = (pageId: string): ReturnType<Context['tools']['execute']> => ctx.tools.execute({ name: 'agent_browser_spike', arguments: { action: 'read', pageId }, agent, callId: `scope-${randomUUID()}` as Parameters<Context['tools']['execute']>[0]['callId'], signal: AbortSignal.timeout(3000) })
      const own = await invoke(source.pageId)
      const foreign = await invoke(target.pageId)
      ownerResults.push({ sourceSessionId: source.sessionId, targetSessionId: target.sessionId, ownReadPassed: !own.isError, foreignReadRejected: foreign.isError && JSON.stringify(foreign).includes('不能操作其他会话的共享页面') })
    }
    return ownerResults
  }
  const routes = ['report', 'owners'].map(method => ctx.connection.fetch.register({
    path: `/api/login-scope-probe/${method}`,
    methods: ['POST'],
    requestBody: 'buffered',
    async fetch(request) {
      const envelope = await request.json() as { type?: string, rpcId?: string, method?: string, payload?: unknown }
      if (envelope.type !== 'client-request' || typeof envelope.rpcId !== 'string' || envelope.method !== `login-scope-probe/${method}`) {
        return new Response('invalid envelope', { status: 400 })
      }
      let result: object
      try {
        result = { ok: true, value: method === 'report' ? await report(envelope.payload) : await owners() }
      }
      catch {
        result = { ok: false, error: { code: 'probe/unavailable', message: '诊断未取得有效结果', details: {} } }
      }
      return Response.json({ type: 'server-response', rpcId: envelope.rpcId, result })
    },
  }))
  ctx.effect(() => async () => {
    for (const dispose of routes.reverse()) {
      await dispose()
    }
  })
}
