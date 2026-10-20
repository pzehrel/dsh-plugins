/** 正式增强工具链的多页指针归属回归；宿主 DOM、公开会话状态与原生 guest 为外部替身，不代表 Desktop 验收。 */
import { expect, it, vi } from 'vitest'
import { harness } from './support/browser-harness.js'

it('同会话标签和跨会话切换只展示所属页位置；后台工具不抢当前标签，结束后新轮不复活', async () => {
  const pages: { nodes: { style: Record<string, string>, removed: boolean }[] }[] = []
  const h = await harness(true, (guest) => {
    const page = { nodes: [] as { style: Record<string, string>, removed: boolean }[] }
    const width = [800, 400, 1000][pages.length]!
    pages.push(page)
    Object.assign(guest, {
      offsetWidth: width,
      offsetHeight: 600,
      parentElement: { append: () => {} },
      getBoundingClientRect: () => ({ left: 0, top: 0, width, height: 600 }),
      ownerDocument: { createElement: () => {
        const node = { style: {} as Record<string, string>, removed: false, setAttribute: () => {}, append: () => {}, remove: () => {
          node.removed = true
        } }
        page.nodes.push(node)
        return node
      } },
    })
    guest.executeJavaScript = async code => code.includes('const elements=[]')
      ? { documentId: guest.documentId, url: guest.getURL(), title: '多页指针夹具', text: '共享页面', elements: [], viewport: [0, 0, width, 600], truncated: false }
      : guest.documentId
  })
  const first = await h.mount('A')
  const second = await h.mount('A')
  const other = await h.mount('B')
  for (const page of [first, second, other]) {
    page.callbacks.loadUrl(page.tabId, page.registration.fixtureUrl)
  }
  h.activity('A', true)
  h.activity('B', true)
  await h.execute('A', undefined, 'select-tab', { tabId: first.tabId })
  await h.execute('A', first.registration.pageId, 'observe')
  expect(pages[0]!.nodes[1]!.style.transform).toBe('translate3d(464px, 330px, 0)')
  await h.execute('A', undefined, 'select-tab', { tabId: second.tabId })
  await h.execute('A', second.registration.pageId, 'observe')
  await vi.waitFor(() => expect(pages[0]!.nodes[0]!.style.display).toBe('none'))
  expect(pages[1]!.nodes[1]!.style.transform).toBe('translate3d(232px, 330px, 0)')
  await h.execute('A', first.registration.pageId, 'observe')
  expect(pages[0]!.nodes[0]!.style.display).toBe('none')
  expect(pages[1]!.nodes[0]!.style.display).toBe('block')
  expect(await h.execute('A', undefined, 'list-tabs')).toMatchObject({ tabs: [{ selected: false }, { selected: true }] })
  h.showSession('B')
  await h.execute('B', other.registration.pageId, 'observe')
  await vi.waitFor(() => expect(pages[1]!.nodes[0]!.style.display).toBe('none'))
  expect(pages[2]!.nodes[1]!.style.transform).toBe('translate3d(580px, 330px, 0)')
  await h.execute('A', first.registration.pageId, 'observe')
  expect(pages[0]!.nodes[0]!.style.display).toBe('none')
  expect(pages[2]!.nodes[0]!.style.display).toBe('block')
  h.showSession('A')
  await vi.waitFor(() => expect(pages[1]!.nodes[0]!.style.display).toBe('block'))
  expect(pages[1]!.nodes[1]!.style.transform).toBe('translate3d(232px, 330px, 0)')
  h.activity('A', false)
  h.activity('A', true)
  expect(pages[0]!.nodes[0]!.style.display).toBe('none')
  expect(pages[1]!.nodes[0]!.style.display).toBe('none')
  await h.unloadClient()
  expect(pages.flatMap(page => page.nodes.filter((_, index) => index % 2 === 0)).every(node => node.removed)).toBe(true)
})
