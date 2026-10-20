/** 在实验公开控制边界验证同页请求归属；模拟 Client 不代表真实 Desktop 验收。 */
import { describe, expect, it, vi } from 'vitest'
import { Broker } from '../src/broker.js'

describe('共享页面实验控制边界', () => {
  it('只有页面所属会话可以读取该共享页面', async () => {
    const broker = new Broker()
    const page = broker.register('会话甲')
    await expect(broker.request('会话乙', page.pageId, 'read', new AbortController().signal)).rejects.toThrow('其他会话')
    broker.close(page.token)
  })

  it('工具只接受与当前请求关联的 Client 页面结果', async () => {
    const broker = new Broker()
    const page = broker.register('会话甲')
    const result = broker.request('会话甲', page.pageId, 'read', new AbortController().signal)
    const command = broker.poll(page.token)
    expect(command?.action).toBe('read')
    broker.complete(page.token, command!.id, { documentId: '文档甲', count: 3, text: '人工修改' })
    await expect(result).resolves.toEqual({ documentId: '文档甲', count: 3, text: '人工修改' })
    broker.close(page.token)
  })

  it('人工接管拒绝新读写并丢弃在途结果', async () => {
    const broker = new Broker()
    const page = broker.register('会话甲')
    const result = broker.request('会话甲', page.pageId, 'read', new AbortController().signal)
    const rejected = expect(result).rejects.toThrow('人工接管')
    const command = broker.poll(page.token)!
    broker.pause(page.token, true)
    broker.complete(page.token, command.id, { documentId: '旧文档', count: 7, text: '不得补发' })
    await rejected
    await expect(broker.request('会话甲', page.pageId, 'click', new AbortController().signal)).rejects.toThrow('人工接管')
    broker.pause(page.token, false)
    expect(broker.poll(page.token)).toBeNull()
    broker.close(page.token)
  })

  it('取消后 Client 不再取得该请求', async () => {
    const broker = new Broker()
    const page = broker.register('会话甲')
    const controller = new AbortController()
    const result = broker.request('会话甲', page.pageId, 'click', controller.signal)
    const rejected = expect(result).rejects.toThrow('取消')
    controller.abort()
    await rejected
    expect(broker.poll(page.token)).toBeNull()
    broker.close(page.token)
  })
})

it('排队取消与已发出点击的结果不明具有不同结果，不自动重试旧调用', async () => {
  const broker = new Broker()
  const page = broker.register('会话甲')
  const queued = new AbortController()
  const first = broker.request('会话甲', page.pageId, 'click', queued.signal, '调用甲')
  const cancelled = expect(first).rejects.toMatchObject({ code: 'cancelled', outcome: 'not-started' })
  queued.abort()
  await cancelled
  const sent = new AbortController()
  const second = broker.request('会话甲', page.pageId, 'click', sent.signal, '调用乙')
  const unknown = expect(second).rejects.toMatchObject({ code: 'unknown', outcome: 'unknown' })
  const command = broker.poll(page.token)!
  sent.abort()
  await unknown
  broker.complete(page.token, command.id, { documentId: '旧文档', count: 1, text: '不得交付' })
  await expect(broker.request('会话甲', page.pageId, 'click', new AbortController().signal, '调用乙')).rejects.toMatchObject({ code: 'duplicate' })
  broker.dispose()
})

it('失联租约撤销旧目标，已发出的读取只报告未交付，迟到登记不能复活卸载实例', async () => {
  vi.useFakeTimers()
  const broker = new Broker()
  try {
    const page = broker.register('会话甲')
    const result = broker.request('会话甲', page.pageId, 'read', new AbortController().signal)
    const stopped = expect(result).rejects.toMatchObject({ code: 'disconnected', outcome: 'not-delivered' })
    broker.poll(page.token)
    await Promise.all([stopped, vi.advanceTimersByTimeAsync(5000)])
    await expect(broker.request('会话甲', page.pageId, 'read', new AbortController().signal)).rejects.toThrow('关闭或不存在')
    expect(() => broker.poll(page.token)).toThrow('凭据失效')
    broker.dispose()
    expect(() => broker.register('会话甲')).toThrow('插件已卸载')
  }
  finally {
    broker.dispose()
    vi.useRealTimers()
  }
})

it('在途心跳不领取新命令；超时后结果不明，重复与迟到完成不再次交付', async () => {
  vi.useFakeTimers()
  const broker = new Broker()
  try {
    const page = broker.register('会话甲')
    const result = broker.request('会话甲', page.pageId, 'click', new AbortController().signal, '慢点击')
    const stopped = result.catch(error => error)
    const command = broker.poll(page.token)!
    for (let second = 0; second < 15; second++) {
      broker.poll(page.token, false)
      await vi.advanceTimersByTimeAsync(1000)
    }
    expect(await stopped).toMatchObject({ code: 'unknown', outcome: 'unknown' })
    expect(broker.activity(page.token)).toBe('uncertain')
    broker.complete(page.token, command.id, { documentId: '文档甲', count: 1, text: '迟到结果' })
    expect(broker.poll(page.token)).toBeNull()
    broker.pause(page.token, false)
    const read = broker.request('会话甲', page.pageId, 'read', new AbortController().signal, '新读取')
    expect(broker.poll(page.token, false)).toBeNull()
    const next = broker.poll(page.token)!
    broker.complete(page.token, command.id, { documentId: '旧文档', count: 8, text: '旧关联' })
    broker.complete(page.token, next.id, { documentId: '文档甲', count: 1, text: '新观察' })
    broker.complete(page.token, next.id, { documentId: '旧文档', count: 8, text: '重复' })
    await expect(read).resolves.toMatchObject({ documentId: '文档甲', count: 1, text: '新观察' })
  }
  finally {
    broker.dispose()
    vi.useRealTimers()
  }
})

it('会话标签写操作结果不明后仍可查询事实，但查询不会重放或解除写屏障', async () => {
  const broker = new Broker()
  const anchor = broker.register('A', 'session')
  const writing = broker.request('A', anchor.pageId, 'create-tab', new AbortController().signal).catch(error => error)
  const command = broker.poll(anchor.token)!
  broker.fail(anchor.token, command.id, '创建回复丢失')
  expect(await writing).toMatchObject({ code: 'unknown' })
  const listing = broker.request('A', anchor.pageId, 'list-tabs', new AbortController().signal)
  const query = broker.poll(anchor.token)!
  expect(broker.allowed(anchor.token, query)).toBe(true)
  broker.complete(anchor.token, query.id, { kind: 'tabs', tabs: [{ tabId: 'actual-created-tab' }] })
  await expect(listing).resolves.toMatchObject({ tabs: [{ tabId: 'actual-created-tab' }] })
  await expect(broker.request('A', anchor.pageId, 'create-tab', new AbortController().signal)).rejects.toThrow('结果不明')
  broker.dispose()
})

it('页面写结果不明后允许重新观察事实，但仍阻止重复写入和接管期间读取', async () => {
  const broker = new Broker()
  try {
    const page = broker.register('会话甲')
    const writing = broker.request('会话甲', page.pageId, 'click', new AbortController().signal).catch(error => error)
    const issued = broker.poll(page.token)!
    broker.fail(page.token, issued.id, '点击后文档已导航')
    expect(await writing).toMatchObject({ code: 'unknown' })
    const reading = broker.request('会话甲', page.pageId, 'observe', new AbortController().signal)
    const query = broker.poll(page.token)!
    expect(query.action).toBe('observe')
    expect(broker.allowed(page.token, query)).toBe(true)
    broker.complete(page.token, issued.id, { documentId: '旧文档', count: 1, text: '迟到结果' })
    broker.complete(page.token, query.id, { kind: 'semantic', documentId: '新文档', observationId: '新观察', url: 'https://example.com/result', title: '结果页', text: '真实结果', truncated: false, elements: [] })
    await expect(reading).resolves.toMatchObject({ documentId: '新文档', text: '真实结果' })
    expect(broker.activity(page.token)).toBe('uncertain')
    await expect(broker.request('会话甲', page.pageId, 'click', new AbortController().signal)).rejects.toMatchObject({ code: 'unknown' })
    broker.pause(page.token, true)
    await expect(broker.request('会话甲', page.pageId, 'observe', new AbortController().signal)).rejects.toThrow('人工接管')
  }
  finally { broker.dispose() }
})
