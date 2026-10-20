/** 通过真实增强工具、Connection 和 Broker 验证导航；仅替换外部 guest 与宿主布局服务。 */
import { expect, it, vi } from 'vitest'
import { executeNavigation } from '../src/session-navigation.js'
import { harness } from './support/browser-harness.js'

it('导航复用同一官方页并返回实际地址，接管时拒绝新导航', async () => {
  const h = await harness(true)
  const page = await h.mount('A')
  page.callbacks.loadUrl(page.tabId, page.registration.fixtureUrl)
  await vi.waitFor(() => expect(h.guests[0]?.getURL()).toBe(page.registration.fixtureUrl))
  const destination = `${page.registration.fixtureUrl}/next?step=2`
  const redirected = new URL(destination)
  redirected.search = '?token=redirect-query-secret'
  redirected.hash = 'redirect-fragment-secret'
  const guest = h.guests[0]!
  const load = guest.loadURL.bind(guest)
  guest.loadURL = url => load(url === destination ? redirected.href : url)
  const result = await h.execute('A', page.registration.pageId, 'navigate', { url: destination })
  expect(result).toMatchObject({ kind: 'navigation', url: `${page.registration.fixtureUrl}/next`, loading: false })
  expect(JSON.stringify(result)).not.toContain('secret')
  expect(h.guests).toHaveLength(1)
  expect(await h.execute('A', page.registration.pageId, 'back')).toMatchObject({ url: page.registration.fixtureUrl })
  expect(await h.execute('A', page.registration.pageId, 'forward')).toMatchObject({ url: `${page.registration.fixtureUrl}/next` })
  await h.rpc('/api', 'agent-browser/pause', { token: page.registration.token, paused: true })
  await expect(h.execute('A', page.registration.pageId, 'navigate', { url: page.registration.fixtureUrl })).rejects.toThrow('人工接管')
  expect(h.guests[0]?.getURL()).toBe(redirected.href)
})

it('首次空白页导航尚无观察地址时省略url，不锁住页面且稍后可继续observe', async () => {
  let issued = 0
  const destination = 'https://controlled.invalid/first?private=query#fragment'
  const h = await harness(true, (guest) => {
    guest.loadURL = async () => {
      issued++
    }
    guest.executeJavaScript = async code => code.includes('const elements=[]')
      ? { documentId: guest.documentId, url: guest.getURL(), title: '首次导航页面', text: '页面已到达', elements: [], viewport: [0, 0, 800, 600], truncated: false }
      : guest.documentId
  })
  const page = await h.mount('A')
  const result = await h.execute('A', page.registration.pageId, 'navigate', { url: destination })
  expect(result).toMatchObject({ kind: 'navigation', loading: false, canGoBack: false, canGoForward: false })
  expect(result).not.toHaveProperty('url')
  expect(issued).toBe(1)
  expect(h.guests).toHaveLength(1)
  const guest = h.guests[0]!
  expect(guest.getURL()).toBe('about:blank')
  guest.url = destination
  guest.emit('did-navigate')
  guest.emit('did-stop-loading')
  await expect(h.execute('A', page.registration.pageId, 'observe')).resolves.toMatchObject({ kind: 'semantic', url: 'https://controlled.invalid/first', text: '页面已到达' })
  expect(issued).toBe(1)
  expect(guest.inputEvents).toEqual([])
})

it('首张页用框架会话锚点创建，后台创建不切换屏幕且其他会话标签不可选择或关闭', async () => {
  const h = await harness(true)
  await h.retainSession('A')
  await h.retainSession('B')
  h.showSession('B')
  expect(await h.execute('A', undefined, 'list-tabs')).toMatchObject({ kind: 'tabs', tabs: [] })
  const created = await h.execute('A', undefined, 'create-tab', { url: 'https://example.invalid/start' }) as { tabs: { tabId: string, selected?: boolean }[] }
  expect(created.tabs).toHaveLength(1)
  expect(created.tabs[0]).not.toHaveProperty('selected')
  expect(h.guests).toHaveLength(0)
  const tabId = created.tabs[0]!.tabId
  await expect(h.execute('B', undefined, 'select-tab', { tabId })).rejects.toThrow('不属于本会话')
  await expect(h.execute('B', undefined, 'close-tab', { tabId })).rejects.toThrow('不属于本会话')
  await expect(h.execute('A', undefined, 'select-tab', { tabId })).rejects.toThrow('background-select-unavailable')
  h.showSession('A')
  expect(await h.execute('A', undefined, 'select-tab', { tabId })).toMatchObject({ tabs: [{ tabId, selected: true }] })
  expect(await h.execute('A', undefined, 'close-tab', { tabId })).toMatchObject({ tabs: [] })
  await expect(h.execute('A', undefined, 'select-tab', { tabId })).rejects.toThrow('已经关闭')
})

it('无 adopted 布局时创建明确失败，伪造会话输入不能更换实际 Agent 归属', async () => {
  const h = await harness(true)
  await h.retainSession('A', false)
  await expect(h.execute('A', undefined, 'create-tab', { url: 'https://example.invalid/' })).rejects.toThrow('未 adopted')
  await expect(h.execute('B', undefined, 'list-tabs', { sessionId: 'A', workspace: '/controlled/workspace' })).rejects.toThrow('无有效框架控制锚点')
})

it('标签清单返回同一挂载页面的 pageId 与实际地址，拒绝凭据地址和旧目标', async () => {
  const h = await harness(true)
  const a = await h.mount('A')
  a.callbacks.loadUrl(a.tabId, a.registration.fixtureUrl)
  await vi.waitFor(() => expect(h.guests[0]?.getURL()).toBe(a.registration.fixtureUrl))
  expect(await h.execute('A', undefined, 'list-tabs')).toMatchObject({ tabs: [{ tabId: a.tabId, pageId: a.registration.pageId, url: a.registration.fixtureUrl }] })
  const redirected = new URL(`${a.registration.fixtureUrl}/redirect`)
  redirected.search = '?token=list-query-secret'
  redirected.hash = 'list-fragment-secret'
  await h.guests[0]!.loadURL(redirected.href)
  const listed = await h.execute('A', undefined, 'list-tabs')
  expect(listed).toMatchObject({ tabs: [{ url: `${a.registration.fixtureUrl}/redirect` }] })
  expect(JSON.stringify(listed)).not.toContain('secret')
  await expect(h.execute('A', undefined, 'create-tab', { url: 'https://user:secret@example.invalid/' })).rejects.toThrow('无凭据')
  await expect(h.execute('A', a.registration.pageId, 'navigate', { url: 'javascript:alert(1)' })).rejects.toThrow('protocol')
  expect(h.guests[0]?.getURL()).toBe(redirected.href)
  a.signal.abort()
  await vi.waitFor(async () => {
    await expect(h.execute('A', a.registration.pageId, 'read')).rejects.toThrow('关闭或不存在')
  })
})

it('会话锚点不能绕过单页接管读取新metadata或选择关闭目标，其他页仍可创建', async () => {
  const h = await harness(true)
  const page = await h.mount('A')
  page.callbacks.loadUrl(page.tabId, page.registration.fixtureUrl)
  await vi.waitFor(() => expect(h.guests[0]?.getURL()).toBe(page.registration.fixtureUrl))
  await h.takeover('A', page.tabId)
  await h.guests[0]!.loadURL(`${page.registration.fixtureUrl}/human-private?token=paused-secret`)
  h.setTabTitle('A', page.tabId, '暂停期间人工新标题')
  const listed = await h.execute('A', undefined, 'list-tabs') as { tabs: Record<string, unknown>[] }
  expect(listed.tabs).toMatchObject([{ tabId: page.tabId, pageId: page.registration.pageId, paused: true }])
  expect(listed.tabs[0]).not.toHaveProperty('url')
  expect(listed.tabs[0]).not.toHaveProperty('title')
  await expect(h.execute('A', undefined, 'select-tab', { tabId: page.tabId })).rejects.toThrow('人工接管')
  await expect(h.execute('A', undefined, 'close-tab', { tabId: page.tabId })).rejects.toThrow('人工接管')
  const created = await h.execute('A', undefined, 'create-tab') as { tabs: { tabId: string }[] }
  expect(created.tabs).toHaveLength(2)
  expect(created.tabs.some(tab => tab.tabId === page.tabId)).toBe(true)
})

it('list已采集metadata但最终许可未返回时，本地pausing立即阻止发送旧标题与网址', async () => {
  const h = await harness(true)
  const page = await h.mount('A')
  page.callbacks.loadUrl(page.tabId, page.registration.fixtureUrl)
  await vi.waitFor(() => expect(h.guests[0]?.getURL()).toBe(page.registration.fixtureUrl))
  h.setTabTitle('A', page.tabId, '不得发送的旧标题')
  let permits = 0
  let permitHeld = false
  let pauseHeld = false
  let sent = ''
  let releasePermit = () => {}
  let releasePause = () => {}
  h.setRpcGate(async (endpoint, payload) => {
    const row = payload as { token: string, paused: boolean, command?: { action: string }, value?: { kind: string } }
    if (endpoint.endsWith('/permit') && row.command?.action === 'list-tabs' && ++permits === 2) {
      permitHeld = true
      await new Promise<void>((resolve) => {
        releasePermit = resolve
      })
    }
    if (endpoint.endsWith('/pause') && row.token === page.registration.token && row.paused) {
      pauseHeld = true
      await new Promise<void>((resolve) => {
        releasePause = resolve
      })
    }
    if (endpoint.endsWith('/complete') && row.value?.kind === 'tabs') {
      sent = JSON.stringify(row.value)
    }
  })
  let taking: Promise<void> | undefined
  try {
    const pending = h.execute('A', undefined, 'list-tabs')
    await vi.waitFor(() => expect(permitHeld).toBe(true))
    taking = h.takeover('A', page.tabId)
    await vi.waitFor(() => expect(pauseHeld).toBe(true))
    releasePermit()
    const result = await pending as { tabs: Record<string, unknown>[] }
    expect(result.tabs[0]).not.toHaveProperty('url')
    expect(result.tabs[0]).not.toHaveProperty('title')
    expect(sent).not.toContain('不得发送的旧标题')
    expect(sent).not.toContain(page.registration.fixtureUrl)
  }
  finally {
    releasePermit()
    releasePause()
    await taking?.catch(() => {})
    h.setRpcGate()
  }
})

it('tabs完成消息在传输中经历接管及交回后，Host按目标页epoch丢弃旧metadata', async () => {
  const h = await harness(true)
  const page = await h.mount('A')
  page.callbacks.loadUrl(page.tabId, page.registration.fixtureUrl)
  await vi.waitFor(() => expect(h.guests[0]?.getURL()).toBe(page.registration.fixtureUrl))
  h.setTabTitle('A', page.tabId, '传输中的旧标题')
  let held = false
  let release = () => {}
  h.setRpcGate(async (endpoint, payload) => {
    if (!held && endpoint.endsWith('/complete') && (payload as { value?: { kind: string } }).value?.kind === 'tabs') {
      held = true
      await new Promise<void>((resolve) => {
        release = resolve
      })
    }
  })
  try {
    const pending = h.execute('A', undefined, 'list-tabs')
    await vi.waitFor(() => expect(held).toBe(true))
    await h.takeover('A', page.tabId)
    await h.resume('A', page.tabId)
    release()
    const result = await pending as { tabs: Record<string, unknown>[] }
    expect(result.tabs[0]).not.toHaveProperty('url')
    expect(result.tabs[0]).not.toHaveProperty('title')
  }
  finally {
    release()
    h.setRpcGate()
  }
})

it('导航在途接管丢弃结果并解除等待监听，之后不交付迟到的同网址页面', async () => {
  const h = await harness(true)
  const page = await h.mount('A')
  page.callbacks.loadUrl(page.tabId, page.registration.fixtureUrl)
  await vi.waitFor(() => expect(h.guests[0]?.getURL()).toBe(page.registration.fixtureUrl))
  const guest = h.guests[0]!
  let started = false
  guest.loadURL = async (url) => {
    guest.url = url
    started = true
    guest.emit('did-start-navigation')
  }
  const operation = h.execute('A', page.registration.pageId, 'navigate', { url: `${page.registration.fixtureUrl}?pending=1` }).catch(error => error)
  await vi.waitFor(() => expect(started).toBe(true))
  await h.takeover('A', page.tabId)
  expect(await operation).toMatchObject({ code: 'unknown', outcome: 'unknown' })
  guest.emit('did-navigate')
  guest.emit('did-stop-loading')
  await expect(h.execute('A', page.registration.pageId, 'reload')).rejects.toThrow('人工接管')
  expect(h.guests).toHaveLength(1)
})

it('原生加载失败不给请求地址伪造成功结果', async () => {
  const h = await harness(true)
  const page = await h.mount('A')
  page.callbacks.loadUrl(page.tabId, page.registration.fixtureUrl)
  await vi.waitFor(() => expect(h.guests[0]?.getURL()).toBe(page.registration.fixtureUrl))
  h.guests[0]!.loadURL = async () => {
    h.guests[0]!.dispatchEvent(Object.assign(new Event('did-fail-load'), { isMainFrame: true, errorCode: -105 }))
  }
  await expect(h.execute('A', page.registration.pageId, 'navigate', { url: 'https://nonexistent.invalid/' })).rejects.toThrow('原生页面加载失败')
  expect(h.guests[0]?.getURL()).toBe(page.registration.fixtureUrl)
})

it('正常导航仍在加载时返回实际加载状态，不因资源慢而锁住页面', async () => {
  vi.useFakeTimers()
  const lifetime = new AbortController()
  const state = { loading: true, canGoBack: false, canGoForward: false }
  let listeners = 0
  try {
    const operation = executeNavigation('navigate', { url: 'https://example.com/slow' }, {
      state: () => state,
      subscribe: () => {
        listeners++
        return () => {
          listeners--
        }
      },
      navigate: () => {},
      back: () => {},
      forward: () => {},
      reload: () => {},
      failure: () => undefined,
    }, lifetime.signal, async () => {})
    const result = operation.then(value => value)
    void result.catch(() => {})
    await vi.advanceTimersByTimeAsync(1500)
    expect(await Promise.race([result, Promise.resolve('仍被加载等待卡住')])).toMatchObject({ kind: 'navigation', loading: true })
    expect(listeners).toBe(0)
  }
  finally {
    lifetime.abort()
    vi.useRealTimers()
  }
})
