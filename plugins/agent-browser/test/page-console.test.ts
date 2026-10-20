/** 正式工具、认证 Connection 与共享页控制台回归；仅原生 guest 和执行上下文为外部替身。 */
import type { ToolDefinition, ToolRunContext } from '@deepseek-ai/dsh-tools'
import { Context } from '@deepseek-ai/cordis'
import { HostConnectionService } from '@deepseek-ai/dsh-client-connection'
import { validateJsonSchemaValue } from '@deepseek-ai/dsh-tools'
import { expect, it, vi } from 'vitest'
import { createToolClient } from '../src/fixed-page-client.js'
import { applyFixedPageHost } from '../src/fixed-page-host.js'

it('仅采集真实工具本次窗口的当前页消息，限制数量并清除已知凭据与 URL 查询', async () => {
  const page = await hostedConsole()
  try {
    const pending = page.call({ action: 'console', durationMs: 100 })
    await vi.waitFor(() => expect(page.listeners).toBe(1))
    page.log('页面警告 https://user:pass@controlled.invalid/log?token=PRIVATE#secret')
    page.log('Cookie: only-fake-sensitive-data')
    page.log('password=only-fake-sensitive-data')
    page.log('{"password":"only-fake-sensitive-data"}')
    page.log(`调试信息 ${page.controlCredential}`)
    for (let i = 0; i < 55; i++) {
      page.log(`普通消息 ${i}`)
    }
    const result = await pending as { kind: string, documentId: string, url: string, messages: { message: string, sourceId: string }[], truncated: boolean }
    expect(result).toMatchObject({ kind: 'console', documentId: expect.any(String), url: 'https://controlled.invalid/page', durationMs: 100, truncated: true })
    expect(result.documentId).not.toBe('页面可伪造标记')
    expect(result.messages).toHaveLength(50)
    expect(result.messages[0]).toMatchObject({ level: 2, message: '页面警告 https://controlled.invalid/log', sourceId: 'https://controlled.invalid/script.js', line: 12 })
    expect(JSON.stringify(result)).not.toMatch(/PRIVATE|only-fake-sensitive-data|user:pass/)
    expect(JSON.stringify(result)).not.toContain(page.controlCredential)
    expect(validateJsonSchemaValue(page.tool.output.schema, result)).toEqual([])
    expect(page.listeners).toBe(0)
    page.log('窗口外不应保留')
    const next = await page.call({ action: 'console', durationMs: 50 }) as { messages: unknown[] }
    expect(next.messages).toEqual([])
  }
  finally {
    await page.close()
  }
})

it('人工接管同步拆监听并丢弃未交付消息，交回新观察后只收新窗口内容', async () => {
  const page = await hostedConsole()
  try {
    const pending = page.call({ action: 'console', durationMs: 2000 }).catch(error => error)
    await vi.waitFor(() => expect(page.listeners).toBe(1))
    page.log('接管前尚未交付')
    const taking = page.client.takeover('会话甲', '页甲')
    expect(page.listeners).toBe(0)
    page.log('人工接管期不得缓存')
    expect(await pending).toMatchObject({ code: 'cancelled', outcome: 'not-delivered' })
    await taking
    await expect(page.call({ action: 'console' })).rejects.toThrow('人工接管')
    await page.client.resume('会话甲', '页甲')
    await expect(page.call({ action: 'console' })).rejects.toThrow('重新读取')
    await page.call({ action: 'observe' })
    const fresh = page.call({ action: 'console', durationMs: 100 })
    await vi.waitFor(() => expect(page.listeners).toBe(1))
    page.log('交回后的新窗口')
    expect(await fresh).toMatchObject({ messages: [{ message: '交回后的新窗口' }] })
    expect(page.listeners).toBe(0)
  }
  finally {
    await page.close()
  }
})

it('导航立即撤销当前窗口，其他会话不能读取；在途取消及卸载均清除监听', async () => {
  const page = await hostedConsole()
  let closed = false
  try {
    await expect(page.call({ action: 'console' }, undefined, '会话乙')).rejects.toThrow('其他会话')
    const old = page.call({ action: 'console', durationMs: 2000 }).catch(error => error)
    await vi.waitFor(() => expect(page.listeners).toBe(1))
    page.log('导航前未交付')
    page.navigate()
    expect(page.listeners).toBe(0)
    expect(await old).toMatchObject({ code: 'cancelled' })
    const cancel = new AbortController()
    const cancelled = page.call({ action: 'console', durationMs: 2000 }, cancel.signal).catch(error => error)
    await vi.waitFor(() => expect(page.listeners).toBe(1))
    cancel.abort()
    expect(await cancelled).toMatchObject({ code: 'cancelled' })
    await vi.waitFor(() => expect(page.listeners).toBe(0))
    const unloading = page.call({ action: 'console', durationMs: 2000 }).catch(error => error)
    await vi.waitFor(() => expect(page.listeners).toBe(1))
    const closing = page.close()
    expect(page.listeners).toBe(0)
    await closing
    closed = true
    expect(await unloading).toMatchObject({ code: 'closed' })
  }
  finally {
    if (!closed) {
      await page.close()
    }
  }
})

it('公开事件形状不匹配时停止并说明能力缺口，不把字符串级别伪装成已验证数字事件', async () => {
  const page = await hostedConsole()
  try {
    await expect(page.call({ action: 'console', durationMs: 2001 })).rejects.toThrow('50–2000')
    const pending = page.call({ action: 'console', durationMs: 100 }).catch(error => error)
    await vi.waitFor(() => expect(page.listeners).toBe(1))
    page.log('不兼容事件的消息不得交付', 'warning')
    expect(page.listeners).toBe(0)
    expect(await pending).toMatchObject({ code: 'cancelled', message: expect.stringContaining('capability-mismatch') })
  }
  finally {
    await page.close()
  }
})

it('许可复核通信延迟不延长控制台采集窗口，超出窗口的消息不进入结果', async () => {
  const page = await hostedConsole()
  try {
    const pending = page.call({ action: 'console', durationMs: 100 })
    await vi.waitFor(() => expect(page.listeners).toBe(1))
    page.deferPermit()
    page.log('窗口内消息')
    await vi.waitFor(() => expect(page.permitWaiting).toBe(true))
    await new Promise(resolve => setTimeout(resolve, 120))
    expect(page.listeners).toBe(0)
    page.log('通信等待时已超窗口，不得采集')
    page.finishPermit()
    expect(await pending).toMatchObject({ messages: [{ message: '窗口内消息' }] })
  }
  finally {
    page.finishPermit()
    await page.close()
  }
})

/** 测试既有 Host 的正式 Fetch 路由，不绕过 Broker 或 Client 私有文档身份。 */
async function hostedConsole() {
  const cleanups: (() => unknown)[] = []
  const connection = new HostConnectionService(new Context(), [], {} as ConstructorParameters<typeof HostConnectionService>[2])
  let tool: ToolDefinition | undefined
  await applyFixedPageHost({ connection, tools: { register: (definition) => {
    tool = definition
    return () => {}
  } }, effect: effect => cleanups.push(effect() as () => unknown) }, 'agent-browser')
  const handler = connection.createSharedFetchHandler('/api')
  let pageId = ''
  let controlCredential = ''
  let deferPermit = false
  let permitWaiting = false
  let finishPermit: () => void = () => {}
  let listeners = 0
  const client = createToolClient({ connection: { rpc: { call: async (_channel, endpoint, payload, signal) => {
    if (endpoint.endsWith('/permit') && deferPermit) {
      deferPermit = false
      permitWaiting = true
      await new Promise<void>((resolve) => {
        finishPermit = resolve
      })
      permitWaiting = false
    }
    const response = await handler.fetch(new Request(`http://127.0.0.1/api/${endpoint}`, { method: 'POST', signal, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ type: 'client-request', rpcId: '控制台回归', method: endpoint, payload }) }))
    const reply = (await response.json()).result
    if (endpoint.endsWith('/register') && reply.ok) {
      pageId = reply.value.pageId
      controlCredential = reply.value.token
    }
    return reply
  } } } }, 'agent-browser')
  const target = new EventTarget()
  const guest = { getURL: () => 'https://user:pass@controlled.invalid/page?token=PRIVATE#secret', executeJavaScript: async (code: string) => code.includes('const elements=[]') ? { documentId: '页面可伪造标记', url: 'https://controlled.invalid/page', title: '自有页面', text: '人工内容', truncated: false, viewport: [0, 0, 800, 600], elements: [] } : '页面可伪造标记', sendInputEvent: async () => {}, addEventListener: (type: string, listener: EventListener) => {
    if (type === 'console-message') {
      listeners++
    }
    target.addEventListener(type, listener)
  }, removeEventListener: (type: string, listener: EventListener) => {
    if (type === 'console-message') {
      listeners--
    }
    target.removeEventListener(type, listener)
  } }
  client.attach('会话甲', { tabId: '页甲', signal: new AbortController().signal }, { getGuest: () => guest })
  await vi.waitFor(() => expect(pageId).not.toBe(''))
  return { tool: tool!, client, deferPermit: () => {
    deferPermit = true
  }, finishPermit: () => finishPermit(), get permitWaiting() {
    return permitWaiting
  }, get controlCredential() {
    return controlCredential
  }, get listeners() {
    return listeners
  }, call: (args: Record<string, unknown>, signal = new AbortController().signal, owner = '会话甲') => tool!.execute({ pageId, ...args }, { agent: { session: { header: { id: owner } } }, signal } as ToolRunContext), log: (message: string, level: unknown = 2) => target.dispatchEvent(Object.assign(new Event('console-message'), { message, level, line: 12, sourceId: 'https://user:pass@controlled.invalid/script.js?secret=PRIVATE#secret' })), navigate: () => target.dispatchEvent(new Event('did-navigate-in-page')), close: async () => {
    await client.dispose()
    for (const cleanup of cleanups.reverse()) {
      await cleanup()
    }
  } }
}
