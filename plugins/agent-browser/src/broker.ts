/** 共享页面控制边界：限定真实归属、请求代次、存活租约及唯一调用，不留存网页结果缓存。 */
import type { Command, PageAction, PageActionResults, PageActivity, PageResult, TabMetadataGuard } from './protocol.js'
import { randomUUID } from 'node:crypto'
import { isNativeInputAction } from './native-input.js'

/** 中止原因；unknown 表示已发出的写动作可能生效，duplicate 表示同一工具调用已处理。 */
type StopCode = 'cancelled' | 'timeout' | 'closed' | 'unloaded' | 'disconnected' | 'unknown' | 'duplicate'
/** 可被工具执行流水线保留的确定性错误，不把结果不明翻译成肯定未执行。 */
export class PageRequestError extends Error {
  /** 中止或去重原因；unknown 禁止自动重试。 */
  readonly code: StopCode
  /** not-started 为未发出，not-delivered 为已读取但未交付，unknown 不保证点击未发生。 */
  readonly outcome: 'not-started' | 'not-delivered' | 'unknown'
  /** @param code 原因。@param outcome 执行确定性。@param message 用户可理解的停止说明。 */
  constructor(code: StopCode, outcome: 'not-started' | 'not-delivered' | 'unknown', message: string) {
    super(`[agent-browser/${code}] ${message}`)
    this.name = 'PageRequestError'
    this.code = code
    this.outcome = outcome
  }
}
/** 只有这些动作会改变页面或布局；读取、感知、截图取消不猜测为写入已经发生。 */
const writingActions = new Set<PageAction>(['choose-file', 'upload-submit', 'click', 'click-element', 'fill', 'press', 'scroll', 'create-tab', 'select-tab', 'close-tab', 'navigate', 'back', 'forward', 'reload'])

interface Pending {
  command: Command
  issued: boolean
  controller: AbortController
  inputStarted?: boolean
  resolve: (value: PageResult) => void
  reject: (error: Error) => void
}
interface Page extends PageRegistration {
  pending?: Pending
  paused: boolean
  uncertain: boolean
  /** 交回后仅成功的新 read/observe 可解除写操作屏障。 */
  needsObservation: boolean
  epoch: number
  lease?: ReturnType<typeof setTimeout>
}
/** 一次挂载的 Client 凭据；token 不进入模型工具结果。 */
export interface PageRegistration {
  /** 所属 DSH 会话，必须来自工具执行上下文或认证 Client 的框架绑定。 */
  sessionId: string
  /** session 为无 guest 的框架会话锚点，省略则为页面。 */
  scope?: 'session'
  /** Host 铸造的页面实例身份，关闭后不可复用。 */
  pageId: string
  /** 仅在宿主和认证 Client 间传递的随机控制凭据。 */
  token: string
}
/** 共享页控制边界；失联五秒撤销登记，防止丢失登记回复或 close 消息留下永久目标。 */
export class Broker {
  private readonly pages = new Map<string, Page>()
  // 只保留调用身份；不缓存已完成观察，也不在取消、重连或关页后补发结果。
  private readonly calls = new Set<string>()
  private disposed = false

  /** @param sessionId 框架绑定的非空会话身份。@param scope 只有正式 SessionBinding 锚点传 session；页面省略。@returns 新凭据；卸载后的迟到登记拒绝。 */
  register(sessionId: string, scope?: 'session'): PageRegistration {
    if (this.disposed) {
      throw new PageRequestError('unloaded', 'not-started', '插件已卸载')
    }
    if (!sessionId) {
      throw new Error('缺少会话身份')
    }
    const page: Page = { sessionId, scope, pageId: randomUUID(), token: randomUUID(), paused: false, uncertain: false, needsObservation: false, epoch: 0 }
    page.lease = this.lease(page)
    this.pages.set(page.pageId, page)
    return { sessionId: page.sessionId, scope, pageId: page.pageId, token: page.token }
  }

  /** @param owner 工具执行身份。@param pageId 可选目标。@returns 明确目标或该会话唯一页面；不跨会话猜测。 */
  target(owner: string, pageId?: string): string {
    if (pageId !== undefined) {
      return pageId
    }
    const owned = [...this.pages.values()].filter(page => page.sessionId === owner && page.scope !== 'session')
    if (owned.length !== 1) {
      throw new Error('需要本会话唯一已登记页面，或明确提供 pageId')
    }
    return owned[0]!.pageId
  }

  /** @param owner 实际 Agent 会话。@returns 已由正式 SessionBinding 登记的无 guest 锚点；不存在或歧义时拒绝。 */
  sessionTarget(owner: string): string {
    const anchors = [...this.pages.values()].filter(page => page.sessionId === owner && page.scope === 'session')
    if (anchors.length !== 1) {
      throw new Error('当前会话尚无有效框架控制锚点')
    }
    return anchors[0]!.pageId
  }

  /** 卸载时先拒绝新登记，再撤销全部凭据及等待请求；重复清理幂等。 */
  dispose(): void {
    this.disposed = true
    for (const page of this.pages.values()) {
      this.retire(page, 'unloaded')
    }
    this.calls.clear()
  }

  /** @param owner 实际 Agent 会话。@param pageId Host 页面身份。@param action Host 白名单动作。@param signal 取消信号。@param callId 可选的正式工具调用关联；重复身份拒绝而不重放。@param extra 仅引用或导航输入，不含权限身份，不接受任意脚本。@returns 与动作对应的本次结果；中止时拒绝并说明确定性。 */
  async request<A extends PageAction>(owner: string, pageId: string, action: A, signal: AbortSignal, callId?: string, extra?: Pick<Command, 'reference' | 'navigation' | 'durationMs' | 'input'>): Promise<PageActionResults[A]> {
    const call = callId === undefined ? undefined : `${owner}\0${callId}`
    if (call && this.calls.has(call)) {
      throw new PageRequestError('duplicate', 'not-started', '重复工具调用已拒绝；不重放旧动作或观察')
    }
    const page = this.pages.get(pageId)
    if (!page) {
      throw new PageRequestError('closed', 'not-started', '页面已关闭或不存在')
    }
    if (page.sessionId !== owner) {
      throw new Error('不能操作其他会话的共享页面')
    }
    if (page.scope === 'session' && !['list-tabs', 'create-tab', 'select-tab', 'close-tab'].includes(action)) {
      throw new Error('会话控制锚点不是网页，不能用它取得页面权限')
    }
    if (call) {
      this.calls.add(call)
    }
    if (page.paused) {
      throw new Error('该页处于人工接管')
    }
    // 写动作结果不明仍允许同页只读观察；观察不清除写屏障，也不重放原动作。
    if (page.uncertain && !(page.scope === 'session' ? action === 'list-tabs' : action === 'observe')) {
      throw new PageRequestError('unknown', 'unknown', '上一操作结果不明；可用 observe 核对现状；继续写操作须人工接管再交回，不自动重试')
    }
    if (page.needsObservation && (writingActions.has(action) || action === 'console')) {
      throw new Error('交回后须先重新读取当前页面，不重放旧操作')
    }
    if (signal.aborted) {
      throw new PageRequestError('cancelled', 'not-started', '请求已取消，动作尚未发出')
    }
    if (page.pending) {
      throw new Error('该页已有在途请求')
    }
    return new Promise<PageActionResults[A]>((resolve, reject) => {
      const id = randomUUID()
      const cancel = (): void => {
        this.stop(page, 'cancelled')
      }
      const timer = setTimeout(() => {
        this.stop(page, 'timeout')
      }, isNativeInputAction(action) ? 120000 : 15000)
      const cleanup = (): void => {
        clearTimeout(timer)
        signal.removeEventListener('abort', cancel)
      }
      signal.addEventListener('abort', cancel, { once: true })
      page.pending = {
        command: { id, epoch: page.epoch, action, ...extra },
        issued: false,
        controller: new AbortController(),
        resolve: (value) => {
          cleanup()
          resolve(value as PageActionResults[A])
        },
        reject: (error) => {
          cleanup()
          reject(error)
        },
      }
    })
  }

  /** @param token Client 凭据。@param accept 默认领取命令；false 仅续租，不消费下一条请求。@returns 只交付一次的动作。 */
  poll(token: string, accept = true): Command | null {
    const page = this.byToken(token)
    clearTimeout(page.lease)
    page.lease = this.lease(page)
    if (!accept || page.paused || (page.uncertain && !(page.scope === 'session' ? page.pending?.command.action === 'list-tabs' : page.pending?.command.action === 'observe')) || !page.pending || page.pending.issued) {
      return null
    }
    page.pending.issued = true
    return page.pending.command
  }

  /** @param token Client 凭据。@returns 无网页内容的紧凑运行状态。 */
  activity(token: string): PageActivity {
    const page = this.byToken(token)
    return page.paused ? 'paused' : page.uncertain ? 'uncertain' : page.pending ? 'running' : 'idle'
  }

  /** @param token Client凭据。@param id 请求关联。@param value 本次结果。@param metadata 标签metadata采集时的目标页代次，缺少或过期则只交付无内容身份。迟到和重复结果丢弃。 */
  complete(token: string, id: string, value: PageResult, metadata: readonly TabMetadataGuard[] = []): void {
    const page = this.byToken(token)
    if (page.pending?.command.id !== id || !page.pending.issued) {
      return
    }
    const pending = page.pending
    const kind = 'kind' in value ? value.kind : 'fixed'
    // 穷举约束使新增动作必须声明结果类型，不能把其他通路的结果交给当前等待者。
    const expectedKind: Record<PageAction, string> = { 'upload-submit': 'input', 'choose-file': 'file-choice', 'console': 'console', 'read': 'fixed', 'click': 'fixed', 'observe': 'semantic', 'resolve': 'resolved', 'click-element': 'input', 'fill': 'input', 'press': 'input', 'scroll': 'input', 'screenshot': 'screenshot', 'list-tabs': 'tabs', 'create-tab': 'tabs', 'select-tab': 'tabs', 'close-tab': 'tabs', 'navigate': 'navigation', 'back': 'navigation', 'forward': 'navigation', 'reload': 'navigation' }
    if (kind !== expectedKind[pending.command.action] || ('kind' in value && value.kind === 'input' && value.action !== pending.command.action)) {
      this.stop(page, 'cancelled', '结果类型与请求动作不匹配')
      return
    }
    page.pending = undefined
    pending.controller.abort()
    if ((pending.command.action === 'read' || pending.command.action === 'observe')) {
      page.needsObservation = false
    }
    if ('kind' in value && value.kind === 'tabs') {
      // session锚点自身许可不代表目标页仍允许交付，接管再交回也不能恢复旧metadata。
      value = { kind: 'tabs', tabs: value.tabs.map(({ title, url, paused, ...identity }) => {
        const target = identity.pageId === undefined ? undefined : this.pages.get(identity.pageId)
        const owned = target?.sessionId === page.sessionId && target.scope !== 'session'
        const guard = metadata.find(guard => guard.tabId === identity.tabId && guard.pageId === identity.pageId)
        if (owned && !target.paused && !paused && guard?.epoch === target.epoch) {
          return { ...identity, ...(url === undefined ? {} : { url }), ...(title === undefined ? {} : { title }) }
        }
        return { ...identity, ...(paused || (owned && target.paused) ? { paused: true } : {}) }
      }) }
    }
    pending.resolve(value)
  }

  /** @param token Client凭据。@param paused 人工接管或交回。@returns 更新后的暂停代次；立即撤销旧结果，Client另等在途结算，交回仍须新观察。 */
  pause(token: string, paused: boolean): number {
    const page = this.byToken(token)
    page.paused = paused
    page.epoch++
    this.stop(page, 'cancelled', '人工接管状态变化，在途结果已丢弃')
    if (!paused) {
      page.uncertain = false
      page.needsObservation = true
    }
    return page.epoch
  }

  /** @param token Client 凭据。@param command 待执行关联。@returns 当前页面代次仍允许该动作。 */
  allowed(token: string, command: Command): boolean {
    const page = this.byToken(token)
    return !page.paused && (!page.uncertain || (page.scope === 'session' ? command.action === 'list-tabs' : command.action === 'observe')) && page.epoch === command.epoch && page.pending?.command.id === command.id && page.pending.command.action === command.action
  }

  /** @param token Client凭据。@param command 已获逐次批准的当前请求。原生调用前的不可重试边界；此后取消保守标为结果不明。 */
  inputStarted(token: string, command: Command): void {
    if (!isNativeInputAction(command.action) || !this.allowed(token, command)) {
      throw new Error('原生输入请求已失效')
    }
    const pending = this.byToken(token).pending!
    if (pending.inputStarted) {
      throw new Error('重复原生输入已拒绝')
    }
    pending.inputStarted = true
  }

  /** @param token Client凭据。@param command 当前已领取请求。@returns 随取消、接管、关页或结果结算中止的生命周期，正式审批不得越过它。 */
  requestSignal(token: string, command: Command): AbortSignal {
    if (!this.allowed(token, command)) {
      throw new Error('请求已失效，不能发起审批')
    }
    return this.byToken(token).pending!.controller.signal
  }

  /** @param token Client 凭据。@returns 页面所属真实会话，仅验证设施使用。 */
  owner(token: string): PageRegistration {
    return this.byToken(token)
  }

  /** @param token Client 凭据。@param id 关联。@param message 固定动作失败说明；已发出写操作的失败保守标为结果不明。@param notStarted Client 在任何写方法发出前失败时才能标记为 true。 */
  fail(token: string, id: string, message: string, notStarted = false): void {
    const page = this.byToken(token)
    if (page.pending?.command.id === id) {
      if (notStarted) {
        page.pending.issued = false
        page.pending.inputStarted = false
      }
      this.stop(page, 'cancelled', message.slice(0, 200))
    }
  }

  /** @param token Client 凭据。@param reason 明确关页或断线；旧凭据失效，旧请求不迁移到相同网址的新页。 */
  close(token: string, reason: 'closed' | 'disconnected' = 'closed'): void {
    const page = [...this.pages.values()].find(page => page.token === token)
    if (page) {
      this.retire(page, reason)
    }
  }

  /** @param page 持有租约的页面。@returns 五秒租约计时器，不阻止 Node 退出。 */
  private lease(page: Page): ReturnType<typeof setTimeout> {
    const timer = setTimeout(() => {
      this.retire(page, 'disconnected')
    }, 5000)
    timer.unref()
    return timer
  }

  /** @param page 当前页面。@param reason 停止原因。@param message 可选的固定失败说明。停止后迟到回调没有等待者。 */
  private stop(page: Page, reason: Exclude<StopCode, 'unknown' | 'duplicate'>, message?: string): void {
    const pending = page.pending
    if (!pending) {
      return
    }
    page.pending = undefined
    pending.controller.abort()
    const unknown = isNativeInputAction(pending.command.action) ? pending.inputStarted === true : pending.issued && writingActions.has(pending.command.action)
    page.uncertain ||= unknown
    const labels = { cancelled: '请求已取消', timeout: '请求超时', closed: '页面已关闭', unloaded: '插件已卸载', disconnected: '连接已中断' }
    pending.reject(new PageRequestError(unknown ? 'unknown' : reason, unknown ? 'unknown' : pending.issued && !isNativeInputAction(pending.command.action) ? 'not-delivered' : 'not-started', `${message ?? labels[reason]}；${unknown ? '已发出操作结果不明，禁止自动重试' : '动作未发出或未交付结果'}`))
  }

  /** @param page 待撤销页面。@param reason 生命周期结束原因。 */
  private retire(page: Page, reason: 'closed' | 'unloaded' | 'disconnected'): void {
    clearTimeout(page.lease)
    this.pages.delete(page.pageId)
    this.stop(page, reason)
  }

  /** @param token Client 挂载凭据。@returns 对应存活页面；过期或撤销的凭据拒绝。 */
  private byToken(token: string): Page {
    const page = [...this.pages.values()].find(page => page.token === token)
    if (!page) {
      throw new Error('Client 凭据失效')
    }
    return page
  }
}
