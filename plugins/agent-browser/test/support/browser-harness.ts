/** 执行真实官方 Client 及既有 Host；只在宿主服务、store 和原生 guest 边界模拟，不代表 Desktop 验收。 */
import type { ToolDefinition, ToolRunContext } from '@deepseek-ai/dsh-tools'
import type { apply as applyEnhancedHost } from '../../src/enhanced-host.js'
import { randomUUID } from 'node:crypto'
import { setMaxListeners } from 'node:events'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import process from 'node:process'
import { createContext, runInContext } from 'node:vm'
import { Context } from '@deepseek-ai/cordis'
import { HostConnectionService } from '@deepseek-ai/dsh-client-connection'
import { afterEach, expect, vi } from 'vitest'
import { apply as applyHost } from '../../src/index.js'

const directory = process.env.DSH_OFFICIAL_BROWSER_PROBE
const cleanups: (() => Promise<void>)[] = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) {
    await cleanup()
  }
})

/** 官方 observable 的外部存储边界；不宣称测试真实持久化介质。 */
function snapshot<T>(initial: T): { getSnapshot: () => T, set: (value: T) => void, subscribe: (listener: () => void) => () => void } {
  let value = initial
  const listeners = new Set<() => void>()
  return {
    getSnapshot: () => value,
    set: (next) => {
      value = next
      for (const listener of listeners) {
        listener()
      }
    },
    subscribe: (listener) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
}

/** 模拟 guest 的公开方法；脚本在独立 VM 的固定测试 DOM 中运行，原生输入仅记录为模拟。 */
class Guest extends EventTarget {
  dataset: Record<string, string> = {}
  url = 'about:blank'
  count = { textContent: '0' }
  input = { value: '初始内容' }
  documentId = randomUUID()
  inputEvents: object[] = []
  history: string[] = []
  historyIndex = -1
  attributes = new Map<string, string>()
  removed = false
  readonly fixture

  constructor() {
    super()
    const button = { getBoundingClientRect: () => ({ x: 0, y: 0, width: 20, height: 20 }) }
    this.fixture = createContext({
      document: {
        body: { dataset: { spikeDocument: this.documentId } },
        querySelector: (selector: string) => ({ '#count': this.count, '#human-input': this.input, '#bump': button })[selector],
        elementFromPoint: () => button,
      },
      window: { spikeLastTrusted: false },
    })
  }

  override addEventListener(type: string, callback: EventListenerOrEventListenerObject | null, options?: boolean | AddEventListenerOptions): void {
    if (typeof options === 'object' && options.signal) {
      setMaxListeners(0, options.signal)
    }
    super.addEventListener(type, callback, options)
  }

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value)
  }

  getURL(): string {
    return this.url
  }

  getTitle(): string {
    return '受控 guest 替身'
  }

  isLoading(): boolean {
    return false
  }

  canGoBack(): boolean {
    return this.historyIndex > 0
  }

  canGoForward(): boolean {
    return this.historyIndex < this.history.length - 1
  }

  clearHistory(): void {
    this.history = [this.url]
    this.historyIndex = 0
  }

  emit(name: string): void {
    this.dispatchEvent(Object.assign(new Event(name), { isMainFrame: true }))
  }

  async loadURL(url: string): Promise<void> {
    this.url = url
    this.history = [...this.history.slice(0, this.historyIndex + 1), url]
    this.historyIndex = this.history.length - 1
    this.emit('did-navigate')
    this.emit('did-stop-loading')
  }

  goBack(): void {
    this.url = this.history[--this.historyIndex]!
    this.emit('did-navigate')
  }

  goForward(): void {
    this.url = this.history[++this.historyIndex]!
    this.emit('did-navigate')
  }

  reload(): void {
    this.emit('dom-ready')
  }

  remove(): void {
    this.removed = true
  }

  async executeJavaScript(code: string): Promise<unknown> {
    return runInContext(code, this.fixture)
  }

  async sendInputEvent(event: object): Promise<void> {
    this.inputEvents.push(event)
    if ('type' in event && event.type === 'mouseUp') {
      this.count.textContent = String(Number(this.count.textContent) + 1)
    }
  }
}

interface Checkpoint { byTab: Record<string, unknown> }
interface Injected {
  mount: (request: object) => () => void
  loadUrl: (id: string, value: string) => void
  restore: (id: string) => void
  goBack: (id: string) => void
  goForward: (id: string) => void
}
interface BodyDefinition {
  store: { init: () => Checkpoint }
  inject: (sessionId: string, actions: object) => Injected
}

/** @param enhanced 是否使用增强构建。@param configureGuest 配置原生 guest 外部边界，默认保留同步导航替身。@returns 共存 builtin 与增强实现的受控宿主，保留实际官方注册、控制器和 Electron 页面代码。 */
export async function harness(enhanced = false, configureGuest: (guest: Guest) => void = () => {}): Promise<{
  /** @param sessionId 公开会话状态的框架归属。@param running 模拟该会话当前轮运行或结束；不授予工具许可。 */
  activity: (sessionId: string, running: boolean) => void
  takeover: (sessionId: string, tabId: string) => Promise<void>
  retainSession: (sessionId: string, adopted?: boolean) => Promise<void>
  showSession: (sessionId: string) => void
  mount: (sessionId?: string, initial?: unknown) => Promise<{ callbacks: Injected, tabId: string, signal: AbortController, state: Checkpoint, registration: { pageId: string, token: string, fixtureUrl: string } }>
  execute: (owner: string, pageId: string | undefined, action: string, extra?: Record<string, unknown>) => Promise<unknown>
  guests: Guest[]
  tabs: Map<string, { id: string, kind: string, priority: string, keepMounted: boolean }>
  leases: Set<string>
  shortcuts: Set<string>
  styles: Map<string, string>
  rpc: (channel: string, endpoint: string, payload: unknown, signal?: AbortSignal) => Promise<{ ok: boolean, value?: unknown, status?: number }>
  toolName: () => string | undefined
  unloadClient: () => Promise<void>
  unloadHost: () => Promise<void>
}> {
  const hostCleanups: (() => unknown)[] = []
  const clientCleanups: (() => unknown)[] = []
  const builtinCleanups: (() => unknown)[] = []
  cleanups.push(async () => {
    for (const cleanup of [...hostCleanups, ...builtinCleanups, ...clientCleanups].reverse()) {
      await cleanup()
    }
  })
  const connection = new HostConnectionService(new Context(), [], {} as ConstructorParameters<typeof HostConnectionService>[2])
  hostCleanups.push(connection.rpc.intercept('/api', endpoint => endpoint === 'builtin/ready', async () => ({ ok: true, value: 'ready' })))
  let tool: ToolDefinition | undefined
  const builtHost = enhanced ? await import(new URL('../../dist/enhanced/index.js', import.meta.url).href) as { apply: typeof applyEnhancedHost } : undefined
  await (builtHost?.apply ?? applyHost)({
    connection,
    agents: { list: () => [] },
    tools: {
      register: (definition) => {
        tool = definition
        return () => {
          tool = undefined
        }
      },
      execute: async () => {
        throw new Error('本实验直接调用注册定义，不冒充完整 ToolRuntime 流水线')
      },
    },
    effect: effect => hostCleanups.push(effect() as () => unknown),
  })
  const registrations = new Map<string, { pageId: string, token: string, fixtureUrl: string }>()
  const handler = connection.createSharedFetchHandler('/api')
  let rpcGate: ((endpoint: string, payload: unknown) => Promise<void>) | undefined
  const rpc = async (_channel: string, endpoint: string, payload: unknown, signal?: AbortSignal): Promise<{ ok: boolean, value?: unknown, status?: number }> => {
    await rpcGate?.(endpoint, payload)
    const response = await handler.fetch(new Request(`http://127.0.0.1/api/${endpoint}`, {
      method: 'POST',
      signal,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'client-request', rpcId: randomUUID(), method: endpoint, payload }),
    }))
    if (!response.ok) {
      return { ok: false, status: response.status }
    }
    const reply = await response.json()
    if (endpoint.endsWith('/register') && reply.result.ok && (payload as { scope?: string }).scope !== 'session') {
      registrations.set((payload as { sessionId: string }).sessionId, reply.result.value)
    }
    return reply.result
  }
  const tabs = new Map<string, { id: string, kind: string, priority: string, keepMounted: boolean }>()
  const slots = new Map<string, BodyDefinition>()
  const titleSlots = new Map<string, { inject: (sessionId: string) => { renderToolStatus: (tabId: string) => { props: { takeover: () => Promise<void>, resume: () => Promise<void> } } } }>()
  const locales = new Set<string>()
  const shortcuts = new Set<string>()
  const openTabs: { sessionId: string, tabId: string }[] = []
  const guests: Guest[] = []
  const leases = new Set<string>()
  const bridge = {
    acquire: async (_workspace: string) => {
      const lease = randomUUID()
      leases.add(lease)
      return { lease, partition: '受控进程内分区' }
    },
    release: async (lease: string) => {
      leases.delete(lease)
    },
    onOpenRequested: () => () => {},
  }
  const modules = new Map<string, { apply: (ctx: object) => void }>()
  const styles = new Map<string, string>()
  const external = {
    'react': { createElement: (_type: unknown, props: object) => ({ props }) },
    'react/jsx-runtime': {},
    '@deepseek-ai/dsh-client-ui-primitives': {},
    '@deepseek-ai/dsh-client-store': { createSnapshotStore: snapshot, defineStore: (spec: unknown) => spec },
  }
  const document = {
    querySelector: (selector: string) => {
      const key = JSON.parse(selector.slice('style[data-plugin-css='.length, -1)) as string
      return styles.has(key) ? {} : null
    },
    head: { appendChild: (style: { dataset: { pluginCss: string }, textContent: string }) => {
      styles.set(style.dataset.pluginCss, style.textContent)
    } },
    getElementById: () => ({ append: (guest: Guest) => {
      queueMicrotask(() => guest.emit('dom-ready'))
    } }),
    createElement: (tag: string) => {
      if (tag === 'style') {
        return { dataset: {}, textContent: '' }
      }
      if (tag !== 'webview') {
        throw new Error(`实验不允许自建 UI 元素：${tag}`)
      }
      const guest = new Guest()
      configureGuest(guest)
      guests.push(guest)
      return guest
    },
  }
  const sandbox = createContext({
    window: { __ModuleLoader__: { load: ({ id, factory }: { id: string, factory: (require: (name: string) => unknown) => { apply: (ctx: object) => void } }) => {
      if (modules.has(id)) {
        throw new Error('重复 Client 模块')
      }
      modules.set(id, factory((name) => {
        if (!(name in external)) {
          throw new Error(`未声明外部模块：${name}`)
        }
        return external[name as keyof typeof external]
      }))
    } } },
    dshDesktop: { protocolVersion: 1, browser: bridge },
    document,
    crypto,
    TextEncoder,
    URL,
    AbortController,
    AbortSignal,
    setTimeout,
    clearTimeout,
    console,
  })
  const layouts = new Map<string, { id: string, kind: string, title?: string }[]>()
  const selected = new Map<string, string>()
  let onScreen = 'A'
  let source: { resolve: (binding: object) => unknown } | undefined
  const retained = new Set<string>()
  const sessionStatus = snapshot<ReadonlyMap<string, { running: boolean | undefined }>>(new Map())
  const ctx = {
    connection: { rpc: { call: rpc } },
    locale: {
      bind: () => (key: string) => key,
      register: (namespace: string) => {
        if (locales.has(namespace)) {
          throw new Error('重复 locale')
        }
        locales.add(namespace)
        return () => {
          locales.delete(namespace)
        }
      },
    },
    shortcuts: { register: ({ id }: { id: string }) => {
      if (shortcuts.has(id)) {
        throw new Error('重复快捷键')
      }
      shortcuts.add(id)
      return () => {
        shortcuts.delete(id)
      }
    } },
    uiSession: { sessionStatus, provide: (descriptor: { resolve: (binding: object) => unknown }) => {
      source = descriptor
      return () => {
        source = undefined
      }
    } },
    sidebarRight: {
      openTabs: { getSnapshot: () => openTabs },
      mounted: { getSnapshot: () => onScreen },
      tabsIn: (owner: string) => layouts.get(owner) ?? [],
      openTabIn: (owner: string) => {
        const layout = layouts.get(owner)
        if (layout) {
          const id = randomUUID()
          layout.push({ id, kind: 'browser' })
          selected.set(owner, id)
        }
      },
      closeIn: (owner: string, id: string) => {
        const layout = layouts.get(owner)
        if (layout) {
          layouts.set(owner, layout.filter(tab => tab.id !== id))
        }
      },
      focus: (id: string) => {
        if (layouts.get(onScreen)?.some(tab => tab.id === id)) {
          selected.set(onScreen, id)
        }
      },
      active: () => {
        const id = selected.get(onScreen)
        return id ? { id } : undefined
      },
    },
    sidebarRightTabs: { register: (definition: { id: string, kind: string, priority: string, keepMounted: boolean }) => {
      if (tabs.has(definition.id)) {
        throw new Error('重复 Sidebar 实现 id')
      }
      tabs.set(definition.id, definition)
      return () => {
        tabs.delete(definition.id)
      }
    } },
    slots: {
      inject: (_name: string, install: () => unknown) => install(),
      register: (definition: BodyDefinition & { key: string, name: string }) => {
        if (definition.name === 'sidebar.right.pane.tab.title') {
          titleSlots.set(definition.key, definition as unknown as { inject: (sessionId: string) => { renderToolStatus: (tabId: string) => { props: { takeover: () => Promise<void>, resume: () => Promise<void> } } } })
        }
        if (definition.name === 'sidebar.right.pane.tab') {
          slots.set(definition.key, definition)
        }
        return () => {
          slots.delete(definition.key)
        }
      },
    },
    workspaces: { list: { getSnapshot: () => ({ phase: 'ready', items: [{ path: '/controlled/workspace', sessionIds: ['A', 'B'] }] }) } },
    inject: (_dependencies: string[], install: (scope: object) => unknown) => install(ctx),
    effect: (effect: () => unknown) => {
      const cleanup = effect()
      if (typeof cleanup === 'function') {
        clientCleanups.push(cleanup as () => unknown)
      }
    },
  }
  const pluginId = enhanced ? 'dsh-plugin-agent-browser' : 'dsh-plugin-official-browser-reuse-probe'
  const moduleId = enhanced ? JSON.parse(readFileSync(new URL('../../dist/enhanced/package.json', import.meta.url), 'utf8')).name : pluginId
  runInContext(readFileSync(enhanced ? new URL('../../dist/official-reference.js', import.meta.url) : join(directory!, 'package/lib/client.js'), 'utf8'), sandbox)
  runInContext(readFileSync(enhanced ? new URL('../../dist/enhanced/client.js', import.meta.url) : join(directory!, 'client-reuse-probe.js'), 'utf8'), sandbox)
  modules.get('@deepseek-ai/dsh-client-ui-sidebar-browser')!.apply(ctx)
  builtinCleanups.push(...clientCleanups.splice(0))
  modules.get(moduleId)!.apply(ctx)
  /** @param owner 模拟工具执行上下文中的真实归属。@param pageId 页面身份。@param action 固定动作。@returns 注册工具定义执行结果，不代表模型自主调用。 */
  async function execute(owner: string, pageId: string | undefined, action: string, extra: Record<string, unknown> = {}): Promise<unknown> {
    return tool!.execute({ ...(pageId !== undefined ? { pageId } : {}), action, ...extra }, {
      agent: { session: { header: { id: owner } } },
      signal: new AbortController().signal,
    } as ToolRunContext)
  }
  /** @param sessionId 外部正式 SessionBinding 的测试身份。@param adopted 是否存在真实布局服务的 adoption。模拟服务边界，不伪造页面登记。 */
  async function retainSession(sessionId: string, adopted = true): Promise<void> {
    if (adopted && !layouts.has(sessionId)) {
      layouts.set(sessionId, [])
    }
    if (source && !retained.has(sessionId)) {
      retained.add(sessionId)
      source.resolve({ sessionId, ctx: { effect: ctx.effect } })
      await new Promise(resolve => setTimeout(resolve, 20))
    }
  }
  /** @param sessionId 框架正文会话。@param initial 保存检查点。@returns 原官方 controller 回调及外部存储替身。 */
  async function mount(sessionId = 'A', initial?: unknown): Promise<{ callbacks: Injected, tabId: string, signal: AbortController, state: Checkpoint, registration: { pageId: string, token: string, fixtureUrl: string } }> {
    await retainSession(sessionId)
    const previous = registrations.get(sessionId)
    const definition = slots.get(pluginId)!
    const state = definition.store.init()
    const tabId = randomUUID()
    const signal = new AbortController()
    const actions = {
      replace: (id: string, value: unknown) => {
        state.byTab[id] = value
      },
      forget: (id: string) => {
        delete state.byTab[id]
      },
    }
    const callbacks = definition.inject(sessionId, actions)
    openTabs.push({ sessionId, tabId })
    layouts.get(sessionId)!.push({ id: tabId, kind: 'browser' })
    selected.set(sessionId, tabId)
    callbacks.mount({ tabId, signal: signal.signal, viewportId: `viewport-${tabId}`, applicationOrigin: 'https://dsh.invalid', initial, initialUrl: undefined, openTab: () => {} })
    await vi.waitFor(() => expect(registrations.get(sessionId)).not.toBe(previous))
    return { callbacks, tabId, signal, state, registration: registrations.get(sessionId)! }
  }
  return { activity: (sessionId, running) => {
    sessionStatus.set(new Map([...sessionStatus.getSnapshot(), [sessionId, { running }]]))
  }, setRpcGate: (gate?: (endpoint: string, payload: unknown) => Promise<void>) => {
    rpcGate = gate
  }, resume: (sessionId, tabId) => titleSlots.get(pluginId)!.inject(sessionId).renderToolStatus(tabId).props.resume(), setTabTitle: (sessionId: string, tabId: string, title: string) => {
    const tab = layouts.get(sessionId)?.find(tab => tab.id === tabId)
    if (tab) {
      tab.title = title
    }
  }, takeover: (sessionId, tabId) => titleSlots.get(pluginId)!.inject(sessionId).renderToolStatus(tabId).props.takeover(), retainSession, showSession: (sessionId) => {
    onScreen = sessionId
  }, mount, execute, guests, tabs, leases, shortcuts, styles, rpc, toolName: () => tool?.name, unloadClient: async () => {
    for (const cleanup of clientCleanups.splice(0).reverse()) {
      await cleanup()
    }
  }, unloadHost: async () => {
    for (const cleanup of hostCleanups.splice(0).reverse()) {
      await cleanup()
    }
  } }
}
