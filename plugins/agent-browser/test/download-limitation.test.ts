/** 自有下载验证页的固定点击反馈；不声称可识别任意网页下载或替代真实 Desktop 文件核验。 */
import { expect, it, vi } from 'vitest'
import { createToolClient } from '../src/fixed-page-client.js'

it('固定页本次点击触发下载时停止并明确未生成文件，不交付成功观察', async () => {
  let delivered = false
  let attempted = 0
  let failure = ''
  let completed = false
  const client = createToolClient({ connection: { rpc: { call: async (_channel, endpoint, payload) => {
    if (endpoint.endsWith('/register')) {
      return { ok: true, value: { token: 'download-test-only', fixtureUrl: 'http://127.0.0.1:12345/fixed' } }
    }
    if (endpoint.endsWith('/poll')) {
      const command = delivered ? null : { id: 'download-click', epoch: 0, action: 'click' }
      delivered = true
      return { ok: true, value: command }
    }
    if (endpoint.endsWith('/fail')) {
      failure = (payload as { message: string }).message
    }
    if (endpoint.endsWith('/complete')) {
      completed = true
    }
    return { ok: true, value: true }
  } } } })
  const guest = {
    getURL: () => 'http://127.0.0.1:12345/fixed',
    executeJavaScript: async (code: string) => code.includes('getBoundingClientRect')
      ? { x: 10, y: 10, documentId: '下载文档', downloadAttempts: attempted }
      : code.includes('#count') ? { documentId: '下载文档', count: 1, text: '自有夹具', downloadAttempts: attempted } : '下载文档',
    sendInputEvent: async (event: object) => {
      if ('type' in event && event.type === 'mouseUp') {
        attempted++
      }
    },
  }
  client.attach('下载验证会话', { tabId: '下载验证页', signal: new AbortController().signal }, { getGuest: () => guest })
  try {
    await vi.waitFor(() => expect(failure).toContain('[agent-browser/download-unsupported]'))
    expect(failure).toContain('未生成文件')
    expect(completed).toBe(false)
    expect(attempted).toBe(1)
  }
  finally {
    await client.dispose()
  }
})

it('缺少公开原生输入能力时说明具体限制，不尝试替代输入或交付成功', async () => {
  let delivered = false
  let failure = ''
  const client = createToolClient({ connection: { rpc: { call: async (_channel, endpoint, payload) => {
    if (endpoint.endsWith('/register')) {
      return { ok: true, value: { token: 'missing-capability-only', fixtureUrl: 'http://127.0.0.1:12345/fixed' } }
    }
    if (endpoint.endsWith('/poll')) {
      const command = delivered ? null : { id: 'missing-input', epoch: 0, action: 'click' }
      delivered = true
      return { ok: true, value: command }
    }
    if (endpoint.endsWith('/fail')) {
      failure = (payload as { message: string }).message
    }
    return { ok: true, value: true }
  } } } })
  const guest = {
    getURL: () => 'http://127.0.0.1:12345/fixed',
    executeJavaScript: async () => { throw new Error('能力缺失时不应读取页面') },
    sendInputEvent: undefined as unknown as (event: object) => Promise<void>,
  }
  client.attach('能力验证会话', { tabId: '能力验证页', signal: new AbortController().signal }, { getGuest: () => guest })
  try {
    await vi.waitFor(() => expect(failure).toContain('[agent-browser/capability-missing]'))
    expect(failure).toContain('sendInputEvent')
  }
  finally {
    await client.dispose()
  }
})

it('下载点击后的读取在途时接管，等待读取结算且不再采集或交付下载结果', async () => {
  let delivered = false
  let paused = false
  let reads = 0
  let scripts = 0
  let completed = false
  let failed = false
  let finishRead: (value: object) => void = () => {}
  const client = createToolClient({ connection: { rpc: { call: async (_channel, endpoint, payload) => {
    if (endpoint.endsWith('/register')) {
      return { ok: true, value: { token: 'download-takeover-only', fixtureUrl: 'http://127.0.0.1:12345/fixed' } }
    }
    if (endpoint.endsWith('/poll')) {
      const command = delivered || !(payload as { accept: boolean }).accept ? null : { id: '下载接管点击', epoch: 0, action: 'click' }
      delivered ||= !!command
      return { ok: true, value: { command, activity: paused ? 'paused' : 'running' } }
    }
    if (endpoint.endsWith('/pause')) {
      paused = true
    }
    completed ||= endpoint.endsWith('/complete')
    failed ||= endpoint.endsWith('/fail')
    return { ok: true, value: true }
  } } } })
  const guest = {
    getURL: () => 'http://127.0.0.1:12345/fixed',
    executeJavaScript: async (code: string): Promise<unknown> => {
      scripts++
      if (code.includes('getBoundingClientRect')) {
        return { x: 10, y: 10, documentId: '下载接管文档', downloadAttempts: 0 }
      }
      if (code.includes('#count')) {
        reads++
        return new Promise<object>((resolve) => {
          finishRead = resolve
        })
      }
      return '下载接管文档'
    },
    sendInputEvent: async () => {},
  }
  client.attach('下载接管会话', { tabId: '下载接管页', signal: new AbortController().signal }, { getGuest: () => guest })
  try {
    await vi.waitFor(() => expect(reads).toBe(1))
    let settled = false
    const taking = client.takeover('下载接管会话', '下载接管页').then(() => {
      settled = true
    })
    await vi.waitFor(() => expect(paused).toBe(true))
    expect(settled).toBe(false)
    const scriptsBeforeSettlement = scripts
    finishRead({ documentId: '下载接管文档', downloadAttempts: 1 })
    await taking
    expect(client.status('下载接管会话', '下载接管页').getSnapshot()).toBe('paused')
    expect(scripts).toBe(scriptsBeforeSettlement)
    expect(completed).toBe(false)
    expect(failed).toBe(false)
  }
  finally {
    await client.dispose()
  }
})
