/** 统一页面控制边界的真实观察回归；仅替换 Connection 和原生 guest，不测试 DOM 私有实现。 */
import type { ToolDefinition, ToolRunContext } from '@deepseek-ai/dsh-tools'
import type { Command, PageResult, SemanticObservation } from '../src/protocol.js'
import { Context } from '@deepseek-ai/cordis'
import { HostConnectionService } from '@deepseek-ai/dsh-client-connection'
import { validateJsonSchemaValue } from '@deepseek-ai/dsh-tools'
import { expect, it, vi } from 'vitest'
import { Broker } from '../src/broker.js'
import { createToolClient } from '../src/fixed-page-client.js'
import { applyFixedPageHost } from '../src/fixed-page-host.js'

it('读取非夹具主文档的新状态，引用遇滚动或节点替换必须冲突，重新观察后恢复', async () => {
  const broker = new Broker()
  let pageId = ''
  const raw = { documentId: '真实文档甲', url: 'https://controlled.invalid/dynamic?token=秘密#秘密', title: '动态页面', text: '订单 数量 1', truncated: false, viewport: [0, 0, 800, 600], elements: [{ nodeId: '节点甲', role: 'button', name: '增加数量', disabled: false, rect: [10, 20, 100, 40], hit: true }] }
  const client = createToolClient({ connection: { rpc: { call: async (_channel, endpoint, payload) => {
    const row = payload as { token: string, accept?: boolean, command: Command, id: string, value: PageResult, message: string }
    if (endpoint.endsWith('/register')) {
      const page = broker.register('会话甲')
      pageId = page.pageId
      return { ok: true, value: { ...page, fixtureUrl: 'http://127.0.0.1/fixed' } }
    }
    if (endpoint.endsWith('/poll')) {
      return { ok: true, value: { command: broker.poll(row.token, row.accept), activity: broker.activity(row.token) } }
    }
    if (endpoint.endsWith('/permit')) {
      return { ok: true, value: broker.allowed(row.token, row.command) }
    }
    if (endpoint.endsWith('/complete')) {
      broker.complete(row.token, row.id, row.value)
    }
    if (endpoint.endsWith('/fail')) {
      broker.fail(row.token, row.id, row.message)
    }
    if (endpoint.endsWith('/close')) {
      broker.close(row.token)
    }
    return { ok: true, value: true }
  } } } })
  const guest = Object.assign(new EventTarget(), { getURL: () => raw.url, executeJavaScript: async (code: string) => code.includes('const elements=[]') ? structuredClone(raw) : raw.documentId, sendInputEvent: async () => {
    throw new Error('观察不得输入')
  } })
  client.attach('会话甲', { tabId: '页甲', signal: new AbortController().signal }, { getGuest: () => guest })
  await vi.waitFor(() => expect(pageId).not.toBe(''))
  const signal = new AbortController().signal
  try {
    const first = await broker.request('会话甲', pageId, 'observe', signal)
    expect(first).toMatchObject({ kind: 'semantic', documentId: expect.any(String), url: 'https://controlled.invalid/dynamic', text: '订单 数量 1', elements: [{ name: '增加数量' }] })
    expect(first.documentId).not.toBe(raw.documentId)
    expect(JSON.stringify(first)).not.toContain('秘密')
    const reference = first.elements[0]!.reference
    expect(await broker.request('会话甲', pageId, 'resolve', signal, undefined, { reference })).toMatchObject({ kind: 'resolved', x: 60, y: 40 })
    raw.viewport[1] = 100
    await expect(broker.request('会话甲', pageId, 'resolve', signal, undefined, { reference })).rejects.toThrow('引用失效')
    raw.text = '订单 数量 2 人工修改'
    const next = await broker.request('会话甲', pageId, 'observe', signal)
    expect(next.text).toBe('订单 数量 2 人工修改')
    expect(next.observationId).not.toBe(first.observationId)
    raw.elements[0]!.nodeId = '替换后的节点乙'
    await expect(broker.request('会话甲', pageId, 'resolve', signal, undefined, { reference: next.elements[0]!.reference })).rejects.toThrow('引用失效')
    const navigation = await broker.request('会话甲', pageId, 'observe', signal)
    guest.dispatchEvent(new Event('did-navigate-in-page'))
    await expect(broker.request('会话甲', pageId, 'resolve', signal, undefined, { reference: navigation.elements[0]!.reference })).rejects.toThrow('引用失效')
    const afterNavigation = await broker.request('会话甲', pageId, 'observe', signal)
    expect(afterNavigation.documentId).not.toBe(navigation.documentId)
  }
  finally {
    await client.dispose()
    broker.dispose()
  }
})

it('正式工具的观察在接管后不补发，交回不能重用旧引用，成功的新观察才解除屏障', async () => {
  const { tool, client, close, pageId, raw, deferRead, finishRead } = await hostedPage()
  const exec = { agent: { session: { header: { id: '会话甲' } } }, signal: new AbortController().signal } as ToolRunContext
  try {
    const first = await tool.execute({ action: 'observe', pageId }, exec) as SemanticObservation
    expect(validateJsonSchemaValue(tool.output.schema, first)).toEqual([])
    deferRead()
    const old = tool.execute({ action: 'observe', pageId }, exec).catch(error => error)
    await vi.waitFor(() => expect(raw.reading).toBe(true))
    let paused = false
    const taking = client.takeover('会话甲', '页甲').then(() => {
      paused = true
    })
    expect(await old).toMatchObject({ code: 'cancelled' })
    await expect(tool.execute({ action: 'observe', pageId }, exec)).rejects.toThrow('人工接管')
    expect(paused).toBe(false)
    finishRead()
    await taking
    expect(await old).toMatchObject({ code: 'cancelled' })
    raw.text = '交回后的人工内容'
    await client.resume('会话甲', '页甲')
    await expect(tool.execute({ action: 'resolve', pageId, reference: first.elements[0]!.reference }, exec)).rejects.toThrow('引用失效')
    const fresh = await tool.execute({ action: 'observe', pageId }, exec) as SemanticObservation
    expect(fresh.text).toBe('交回后的人工内容')
    expect(fresh.observationId).not.toBe(first.observationId)
  }
  finally {
    finishRead()
    await close()
  }
})

it('观察结束前文档被替换时拒绝结果，取消后的引用不可被再次 resolve', async () => {
  const { tool, close, pageId, raw } = await hostedPage()
  const exec = { agent: { session: { header: { id: '会话甲' } } }, signal: new AbortController().signal } as ToolRunContext
  try {
    raw.replaceAfterRead = true
    await expect(tool.execute({ action: 'observe', pageId }, exec)).rejects.toThrow('文档已变化')
    raw.replaceAfterRead = false
    const fresh = await tool.execute({ action: 'observe', pageId }, exec) as SemanticObservation
    expect(fresh.documentId).not.toBe('文档乙')
    expect(fresh.elements).toHaveLength(1)
    expect(JSON.stringify(fresh)).not.toContain('passwordValue')
    expect(validateJsonSchemaValue(tool.output.schema, fresh)).toEqual([])
  }
  finally {
    await close()
  }
})

/** 正式 Host/认证 Fetch/Client 组合；原生 guest 结果与执行上下文是外部边界，不代表原生 DOM 验收。 */
async function hostedPage(withNavigation = true) {
  const cleanups: (() => unknown)[] = []
  const connection = new HostConnectionService(new Context(), [], {} as ConstructorParameters<typeof HostConnectionService>[2])
  let tool: ToolDefinition | undefined
  await applyFixedPageHost({ connection, tools: { register: (definition) => {
    tool = definition
    return () => {}
  } }, effect: effect => cleanups.push(effect() as () => unknown) }, 'agent-browser')
  const handler = connection.createSharedFetchHandler('/api')
  let pageId = ''
  const raw = { documentId: '文档甲', url: 'https://controlled.invalid/dynamic', title: '受控动态页', text: '人工初始内容', truncated: false, viewport: [0, 0, 800, 600], elements: [{ nodeId: '节点甲', role: 'button', name: '增加', disabled: false, rect: [10, 20, 100, 40], hit: true }], passwordValue: '不得投影的额外字段', reading: false, replaceAfterRead: false }
  let delayed = false
  let resolveRead: (value: unknown) => void = () => {}
  const client = createToolClient({ connection: { rpc: { call: async (_channel, endpoint, payload, signal) => {
    const response = await handler.fetch(new Request(`http://127.0.0.1/api/${endpoint}`, { method: 'POST', signal, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ type: 'client-request', rpcId: '观察回归', method: endpoint, payload }) }))
    const reply = (await response.json()).result
    if (endpoint.endsWith('/register') && reply.ok) {
      pageId = reply.value.pageId
    }
    return reply
  } } } }, 'agent-browser')
  const guest = Object.assign(withNavigation ? new EventTarget() : {}, { getURL: () => raw.url, executeJavaScript: async (code: string): Promise<unknown> => {
    if (!code.includes('const elements=[]')) {
      return raw.documentId
    }
    const snapshot = structuredClone(raw)
    if (raw.replaceAfterRead) {
      raw.documentId = '文档乙'
    }
    if (delayed) {
      delayed = false
      raw.reading = true
      return new Promise((resolve) => {
        resolveRead = resolve
      })
    }
    return snapshot
  }, sendInputEvent: async () => {} })
  client.attach('会话甲', { tabId: '页甲', signal: new AbortController().signal }, { getGuest: () => guest })
  await vi.waitFor(() => expect(pageId).not.toBe(''))
  return { tool: tool!, client, raw, pageId, deferRead: () => {
    delayed = true
  }, finishRead: () => resolveRead(structuredClone(raw)), close: async () => {
    await client.dispose()
    for (const cleanup of cleanups.reverse()) {
      await cleanup()
    }
  } }
}

it('缺少公开导航事件能力时拒绝通用观察，不能以网页标记冒充私有文档代次', async () => {
  const scenario = await hostedPage(false)
  const exec = { agent: { session: { header: { id: '会话甲' } } }, signal: new AbortController().signal } as ToolRunContext
  try {
    await expect(scenario.tool.execute({ action: 'observe', pageId: scenario.pageId }, exec)).rejects.toThrow('addEventListener/removeEventListener')
  }
  finally {
    await scenario.close()
  }
})
