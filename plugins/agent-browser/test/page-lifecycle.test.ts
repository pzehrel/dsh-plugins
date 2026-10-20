/** 固定工具到同页的生命周期回归；只替换公开 Connection 与原生 guest 外部边界。 */
import { expect, it, vi } from 'vitest'
import { createToolClient } from '../src/fixed-page-client.js'

it('卸载等待已开始的原生读取，迟到结果不交付也不重新登记', async () => {
  let finishRead: (value: unknown) => void = () => {}
  let readStarted = false
  let commands = 0
  const completed: string[] = []
  const closed: string[] = []
  const client = createToolClient({ connection: { rpc: { call: async (_channel, endpoint) => {
    if (endpoint.endsWith('/register')) {
      return { ok: true, value: { token: 'lifecycle-only', fixtureUrl: 'http://127.0.0.1:12345/fixed' } }
    }
    if (endpoint.endsWith('/poll')) {
      return { ok: true, value: commands++ === 0 ? { id: 'read-once', epoch: 0, action: 'read' } : null }
    }
    if (endpoint.endsWith('/complete')) {
      completed.push(endpoint)
    }
    if (endpoint.endsWith('/close')) {
      closed.push(endpoint)
    }
    return { ok: true, value: true }
  } } } })
  const guest = {
    getURL: () => 'http://127.0.0.1:12345/fixed',
    executeJavaScript: async () => {
      readStarted = true
      return new Promise((resolve) => {
        finishRead = resolve
      })
    },
    sendInputEvent: async () => {},
  }
  client.attach('会话甲', { tabId: '页甲', signal: new AbortController().signal }, { getGuest: () => guest })
  await vi.waitFor(() => expect(readStarted).toBe(true))
  let disposed = false
  const disposing = client.dispose().then(() => {
    disposed = true
  })
  await vi.waitFor(() => expect(closed).toHaveLength(1))
  expect(disposed).toBe(false)
  finishRead({ documentId: '文档甲', count: 0, text: '迟到观察' })
  await disposing
  expect(completed).toEqual([])
  expect(closed).toHaveLength(1)
})

it('公开连接断开后撤销旧登记，恢复连接或卸载后的迟到回调不会自动重绑', async () => {
  let connected: 'connected' | 'disconnected' = 'connected'
  const listeners = new Set<() => void>()
  let registrations = 0
  let closes = 0
  const client = createToolClient({ connection: {
    state: { getSnapshot: () => connected, subscribe: (listener) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    } },
    rpc: { call: async (_channel, endpoint) => {
      if (endpoint.endsWith('/register')) {
        registrations++
        return { ok: true, value: { token: 'connection-only', fixtureUrl: 'http://127.0.0.1:12345/fixed' } }
      }
      if (endpoint.endsWith('/close')) {
        closes++
      }
      return { ok: true, value: null }
    } },
  } })
  const request = { tabId: '页甲', signal: new AbortController().signal }
  const target = { getGuest: () => undefined }
  client.attach('会话甲', request, target)
  await vi.waitFor(() => expect(registrations).toBe(1))
  connected = 'disconnected'
  listeners.forEach(listener => listener())
  await vi.waitFor(() => expect(closes).toBe(1))
  expect(client.status('会话甲', '页甲').getSnapshot()).toBe('offline')
  connected = 'connected'
  listeners.forEach(listener => listener())
  await client.dispose()
  client.attach('会话甲', request, target)
  expect(listeners.size).toBe(0)
  expect(registrations).toBe(1)
})

it('关闭发生在 mouseDown 等待期间时，不再向旧页发送 mouseUp', async () => {
  let finishDown: () => void = () => {}
  const inputs: string[] = []
  let delivered = false
  const client = createToolClient({ connection: { rpc: { call: async (_channel, endpoint) => {
    if (endpoint.endsWith('/register')) {
      return { ok: true, value: { token: 'input-only', fixtureUrl: 'http://127.0.0.1:12345/fixed' } }
    }
    if (endpoint.endsWith('/poll')) {
      const command = delivered ? null : { id: 'click-once', epoch: 0, action: 'click' }
      delivered = true
      return { ok: true, value: command }
    }
    return { ok: true, value: true }
  } } } })
  const guest = {
    getURL: () => 'http://127.0.0.1:12345/fixed',
    executeJavaScript: async (code: string) => code.includes('getBoundingClientRect') ? { x: 10, y: 10, documentId: '文档甲' } : '文档甲',
    sendInputEvent: async (event: object) => {
      const type = 'type' in event ? String(event.type) : ''
      inputs.push(type)
      if (type === 'mouseDown') {
        await new Promise<void>((resolve) => {
          finishDown = resolve
        })
      }
    },
  }
  client.attach('会话甲', { tabId: '页甲', signal: new AbortController().signal }, { getGuest: () => guest })
  await vi.waitFor(() => expect(inputs).toEqual(['mouseDown']))
  const disposing = client.dispose()
  finishDown()
  await disposing
  expect(inputs).toEqual(['mouseDown'])
})

it('host 与 Client 构建不匹配时撤销登记，不执行页面动作', async () => {
  let closes = 0
  const client = createToolClient({ connection: { rpc: { call: async (_channel, endpoint) => {
    if (endpoint.endsWith('/register')) {
      return { ok: true, value: { token: 'mismatched-only', fixtureUrl: 'http://127.0.0.1:12345/fixed', protocolVersion: 5, build: 'old-build' } }
    }
    if (endpoint.endsWith('/close')) {
      closes++
    }
    return { ok: true, value: null }
  } } } }, 'agent-browser', 'new-build')
  client.attach('会话甲', { tabId: '页甲', signal: new AbortController().signal }, { getGuest: () => {
    throw new Error('不应访问页面')
  } })
  await vi.waitFor(() => expect(closes).toBe(1))
  expect(client.status('会话甲', '页甲').getSnapshot()).toBe('incompatible')
  await client.dispose()
})

it.each([2, 3])('相同网址在第 %i 次输入许可期间换文档时，不把旧坐标发往新文档', async (replaceAt) => {
  let documentId = '文档甲'
  let permits = 0
  let delivered = false
  let failed = false
  const inputs: { type: string, documentId: string }[] = []
  const client = createToolClient({ connection: { rpc: { call: async (_channel, endpoint) => {
    if (endpoint.endsWith('/register')) {
      return { ok: true, value: { token: 'navigation-only', fixtureUrl: 'http://127.0.0.1:12345/fixed' } }
    }
    if (endpoint.endsWith('/poll')) {
      const command = delivered ? null : { id: 'click-once', epoch: 0, action: 'click' }
      delivered = true
      return { ok: true, value: command }
    }
    if (endpoint.endsWith('/permit') && ++permits === replaceAt) {
      documentId = '文档乙'
    }
    if (endpoint.endsWith('/fail')) {
      failed = true
    }
    if (endpoint.endsWith('/complete')) {
      throw new Error('旧文档点击不能成功交付')
    }
    return { ok: true, value: true }
  } } } })
  const guest = {
    getURL: () => 'http://127.0.0.1:12345/fixed',
    executeJavaScript: async (code: string) => code.includes('getBoundingClientRect') ? { x: 10, y: 10, documentId } : documentId,
    sendInputEvent: async (event: object) => {
      inputs.push({ type: 'type' in event ? String(event.type) : '', documentId })
    },
  }
  client.attach('会话甲', { tabId: '页甲', signal: new AbortController().signal }, { getGuest: () => guest })
  await vi.waitFor(() => expect(failed).toBe(true))
  expect(inputs).toEqual(replaceAt === 2 ? [] : [{ type: 'mouseDown', documentId: '文档甲' }])
  await client.dispose()
})

it('点击后同网址换文档时，不把新文档的读取当成原点击结果', async () => {
  let documentId = '文档甲'
  let delivered = false
  let failed = false
  let completed = false
  const client = createToolClient({ connection: { rpc: { call: async (_channel, endpoint) => {
    if (endpoint.endsWith('/register')) {
      return { ok: true, value: { token: 'after-click-only', fixtureUrl: 'http://127.0.0.1:12345/fixed' } }
    }
    if (endpoint.endsWith('/poll')) {
      const command = delivered ? null : { id: 'click-once', epoch: 0, action: 'click' }
      delivered = true
      return { ok: true, value: command }
    }
    if (endpoint.endsWith('/fail')) {
      failed = true
    }
    if (endpoint.endsWith('/complete')) {
      completed = true
    }
    return { ok: true, value: true }
  } } } })
  const guest = {
    getURL: () => 'http://127.0.0.1:12345/fixed',
    executeJavaScript: async (code: string) => code.includes('getBoundingClientRect') ? { x: 10, y: 10, documentId } : code.includes('#count') ? { documentId, count: 0 } : documentId,
    sendInputEvent: async (event: object) => {
      if ('type' in event && event.type === 'mouseUp') {
        documentId = '文档乙'
      }
    },
  }
  client.attach('会话甲', { tabId: '页甲', signal: new AbortController().signal }, { getGuest: () => guest })
  await vi.waitFor(() => expect(failed).toBe(true))
  expect(completed).toBe(false)
  expect(client.status('会话甲', '页甲').getSnapshot()).toBe('uncertain')
  await client.dispose()
})
