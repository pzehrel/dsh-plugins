/** 运行锁定 npm 侧栏及 dockkit；只替换渲染、框架装配与内存 store 引擎，不实现地址或路由规则。 */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { createContext, runInContext } from 'node:vm'
import ts from 'typescript'

/** 本测试物化的合成框架会话身份；不对应真实 Agent。 */
type SessionId = Parameters<Context['sidebarRight']['tabsIn']>[0]

/** 内存框架只需要同步读取、订阅和整体替换。 */
interface MemorySnapshot<T> {
  /** @returns 当前缓存引用。 */
  getSnapshot: () => T
  /** @param listener 同步变化通知。@returns 取消订阅。 */
  subscribe: (listener: () => void) => () => void
  /** @param next 整体替换值；不复制或持久化。 */
  set: (next: T) => void
}

/** @param initial 内存初值；不读取磁盘。@returns 同步 observable，供官方框架契约使用。 */
function memorySnapshot<T>(initial: T): MemorySnapshot<T> {
  let value = initial
  const listeners = new Set<() => void>()
  return {
    getSnapshot: () => value,
    subscribe: (listener: () => void) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    set: (next: T) => {
      value = next
      for (const listener of [...listeners]) {
        listener()
      }
    },
  }
}

/** 官方 defineStore 的内存引擎边界；执行传入的原始 action，不重写侧栏 reducer。 */
interface MemorySpec {
  /** 每个框架 scope 创建独立初值。 */
  init: () => object
  /** 官方原始 draft action；参数原样转交。 */
  actions: Record<string, (draft: object, ...args: unknown[]) => void>
}

/** 框架 store 引擎的有限内存实例。 */
interface MemoryInstance extends MemorySnapshot<object> {
  /** 底层 observable，与实例读取同一状态。 */
  store: MemorySnapshot<object>
  /** 官方原始 action 的绑定入口。 */
  actions: Record<string, (...args: unknown[]) => void>
  /** 内存实现没有持久化内容。 */
  clearPersisted: () => void
}

/** @param spec 官方传入的 store 声明。@returns 独立内存实例工厂；原 action 异常直接传播。 */
function memoryStore(spec: MemorySpec): { create: () => MemoryInstance } {
  return { create: () => {
    const store = memorySnapshot(spec.init())
    const actions = Object.fromEntries(Object.entries(spec.actions).map(([name, action]) => [name, (...args: unknown[]) => {
      const draft = structuredClone(store.getSnapshot())
      action(draft, ...args)
      store.set(draft)
    }]))
    return { ...store, store, actions, clearPersisted: () => {} }
  } }
}

/** 只向测试公开真实控制面和框架生命周期。 */
interface OfficialSidebarHarness {
  /** 真实 SDK 公开控制面；不包裹其地址或协议逻辑。 */
  sidebar: Context['sidebarRight']
  /** @param scope 合成会话名。@returns 经过真实 slot 声明物化的合成身份；不创建 Agent。 */
  adopt: (scope: string) => SessionId
  /** 逆序释放本轮注册和 occurrence；重复调用无操作。 */
  dispose: () => void
}

/** @returns 真实公开侧栏面、框架 store 物化入口和幂等清理；依赖漂移或未知模块立即抛错。 */
export function officialSidebar(): OfficialSidebarHarness {
  const require = createRequire(import.meta.url)
  const sidebarFile = require.resolve('@deepseek-ai/dsh-client-ui-sidebar-right/client')
  const dockkitFile = require.resolve('@deepseek-ai/dsh-client-ui-dockkit')
  const sidebarBytes = readFileSync(sidebarFile)
  const dockkitBytes = readFileSync(dockkitFile)
  const sidebarHash = createHash('sha256').update(sidebarBytes).digest('hex')
  const dockkitHash = createHash('sha256').update(dockkitBytes).digest('hex')
  if (sidebarHash !== '7e3c8ead7f24a5b711e6554c9b3f3c0274ee5f95a50f3adc8269028ee0d978a2'
    || dockkitHash !== 'a99b3077aabf01d9388f1ea92d25891f15cd2455c0ed45124aba8485eda2b714'
    || require('@deepseek-ai/dsh-client-ui-sidebar-right/package.json').version !== '0.2.0-rc.2'
    || require('@deepseek-ai/dsh-client-ui-dockkit/package.json').version !== '0.2.0-rc.2') {
    throw new Error('官方侧栏契约输入漂移，须重新核对固定版本及来源')
  }
  const archive = fileURLToPath(new URL('../../upstream/official-browser-0.2.0-rc.2.tgz', import.meta.url))
  if (createHash('sha256').update(readFileSync(archive)).digest('hex') !== '133cd34e9384321e097bb4ae830bc27e087a597959f069a814f29b81a34afcb9') {
    throw new Error('官方浏览器归档摘要不匹配')
  }
  const definition = spawnSync('tar', ['-xOf', archive, 'src/client/definition.tsx'], { encoding: 'utf8' })
  if (definition.status !== 0) {
    throw new Error('无法读取官方浏览器类型声明')
  }
  const cleanups: (() => void)[] = []
  const services = new Map<string, unknown>()
  let createStore: ((scope: string) => unknown) | undefined

  // 只保留组件定义期包装；测试若开始渲染，缺失的渲染 API 会直接失败。
  const renderer: Record<string, unknown> = {
    'react': { createContext: () => ({}), forwardRef: (body: unknown) => body, memo: (body: unknown) => body },
    'react/jsx-runtime': {},
    'react-dom': {},
    'clsx': {},
    '@deepseek-ai/dsh-client-ui-primitives': {},
  }
  const stores = {
    createSnapshotStore: memorySnapshot,
    defineStore: memoryStore,
    notifySubscribers: (listeners: Iterable<() => void>) => {
      for (const listener of [...listeners]) {
        listener()
      }
    },
  }
  const dockkit = { exports: {} }
  const dependency = (name: string): unknown => {
    if (Object.hasOwn(renderer, name)) {
      return renderer[name]
    }
    if (name === '@deepseek-ai/dsh-client-store') {
      return stores
    }
    if (name === '@deepseek-ai/dsh-client-ui-dockkit') {
      return dockkit.exports
    }
    if (name.endsWith('.css')) {
      return {}
    }
    throw new Error(`契约回归未允许的依赖：${name}`)
  }
  // 仅做 ESM→CJS 编译以装配真实 dockkit；原始函数、地址生成与协议检查均不替换。
  runInContext(ts.transpileModule(dockkitBytes.toString(), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, createContext({ module: dockkit, exports: dockkit.exports, require: dependency }))

  const effect = (body: () => unknown): (() => void) => {
    const cleanup = body()
    let active = true
    const dispose = (): void => {
      if (!active) {
        return
      }
      active = false
      if (typeof cleanup === 'function') {
        cleanup()
      }
    }
    cleanups.push(dispose)
    return dispose
  }
  const register = (definition: { name: string, store?: { create: (scope: string) => unknown } }): (() => void) => {
    if (definition.name === 'rightbar.session' && definition.store) {
      const store = definition.store
      createStore = scope => store.create(scope)
    }
    return () => {}
  }
  const ctx = {
    effect,
    reflect: { provide: (name: string, value: unknown) => {
      services.set(name, value)
      return () => {
        services.delete(name)
      }
    } },
    locale: { bind: () => (key: string) => key, register: () => () => {} },
    sessions: {},
    uiSession: { adapter: { current: memorySnapshot({ key: undefined }) } },
    layout: { panelInfo: memorySnapshot({ activePanelId: null }) },
    resources: { pin: () => {} },
    shortcuts: { register: () => () => {}, catalog: memorySnapshot([]) },
    slots: {
      register,
      inject: (_name: string, body: () => unknown) => {
        const result = body()
        if (result && typeof result === 'object' && Symbol.iterator in result) {
          for (const _entry of result as Iterable<unknown>) { /* 执行真实插件的 slot 注册生成器。 */ }
        }
        return () => {}
      },
    },
  }
  runInContext(sidebarBytes.toString(), createContext({
    window: { __ModuleLoader__: { load: (definition: { factory: (require: (name: string) => unknown) => { apply: (ctx: unknown) => void } }) => definition.factory(dependency).apply(ctx) } },
    AbortController,
    Error,
    crypto: globalThis.crypto,
    console,
  }))
  const sidebar = services.get('sidebarRight') as Context['sidebarRight']
  const tabs = services.get('sidebarRightTabs') as Context['sidebarRightTabs']
  if (!sidebar || !tabs || !createStore) {
    throw new Error('官方侧栏未完成框架装配')
  }
  const browser = { exports: {} as { browserDefinition?: (t: (key: string) => string) => Parameters<typeof tabs.register>[0] } }
  runInContext(ts.transpileModule(definition.stdout, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, createContext({ module: browser, exports: browser.exports, require: dependency }))
  if (!browser.exports.browserDefinition) {
    throw new Error('官方浏览器缺少类型声明')
  }
  tabs.register(browser.exports.browserDefinition(key => key))
  const materialize = createStore
  return {
    sidebar,
    adopt: (scope) => {
      materialize(scope)
      return scope as SessionId
    },
    dispose: () => {
      for (const cleanup of cleanups.toReversed()) {
        cleanup()
      }
    },
  }
}
