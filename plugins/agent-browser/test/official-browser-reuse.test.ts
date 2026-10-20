/** 固定发布 bundle 的历史复用实验；不把受控 guest 结果当作原生验证。 */
import process from 'node:process'
import { describe, expect, it, vi } from 'vitest'
import { harness } from './support/browser-harness.js'

const directory = process.env.DSH_OFFICIAL_BROWSER_PROBE

describe.skipIf(!directory)('官方浏览器复用：固定官方代码与受控宿主组合', () => {
  it('保留 builtin 并注册同 kind 扩展，不重复快捷键或自动创建 guest', async () => {
    const h = await harness()
    await h.mount()
    expect([...h.tabs.values()].map(tab => [tab.kind, tab.priority, tab.keepMounted])).toEqual([['browser', 'builtin', true], ['browser', 'extension', true]])
    expect([...h.shortcuts]).toEqual(['browser.new'])
    expect([...h.styles.keys()]).toEqual(['@deepseek-ai/dsh-client-ui-sidebar-browser/Browser.module.css', 'dsh-plugin-official-browser-reuse-probe/Browser.module.css'])
    expect(new Set(h.styles.values()).size).toBe(1)
    expect(h.guests).toHaveLength(0)
  })

  it('工具读取人工修改并点击官方创建的同一 guest，不新建第二份页面', async () => {
    const h = await harness()
    const page = await h.mount()
    page.callbacks.loadUrl(page.tabId, page.registration.fixtureUrl)
    await vi.waitFor(() => expect(h.guests[0]?.getURL()).toBe(page.registration.fixtureUrl))
    const guest = h.guests[0]!
    guest.input.value = '人工修改同一实例'
    expect(await h.execute('A', page.registration.pageId, 'read')).toMatchObject({ documentId: guest.documentId, count: 0, text: '人工修改同一实例' })
    expect(await h.execute('A', page.registration.pageId, 'click')).toMatchObject({ documentId: guest.documentId, count: 1, lastTrusted: false })
    expect(guest.inputEvents).toHaveLength(2)
    expect(h.guests).toHaveLength(1)
    expect(h.leases.size).toBe(1)
  })

  it('复用现有 Host 的会话隔离、接管拒绝及交回后重新读取', async () => {
    const h = await harness()
    const page = await h.mount('B')
    page.callbacks.loadUrl(page.tabId, page.registration.fixtureUrl)
    await vi.waitFor(() => expect(h.guests[0]?.getURL()).toBe(page.registration.fixtureUrl))
    await expect(h.execute('A', page.registration.pageId, 'read')).rejects.toThrow('其他会话')
    await h.rpc('/api', 'agent-browser-spike/pause', { token: page.registration.token, paused: true })
    await expect(h.execute('B', page.registration.pageId, 'click')).rejects.toThrow('人工接管')
    h.guests[0]!.input.value = '接管期间修改'
    await h.rpc('/api', 'agent-browser-spike/pause', { token: page.registration.token, paused: false })
    expect(await h.execute('B', page.registration.pageId, 'read')).toMatchObject({ text: '接管期间修改', count: 0 })
  })

  it('关页撤销工具目标并沿用官方 lease 清理', async () => {
    const h = await harness()
    const page = await h.mount()
    page.callbacks.loadUrl(page.tabId, page.registration.fixtureUrl)
    await vi.waitFor(() => expect(h.leases.size).toBe(1))
    page.signal.abort()
    await vi.waitFor(() => expect(h.leases.size).toBe(0))
    await vi.waitFor(async () => {
      await expect(h.execute('A', page.registration.pageId, 'read')).rejects.toThrow('关闭或不存在')
    })
    expect(h.guests[0]!.removed).toBe(true)
  })

  it('沿用官方 URL 检查点与显式恢复，不在挂载时自动导航', async () => {
    const h = await harness()
    const first = await h.mount()
    first.callbacks.loadUrl(first.tabId, first.registration.fixtureUrl)
    await vi.waitFor(() => expect(h.guests[0]?.getURL()).toBe(first.registration.fixtureUrl))
    const saved = first.state.byTab[first.tabId]
    first.signal.abort()
    await vi.waitFor(() => expect(h.leases.size).toBe(0))
    const restored = await h.mount('B', saved)
    expect(h.guests).toHaveLength(1)
    restored.callbacks.restore(restored.tabId)
    await vi.waitFor(() => expect(h.guests[1]?.getURL()).toBe(first.registration.fixtureUrl))
  })

  it('导航离开唯一测试网址后固定工具拒绝执行', async () => {
    const h = await harness()
    const page = await h.mount()
    page.callbacks.loadUrl(page.tabId, 'https://example.invalid/controlled-mock-only')
    await vi.waitFor(() => expect(h.guests[0]?.getURL()).toBe('https://example.invalid/controlled-mock-only'))
    await expect(h.execute('A', page.registration.pageId, 'click')).rejects.toThrow('可控测试网址')
    expect(h.guests[0]!.inputEvents).toHaveLength(0)
  })
})
