/** 独立源码增强的工具到同页集成；仅在外部宿主服务和原生 guest 边界使用替身。 */
import { describe, expect, it, vi } from 'vitest'
import { harness } from './support/browser-harness.js'

describe('源码增强独立装配', () => {
  it('不加载旧实验插件时，普通工具能读取并点击官方同一共享页面', async () => {
    const h = await harness(true)
    const page = await h.mount()
    page.callbacks.loadUrl(page.tabId, page.registration.fixtureUrl)
    await vi.waitFor(() => expect(h.guests[0]?.getURL()).toBe(page.registration.fixtureUrl))
    h.guests[0]!.input.value = '独立装配的人工内容'
    expect(h.toolName()).toBe('agent_browser')
    expect(await h.execute('A', undefined, 'read')).toMatchObject({ count: 0, text: '独立装配的人工内容' })
    expect(await h.execute('A', page.registration.pageId, 'click')).toMatchObject({ documentId: h.guests[0]!.documentId, count: 1 })
    expect(await h.execute('A', page.registration.pageId, 'read')).toMatchObject({ documentId: h.guests[0]!.documentId, count: 1 })
    await expect(h.execute('A', '', 'click')).rejects.toThrow('关闭或不存在')
    expect(h.guests).toHaveLength(1)
    expect([...h.shortcuts]).toEqual(['browser.new'])
  })
})

describe('源码增强撤销与正式路由', () => {
  it('关闭自有页后旧目标失效，卸载增强恢复 builtin 并注销工具', async () => {
    const h = await harness(true)
    const page = await h.mount()
    page.callbacks.loadUrl(page.tabId, page.registration.fixtureUrl)
    await vi.waitFor(() => expect(h.leases.size).toBe(1))
    await expect(h.execute('B', page.registration.pageId, 'read')).rejects.toThrow('其他会话')
    const diagnostic = await h.rpc('/api', 'agent-browser/self-test', { token: page.registration.token })
    expect(diagnostic).toMatchObject({ ok: false, status: 404 })
    expect(await h.rpc('/api', 'builtin/ready', {})).toMatchObject({ ok: true, value: 'ready' })
    page.signal.abort()
    await vi.waitFor(() => expect(h.leases.size).toBe(0))
    await vi.waitFor(async () => {
      await expect(h.execute('A', page.registration.pageId, 'read')).rejects.toThrow('关闭或不存在')
    })
    await h.unloadClient()
    expect([...h.tabs.keys()]).toEqual(['@deepseek-ai/dsh-client-ui-sidebar-browser'])
    expect([...h.shortcuts]).toEqual(['browser.new'])
    await h.unloadHost()
    expect(h.toolName()).toBeUndefined()
  })
})
