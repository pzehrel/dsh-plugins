import type { IncomingMessage, ServerResponse } from 'node:http'
/** 独立原生验收驱动：调用固定工具与显式开启的能力动作，执行有界任务及取消负例，不提供页面实现。 */
import type { Observation } from '../plugins/agent-browser/src/protocol.js'
import type { ScreenshotObservation } from '../plugins/agent-browser/src/screenshot.js'
import { Buffer } from 'node:buffer'
import { randomUUID } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { join } from 'node:path'
import { createUserMessage } from '@deepseek-ai/dsh-llm/message'

type BaseContext = Parameters<typeof import('../plugins/agent-browser/src/index.js').apply>[0]
type ImageAttachmentRef = ScreenshotObservation['attachment']
/** 正式附件服务的只读消费面；根工具不引入另一份宿主依赖。 */
interface ImageReader {
  /** @param ref 本次成功输出的图片引用。@param signal 驱动生命周期。@returns 正式存储已验证的引用和字节；不支持任意路径或附件身份输入。 */
  readImage: (ref: ImageAttachmentRef, signal?: AbortSignal) => Promise<{ ref: ImageAttachmentRef, data: Uint8Array }>
}
interface Context extends Pick<BaseContext, 'agents' | 'effect'> {
  /** 正式工具执行及只读定义查询。 */
  tools: BaseContext['tools'] & { get: (name: string) => { description: string } | undefined }
  /** 可选正式存储作用域，只读本次成功截图输出的图片；不阻塞核心驱动启动。 */
  inject?: (services: string[], callback: (scope: { attachments: ImageReader, effect: (effect: () => unknown) => unknown }) => void) => unknown
}
type CallId = Parameters<Context['tools']['execute']>[0]['callId']
interface Result {
  isError: boolean
  value?: Observation & { pageId: string }
  error?: string
}
/** 一次性驱动的明确目标与本机控制文件。 */
export interface DriverConfiguration {
  /** 只消费这个已存在的真实会话。 */
  sessionId: string
  /** 权限为 0600 的本机控制文件。 */
  controlFile: string
  /** 是否启用有界生命周期验收路由。 */
  lifecycle: boolean
  /** 显式开启 /call 的动作白名单；省略时保持原固定页路由，不接受会话或工具身份参数。 */
  actions?: readonly string[]
  /** prepare 固定创建的私有目录；仅显式开启 screenshot 时导出本次已交付图片，不接受 HTTP 路径参数。 */
  artifactDirectory?: string
  /** 显式专用空白Agent的合法pre-step验收；总是reject，不进入模型step。 */
  approvalProbe?: boolean
}
export const inject = ['tools', 'agents']
/** @param ctx 指定真实 Agent 所在 profile 的工具服务；不发送模型消息，不触碰其他 Agent。 */
export function apply(ctx: Context): void {
  createNativeDriver(ctx, JSON.parse(readFileSync(new URL('./driver-config.json', import.meta.url), 'utf8')) as DriverConfiguration)
}
/** @param ctx 正式工具边界，测试可替换外部宿主。@param configuration 独立验收目标。 */
export function createNativeDriver(ctx: Context, configuration: DriverConfiguration): void {
  const dedicatedAgent = (): ReturnType<Context['agents']['list']>[number] => {
    const agent = ctx.agents.list().find(agent => agent.session.header.id === configuration.sessionId)
    if (!agent || agent.status !== 'idle' || !agent.inbox || agent.inbox.nextTurn.length || agent.inbox.nextStep.length) {
      throw new Error('审批验收只允许配置的空闲且两个inbox均为空的专用Agent')
    }
    return agent
  }
  if (configuration.approvalProbe) {
    dedicatedAgent()
  }
  const lifetime = new AbortController()
  const handlers = new Set<Promise<void>>()
  const imageReads = new Set<Promise<unknown>>()
  let attachments: ImageReader | undefined
  if (configuration.artifactDirectory && configuration.actions?.includes('screenshot')) {
    ctx.inject?.(['attachments'], (scope) => {
      const store = scope.attachments
      attachments = store
      scope.effect(() => async () => {
        if (attachments === store) {
          attachments = undefined
        }
        await Promise.allSettled([...imageReads])
      })
    })
  }
  let disposed: Promise<void> | undefined
  const secret = randomUUID()
  let lastPageId: string | undefined
  let lastCallId: CallId | undefined
  let cancellation: AbortController | undefined
  let work: Promise<void> | undefined
  let approvalWork: Promise<void> | undefined
  let approvalCancellation: AbortController | undefined
  let approvalJob: { id: string, running: boolean, phase: string, turn?: number, step?: number, isError?: boolean, value?: unknown, error?: string } | undefined
  let job: { running: boolean, results: Result[] } | undefined

  /** @param action 固定页动作。@param signal 验收取消。@param pageId 已确认目标，可省略唯一页。@param repeated 可选旧关联，仅用于去重负例。@returns 白名单结果，不包含控制凭据。 */
  async function execute(action: 'read' | 'click', signal: AbortSignal, pageId?: string, repeated?: CallId): Promise<Result> {
    signal = AbortSignal.any([lifetime.signal, signal])
    signal.throwIfAborted()
    const agent = ctx.agents.list().find(agent => agent.session.header.id === configuration.sessionId)
    if (!agent) {
      throw new Error('指定会话没有实时 Agent')
    }
    const callId = repeated ?? `enhanced-native-${randomUUID()}` as CallId
    const result = await ctx.tools.execute({ name: 'agent_browser', arguments: pageId === undefined ? { action } : { action, pageId }, agent, callId, signal })
    signal.throwIfAborted()
    if (!result.isError) {
      lastCallId = callId
    }
    const value = result.value as Observation & { pageId: string } | undefined
    if (typeof value?.pageId === 'string') {
      lastPageId = value.pageId
    }
    return {
      isError: result.isError,
      value: value && { pageId: value.pageId, documentId: value.documentId, count: value.count, text: value.text, lastTrusted: value.lastTrusted },
      error: result.isError ? JSON.stringify(result.content).slice(0, 600) : undefined,
    }
  }
  async function handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    response.setHeader('content-type', 'application/json')
    response.setHeader('cache-control', 'no-store')
    if (request.headers.authorization !== `Bearer ${secret}`) {
      response.writeHead(403).end('{}')
      return
    }
    try {
      if (request.method === 'GET' && request.url === '/status') {
        const definition = ctx.tools.get('agent_browser')
        // 工具说明会随能力扩展，定位精确自有夹具地址，不依赖中文标点位置。
        const fixtureUrl = definition?.description.match(/http:\/\/127\.0\.0\.1:\d+\/spike-[0-9a-f-]{36}/u)?.[0]
        let hostBuild: string | undefined
        if (fixtureUrl) {
          const url = new URL(fixtureUrl)
          if (url.hostname === '127.0.0.1' && url.pathname.startsWith('/spike-')) {
            const health = await fetch(`${url.origin}/_agent_browser_status`, { signal: AbortSignal.any([lifetime.signal, AbortSignal.timeout(1000)]) }).then(reply => reply.json()) as { build?: string }
            hostBuild = health.build
          }
        }
        response.end(JSON.stringify({ toolPresent: !!definition, legacyToolPresent: !!ctx.tools.get('agent_browser_spike'), fixtureUrl, hostBuild }))
        return
      }
      if (configuration.approvalProbe && request.method === 'GET' && request.url === '/approval/job') {
        response.end(JSON.stringify({ driver: '真实Agent合法pre-step内正式ToolRuntime；真实审批UI；不调用模型', ...(approvalJob ?? { running: false }) }))
        return
      }
      if (configuration.approvalProbe && request.method === 'POST' && request.url === '/approval/cancel') {
        approvalCancellation?.abort()
        response.end(JSON.stringify({ cancelled: true }))
        return
      }
      if (configuration.approvalProbe && request.method === 'POST' && request.url === '/approval/start') {
        if (approvalJob?.running) {
          response.writeHead(409).end(JSON.stringify({ error: '已有审批验收在途' }))
          return
        }
        const chunks: Buffer[] = []
        let length = 0
        for await (const chunk of request) {
          length += chunk.length
          if (length > 32768) {
            throw new Error('审批验收参数超过上限')
          }
          chunks.push(Buffer.from(chunk))
        }
        const args = JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>
        const fields = ['action', 'pageId', 'reference', 'text', 'key', 'x', 'y', 'selectionId']
        if (!args || typeof args !== 'object' || Array.isArray(args) || Object.keys(args).some(key => !fields.includes(key)) || !['click-element', 'fill', 'press', 'scroll', 'choose-file', 'upload-submit'].includes(String(args.action)) || !configuration.actions?.includes(String(args.action))) {
          throw new Error('审批验收只接受显式白名单的固定输入数据')
        }
        if (args.action === 'upload-submit' ? typeof args.selectionId !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/u.test(args.selectionId) : args.selectionId !== undefined) {
          throw new Error('文件提交只接受本次opaque选择身份；其他动作不接受选择身份')
        }
        const agent = dedicatedAgent()
        const marker = createUserMessage({ content: [{ type: 'text', text: `Agent浏览器本机审批验收 ${randomUUID()}，由pre-step拦截，不调用模型。` }], source: { kind: 'user' } })
        const current = { id: randomUUID(), running: true, phase: 'waiting-turn' } as NonNullable<typeof approvalJob>
        approvalJob = current
        approvalCancellation = new AbortController()
        const signal = AbortSignal.any([lifetime.signal, approvalCancellation.signal, AbortSignal.timeout(180000)])
        let consumed = false
        // 只在agent.ctx前置注册，避免旧监听先进入模型；未知输入也reject。拦截器直到owned turn彻底idle后才解除。
        const remove = agent.ctx.on('agent/pre-step', async (payload, next) => {
          if (payload.agent.session.header.id !== configuration.sessionId) {
            return next()
          }
          // 同目标会话的代理或替换对象也必须拦住；不能因对象不相等而把验收marker交给模型。
          if (payload.agent !== agent || consumed || payload.step !== 1 || payload.messages.length !== 1 || payload.messages[0]?.id !== marker.id || signal.aborted) {
            current.error = '非本次唯一验收输入，拒绝进入模型step'
            return { kind: 'reject' as const }
          }
          consumed = true
          current.phase = 'executing-tool'
          current.turn = payload.turn
          current.step = payload.step
          try {
            const result = await ctx.tools.execute({ name: 'agent_browser', arguments: args, agent, callId: `enhanced-approval-${randomUUID()}` as CallId, signal: AbortSignal.any([signal, payload.signal]) })
            signal.throwIfAborted()
            current.isError = result.isError
            current.value = result.value
            if (result.isError) {
              current.error = JSON.stringify(result.content).slice(0, 1000)
            }
          }
          catch (error) {
            current.isError = true
            current.error = String(error).slice(0, 1000)
          }
          return { kind: 'reject' as const }
        }, { prepend: true })
        const cancel = (): void => {
          agent.cancel({ kind: 'hook', reason: '本次独立浏览器审批验收取消' }, { keepInbox: true })
        }
        signal.addEventListener('abort', cancel, { once: true })
        approvalWork = (async () => {
          try {
            signal.throwIfAborted()
            agent.followup(marker)
            await agent.whenIdle()
            if (!consumed && !current.error) {
              current.error = '合法turn未消费本次唯一验收输入'
            }
          }
          catch (error) {
            current.isError = true
            current.error = String(error).slice(0, 1000)
          }
          finally {
            // whenIdle失败仍再次等待；不能在残留的唤醒输入存在时先撤销防模型拦截器。
            await agent.whenIdle()
            // 取消可能早于claim；只移除自身marker，不能留下稍后被模型消费的验收输入。
            agent.inbox.remove(marker.id)
            signal.removeEventListener('abort', cancel)
            remove()
            current.phase = 'settled'
            current.running = false
          }
        })()
        response.end(JSON.stringify({ started: true, id: current.id }))
        return
      }
      if (configuration.actions?.length && request.method === 'POST' && request.url === '/call') {
        const chunks: Buffer[] = []
        let length = 0
        for await (const chunk of request) {
          length += chunk.length
          if (length > 32768) {
            response.writeHead(413).end(JSON.stringify({ error: '验收参数超过上限' }))
            return
          }
          chunks.push(Buffer.from(chunk))
        }
        let args: Record<string, unknown>
        try {
          const value: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'))
          const fields = new Set(['action', 'pageId', 'tabId', 'reference', 'url', 'direction', 'kind', 'text', 'key', 'x', 'y', 'durationMs'])
          if (!value || typeof value !== 'object' || Array.isArray(value)
            || Object.keys(value).some(key => !fields.has(key))
            || typeof (value as Record<string, unknown>).action !== 'string'
            || !configuration.actions.includes((value as Record<string, unknown>).action as string)
            || ['choose-file', 'upload-submit'].includes(String((value as Record<string, unknown>).action))) {
            throw new Error('动作或参数不在本次验收白名单中')
          }
          args = value as Record<string, unknown>
        }
        catch {
          response.writeHead(400).end(JSON.stringify({ error: '动作或参数不在本次验收白名单中' }))
          return
        }
        const agent = ctx.agents.list().find(agent => agent.session.header.id === configuration.sessionId)
        if (!agent) {
          throw new Error('指定会话没有实时 Agent')
        }
        // 接口只接受工具数据；工具名称、Agent 和 callId 始终由驱动持有，权限仍由正式 Host 检查。
        const cancelled = new AbortController()
        const abort = (): void => {
          cancelled.abort()
        }
        response.once('close', abort)
        try {
          const signal = AbortSignal.any([lifetime.signal, cancelled.signal, AbortSignal.timeout(20000)])
          const result = await ctx.tools.execute({ name: 'agent_browser', arguments: args, agent, callId: `enhanced-native-${randomUUID()}` as CallId, signal })
          signal.throwIfAborted()
          let artifact: { artifactFile: string, imageRef: ImageAttachmentRef, bytes: number, imageBlock: { type: 'image', attachment: ImageAttachmentRef } } | undefined
          if (args.action === 'screenshot' && !result.isError && configuration.artifactDirectory) {
            const value = result.value as { kind?: string, attachment?: ImageAttachmentRef } | undefined
            const block = result.content.find(block => block.type === 'image' && block.attachment.attachmentId === value?.attachment?.attachmentId)
            if (value?.kind !== 'screenshot' || !value.attachment || block?.type !== 'image' || !attachments) {
              throw new Error('[native-driver/image-export] 缺少正式图片服务或本次成功结果的匹配image块，未导出图片')
            }
            // 只消费刚成功交付的截图引用；请求无法提供附件身份或路径，不是额外的截图/文件读取通路。
            const reading = attachments.readImage(value.attachment, signal)
            imageReads.add(reading)
            try {
              const image = await reading
              signal.throwIfAborted()
              const extension = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif' }[image.ref.mediaType]
              if (image.ref.attachmentId !== value.attachment.attachmentId || !extension || !(image.data instanceof Uint8Array) || !image.data.length || image.data.length !== image.ref.bytes || image.data.length > 4 * 1024 * 1024 || image.ref.width <= 0 || image.ref.height <= 0) {
                throw new Error('[native-driver/image-export] 正式图片内容或关联无效，未导出图片')
              }
              const artifactFile = join(configuration.artifactDirectory, `${randomUUID()}.${extension}`)
              writeFileSync(artifactFile, image.data, { mode: 0o600, flag: 'wx' })
              artifact = { artifactFile, imageRef: image.ref, bytes: image.data.length, imageBlock: { type: 'image', attachment: block.attachment } }
            }
            finally {
              imageReads.delete(reading)
            }
          }
          response.end(JSON.stringify({ driver: '正式 ToolRuntime.execute，真实 Agent；不是模型自主调用', isError: result.isError, value: result.value, ...artifact, error: result.isError ? JSON.stringify(result.content).slice(0, 600) : undefined }))
        }
        finally {
          response.removeListener('close', abort)
        }
        return
      }
      if (configuration.lifecycle && request.method === 'GET' && request.url === '/job') {
        response.end(JSON.stringify(job ?? { running: false, results: [] }))
        return
      }
      if (configuration.lifecycle && request.method === 'POST' && request.url === '/start') {
        if (!lastPageId || job?.running) {
          response.writeHead(409).end(JSON.stringify({ error: '先完成 run，并等待上一项任务结束' }))
          return
        }
        const target = lastPageId
        cancellation = new AbortController()
        const signal = AbortSignal.any([lifetime.signal, cancellation.signal])
        const current = { running: true, results: [] as Result[] }
        job = current
        // 最多八十次自有页读取；整个循环从不导航、切会话或抢焦点。
        work = (async () => {
          for (let index = 0; index < 80 && !signal.aborted; index++) {
            const result = await execute('read', signal, target)
            current.results.push(result)
            if (result.isError) {
              break
            }
          }
        })().catch(() => {
          current.results.push({ isError: true, error: '验收驱动未取得有效工具结果' })
        }).finally(() => {
          current.running = false
        })
        response.end(JSON.stringify({ started: true, pageId: target }))
        return
      }
      if (configuration.lifecycle && request.method === 'POST' && request.url === '/cancel') {
        cancellation?.abort()
        response.end(JSON.stringify({ cancelled: true }))
        return
      }
      if (configuration.lifecycle && request.method === 'POST' && (request.url === '/read' || request.url === '/click')) {
        if (!lastPageId) {
          throw new Error('先完成 run 以确认唯一共享页面')
        }
        // 独立新关联验证交回后的首次动作；不复用旧调用，也不绕过正式工具控制边界。
        response.end(JSON.stringify(await execute(request.url === '/read' ? 'read' : 'click', AbortSignal.timeout(20000), lastPageId)))
        return
      }
      if (configuration.lifecycle && request.method === 'POST' && request.url === '/repeat') {
        if (!lastCallId || !lastPageId) {
          throw new Error('尚无可重复验证的调用')
        }
        response.end(JSON.stringify(await execute('click', AbortSignal.timeout(20000), lastPageId, lastCallId)))
        return
      }
      const action = request.url === '/run' ? 'run' : request.url === '/closed' ? 'closed' : undefined
      if (request.method !== 'POST' || !action) {
        response.writeHead(404).end('{}')
        return
      }
      const results: Result[] = []
      for (const step of action === 'run' ? ['read', 'click', 'read'] as const : ['read'] as const) {
        results.push(await execute(step, AbortSignal.timeout(20000), action === 'closed' ? lastPageId : undefined))
      }
      response.end(JSON.stringify({ driver: '正式 ToolRuntime.execute，真实 Agent；不是模型自主调用', results }))
    }
    catch (error) {
      response.writeHead(500).end(JSON.stringify({ error: String(error).slice(0, 200) }))
    }
  }
  const server = createServer((request, response) => {
    const handling = handle(request, response)
    handlers.add(handling)
    void handling.finally(() => handlers.delete(handling))
  })
  server.listen(0, '127.0.0.1', () => {
    const address = server.address()
    if (!lifetime.signal.aborted && address && typeof address !== 'string') {
      writeFileSync(configuration.controlFile, JSON.stringify({ port: address.port, secret }), { mode: 0o600 })
    }
  })
  ctx.effect(() => () => {
    if (!disposed) {
      lifetime.abort()
      cancellation?.abort()
      approvalCancellation?.abort()
      server.closeAllConnections()
      const closed = new Promise<void>((resolve) => {
        server.close(() => resolve())
      })
      // 普通请求和后台循环都必须结算；已发送的原生操作不能靠断开 HTTP 冒充结束。
      disposed = Promise.allSettled([...handlers, work, approvalWork, closed]).then(() => {})
    }
    return disposed
  })
}
