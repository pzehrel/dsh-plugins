/** 原生验收诊断的控制边界：模拟 RPC/guest，验证人工触发及关闭取消，不作为原生成功证据。 */
import { afterEach, expect, it, vi } from 'vitest'
import { createNativeClient } from '../../../tools/official-browser-native-probe.js'
import { createToolClient } from '../src/fixed-page-client.js'

afterEach(() => {
  vi.useRealTimers()
})

/** @returns 仅固定测试页的外部 RPC 与 guest 替身。 */
function fixture() {
  let text = ''
  let active = true
  let evidence = ''
  const selfTest = vi.fn(async () => ({ ok: true, value: { results: [] } }))
  const guest = { getURL: () => 'http://127.0.0.1:12345/spike-test', executeJavaScript: vi.fn(async (code: string) => {
    if (code.startsWith('document.querySelector(\'#identity\').textContent=')) {
      evidence = JSON.parse(code.slice(code.indexOf('=') + 1))
    }
    return code === 'document.querySelector(\'#human-input\').value' ? text : undefined
  }) }
  const context = { connection: { rpc: { call: async (_channel: string, endpoint: string) => endpoint.endsWith('/self-test') ? active ? selfTest() : { ok: false, error: { message: 'Client 凭据失效' } } : { ok: true, value: { token: 'test-only', fixtureUrl: guest.getURL() } } } } }
  const client = createNativeClient(context, scoped => ({
    attach: () => {
      void scoped.connection.rpc.call('/api', 'agent-browser-spike/register', {})
    },
    dispose: async () => { active = false },
  }))
  const lifetime = new AbortController()
  client.attach('test-session', { tabId: 'test-tab', signal: lifetime.signal }, { getGuest: () => lifetime.signal.aborted ? undefined : guest })
  return { selfTest, client, lifetime, guest, getEvidence: () => evidence, setText: (value: string) => {
    text = value
  } }
}

it('只在人工标记后运行一次固定闭环；无结果不能标记原生成功', async () => {
  vi.useFakeTimers()
  const f = fixture()
  try {
    await vi.advanceTimersByTimeAsync(1000)
    expect(f.selfTest).not.toHaveBeenCalled()
    f.setText('人工复用验收 A')
    await vi.advanceTimersByTimeAsync(1000)
    expect(f.selfTest).toHaveBeenCalledTimes(1)
    expect(f.getEvidence()).toContain('"status":"failed"')
    await vi.advanceTimersByTimeAsync(1000)
    expect(f.selfTest).toHaveBeenCalledTimes(1)
  }
  finally {
    await f.client.dispose()
  }
})

it('关页后停止诊断，不再采集或触发固定工具', async () => {
  vi.useFakeTimers()
  const f = fixture()
  f.lifetime.abort()
  f.setText('人工复用验收 A')
  await vi.advanceTimersByTimeAsync(1000)
  expect(f.selfTest).not.toHaveBeenCalled()
  await f.client.dispose()
})

it('关页后在下一测试页展示拒绝结论，不输出已撤销凭据', async () => {
  vi.useFakeTimers()
  const f = fixture()
  await vi.advanceTimersByTimeAsync(200)
  f.lifetime.abort()
  await vi.advanceTimersByTimeAsync(200)
  f.client.attach('test-session', { tabId: 'next-tab', signal: new AbortController().signal }, { getGuest: () => f.guest })
  await vi.advanceTimersByTimeAsync(500)
  expect(f.getEvidence()).toContain('"hostRejectedClosedTarget":true')
  expect(f.getEvidence()).not.toContain('test-only')
  await f.client.dispose()
})

it('卸载等待已开始的关页清理，不重复释放 Client', async () => {
  let finish: (() => void) | undefined
  const dispose = vi.fn(() => new Promise<void>((resolve) => {
    finish = resolve
  }))
  const client = createNativeClient({ connection: { rpc: { call: async () => ({ ok: true }) } } }, () => ({ attach: () => {}, dispose }))
  const lifetime = new AbortController()
  client.attach('test-session', { tabId: 'test-tab', signal: lifetime.signal }, { getGuest: () => undefined })
  lifetime.abort()
  let disposed = false
  const pending = client.dispose().then(() => {
    disposed = true
  })
  await Promise.resolve()
  expect(disposed).toBe(false)
  expect(dispose).toHaveBeenCalledTimes(1)
  finish?.()
  await pending
  expect(disposed).toBe(true)
})

it('登记响应迟于关页时，卸载等待迟到凭据被撤销', async () => {
  let registered: ((value: { ok: boolean, value: { token: string, fixtureUrl: string } }) => void) | undefined
  const closed = vi.fn()
  const client = createToolClient({ connection: { rpc: { call: async (_channel, endpoint) => {
    if (endpoint.endsWith('/register')) {
      return new Promise((resolve) => {
        registered = resolve
      })
    }
    closed(endpoint)
    return { ok: true }
  } } } })
  const lifetime = new AbortController()
  client.attach('test-session', { tabId: 'test-tab', signal: lifetime.signal }, { getGuest: () => undefined })
  lifetime.abort()
  let disposed = false
  const pending = client.dispose().then(() => {
    disposed = true
  })
  await Promise.resolve()
  expect(disposed).toBe(false)
  registered?.({ ok: true, value: { token: 'late-test-only', fixtureUrl: 'http://127.0.0.1:12345/spike-test' } })
  await pending
  expect(disposed).toBe(true)
  expect(closed.mock.calls).toEqual([['agent-browser-spike/close']])
})
