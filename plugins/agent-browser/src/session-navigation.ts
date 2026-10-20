/** 将统一页面命令委托给已绑定会话的官方 Sidebar 和同一浏览器 controller；不创建浏览器或持有宿主私有对象。 */
import { screenshotDisplayURL as displayURL } from './screenshot.js'

/** 首版标签和导航动作；身份始终取自认证 Client 绑定与 Host Agent 上下文。 */
export type NavigationAction
  /** 列出实际 Agent 会话已 adopted 的浏览器标签。 */
  = | 'list-tabs'
  /** 通过官方 openTabIn 创建该会话首张或后续标签。 */
    | 'create-tab'
  /** 仅屏幕会话可通过官方 focus 选择旧标签；后台明确拒绝。 */
    | 'select-tab'
  /** 通过官方 closeIn 关闭本会话标签并触发 occurrence 撤销。 */
    | 'close-tab'
  /** 经原官方 controller 在同一页面导航。 */
    | 'navigate'
  /** 使用同一原生页面的上一条历史。 */
    | 'back'
  /** 使用同一原生页面的下一条历史。 */
    | 'forward'
  /** 刷新同一页面，不另开 guest。 */
    | 'reload'
/** 导航输入不接收会话、工作区或 guest 身份。 */
export interface NavigationInput {
  /** 创建或导航的 HTTP(S) 地址；由官方地址解析器最终校验。 */
  url?: string
  /** 当前框架会话中待选择或关闭的标签；不作为页面控制凭据。 */
  tabId?: string
}
/** 官方 controller 的无内容导航状态。 */
export interface NavigationState {
  /** 可选的实际已观察地址展示值，去除凭据、查询及片段；尚未观察到时省略，不以请求地址补全。内部控制器仍保留原始地址。 */
  url?: string
  /** 原官方页面是否仍在加载。 */
  loading: boolean
  /** Chromium 是否存在后退历史。 */
  canGoBack: boolean
  /** Chromium 是否存在前进历史。 */
  canGoForward: boolean
}
/** 认证会话内官方布局的标签摘要，不含网页正文。 */
export interface SessionTab {
  /** 官方布局标签身份。 */
  tabId: string
  /** 已就绪增强页的 Host 身份；尚未挂载的标签省略。 */
  pageId?: string
  /** 原官方 controller 观察地址的净化展示值；没有实际文档或已接管时省略。 */
  url?: string
  /** 框架记录的标签标题。 */
  title?: string
  /** 仅当前屏幕会话可确认是否选中；后台省略。 */
  selected?: boolean
  /** 本页正在接管、已接管或交接失败；true 时不输出网页标题/地址，也不允许 Agent 选择或关闭。 */
  paused?: boolean
}
/** 统一结果中的导航状态或会话标签摘要。 */
export type NavigationResult
  = | (NavigationState & {
    /** 原官方 controller 的实际导航状态。 */
    kind: 'navigation'
  })
  | {
    /** 正式 SessionBinding 会话范围的标签结果。 */
    kind: 'tabs'
    /** 实际本会话布局中的浏览器标签；空数组表示没有标签。 */
    tabs: SessionTab[]
  }
/** 同一官方 controller 的有限调用面。 */
export interface NavigationController {
  /** @returns 官方页面当前无内容状态。 */
  state: () => NavigationState
  /** @param listener 官方状态变化回调。@returns 移除订阅。 */
  subscribe: (listener: () => void) => () => void
  /** @param value 地址输入，非法地址由官方 controller 拒绝。 */
  navigate: (value: string) => void
  /** 后退无历史时由适配器先拒绝。 */
  back: () => void
  /** 前进无历史时由适配器先拒绝。 */
  forward: () => void
  /** 刷新同一原生页面。 */
  reload: () => void
  /** @returns 官方地址或加载错误；没有错误时省略。 */
  failure: () => string | undefined
}
/** 正式 SidebarRightController 的已核对公开成员，不使用私有布局 store。 */
export interface SessionSidebar {
  /** @returns 当前屏幕会话；只能用于限制 focus，不能授予权限。 */
  mounted: { getSnapshot: () => string | undefined }
  /** @param owner 认证框架会话。@returns 该会话已 adopted 的布局标签。 */
  tabsIn: (owner: string) => readonly { id: string, kind: string, title?: string }[]
  /** @param owner 认证会话。@param kind 固定 browser。@param options 可选初始地址。 */
  openTabIn: (owner: string, kind: 'browser', options?: { params?: { url?: string } }) => void
  /** @param owner 认证会话。@param tabId 已核对本会话的标签。 */
  closeIn: (owner: string, tabId: string) => void
  /** @param tabId 只用于当前屏幕且归属已经核对的标签。 */
  focus: (tabId: string) => void
  /** @returns 当前屏幕会话活跃标签；后台不调用此值判断归属。 */
  active: () => { id: string } | undefined
}
/** @param value 不可信动作参数。@returns 是否属于此有限适配器。 */
export function isNavigationAction(value: unknown): value is NavigationAction {
  return typeof value === 'string' && ['list-tabs', 'create-tab', 'select-tab', 'close-tab', 'navigate', 'back', 'forward', 'reload'].includes(value)
}
/**
 * @param action 已由 Host 校验的标签动作。
 * @param input 不含会话权限的模型输入。
 * @param owner 来自认证 Client 框架绑定的会话。
 * @param sidebar 官方公开布局服务。
 * @param issued 在唯一公开写方法发出前同步标记；参数校验失败仍可确定未发出。
 * @param metadata 由同一 Client 登记表补充页面身份与官方已观察地址；不读 guest DOM。
 * @returns 实际提交后的本会话摘要；后台 selected 省略。
 * @throws Error 目标不存在、后台选择无公开路径或宿主未实际完成创建/关闭时拒绝。
 */
export function executeSessionTabs(action: NavigationAction, input: NavigationInput, owner: string, sidebar: SessionSidebar, issued: () => void = () => {}, metadata: (tabId: string) => Pick<SessionTab, 'pageId' | 'url' | 'paused'> = () => ({})): NavigationResult {
  const before = sidebar.tabsIn(owner).filter(tab => tab.kind === 'browser')
  if (action === 'create-tab') {
    if (input.url !== undefined) {
      if (input.url.length > 16384) {
        throw new Error('创建地址过长')
      }
      const url = new URL(input.url)
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
        throw new Error('创建标签仅接受无凭据的 HTTP(S) 地址')
      }
    }
    issued()
    sidebar.openTabIn(owner, 'browser', { params: input.url === undefined ? {} : { url: input.url } })
    if (!sidebar.tabsIn(owner).some(tab => tab.kind === 'browser' && !before.some(old => old.id === tab.id))) {
      throw new Error('当前会话布局未 adopted 或未创建实际标签；未切换其他会话')
    }
  }
  else if (action === 'select-tab' || action === 'close-tab') {
    if (!input.tabId || !before.some(tab => tab.id === input.tabId)) {
      throw new Error('标签不属于本会话或已经关闭')
    }
    if (metadata(input.tabId).paused) {
      throw new Error('目标页处于人工接管，Agent 不能选择或关闭')
    }
    if (action === 'select-tab') {
      if (sidebar.mounted.getSnapshot() !== owner) {
        throw new Error('[agent-browser/background-select-unavailable] 当前公开 SDK 仅提供屏幕会话 focus；后台选择既有标签仍阻塞首版要求')
      }
      issued()
      sidebar.focus(input.tabId)
      if (sidebar.active()?.id !== input.tabId) {
        throw new Error('官方布局未确认选中目标标签')
      }
    }
    else {
      issued()
      sidebar.closeIn(owner, input.tabId)
      if (sidebar.tabsIn(owner).some(tab => tab.id === input.tabId)) {
        throw new Error('官方布局未关闭目标标签')
      }
    }
  }
  else if (action !== 'list-tabs') {
    throw new Error('不是标签动作')
  }
  const foreground = sidebar.mounted.getSnapshot() === owner
  const selected = foreground ? sidebar.active()?.id : undefined
  return { kind: 'tabs', tabs: sidebar.tabsIn(owner).filter(tab => tab.kind === 'browser').map((tab) => {
    const info = metadata(tab.id)
    return { tabId: tab.id, ...(info.pageId ? { pageId: info.pageId } : {}), ...(info.paused ? { paused: true } : { ...(info.url ? { url: displayURL(info.url) } : {}), ...(tab.title === undefined ? {} : { title: tab.title }) }), ...(foreground ? { selected: tab.id === selected } : {}) }
  }) }
}
/**
 * @param action 页面导航动作。
 * @param input 模型给定地址，不含会话身份。
 * @param target 原官方同一 controller。
 * @param signal 页面生命周期与人工接管合成信号。
 * @param permit 同 Broker 的当前命令许可复核。
 * @param issued 在原 controller 写方法发出前同步标记，区分校验失败与可能已经导航。
 * @returns 原 controller 当前观察到的地址、加载及历史状态；最多等待一秒，仍加载即返回 loading=true，尚未观察到实际地址时省略 url，不以请求地址冒充实际页面。
 * @throws Error 取消、许可撤销、非法地址、历史不可用或原生加载失败；不重试。
 */
export async function executeNavigation(action: NavigationAction, input: NavigationInput, target: NavigationController, signal: AbortSignal, permit: () => Promise<void>, issued: () => void = () => {}): Promise<NavigationResult> {
  await permit()
  if (action === 'navigate' && typeof input.url !== 'string') {
    throw new Error('导航需要 url')
  }
  if (action === 'navigate') {
    if (input.url!.length > 16384) {
      throw new Error('导航地址过长')
    }
    const url = new URL(input.url!)
    if (!['http:', 'https:'].includes(url.protocol)) {
      throw new Error('protocol：导航仅接受 HTTP(S) 地址')
    }
    if (url.username || url.password) {
      throw new Error('credentials：导航不接受 URL 内凭据')
    }
  }
  if (action === 'back' && !target.state().canGoBack) {
    throw new Error('当前页面没有后退历史')
  }
  if (action === 'forward' && !target.state().canGoForward) {
    throw new Error('当前页面没有前进历史')
  }
  if (!['navigate', 'back', 'forward', 'reload'].includes(action)) {
    throw new Error('不是页面导航动作')
  }
  // 先订阅再提交，避免同步 guest 事件使等待者错过导航结束。取消只丢弃请求，不声称撤回已经发生的导航。
  await new Promise<void>((resolve, reject) => {
    let submitted = false
    let settled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    let unsubscribe = (): void => {}
    const finish = (error?: unknown): void => {
      if (settled) {
        return
      }
      settled = true
      clearTimeout(timer)
      unsubscribe()
      signal.removeEventListener('abort', abort)
      if (error) {
        reject(error)
      }
      else {
        resolve()
      }
    }
    function abort(): void {
      finish(new Error('导航请求已取消；已发出导航可能继续'))
    }
    const changed = (): void => {
      if (!submitted) {
        return
      }
      const failure = target.failure()
      if (failure) {
        finish(new Error(failure))
      }
      else if (!target.state().loading) {
        finish()
      }
    }
    unsubscribe = target.subscribe(changed)
    // 页面可能等待慢资源或持续加载；只交付真实加载状态，让后续observe核对，不把正常等待升级为未知写结果。
    timer = setTimeout(() => finish(target.failure()), 1000)
    signal.addEventListener('abort', abort, { once: true })
    try {
      signal.throwIfAborted()
      issued()
      if (action === 'navigate') {
        target.navigate(input.url!)
      }
      else if (action === 'back') {
        target.back()
      }
      else if (action === 'forward') {
        target.forward()
      }
      else {
        target.reload()
      }
      submitted = true
      changed()
    }
    catch (error) {
      finish(error)
    }
  })
  await permit()
  const state = target.state()
  return { kind: 'navigation', ...state, ...(state.url ? { url: displayURL(state.url) } : {}) }
}
