import type { PointerCarrier } from './agent-pointer.js'
/** 官方自有页面统一工具适配：固定动作与主文档感知共用串行命令、独立心跳和接管屏障；不搜索或重建其他页面。 */
import type { InputEditState, InputFileBinding, InputTarget } from './native-input.js'
import type { SelectedFileInfo } from './native-upload.js'
import type { Command, PageActivity } from './protocol.js'
/** 官方自有页面与框架会话的工具适配：命令串行，心跳独立；导航复用同一 controller，断线和关闭只撤销。 */
import type { NavigationController, NavigationInput, SessionSidebar } from './session-navigation.js'
import { createAgentPointer } from './agent-pointer.js'
import { DownloadUnsupportedError, requirePageCapabilities } from './capability-feedback.js'
import { bindInputContent, createInputContentScript, createInputHitScript, inputEditState, isNativeInputAction, sendInputBatch } from './native-input.js'
import { captureSelectedFile, createFileCaptureScript, createFileChoiceScript, createFileInstallScript, createFileMetadataScript, parseSelectedFileInfo } from './native-upload.js'
import { collectConsole, consoleDuration } from './page-console.js'
import { captureScreenshot } from './screenshot.js'
import { createSemanticReader, createSemanticSnapshotScript, documentIdentityScript } from './semantic-observation.js'
import { executeNavigation, executeSessionTabs, isNavigationAction } from './session-navigation.js'

interface Guest extends PointerCarrier {
  /** @returns 当前自有原生页面的网址。 */
  getURL: () => string
  /** @returns 公开Electron缩放因子；当前输入仅验证1倍，其他比例拒绝猜测坐标。 */
  getZoomFactor?: () => number
  /** 公开原生导航事件，仅撤销引用，不从事件读取网页内容。 */
  addEventListener?: (type: string, listener: (event: Event) => void) => void
  /** 关页时撤销自身事件监听。 */
  removeEventListener?: (type: string, listener: (event: Event) => void) => void
  /** @param code 经审查的固定脚本，不接收模型代码。@param userGesture 仅原生choose-file固定传true以打开OS选择器，其他脚本省略。@returns 原生执行结果，可能迟于关闭。 */
  executeJavaScript: (code: string, userGesture?: boolean) => Promise<unknown>
  /** @param event 校验后的原生输入，不移动系统鼠标。 */
  sendInputEvent: (event: object) => Promise<void>
  /** @param text 已逐次审批的普通字段内容；不通过DOM赋值模拟输入。 */
  insertText?: (text: string) => Promise<void>
  /** 同步公开原生全选命令；void返回不证明renderer已选中，必须另读实际选区。 */
  selectAll?: () => void
  /** @returns 同一自有页的原生截图，不建立后台浏览器。 */
  capturePage?: () => Promise<{ toDataURL: () => string }>
}
interface Source<T> {
  /** @returns 当前公开连接状态。 */
  getSnapshot: () => T
  /** @param listener 状态失效回调。@returns 取消订阅。 */
  subscribe: (listener: () => void) => () => void
}
interface Context {
  /** 正式会话状态只控制指针显隐，不作为工具权限或目标归属依据。 */
  uiSession?: { sessionStatus?: Source<ReadonlyMap<string, { readonly running: boolean | undefined }>> }
  /** 正式 Connection；旧实验允许仅提供 RPC，正式增强消费公开状态和代次。 */
  connection: {
    /** 认证调用，不向 guest 暴露凭据。 */
    rpc: { call: (channel: string, endpoint: string, payload: unknown, signal?: AbortSignal) => Promise<{ ok: boolean, value?: unknown, error?: { message?: string } }> }
    /** 可选的公开连接状态；断连或连接替换时撤销现有登记。 */
    state?: Source<'connected' | 'connecting' | 'disconnected' | undefined>
    /** 可选的公开 Host 代次；变更后不把旧调用附着到新宿主。 */
    generation?: Source<{ id: number } | undefined>
  }
}
interface Mount {
  /** 正式正文绑定的标签页，不由工具参数提供。 */
  tabId: string
  /** 仅框架 SessionBinding 注册，不由模型指定。 */
  scope?: 'session'
  /** occurrence 的生命周期，隐藏不应使它中止。 */
  signal: AbortSignal
}
interface Target {
  /** @returns 仅自有且已就绪的原生页面；不扫描宿主 DOM。 */
  getGuest: () => Guest | undefined
  /** 同一原官方 controller，旧实验省略。 */
  navigation?: NavigationController
}
interface Registration {
  pageId?: string
  token: string
  fixtureUrl: string
  protocolVersion?: number
  build?: string
  /** 目标页Host暂停代次；成功接管/交回ACK后更新，只用于metadata最后交付检查。 */
  epoch?: number
}
/** idle 可用；running 执行中；uncertain 结果不明；offline 须重新打开；incompatible 须重装匹配版本；closed 已撤销；pausing/resuming 等待屏障；paused 已接管；失败状态保持本地停用。 */
export type ToolStatus = PageActivity | 'offline' | 'incompatible' | 'closed' | 'pausing' | 'resuming' | 'takeover-failed' | 'resume-failed'
/** 页面内无内容缓存的状态订阅，用于紧凑后台标记。 */
export interface ToolStatusSource {
  /** @returns 当前工具生命周期，不包含网页内容或凭据。 */
  getSnapshot: () => ToolStatus
  /** @param listener React 状态失效回调。@returns 取消订阅。 */
  subscribe: (listener: () => void) => () => void
}
interface StatusStore extends ToolStatusSource { set: (value: ToolStatus) => void }
const readScript = `(()=>({documentId:document.body.dataset.spikeDocument,count:Number(document.querySelector('#count').textContent),text:document.querySelector('#human-input').value.slice(0,200),lastTrusted:window.spikeLastTrusted===true,downloadAttempts:Number(document.body.dataset.spikeDownloadAttempts||0)}))()`
const locateScript = `(()=>{const e=document.querySelector('#bump');const b=e.getBoundingClientRect();const x=b.x+b.width/2,y=b.y+b.height/2;if(document.elementFromPoint(x,y)!==e)throw Error('目标被遮挡');return {x,y,documentId:document.body.dataset.spikeDocument,downloadAttempts:Number(document.body.dataset.spikeDownloadAttempts||0)}})()`

/** @param ctx 正式 Connection。@param prefix 两种现有装配的固定路由。@param expectedBuild 增强构建的内容身份，旧实验省略；不匹配即撤销登记。@param sidebar 可选的正式 Sidebar 标签服务；旧实验省略。@returns 页面绑定、状态与幂等卸载；断线后须用户重新打开，不重放旧调用。 */
export function createToolClient(ctx: Context, prefix = 'agent-browser-spike', expectedBuild?: string, sidebar?: SessionSidebar): {
  attach: (sessionId: string, request: Mount, target: Target) => void
  /** @param sessionId 正式 SessionBinding 会话。@param signal 框架绑定生命周期。登记无 guest 的同 Broker 会话锚点。 */
  attachSession: (sessionId: string, signal: AbortSignal) => void
  status: (sessionId: string, tabId: string) => ToolStatusSource
  /** @param sessionId 框架会话。@param tabId 当前标签。@returns Host 撤销并等待旧操作结算后完成；失败保持本地阻止，不声称已接管。 */
  takeover: (sessionId: string, tabId: string) => Promise<void>
  /** @param sessionId 框架会话。@param tabId 当前标签。@returns 显式交回确认；失败不恢复执行，成功后首次工具动作须为新的 read。 */
  resume: (sessionId: string, tabId: string) => Promise<void>
  dispose: () => Promise<void>
} {
  const active = new Map<string, (reason?: 'closed' | 'offline') => Promise<void>>()
  const lifetimes = new Set<(reason?: 'closed' | 'offline') => Promise<void>>()
  const controls = new Map<string, (paused: boolean) => Promise<void>>()
  const statuses = new Map<string, StatusStore>()
  const pointerRefresh = new Map<string, (sessionChanged?: boolean) => void>()
  const pageBindings = new Map<string, { registration: Registration, target: Target, paused: () => boolean, revision: () => number }>()
  let disposed: Promise<void> | undefined
  let shuttingDown = false
  let generation = ctx.connection.generation?.getSnapshot()?.id

  /** @param key 框架会话与标签页的组合身份。@returns 不留存网页观察的稳定订阅。 */
  function status(key: string): StatusStore {
    let store = statuses.get(key)
    if (!store) {
      let value: ToolStatus = shuttingDown ? 'closed' : 'idle'
      const listeners = new Set<() => void>()
      store = { getSnapshot: () => value, subscribe: (listener) => {
        listeners.add(listener)
        return () => {
          listeners.delete(listener)
        }
      }, set: (next) => {
        if (value === next) {
          return
        }
        value = next
        for (const listener of listeners) {
          listener()
        }
      } }
      statuses.set(key, store)
    }
    return store
  }
  /** @param method 固定路由。@param payload 控制消息。@param signal 页面取消。@returns 成功值；单次通信最多等待三秒，不重试动作。 */
  async function rpc(method: string, payload: object, signal?: AbortSignal): Promise<unknown> {
    const timeout = AbortSignal.timeout(method === 'approve' ? 125000 : 3000)
    const reply = await ctx.connection.rpc.call('/api', `${prefix}/${method}`, payload, signal ? AbortSignal.any([signal, timeout]) : timeout)
    if (!reply.ok) {
      throw new Error(reply.error?.message ?? 'Host 通信失败')
    }
    return reply.value
  }
  /** 公开连接状态和代次失效时先停止全部页面；重新连接不恢复旧控制目标。 */
  function connectionChanged(): void {
    const next = ctx.connection.generation?.getSnapshot()?.id
    const state = ctx.connection.state?.getSnapshot()
    const changed = generation !== undefined && next !== generation
    generation = next
    if (changed || state === 'disconnected' || state === 'connecting') {
      for (const close of active.values()) {
        void close('offline').catch(() => {})
      }
    }
  }
  const unsubscribe = [ctx.connection.state?.subscribe(connectionChanged), ctx.connection.generation?.subscribe(connectionChanged), ctx.uiSession?.sessionStatus?.subscribe(() => {
    for (const refresh of pointerRefresh.values()) {
      refresh(true)
    }
  })]

  /** @param sessionId 正式正文会话。@param request occurrence 身份与信号。@param target 同一自有页的有限能力。 */
  function attach(sessionId: string, request: Mount, target: Target): void {
    if (shuttingDown || request.signal.aborted) {
      return
    }
    const key = `${sessionId}\0${request.tabId}`
    const state = status(key)
    if (ctx.connection.state?.getSnapshot() === 'disconnected' || ctx.connection.state?.getSnapshot() === 'connecting') {
      state.set('offline')
      return
    }
    void active.get(key)?.().catch(() => {})
    const lifetime = new AbortController()
    const signal = AbortSignal.any([request.signal, lifetime.signal])
    const operations = new Set<Promise<void>>()
    const semantic = createSemanticReader()
    const semanticScope = crypto.randomUUID()
    const snapshotScript = createSemanticSnapshotScript(semanticScope)
    let semanticGuest: Guest | undefined
    const navigationEvents = ['did-start-navigation', 'did-navigate-in-page', 'did-frame-navigate', 'dom-ready']
    let documentGeneration = 0
    let documentLifetime = new AbortController()
    let commandDocumentGeneration = 0
    let privateDocumentId: string | undefined
    let pageDocumentMarker: string | undefined
    let executing = false
    let blocked = false
    const pointer = createAgentPointer(() => target.getGuest(), () => !sidebar || (sidebar.mounted.getSnapshot() === sessionId && sidebar.active()?.id === request.tabId))
    let browserUsed = false
    /** 会话运行状态覆盖动作间停顿；缺失公开状态的旧装配仅在当前工具执行期间显示。 */
    const refreshPointer = (sessionChanged = false): void => {
      try {
        const running = ctx.uiSession?.sessionStatus?.getSnapshot().get(sessionId)?.running
        if (sessionChanged && running === false) {
          browserUsed = false
        }
        pointer.setActive(browserUsed && !signal.aborted && !blocked && state.getSnapshot() !== 'uncertain' && (running ?? executing))
      }
      catch { pointer.setActive(false) }
    }
    if (request.scope !== 'session') {
      pointerRefresh.set(key, refreshPointer)
    }
    // 只保存本页获准选择的无内容身份与摘要；接管、导航或关闭立即清除，不留文件字节缓存。
    let fileSelection: { selectionId: string, target: InputTarget, fileId: string, file: SelectedFileInfo } | undefined
    // 网页主世界标记可伪造，只作额外一致性检查；授权和文档代次始终由 Client 私有状态持有。
    const invalidate = (): void => {
      pointer.reset()
      fileSelection = undefined
      documentGeneration++
      documentLifetime.abort()
      documentLifetime = new AbortController()
      privateDocumentId = privateDocumentId === undefined ? undefined : crypto.randomUUID()
      pageDocumentMarker = undefined
      semantic.clear()
    }
    const bindDocument = (marker: string): string => {
      if (privateDocumentId === undefined || (pageDocumentMarker !== undefined && pageDocumentMarker !== marker)) {
        privateDocumentId = crypto.randomUUID()
        semantic.clear()
      }
      pageDocumentMarker = marker
      return privateDocumentId
    }
    const stopNavigation = (): void => {
      for (const event of navigationEvents) {
        semanticGuest?.removeEventListener?.(event, invalidate)
      }
      semanticGuest = undefined
    }
    let registration: Registration | undefined
    let timer: ReturnType<typeof setTimeout> | undefined
    let closed: Promise<void> | undefined
    let incompatible = false
    let controlRevision = 0
    let commandLifetime = new AbortController()
    let transition: Promise<void> | undefined
    let transitionPaused: boolean | undefined
    const registering = rpc('register', { sessionId, scope: request.scope }, signal).then((value) => {
      registration = value as Registration
      if (!signal.aborted && request.scope !== 'session') {
        pageBindings.set(key, { registration, target, paused: () => blocked, revision: () => controlRevision })
      }
      if (prefix === 'agent-browser' && (registration.protocolVersion !== 6 || (expectedBuild !== undefined && registration.build !== expectedBuild))) {
        incompatible = true
        throw new Error('工具连接版本不匹配，请重新安装同一构建的 Host 与 Client')
      }
    })

    /** @param operation 已开始的通信或原生操作；关闭等待其结算，迟到后仍必须通过生命周期检查。 */
    function track(operation: Promise<void>): void {
      operations.add(operation)
      void operation.then(() => operations.delete(operation), () => operations.delete(operation))
    }
    /** @param reason 明确关闭或断线。@returns 同一清理承诺；先撤销 Host 目标，再等待在途操作和迟到登记。 */
    function close(reason: 'closed' | 'offline' = 'closed'): Promise<void> {
      if (closed) {
        return closed
      }
      fileSelection = undefined
      pointer.dispose()
      if (pointerRefresh.get(key) === refreshPointer) {
        pointerRefresh.delete(key)
      }
      lifetime.abort()
      controlRevision++
      documentLifetime.abort()
      stopNavigation()
      semantic.clear()
      if (pageBindings.get(key)?.registration === registration) {
        pageBindings.delete(key)
      }
      commandLifetime.abort()
      if (controls.get(key) === control) {
        controls.delete(key)
      }
      clearTimeout(timer)
      state.set(incompatible ? 'incompatible' : reason)
      request.signal.removeEventListener('abort', abort)
      if (active.get(key) === close) {
        active.delete(key)
      }
      closed = registering.catch(() => {}).then(async () => {
        try {
          if (registration) {
            await rpc('close', { token: registration.token, reason: reason === 'offline' ? 'disconnected' : 'closed' })
          }
        }
        finally {
          await Promise.allSettled([...operations])
          await transition?.catch(() => {})
        }
      }).finally(() => {
        lifetimes.delete(close)
      })
      return closed
    }
    /** occurrence 撤销不产生未处理拒绝；若通信丢失，Host 五秒租约仍会撤销目标。 */
    function abort(): void {
      void close().catch(() => {})
    }
    request.signal.addEventListener('abort', abort, { once: true })
    controls.set(key, control)
    active.set(key, close)
    lifetimes.add(close)

    /** @param paused 显式接管或交回。@returns 同一在途转换；失败保持本地屏障，待用户重试，不自动交回。 */
    function control(paused: boolean): Promise<void> {
      if (transition) {
        return transitionPaused === paused ? transition : Promise.reject(new Error('接管转换尚未结算，不能同时交接'))
      }
      if (signal.aborted || (!paused && state.getSnapshot() !== 'paused' && state.getSnapshot() !== 'resume-failed')) {
        return Promise.reject(new Error('当前页面不能交回，请先完成接管'))
      }
      fileSelection = undefined
      blocked = true
      browserUsed = false
      pointer.setActive(false)
      controlRevision++
      semantic.clear()
      transitionPaused = paused
      commandLifetime.abort()
      state.set(paused ? 'pausing' : 'resuming')
      transition = (async () => {
        try {
          await registering
          signal.throwIfAborted()
          const acknowledged = await rpc('pause', { token: registration!.token, paused }, signal)
          registration!.epoch = acknowledged && typeof acknowledged === 'object' && 'epoch' in acknowledged && typeof acknowledged.epoch === 'number' ? acknowledged.epoch : (registration!.epoch ?? 0) + 1
          // 本地屏障在任何 await 前生效；此时不再产生新命令，仍允许无内容的独立心跳。
          await Promise.allSettled([...operations])
          signal.throwIfAborted()
          if (paused) {
            state.set('paused')
          }
          else {
            commandLifetime = new AbortController()
            blocked = false
            state.set('idle')
          }
        }
        catch (error) {
          if (!signal.aborted) {
            state.set(paused ? 'takeover-failed' : 'resume-failed')
          }
          throw error
        }
        finally {
          transition = undefined
          transitionPaused = undefined
        }
      })()
      return transition
    }

    /** @param fixed 默认仅允许固定测试网址，感知动作明确传 false。@returns 当前同一自有实例；关闭或重建不得复用。 */
    function guest(fixed = true): Guest {
      const failure = target.navigation?.failure()
      if (failure) {
        throw new Error(failure)
      }
      const element = target.getGuest()
      if (signal.aborted || blocked) {
        throw new Error('官方页面已关闭或正在人工接管')
      }
      if (!element) {
        throw new Error(target.navigation?.state().loading ? '页面仍在加载，请稍后重新 observe；未发送输入' : '官方页面未就绪或已关闭')
      }
      requirePageCapabilities(element, 'read')
      // 通用页面不依赖可伪造的网页标记授权；缺少公开导航撤销事件时直接拒绝。
      if (!fixed && (typeof element.addEventListener !== 'function' || typeof element.removeEventListener !== 'function')) {
        throw new Error('[agent-browser/capability-missing] 通用页面缺少公开 addEventListener/removeEventListener，无法确认文档代次')
      }
      if (semanticGuest !== element) {
        if (semanticGuest) {
          invalidate()
        }
        stopNavigation()
        semantic.clear()
        semanticGuest = element
        for (const event of navigationEvents) {
          element.addEventListener?.(event, invalidate)
        }
      }
      if (fixed && element.getURL() !== registration?.fixtureUrl) {
        throw new Error('官方页面未就绪、已关闭或不在可控测试网址')
      }
      return element
    }
    /** @param command 当前请求。@param element 起始自有页。@param commandSignal 当前接管代次与页面生命周期的合成取消。@returns 当前许可，防止每个 await 后继续发送旧输入。 */
    async function permitted(command: Command, element: Guest, commandSignal: AbortSignal): Promise<void> {
      commandSignal.throwIfAborted()
      if (commandDocumentGeneration !== documentGeneration) {
        throw new Error('文档或导航已变化，请重新 observe')
      }
      const fixed = command.action === 'read' || command.action === 'click'
      if (guest(fixed) !== element || !await rpc('permit', { token: registration!.token, command }, commandSignal) || guest(fixed) !== element) {
        throw new Error('请求已失效或人工接管')
      }
      commandSignal.throwIfAborted()
      if (commandDocumentGeneration !== documentGeneration) {
        throw new Error('文档或导航已变化，请重新 observe')
      }
    }
    /** @param command 只执行一次的固定命令。@param pageCommandSignal 页面及接管代次的取消；Host请求撤销另由独立watch传入，任何失败都不自动重放。 */
    async function execute(command: Command, pageCommandSignal: AbortSignal): Promise<void> {
      const token = registration!.token
      const commandCancellation = new AbortController()
      const commandSignal = AbortSignal.any([pageCommandSignal, commandCancellation.signal])
      const watchLifetime = new AbortController()
      const watchSignal = AbortSignal.any([pageCommandSignal, watchLifetime.signal])
      const identity = { id: command.id, epoch: command.epoch, action: command.action }
      let watching: Promise<void> | undefined
      state.set('running')
      let navigationIssued = false
      let inputIssued = false
      browserUsed = true
      refreshPointer()
      const stopPointer = (): void => {
        browserUsed = false
        pointer.setActive(false)
      }
      commandSignal.addEventListener('abort', stopPointer, { once: true })
      try {
        if (isNavigationAction(command.action)) {
          const metadataSnapshots = new Map<string, { pageId: string, epoch: number, unchanged: () => boolean }>()
          const startGeneration = documentGeneration
          const permit = async (): Promise<void> => {
            commandSignal.throwIfAborted()
            if (!navigationIssued && startGeneration !== documentGeneration) {
              throw new Error('执行导航前文档已变化，请重新观察')
            }
            if (blocked || !await rpc('permit', { token, command }, commandSignal)) {
              throw new Error('导航请求已失效或人工接管')
            }
            commandSignal.throwIfAborted()
            if (blocked) {
              throw new Error('页面已人工接管')
            }
          }
          await permit()
          const input: NavigationInput = command.navigation ?? {}
          const value = ['list-tabs', 'create-tab', 'select-tab', 'close-tab'].includes(command.action)
            ? executeSessionTabs(command.action, input, sessionId, sidebar ?? (() => {
                throw new Error('当前宿主未提供正式 Sidebar 控制能力')
              })(), () => {
                navigationIssued = true
              }, (tabId) => {
                const binding = pageBindings.get(`${sessionId}\0${tabId}`)
                const pageId = binding?.registration.pageId
                if (binding && pageId) {
                  const revision = binding.revision()
                  metadataSnapshots.set(tabId, { pageId, epoch: binding.registration.epoch ?? 0, unchanged: () => pageBindings.get(`${sessionId}\0${tabId}`) === binding && !binding.paused() && revision === binding.revision() })
                }
                if (binding?.paused()) {
                  return { ...(pageId ? { pageId } : {}), paused: true }
                }
                const url = binding?.target.navigation?.state().url
                return { ...(pageId ? { pageId } : {}), ...(url ? { url } : {}) }
              })
            : await executeNavigation(command.action, input, target.navigation ?? (() => {
                throw new Error('当前页没有官方导航控制器')
              })(), commandSignal, permit, () => {
                navigationIssued = true
                invalidate()
              })
          await permit()
          if (value.kind === 'tabs') {
            // 最后一次await后同步重核目标页；本地pausing在Host ACK前也会撤销已采集的摘要。
            value.tabs = value.tabs.map((tab) => {
              if (metadataSnapshots.get(tab.tabId)?.unchanged()) {
                return tab
              }
              const { title: _title, url: _url, paused: _paused, ...identity } = tab
              return { ...identity, ...(pageBindings.get(`${sessionId}\0${tab.tabId}`)?.paused() ? { paused: true } : {}) }
            })
          }
          const metadata = [...metadataSnapshots].map(([tabId, snapshot]) => ({ tabId, pageId: snapshot.pageId, epoch: snapshot.epoch }))
          await rpc('complete', { token, id: command.id, value, metadata }, commandSignal)
          return
        }
        const element = guest(command.action === 'read' || command.action === 'click')
        commandDocumentGeneration = documentGeneration
        requirePageCapabilities(element, command.action === 'click' ? 'click' : 'read')
        if (isNativeInputAction(command.action)) {
          if (command.action === 'choose-file') {
            fileSelection = undefined
          }
          let editState: InputEditState | undefined
          // 最后Host许可之后只做本地生命周期复核，避免完整内容核对后再等待Host而重新打开批准绑定窗口。
          const locallyPermitted = (): void => {
            commandSignal.throwIfAborted()
            if (guest(false) !== element || commandDocumentGeneration !== documentGeneration) {
              throw new Error('原生输入前页面或文档已失效')
            }
          }
          const readTarget = async (localOnly = false, focused = command.action === 'press'): Promise<InputTarget> => {
            const check = localOnly ? locallyPermitted : () => permitted(command, element, commandSignal)
            if (element.getZoomFactor?.() !== 1) {
              throw new Error('原生输入坐标仅已核验1倍页面缩放；无法确认比例，未发送输入')
            }
            await check()
            const raw = await element.executeJavaScript(snapshotScript) as { documentId: string, activeNodeId?: string }
            await check()
            const documentId = bindDocument(raw.documentId)
            const binding = await semantic.inputTarget(command.input?.reference ?? '', { ...raw, documentId }, command.action === 'choose-file')
            await check()
            if (focused && raw.activeNodeId !== binding.nodeId) {
              throw new Error('实际焦点不属于已批准目标，请先明确点击并重新observe')
            }
            let fileBinding: InputFileBinding | undefined
            if (command.action === 'upload-submit') {
              const selected = fileSelection
              if (!selected || selected.selectionId !== command.input?.selectionId || selected.target.documentId !== documentId) {
                throw new Error('选择身份已失效或不属于当前文档，请重新选择获准文件')
              }
              const current = await element.executeJavaScript(createFileMetadataScript(semanticScope, selected.target)) as SelectedFileInfo & { fileId?: string }
              await check()
              if (current.fileId !== selected.fileId || JSON.stringify(parseSelectedFileInfo({ ...current, capturedAt: selected.file.capturedAt, contentSource: 'immutable-copy' })) !== JSON.stringify(selected.file)) {
                throw new Error('文件对象或完整内容已变化，请重新选择并授权')
              }
              fileBinding = { nodeId: selected.target.nodeId, fileId: selected.fileId, file: selected.file }
            }
            const contents = await element.executeJavaScript(createInputContentScript(semanticScope, binding.nodeId, command.action === 'choose-file', fileBinding, command.action === 'fill'))
            await check()
            const bound = await bindInputContent(binding, contents)
            await check()
            if (command.action === 'fill') {
              editState = inputEditState(contents, bound)
            }
            return bound
          }
          const binding = await readTarget()
          if (command.action === 'fill' && ((!['INPUT', 'TEXTAREA'].includes(binding.tag)) || binding.readOnly || editState?.badInput || (binding.tag === 'INPUT' && !['text', 'search', 'email', 'url', 'tel', 'number'].includes(binding.inputType)) || typeof element.insertText !== 'function' || typeof element.selectAll !== 'function')) {
            throw new Error('fill需要普通可编辑字段、可确认编辑状态及公开selectAll/insertText；敏感、无效或未知状态拒绝')
          }
          const approvedValue = editState?.value
          await rpc('approve', { token, command, binding }, commandSignal)
          // 先确认无内容撤销通道可用；持续watch独立于Guest读取，不在完整批准复核后再插Host等待。
          if (await rpc('input-watch', { token, command: identity, initial: true }, commandSignal) !== true) {
            throw new Error('原生命令撤销监听不可用，未发送输入')
          }
          watching = (async () => {
            try {
              while (!watchSignal.aborted) {
                if (await rpc('input-watch', { token, command: identity }, watchSignal) !== true) {
                  if (!watchSignal.aborted) {
                    commandCancellation.abort()
                  }
                  return
                }
              }
            }
            catch {
              if (!watchSignal.aborted) {
                commandCancellation.abort()
              }
            }
          })()
          const final = await readTarget()
          if (JSON.stringify(final) !== JSON.stringify(binding)) {
            throw new Error('审批期间目标变化，旧批准失效')
          }
          await permitted(command, element, commandSignal)
          await pointer.move(final, commandSignal)
          // 视觉等待尚未发送原生输入；取消后不能提前进入 Host 的发送边界。
          await permitted(command, element, commandSignal)
          await rpc('input-started', { token, command }, commandSignal)
          await permitted(command, element, commandSignal)
          const verifyApproved = async (focused = command.action === 'press'): Promise<void> => {
            const current = await readTarget(true, focused)
            if (JSON.stringify(current) !== JSON.stringify(binding)) {
              throw new Error('原生输入前完整批准目标或内容变化，旧批准失效')
            }
          }
          // 动画等待可能跨过人工滚动、审批撤销或文档变化；等待后重新走完整许可与本地目标复核。
          await verifyApproved()
          if (await element.executeJavaScript(createInputHitScript(semanticScope, final, command.action === 'press', command.action === 'choose-file')) !== true) {
            throw new Error('原生输入前命中或布局变化，旧批准失效')
          }
          commandSignal.throwIfAborted()
          if (blocked || guest(false) !== element || commandDocumentGeneration !== documentGeneration || privateDocumentId !== final.documentId) {
            throw new Error('原生输入前页面或文档已失效')
          }
          if (element.getZoomFactor?.() !== 1) {
            throw new Error('审批期间页面缩放变化，旧批准失效')
          }
          inputIssued = true
          if (command.action === 'choose-file') {
            // 固定showPicker一次调用安装无内容监听并打开原生选择器；不把普通点击Promise当作OS结算。
            // 已发出后取消只撤销结果许可，仍等真实事件/文档销毁的Guest Promise，不提前ACK或追加FileList读取。
            const choice = await element.executeJavaScript(createFileChoiceScript(semanticScope, final), true) as { status?: string }
            await permitted(command, element, commandSignal)
            if (!choice || !['cancelled', 'selected'].includes(choice.status ?? '')) {
              throw new Error('原生文件选择未取得可信结算')
            }
            let selected: { selectionId: string, file: SelectedFileInfo } | undefined
            if (choice.status === 'selected') {
              const raw = await element.executeJavaScript(createFileCaptureScript(semanticScope, final))
              await permitted(command, element, commandSignal)
              let captured: Awaited<ReturnType<typeof captureSelectedFile>> | undefined
              try {
                captured = await captureSelectedFile(raw)
                await permitted(command, element, commandSignal)
                locallyPermitted()
                const installed = await element.executeJavaScript(createFileInstallScript(semanticScope, final, captured)) as { fileId?: string }
                await permitted(command, element, commandSignal)
                if (typeof installed.fileId !== 'string' || !installed.fileId || installed.fileId.length > 500) {
                  throw new Error('未取得不可变内容副本身份')
                }
                selected = { selectionId: crypto.randomUUID(), file: captured.file }
                fileSelection = { ...selected, target: final, fileId: installed.fileId }
              }
              finally {
                // 原始内容仅在本次捕获/安装暂存；接管或取消不保留稍后补交的内容。
                captured = undefined
              }
            }
            await permitted(command, element, commandSignal)
            semantic.clear()
            await rpc('complete', { token, id: command.id, value: { ...selected, kind: 'file-choice', documentId: final.documentId, observationId: final.observationId, reference: final.reference, status: choice.status } }, commandSignal)
            return
          }
          if (command.action === 'scroll') {
            await element.sendInputEvent({ type: 'mouseWheel', x: Math.round(final.x), y: Math.round(final.y), deltaX: -command.input!.x! || 0, deltaY: -command.input!.y! || 0, canScroll: true })
          }
          else if (command.action === 'press') {
            // 同步排入一对按键，取消后不再发送单独释放事件；已排入的事件仍须等待结算。
            await sendInputBatch([
              () => element.sendInputEvent({ type: 'keyDown', keyCode: command.input!.key! }),
              ...(['Enter', 'Space'].includes(command.input!.key!) ? [() => element.sendInputEvent({ type: 'char', keyCode: command.input!.key! })] : []),
              () => element.sendInputEvent({ type: 'keyUp', keyCode: command.input!.key! }),
            ])
          }
          else {
            await sendInputBatch([
              () => element.sendInputEvent({ type: 'mouseDown', x: Math.round(final.x), y: Math.round(final.y), button: 'left', clickCount: 1 }),
              () => element.sendInputEvent({ type: 'mouseUp', x: Math.round(final.x), y: Math.round(final.y), button: 'left', clickCount: 1 }),
            ])
          }
          if (command.action === 'click-element' || command.action === 'press' || command.action === 'upload-submit') {
            // 原生事件组已完整结算，正常点击/按键/提交可能已导航；只确认原批准文档的发送事实。
            // 不读取新文档，也不要求旧文档仍在；关闭、取消、断线及接管仍由当前命令许可拒绝。
            if (command.action === 'upload-submit') {
              fileSelection = undefined
            }
            semantic.clear()
            commandSignal.throwIfAborted()
            if (blocked || !await rpc('permit', { token, command }, commandSignal)) {
              throw new Error('原生输入结果许可已撤销')
            }
            commandSignal.throwIfAborted()
            watchLifetime.abort()
            await rpc('complete', { token, id: command.id, value: { kind: 'input', documentId: final.documentId, observationId: final.observationId, reference: final.reference, action: command.action, status: 'issued' } }, commandSignal)
            return
          }
          await permitted(command, element, commandSignal)
          if (command.action === 'fill') {
            const focus = async (): Promise<void> => {
              await permitted(command, element, commandSignal)
              // 聚焦/选择事件可能触发网站改写字段或切焦；重新绑定完整普通/隐藏状态及当前编辑事实。
              await verifyApproved(true)
              if (await element.executeJavaScript(createInputHitScript(semanticScope, final, true)) !== true) {
                throw new Error('填写前实际焦点或目标命中已变化，不替换其他字段')
              }
              locallyPermitted()
              if (!editState?.focused || editState.readOnly || editState.disabled || editState.badInput || editState.value !== approvedValue) {
                throw new Error('实际编辑目标、焦点或完整值变化，未继续填写')
              }
            }
            await focus()
            if (approvedValue !== '') {
              element.selectAll!()
              await focus()
              const selected = editState!
              const completeSelection = selected.selectionStart !== null && selected.selectionEnd !== null
                ? selected.selectionStart === 0 && selected.selectionEnd === selected.value.length
                : selected.targetSelectionConfirmed
              if (!completeSelection) {
                throw new Error('无法确认当前目标已完整选中；未替换文字，不自动重试')
              }
            }
            commandSignal.throwIfAborted()
            if (blocked || commandDocumentGeneration !== documentGeneration || privateDocumentId !== final.documentId) {
              throw new Error('填写前文档已失效')
            }
            await element.insertText!(command.input!.text!)
            // 同步全选不是业务ACK；仅在尚未取消时启动一次只读后置核验，不为成功证明在接管后追加读取。
            locallyPermitted()
            const written = inputEditState(await element.executeJavaScript(createInputContentScript(semanticScope, final.nodeId)), final)
            locallyPermitted()
            if (!written.focused || written.readOnly || written.disabled || written.badInput || written.value !== command.input!.text!) {
              throw new Error('原生填写后的实际值或目标无法确认，结果不明；请人工核对，不自动重试')
            }
          }
          semantic.clear()
          await permitted(command, element, commandSignal)
          watchLifetime.abort()
          await rpc('complete', { token, id: command.id, value: { kind: 'input', documentId: final.documentId, observationId: final.observationId, reference: final.reference, action: command.action, status: 'issued' } }, commandSignal)
          return
        }
        if (command.action === 'console') {
          await permitted(command, element, commandSignal)
          const marker = await element.executeJavaScript(documentIdentityScript)
          await permitted(command, element, commandSignal)
          if (typeof marker !== 'string') {
            throw new TypeError('页面文档标记无效')
          }
          const documentId = bindDocument(marker)
          const consoleSignal = AbortSignal.any([commandSignal, documentLifetime.signal])
          const value = await collectConsole(element, documentId, consoleDuration(command.durationMs), consoleSignal, () => !blocked && !signal.aborted && target.getGuest() === element && commandDocumentGeneration === documentGeneration && privateDocumentId === documentId, () => permitted(command, element, commandSignal), [token])
          const clearResult = (): void => {
            value.messages.length = 0
          }
          consoleSignal.addEventListener('abort', clearResult, { once: true })
          if (consoleSignal.aborted) {
            clearResult()
          }
          try {
            await permitted(command, element, commandSignal)
            if (await element.executeJavaScript(documentIdentityScript) !== marker || privateDocumentId !== documentId) {
              throw new Error('控制台结果所属文档已变化，请重新 observe')
            }
            await permitted(command, element, commandSignal)
            await rpc('complete', { token, id: command.id, value }, commandSignal)
          }
          finally {
            // 只保留本次待交付局部值；接管/取消/最终结果结算后不留历史缓存。
            consoleSignal.removeEventListener('abort', clearResult)
            clearResult()
          }
          return
        }
        if (command.action === 'observe' || command.action === 'resolve') {
          await permitted(command, element, commandSignal)
          const raw = await element.executeJavaScript(snapshotScript) as { documentId: string }
          await permitted(command, element, commandSignal)
          const marker = raw.documentId
          if (typeof marker !== 'string') {
            throw new TypeError('页面文档标记无效')
          }
          const documentId = bindDocument(marker)
          const owned = { ...raw, documentId }
          const value = command.action === 'observe' ? await semantic.observe(owned) : await semantic.resolve(command.reference ?? '', owned)
          await permitted(command, element, commandSignal)
          if (await element.executeJavaScript(documentIdentityScript) !== marker || privateDocumentId !== documentId) {
            throw new Error('观察所属文档已变化，请重新 observe')
          }
          await permitted(command, element, commandSignal)
          await rpc('complete', { token, id: command.id, value }, commandSignal)
          return
        }
        if (command.action === 'screenshot') {
          const screenshotUrl = element.getURL()
          const value = await captureScreenshot(element, () => permitted(command, element, commandSignal), documentIdentityScript)
          await permitted(command, element, commandSignal)
          const marker = value.documentId
          const documentId = bindDocument(marker)
          value.documentId = documentId
          await rpc('complete', { token, id: command.id, epoch: command.epoch, value }, commandSignal)
          await permitted(command, element, commandSignal)
          if (await element.executeJavaScript(documentIdentityScript) !== marker || privateDocumentId !== documentId || element.getURL() !== screenshotUrl) {
            throw new Error('附件保存期间文档变化；旧截图不交付')
          }
          await permitted(command, element, commandSignal)
          await rpc('complete', { token, id: command.id, epoch: command.epoch, value: { kind: 'screenshot-ready' } }, commandSignal)
          return
        }
        let clickDocument: string | undefined
        let downloadAttempts: number | undefined
        await permitted(command, element, commandSignal)
        if (command.action === 'click') {
          const point = await element.executeJavaScript(locateScript) as { x: number, y: number, documentId: string, downloadAttempts?: number }
          clickDocument = point.documentId
          downloadAttempts = point.downloadAttempts
          await permitted(command, element, commandSignal)
          if (await element.executeJavaScript('document.body.dataset.spikeDocument') !== point.documentId) {
            throw new Error('点击前文档变化')
          }
          if (guest() !== element) {
            throw new Error('点击目标实例变化')
          }
          await element.sendInputEvent({ type: 'mouseDown', x: Math.round(point.x), y: Math.round(point.y), button: 'left', clickCount: 1 })
          await permitted(command, element, commandSignal)
          if (await element.executeJavaScript('document.body.dataset.spikeDocument') !== point.documentId) {
            throw new Error('点击中途文档变化')
          }
          if (guest() !== element) {
            throw new Error('点击目标实例变化')
          }
          await element.sendInputEvent({ type: 'mouseUp', x: Math.round(point.x), y: Math.round(point.y), button: 'left', clickCount: 1 })
        }
        await permitted(command, element, commandSignal)
        const value = await element.executeJavaScript(readScript) as { documentId: string, downloadAttempts?: number }
        await permitted(command, element, commandSignal)
        if ((clickDocument !== undefined && value.documentId !== clickDocument) || await element.executeJavaScript('document.body.dataset.spikeDocument') !== value.documentId) {
          throw new Error('读取结果所属文档已变化')
        }
        if (guest() !== element) {
          throw new Error('读取目标实例变化')
        }
        // 此标记只属于自有固定夹具，不能当作任意网页下载检测；不交付“点击成功”等价于文件已生成的结果。
        if (downloadAttempts !== undefined && value.downloadAttempts !== undefined && value.downloadAttempts > downloadAttempts) {
          throw new DownloadUnsupportedError()
        }
        await rpc('complete', { token, id: command.id, epoch: command.epoch, value }, commandSignal)
      }
      catch (error) {
        if (command.action === 'upload-submit') {
          fileSelection = undefined
        }
        semantic.clear()
        if (!commandSignal.aborted && !blocked) {
          state.set(command.action === 'click' || inputIssued ? 'uncertain' : 'idle')
          await rpc('fail', { token, id: command.id, message: String(error), notStarted: isNativeInputAction(command.action) ? !inputIssued : isNavigationAction(command.action) && !navigationIssued }, commandSignal).catch(() => {
            void close('offline').catch(() => {})
          })
        }
      }
      finally {
        commandSignal.removeEventListener('abort', stopPointer)
        watchLifetime.abort()
        if (isNativeInputAction(command.action)) {
          // 此时所有Guest与已排入原生操作都已结算；ACK不使用已取消信号，也不等待Host原工具或pause完成。
          if (commandCancellation.signal.aborted && !pageCommandSignal.aborted) {
            // watch通信失败或审批服务撤销也须结束Host等待；真实Agent取消已撤销时该fail幂等无效。
            await rpc('fail', { token, id: command.id, message: '原生命令撤销监听已停止，结果不再交付', notStarted: !inputIssued }).catch(() => {})
          }
          await rpc('input-drained', { token, command: identity }).catch(() => {
            void close('offline').catch(() => {})
          })
        }
        await watching
        executing = false
        refreshPointer()
      }
    }
    /** 命令在途仍独立续租；accept=false 不消费下一条命令，也不采集网页内容。 */
    async function poll(): Promise<void> {
      if (signal.aborted || !registration) {
        return
      }
      try {
        const reply = await rpc('poll', { token: registration.token, lifecycle: true, accept: !executing && !blocked }, signal)
        if (signal.aborted) {
          return
        }
        const value = reply && typeof reply === 'object' && 'command' in reply ? reply as { command: Command | null, activity: PageActivity } : { command: reply as Command | null, activity: executing ? 'running' : 'idle' } as const
        if (!blocked) {
          state.set(value.activity)
          refreshPointer()
        }
        if (value.command && !executing && !blocked) {
          executing = true
          track(execute(value.command, AbortSignal.any([signal, commandLifetime.signal])))
        }
      }
      catch {
        if (!signal.aborted) {
          void close('offline').catch(() => {})
        }
      }
      finally {
        if (!signal.aborted) {
          timer = setTimeout(() => {
            track(poll())
          }, 250)
        }
      }
    }
    void registering.then(() => {
      if (!signal.aborted) {
        track(poll())
      }
    }).catch(() => {
      void close('offline').catch(() => {})
    })
  }
  return { attach, attachSession: (sessionId, signal) => attach(sessionId, { tabId: '$session-control', scope: 'session', signal }, { getGuest: () => undefined }), takeover: (sessionId, tabId) => controls.get(`${sessionId}\0${tabId}`)?.(true) ?? Promise.reject(new Error('页面尚未登记或已关闭')), resume: (sessionId, tabId) => controls.get(`${sessionId}\0${tabId}`)?.(false) ?? Promise.reject(new Error('页面尚未登记或已关闭')), status: (sessionId, tabId) => status(`${sessionId}\0${tabId}`), dispose: () => {
    if (!disposed) {
      shuttingDown = true
      for (const stop of unsubscribe) {
        stop?.()
      }
      disposed = Promise.all([...lifetimes].map(close => close())).then(() => {})
    }
    return disposed
  } }
}
