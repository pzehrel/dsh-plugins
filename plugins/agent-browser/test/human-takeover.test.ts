/** 人工接管的公开控制边界回归：真实 Broker 与 Client 组合，仅替换 Connection 和原生 guest。 */
import type { Command, Observation } from '../src/protocol.js'
import { expect, it, vi } from 'vitest'
import { Broker } from '../src/broker.js'
import { createToolClient } from '../src/fixed-page-client.js'

it('接管立即阻止新感知，等待旧读取结算，交回后先新观察再允许点击', async () => {
  const broker = new Broker()
  let token = ''
  let pageId = ''
  let reads = 0
  let finishRead: (value: Observation) => void = () => {}
  const client = createToolClient({ connection: { rpc: { call: async (_channel, endpoint, payload) => {
    const row = payload as { token: string, accept?: boolean, command: Command, id: string, value: Observation, paused: boolean }
    if (endpoint.endsWith('/register')) {
      const page = broker.register('会话甲')
      token = page.token
      pageId = page.pageId
      return { ok: true, value: { ...page, fixtureUrl: 'http://127.0.0.1:12345/fixed' } }
    }
    if (endpoint.endsWith('/poll')) {
      return { ok: true, value: { command: broker.poll(row.token, row.accept), activity: broker.activity(row.token) } }
    }
    if (endpoint.endsWith('/permit')) {
      return { ok: true, value: broker.allowed(row.token, row.command) }
    }
    if (endpoint.endsWith('/pause')) {
      broker.pause(row.token, row.paused)
    }
    if (endpoint.endsWith('/complete')) {
      broker.complete(row.token, row.id, row.value)
    }
    if (endpoint.endsWith('/close')) {
      broker.close(row.token)
    }
    return { ok: true, value: true }
  } } } })
  const guest = {
    getURL: () => 'http://127.0.0.1:12345/fixed',
    executeJavaScript: async (code: string): Promise<unknown> => {
      if (!code.includes('#count')) {
        return '文档甲'
      }
      reads++
      if (reads === 1) {
        return new Promise<Observation>((resolve) => {
          finishRead = resolve
        })
      }
      return { documentId: '文档甲', count: 0, text: '人工已修改' }
    },
    sendInputEvent: async () => {},
  }
  client.attach('会话甲', { tabId: '页甲', signal: new AbortController().signal }, { getGuest: () => guest })
  await vi.waitFor(() => expect(pageId).not.toBe(''))
  const old = broker.request('会话甲', pageId, 'read', new AbortController().signal).catch(error => error)
  await vi.waitFor(() => expect(reads).toBe(1))
  let settled = false
  const taking = client.takeover('会话甲', '页甲').then(() => {
    settled = true
  })
  expect(client.status('会话甲', '页甲').getSnapshot()).toBe('pausing')
  await vi.waitFor(() => expect(broker.activity(token)).toBe('paused'))
  await expect(broker.request('会话甲', pageId, 'read', new AbortController().signal)).rejects.toThrow('人工接管')
  expect(settled).toBe(false)
  const prematureReturn = client.resume('会话甲', '页甲').catch(error => error)
  finishRead({ documentId: '文档甲', count: 0, text: '不得补发' })
  await taking
  expect(await prematureReturn).toBeInstanceOf(Error)
  expect(client.status('会话甲', '页甲').getSnapshot()).toBe('paused')
  expect(await old).toMatchObject({ code: 'cancelled' })
  expect(reads).toBe(1)
  await client.resume('会话甲', '页甲')
  await expect(broker.request('会话甲', pageId, 'click', new AbortController().signal)).rejects.toThrow('重新读取')
  const fresh = broker.request('会话甲', pageId, 'read', new AbortController().signal)
  await expect(fresh).resolves.toMatchObject({ text: '人工已修改' })
  expect(reads).toBe(2)
  await client.dispose()
  broker.dispose()
})

it('接管失败不会重新采集；重试成功后交回失败仍保持暂停，普通浏览不自动接管', async () => {
  let failPause = true
  let failResume = true
  let registrations = 0
  let polls = 0
  let guestCalls = 0
  const client = createToolClient({ connection: { rpc: { call: async (_channel, endpoint, payload) => {
    if (endpoint.endsWith('/register')) {
      registrations++
      return { ok: true, value: { token: 'failure-only', fixtureUrl: 'http://127.0.0.1:12345/fixed' } }
    }
    if (endpoint.endsWith('/pause')) {
      const paused = (payload as { paused: boolean }).paused
      if (paused ? failPause : failResume) {
        return { ok: false, error: { message: '故障注入：暂停确认不可用' } }
      }
    }
    if (endpoint.endsWith('/poll')) {
      polls++
      return { ok: true, value: { command: { id: `读取${polls}`, action: 'read', epoch: 0 }, activity: 'idle' } }
    }
    return { ok: true, value: true }
  } } } })
  const guest = {
    getURL: () => 'http://127.0.0.1:12345/fixed',
    executeJavaScript: async (code: string) => {
      guestCalls++
      return code.includes('#count') ? { documentId: '文档甲', count: 0, text: '普通手动修改' } : '文档甲'
    },
    sendInputEvent: async () => {},
  }
  client.attach('会话甲', { tabId: '页甲', signal: new AbortController().signal }, { getGuest: () => guest })
  await vi.waitFor(() => expect(guestCalls).toBeGreaterThan(0))
  expect(client.status('会话甲', '页甲').getSnapshot()).not.toBe('paused')
  await expect(client.takeover('会话甲', '页甲')).rejects.toThrow('暂停确认不可用')
  expect(client.status('会话甲', '页甲').getSnapshot()).toBe('takeover-failed')
  const atFailure = guestCalls
  const beforePoll = polls
  await vi.waitFor(() => expect(polls).toBeGreaterThan(beforePoll))
  expect(guestCalls).toBe(atFailure)
  failPause = false
  await client.takeover('会话甲', '页甲')
  await expect(client.resume('会话甲', '页甲')).rejects.toThrow('暂停确认不可用')
  expect(client.status('会话甲', '页甲').getSnapshot()).toBe('resume-failed')
  expect(guestCalls).toBe(atFailure)
  failResume = false
  await client.resume('会话甲', '页甲')
  await vi.waitFor(() => expect(guestCalls).toBeGreaterThan(atFailure))
  expect(registrations).toBe(1)
  await client.dispose()
})

it('接管等待已发出的 mouseDown，结算后不发 mouseUp 或交付旧结果', async () => {
  let finishDown: () => void = () => {}
  let delivered = false
  let paused = false
  let completed = false
  const inputs: string[] = []
  const client = createToolClient({ connection: { rpc: { call: async (_channel, endpoint, payload) => {
    if (endpoint.endsWith('/register')) {
      return { ok: true, value: { token: 'takeover-input-only', fixtureUrl: 'http://127.0.0.1:12345/fixed' } }
    }
    if (endpoint.endsWith('/pause')) {
      paused = true
    }
    if (endpoint.endsWith('/complete')) {
      completed = true
    }
    if (endpoint.endsWith('/poll')) {
      const accept = (payload as { accept: boolean }).accept
      const command = delivered || !accept || paused ? null : { id: '点击甲', epoch: 0, action: 'click' }
      delivered ||= !!command
      return { ok: true, value: { command, activity: paused ? 'paused' : 'running' } }
    }
    return { ok: true, value: true }
  } } } })
  const guest = {
    getURL: () => 'http://127.0.0.1:12345/fixed',
    executeJavaScript: async (code: string) => code.includes('getBoundingClientRect') ? { x: 10, y: 10, documentId: '文档甲' } : '文档甲',
    sendInputEvent: async (event: object) => {
      inputs.push('type' in event ? String(event.type) : '')
      await new Promise<void>((resolve) => {
        finishDown = resolve
      })
    },
  }
  client.attach('会话甲', { tabId: '页甲', signal: new AbortController().signal }, { getGuest: () => guest })
  await vi.waitFor(() => expect(inputs).toEqual(['mouseDown']))
  let taken = false
  const taking = client.takeover('会话甲', '页甲').then(() => {
    taken = true
  })
  await vi.waitFor(() => expect(paused).toBe(true))
  expect(taken).toBe(false)
  finishDown()
  await taking
  expect(inputs).toEqual(['mouseDown'])
  expect(completed).toBe(false)
  expect(client.status('会话甲', '页甲').getSnapshot()).toBe('paused')
  await client.dispose()
})

it('关闭等待接管确认 RPC 结算，迟到确认不把已关闭页面改成已接管', async () => {
  let finishPause: () => void = () => {}
  let requestedPause = false
  let requestedClose = false
  const client = createToolClient({ connection: { rpc: { call: async (_channel, endpoint) => {
    if (endpoint.endsWith('/register')) {
      return { ok: true, value: { token: 'close-control-only', fixtureUrl: 'http://127.0.0.1:12345/fixed' } }
    }
    if (endpoint.endsWith('/poll')) {
      return { ok: true, value: null }
    }
    if (endpoint.endsWith('/pause')) {
      requestedPause = true
      await new Promise<void>((resolve) => {
        finishPause = resolve
      })
    }
    if (endpoint.endsWith('/close')) {
      requestedClose = true
    }
    return { ok: true, value: true }
  } } } })
  client.attach('会话甲', { tabId: '页甲', signal: new AbortController().signal }, { getGuest: () => undefined })
  const taking = client.takeover('会话甲', '页甲').catch(error => error)
  await vi.waitFor(() => expect(requestedPause).toBe(true))
  let disposed = false
  const disposing = client.dispose().then(() => {
    disposed = true
  })
  await vi.waitFor(() => expect(requestedClose).toBe(true))
  expect(disposed).toBe(false)
  finishPause()
  await disposing
  expect(await taking).toBeInstanceOf(Error)
  expect(client.status('会话甲', '页甲').getSnapshot()).toBe('closed')
})
