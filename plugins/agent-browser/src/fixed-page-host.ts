import type { AttachmentStore } from '@deepseek-ai/dsh-attachment'
import type { HostConnectionHandle } from '@deepseek-ai/dsh-client-connection'
import type { ToolRunContext, ToolRuntime } from '@deepseek-ai/dsh-tools'
import type { PageRegistration } from './broker.js'
import type { Command, Observation, TabMetadataGuard } from './protocol.js'
import type { ScreenshotCapture, ScreenshotObservation } from './screenshot.js'
import type { NavigationResult } from './session-navigation.js'
/** 共享页面正式工具与认证路由；增强增加主文档感知与截图，旧实验仅保留固定动作，不依赖旧实验入口。 */
import { randomUUID } from 'node:crypto'
import { createServer } from 'node:http'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { Broker, PageRequestError } from './broker.js'
import { requireFixedPageAction } from './capability-feedback.js'
import { createDownloadFixture } from './download-fixture.js'
import { inputApprovalReason, inputOutputSchema, isNativeInputAction, parseInputTarget, parseNativeInput, projectInputResult } from './native-input.js'
import { createUploadFixture } from './native-upload-fixture.js'
import { fileChoiceOutputSchema, projectFileChoiceResult } from './native-upload.js'
import { consoleDuration, consoleOutputSchema, projectConsoleResult } from './page-console.js'
import { persistScreenshot } from './screenshot-host.js'
import { screenshotDisplayURL as displayURL } from './screenshot.js'
import { projectSemanticResult, resolvedOutputSchema, semanticOutputSchema } from './semantic-contract.js'
import { createSemanticFixture } from './semantic-fixture.js'
import { isNavigationAction } from './session-navigation.js'
/** 构建器注入的内容身份；直接运行源码时使用固定生命周期版本。 */
declare const __AGENT_BROWSER_BUILD__: string | undefined
/** 公开正式审批请求的最小消费面，与固定官方rc.2签名一致。 */
interface PageApprovalRequest {
  /** 真实ToolRunContext中的Agent，不能由Client传入。 */
  agent: NonNullable<ToolRunContext['agent']>
  /** 当前固定工具名称，用于正式审计与展示。 */
  toolName: string
  /** 本次真实工具调用关联，不复用旧批准。 */
  callId?: ToolRunContext['callId']
  /** 可独立阅读的当前页面、目标、动作和确切内容。 */
  reason: string
  /** 统一请求生命周期，取消、接管或关闭立即撤销问题。 */
  signal: AbortSignal
}
/** 官方approval服务的只读消费面；不注册answerer或伪造批准。 */
interface PageApprovalService {
  /** @param request 当前合法turn内的正式请求。@returns 只允许allowed-once继续，其余结果失败关闭；无open turn可抛出官方错误。 */
  request: (request: PageApprovalRequest) => Promise<'allowed-once' | 'rejected' | 'cancelled' | 'unavailable'>
}
/** 原生命令撤销后的无内容清理身份；页面退休后仍接受对应watch和drain ACK。 */
interface InputLifetime {
  /** 原认证Client凭据，不向网页或工具结果公开。 */
  token: string
  /** 原页面身份；未确认结算时阻止同页新写入。 */
  pageId: string
  /** 仅请求身份、暂停代次及动作，不保留输入内容。 */
  command: Pick<Command, 'id' | 'epoch' | 'action'>
  /** 真实Agent请求、Broker与审批服务撤销的合成信号。 */
  signal: AbortSignal
  /** 只有认证Client确认全部原生/Guest操作结算才完成。 */
  drained: Promise<void>
  /** 幂等记录实际drain，超时不得调用。 */
  acknowledge: () => void
}
/** 启动自测持有的官方本进程 Peer；只消费释放能力，原对象完整传回 Connection。 */
interface StartupPeer {
  /** 等待官方 Peer 作用域清理，成功和失败都必须调用。 */
  dispose: () => Promise<void>
}
/** 官方公开服务的最小消费面；只描述本实验实际调用的成员。 */
export interface FixedPageHostContext {
  /** 正式工具注册与执行流水线。 */
  tools: Pick<ToolRuntime, 'register'>
  /** 可选的正式图片持久化服务；缺少只拒绝截图，不影响固定读写。 */
  attachments?: Pick<AttachmentStore, 'saveImage'>
  /** @param services 按服务名数组请求attachments或approval。@param callback 服务可用时绑定子作用域；其撤销停止之后的新保存。@returns 宿主维护的子fiber，核心工具不等待可选服务。 */
  inject?: (services: string[], callback: (scope: {
    /** 子作用域显式请求的图片存储服务。 */
    attachments?: Pick<AttachmentStore, 'saveImage'>
    /** 子作用域按服务名显式请求的正式审批服务。 */
    approval?: PageApprovalService
    /** 将服务句柄撤销绑定至该子作用域。 */
    effect: (effect: () => unknown) => unknown
  }) => void) => unknown
  /** 官方rc.2正式审批服务；缺少或非allowed-once均拒绝，不能由网页授权。 */
  approval?: PageApprovalService
  /** 正式认证共享通道的精确路由；不争抢官方 API Gateway 的唯一 interceptor。 */
  connection: Pick<HostConnectionHandle, 'fetch'> & {
    /** @param channel 固定的正式 API 通道。@returns 官方共享路由句柄；新版要求 Peer，旧版保留单参数调用。 */
    createSharedFetchHandler: (channel: '/api') => {
      /** @param request 本插件构造的本地注册自测请求。@param peer 新版宿主创建的原始 Peer。@returns 正式路由响应。 */
      fetch: (request: Request, peer?: StartupPeer) => Promise<Response>
    }
    /**
     * @param options 固定本进程自测配置，不接收网页或工具输入。
     * @param options.principal 插件自身的受信主体声明。
     * @param options.principal.kind 固定官方 owner 主体，不借用外部身份。
     * @param options.interactions 禁止自测发起用户交互。
     * @returns 新版官方 Peer，调用方须等待释放。
     */
    createPeer?: (options: {
      /** 插件自身受信自测的主体，不代表外部请求认证。 */
      principal: {
        /** 官方公开本进程 owner 主体；不借用 Agent 或网页身份。 */
        kind: 'owner'
      }
      /** 自测不发起任何用户交互。 */
      interactions: 'none'
    }) => StartupPeer
  }
  /** 将服务及资源清理绑定至插件生命周期。 */
  effect: (effect: () => unknown) => unknown
}
/** @param ctx 正式 Host 服务。@param namespace 两个现有装配的固定身份。@param diagnose 仅旧实验提供的诊断回调，增强入口不传入。 */
export async function applyFixedPageHost(ctx: FixedPageHostContext, namespace: 'agent-browser-spike' | 'agent-browser', diagnose?: (page: PageRegistration, signal: AbortSignal) => Promise<unknown>): Promise<void> {
  const mode = namespace === 'agent-browser-spike' ? 'experiment' : 'enhanced'
  const prefix = `${namespace}/`
  const toolName = mode === 'experiment' ? 'agent_browser_spike' : 'agent_browser'
  const broker = new Broker()
  // RPC取消不会撤回已发出的saveImage；Host ACK也等待它结算，避免Client先中止通信后误报已接管。
  const approvalRequests = new Map<string, Set<Promise<unknown>>>()
  const imageWrites = new Map<string, Set<Promise<unknown>>>()
  const inputLifetimes = new Map<string, InputLifetime>()
  // 与单次RPC三秒预算对齐；超时只报告未确认，不能删除清理身份或解除同页写屏障。
  const waitInputDrain = async (entry: InputLifetime): Promise<void> => {
    let timeout: ReturnType<typeof setTimeout> | undefined
    try {
      await Promise.race([entry.drained, new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => reject(new PageRequestError('unknown', 'unknown', 'cleanup-unconfirmed：未取得Client原生操作结算确认；页面保持停用，禁止重试')), 3000)
      })])
    }
    finally {
      clearTimeout(timeout)
    }
  }
  const preparingImages = new Set<string>()
  // 只暂存保存后的引用，待Client复核文档；原始像素不作为接管期缓存，调用结束即撤销暂存。
  const stagedImages = new Map<string, { pageId: string, token: string, observation: ScreenshotObservation }>()
  const drain = async (token?: string): Promise<void> => {
    await Promise.allSettled(token ? [...imageWrites.get(token) ?? [], ...approvalRequests.get(token) ?? []] : [...imageWrites.values(), ...approvalRequests.values()].flatMap(writes => [...writes]))
    // ACK端点不等待本函数；先保留路由，才能在页面已退休或卸载中接收迟到清理确认。
    await Promise.all([...inputLifetimes.values()].filter(entry => !token || entry.token === token).map(waitInputDrain))
  }

  // Cordis对象式inject是服务名到配置的映射，不支持required/optional；子fiber等待可选服务，核心工具照常启动。
  let attachments = ctx.inject ? undefined : ctx.attachments
  ctx.inject?.(['attachments'], (scope) => {
    const store = scope.attachments
    if (!store) {
      return
    }
    attachments = store
    scope.effect(() => async () => {
      if (attachments === store) {
        attachments = undefined
      }
      // 服务解除先阻止后续保存，再等待已经发出的写入；解除依赖不代表原生存储已经取消。
      await drain()
    })
  })

  // 审批服务作为可选子作用域；缺少时保留观察等能力，所有输入失败关闭。
  let approval = ctx.inject ? undefined : ctx.approval
  let approvalLifetime = new AbortController()
  const approvals = new Map<string, { exec: ToolRunContext, input: ReturnType<typeof parseNativeInput>, approvedCommand?: string, asking?: boolean }>()
  ctx.inject?.(['approval'], (scope) => {
    const service = scope.approval
    if (!service) {
      return
    }
    approval = service
    const serviceLifetime = new AbortController()
    approvalLifetime = serviceLifetime
    scope.effect(() => async () => {
      serviceLifetime.abort()
      if (approval === service) {
        approval = undefined
      }
      await drain()
    })
  })
  const fixturePath = `/spike-${randomUUID()}`
  const downloadFixture = createDownloadFixture(fixturePath)
  const semanticFixture = createSemanticFixture(fixturePath)
  const uploadFixture = createUploadFixture(fixturePath)
  // 只公布实验构建及注册探针结果，不包含真实会话、页面凭据或账号数据。
  const healthPath = mode === 'experiment' ? '/_agent_browser_spike_status' : '/_agent_browser_status'
  const build = typeof __AGENT_BROWSER_BUILD__ === 'string' ? __AGENT_BROWSER_BUILD__ : 'source-enhanced-takeover-v4'
  const health = { build: mode === 'experiment' ? 'fetch-routes-v2' : build, ready: false, registerStatus: 0, error: '' }
  const server = createServer((request, response) => {
    if (downloadFixture.handle(request, response) || semanticFixture(request, response) || uploadFixture(request, response)) {
      return
    }
    if (request.method === 'GET' && request.url === healthPath) {
      response.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
      response.end(JSON.stringify(health))
      return
    }
    if (request.method !== 'GET' || request.url !== fixturePath) {
      response.writeHead(404).end()
      return
    }
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
    response.end(`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>DSH 原生共享页面实验</title>
<style>body{font:16px system-ui;padding:24px;background:#fafafa;color:#222}button,input{font:inherit;margin:12px 0;padding:10px}input{display:block;width:90%}</style>
<h1>原生共享页面实验</h1><p>只在本机运行，不访问真实账号。</p><p>计数：<strong id="count">0</strong></p>
<button id="bump">增加计数</button><label>人工修改内容<input id="human-input" value="初始内容"></label>
<label>敏感字段过滤测试<input id="password" type="password" value="仅用于过滤验证"></label>
<p id="identity"></p><script>document.body.dataset.spikeDocument=crypto.randomUUID();document.querySelector('#identity').textContent='文档实例：'+document.body.dataset.spikeDocument;
window.spikeLastTrusted=false;document.querySelector('#bump').addEventListener('click',event=>{document.querySelector('#count').textContent=String(Number(document.querySelector('#count').textContent)+1);window.spikeLastTrusted=event.isTrusted})</script>${downloadFixture.html}<p><a href="${fixturePath}/upload">自有原生上传验收</a></p></html>`)
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  if (!address || typeof address === 'string') {
    throw new Error('测试站未取得本机端口')
  }
  const fixtureUrl = `http://127.0.0.1:${address.port}${fixturePath}`
  // 在工具/schema 注册前拥有测试站资源：后续启动失败也由插件 fiber 撤销监听。
  ctx.effect(() => async () => {
    await new Promise<void>((resolve) => {
      server.closeAllConnections()
      server.close(() => resolve())
    })
  })
  ctx.effect(() => {
    const disposeTool = ctx.tools.register(defineTool({
      name: toolName,
      description: mode === 'experiment' ? `仅在本插件可控测试页 ${fixtureUrl} 读取或点击计数按钮；不接受任意网页、URL、脚本或会话身份。` : `在本会话的官方内置浏览器中操作用户可见的同一网页。先 list-tabs 查看标签，或 create-tab 打开 HTTP(S) 网址；observe 读取当前真实主文档并取得元素 reference，resolve 可只读重核引用。click-element/fill/press/scroll 使用最近观察的 reference 进行原生点击、填写、按键和滚动，全部逐次正式审批，仅允许已核验的1倍页面缩放，点击或按键导致正常跳转仍返回 issued（只确认事件已发送），随后重新 observe 取得新文档和引用即可继续，不能复用旧引用或重复发送。加载中 observe 可重新读取，未就绪不等于写动作失败。select-tab/close-tab 管理本会话既有标签，navigate/back/forward/reload 复用官方同页导航，最多等待一秒返回实际状态；loading=true表示仍在加载，应observe确认而非重发导航；后台 select 尚不可用，继续阻塞首版。screenshot 按需捕获同一页面；console 只采当前文档本次有界窗口消息，无历史，已知敏感模式省略但不能保证识别任意秘密。截图含全部可见像素，不能保证画面无秘密，敏感页面请人工接管。过滤敏感表单字段，不接受脚本、选择器或会话身份；跨域 frame 尚未支持。网页下载不支持，不会返回文件；choose-file 逐次批准后打开标准单文件原生选择器，等待可信取消或未改变/选择结算，不代表上传；selected 会将该次≤16MiB内容通过公开File/DataTransfer设为同一input的不可变副本，无合成change；upload-submit 只按该选择身份逐次批准标准同页POST multipart表单并发送原生提交事件，不承诺网站接收成功，站点自身处理差异及完整首版仍待验收。read/click 仅用于内部自测页 ${fixtureUrl}，普通网页使用上述观察和原生输入动作。`,
      parameters: {
        pageId: { type: 'string', description: 'Host 铸造的自有页面身份；省略时仅允许本会话恰有一个已登记页面。' },
        action: { type: 'string', required: true, description: mode === 'experiment' ? '仅 read 或 click 固定夹具动作。' : '动作：list-tabs/create-tab/select-tab/close-tab/navigate/back/forward/reload/observe/resolve/click-element/fill/press/scroll/screenshot/console/choose-file/upload-submit/read/click。普通网页先 create-tab 或 list-tabs，再 observe；输入使用最近 reference 并逐次审批，完成后重新 observe。read/click 仅供内部自测。' },
        url: { type: 'string', description: '仅创建标签或导航使用的无凭据 HTTP(S) 地址。' },
        tabId: { type: 'string', description: '本会话标签身份，仅供选择或关闭。' },
        selectionId: { type: 'string', description: '仅upload-submit：本页choose-file的获准选择身份，不接受路径、脚本或其他会话引用。' },
        reference: { type: 'string', description: 'resolve与原生输入必填；必须来自此页最近成功 observe，不接受 CSS 或代码。' },
        key: { type: 'string', description: '仅press，固定键名白名单；目标必须已经聚焦，不自动点击按钮。' },
        x: { type: 'number', description: '仅scroll，水平相对增量，CSS像素整数-1000到1000，非屏幕坐标。' },
        y: { type: 'number', description: '仅scroll，垂直相对增量，CSS像素整数-1000到1000，x/y不得同时为0。' },
        text: { type: 'string', description: '仅fill：明确替换内容，最多2000字符；逐次正式审批，拒绝敏感或文件字段。' },
        durationMs: { type: 'number', description: '仅 console：50–2000 毫秒整数，省略默认 500；只采本次窗口，没有历史回放。' },
      },
      output: {
        // defineTool 消费作者侧 DSL；必填标记属于每个属性，不能直接传入原始 JSON Schema 的 required 数组。
        schema: { oneOf: [{ type: 'object', additionalProperties: false, properties: {
          pageId: { type: 'string', description: 'Host铸造的本会话自有页面身份；尚未挂载的标签可省略，不能代替归属检查。', required: true },
          documentId: { type: 'string', description: '当前结果绑定的文档身份；截图使用Client私有身份，固定read/click保留自有夹具标记。', required: true },
          count: { type: 'number', description: '固定自有测试页的当前计数，不是通用网页观察结果。', required: true },
          text: { type: 'string', description: '固定自有测试页普通输入的当前值，最多200字符。', required: true },
          lastTrusted: { type: 'boolean', description: '可选，最近固定按钮事件是否为可信原生输入。' },
        } }, semanticOutputSchema, resolvedOutputSchema, consoleOutputSchema, inputOutputSchema, fileChoiceOutputSchema, { type: 'object', additionalProperties: false, properties: {
          pageId: { type: 'string', description: 'Host铸造的本会话自有页面身份；尚未挂载的标签可省略，不能代替归属检查。' },
          kind: { type: 'string', description: '固定输出类型判别，导航、标签或截图分支，不是网页授权。', enum: ['navigation'], required: true },
          url: { type: 'string', description: '实际已观察地址的净化展示值，去除用户信息、查询及片段；尚未观察到实际地址时省略，不使用请求地址补全。' },
          loading: { type: 'boolean', description: '同一官方controller观察到的原生加载状态。', required: true },
          canGoBack: { type: 'boolean', description: '同一原生页面是否具有后退历史，不表示已后退。', required: true },
          canGoForward: { type: 'boolean', description: '同一原生页面是否具有前进历史，不表示已前进。', required: true },
        } }, { type: 'object', additionalProperties: false, properties: {
          kind: { type: 'string', description: '固定输出类型判别，导航、标签或截图分支，不是网页授权。', enum: ['tabs'], required: true },
          tabs: { type: 'array', description: '本框架会话的浏览器标签摘要，最多1000项；超限拒绝。', required: true, items: { type: 'object', additionalProperties: false, properties: {
            tabId: { type: 'string', description: '正式框架布局标签身份；不能替换工具执行Agent会话归属。', required: true },
            pageId: { type: 'string', description: 'Host铸造的本会话自有页面身份；尚未挂载的标签可省略，不能代替归属检查。' },
            url: { type: 'string', description: '实际已观察地址的净化展示值，去除用户信息、查询及片段；未挂载或元数据失效时省略。' },
            title: { type: 'string', description: '可选框架标题，仅在目标页未接管且元数据代次有效时交付；其他情况省略。' },
            selected: { type: 'boolean', description: '仅当前屏幕会话可确认的布局选中状态；后台省略。' },
            paused: { type: 'boolean', description: '可选，true表示目标页正在交接或已暂停；省略不代表已获操作许可。' },
          } } },
        } }, { type: 'object', additionalProperties: false, properties: {
          pageId: { type: 'string', description: 'Host铸造的本会话自有页面身份；尚未挂载的标签可省略，不能代替归属检查。', required: true },
          documentId: { type: 'string', description: '当前结果绑定的文档身份；截图使用Client私有身份，固定read/click保留自有夹具标记。', required: true },
          kind: { type: 'string', description: '固定输出类型判别，导航、标签或截图分支，不是网页授权。', enum: ['screenshot'], required: true },
          url: { type: 'string', description: '实际已观察地址的净化展示值，去除用户信息、查询及片段；未挂载或元数据失效时省略。', required: true },
          exposureWarning: { type: 'string', description: '截图包含全部可见像素的风险与不可撤回说明；不声称DOM过滤已脱敏图片。', required: true },
          attachment: { type: 'object', description: '公开saveImage产生的正式图片引用，不含原始base64或本地文件路径。', required: true, additionalProperties: false, properties: {
            attachmentId: { type: 'string', description: '正式存储中的图片身份，不能用作任意文件路径或读取请求。', required: true },
            mediaType: { type: 'string', description: '存储验证后的真实图片媒体类型，可能已由宿主归一化。', required: true },
            bytes: { type: 'number', description: '正式图片编码字节数，不是像素数。', required: true },
            width: { type: 'number', description: '正式图片宽度，单位像素；originalDimensions内为缩小前宽度。', required: true },
            height: { type: 'number', description: '正式图片高度，单位像素；originalDimensions内为缩小前高度。', required: true },
            name: { type: 'string', description: '可选图片显示名称，不是可读取的本地路径。' },
            originalDimensions: { type: 'object', description: '可选，宿主缩小图片前的像素宽高。', additionalProperties: false, properties: { width: { type: 'number', description: '正式图片宽度，单位像素；originalDimensions内为缩小前宽度。', required: true }, height: { type: 'number', description: '正式图片高度，单位像素；originalDimensions内为缩小前高度。', required: true } } },
          } },
        } }] },
        render: (_args, value) => {
          const screenshot = value as unknown as ScreenshotObservation
          return screenshot.kind === 'screenshot' ? [{ type: 'text', text: JSON.stringify(value) }, { type: 'image', attachment: screenshot.attachment }] : [{ type: 'text', text: JSON.stringify(value) }]
        },
      },
      async execute(args, exec) {
        const owner = exec.agent?.session.header.id
        if (!owner) {
          throw new Error('需要真实调用 Agent 的会话身份')
        }
        if (mode === 'experiment' && args.action !== 'read' && args.action !== 'click') {
          throw new Error('旧实验只允许 read 或 click')
        }
        if (!isNavigationAction(args.action) && args.action !== 'observe' && args.action !== 'resolve' && args.action !== 'screenshot' && args.action !== 'console' && !isNativeInputAction(args.action)) {
          requireFixedPageAction(args.action)
        }
        if (args.action === 'resolve' && (typeof args.reference !== 'string' || !args.reference || args.reference.length > 250)) {
          throw new Error('resolve 需要本页最近 observe 的 reference')
        }
        const input = isNativeInputAction(args.action) ? parseNativeInput(args) : undefined
        const durationMs = args.action === 'console' ? consoleDuration(args.durationMs) : undefined
        const sessionAction = ['list-tabs', 'create-tab', 'select-tab', 'close-tab'].includes(args.action)
        const pageId = sessionAction ? broker.sessionTarget(owner) : broker.target(owner, args.pageId)
        if (input) {
          if (approvals.has(pageId) || [...inputLifetimes.values()].some(entry => entry.pageId === pageId)) {
            throw new Error('该页已有审批或原生输入在途；不并发写入')
          }
          approvals.set(pageId, { exec, input })
        }
        try {
          const observation = await broker.request(owner, pageId, args.action, exec.signal, exec.callId, { reference: args.reference, input, durationMs, navigation: { url: args.url, tabId: args.tabId } })
          if (sessionAction) {
            if (!('kind' in observation) || observation.kind !== 'tabs') {
              throw new Error('会话控制结果类型无效')
            }
            return observation
          }
          return { pageId, ...observation }
        }
        finally {
          if (input) {
            try {
              await Promise.all([...inputLifetimes.values()].filter(entry => entry.pageId === pageId).map(waitInputDrain))
            }
            finally {
              approvals.delete(pageId)
            }
          }
          for (const [id, staged] of stagedImages) {
            if (staged.pageId === pageId) {
              stagedImages.delete(id)
            }
          }
        }
      },
    }))
    const handle = async (endpoint: string, payload: unknown, signal: AbortSignal): Promise<unknown> => {
      try {
        if (!payload || typeof payload !== 'object') {
          throw new Error('请求必须是对象')
        }
        const row = payload as Record<string, unknown>
        let value: unknown
        const method = endpoint.slice(prefix.length)
        if (method === 'register') {
          if (typeof row.sessionId !== 'string' || row.sessionId.length > 200) {
            throw new Error('缺少框架会话绑定')
          }
          value = { ...broker.register(row.sessionId, row.scope === 'session' ? 'session' : undefined), epoch: 0, fixtureUrl, protocolVersion: 6, build }
        }
        else {
          if (typeof row.token !== 'string') {
            throw new TypeError('缺少 Client 凭据')
          }
          if (method === 'poll') {
            const command = broker.poll(row.token, row.accept !== false)
            value = row.lifecycle === true ? { command, activity: broker.activity(row.token) } : command
          }
          else if (method === 'permit') {
            value = broker.allowed(row.token, row.command as Command)
          }
          else if (method === 'input-watch' || method === 'input-drained') {
            const command = row.command as Command | undefined
            const entry = command && inputLifetimes.get(command.id)
            if (!entry) {
              value = false
            }
            else if (entry.token !== row.token || entry.command.epoch !== command?.epoch || entry.command.action !== command.action) {
              throw new Error('原生命令清理身份不匹配')
            }
            else if (method === 'input-drained') {
              entry.acknowledge()
              inputLifetimes.delete(entry.command.id)
              value = true
            }
            else {
              // 只等待无内容撤销；正常一秒到期不是drain，通信失败由Client停止本命令。
              if (row.initial !== true) {
                await new Promise<void>((resolve) => {
                  let timer: ReturnType<typeof setTimeout>
                  const finish = (): void => {
                    clearTimeout(timer)
                    entry.signal.removeEventListener('abort', finish)
                    signal.removeEventListener('abort', finish)
                    resolve()
                  }
                  timer = setTimeout(finish, 1000)
                  entry.signal.addEventListener('abort', finish, { once: true })
                  signal.addEventListener('abort', finish, { once: true })
                  if (entry.signal.aborted || signal.aborted) {
                    finish()
                  }
                })
              }
              value = !entry.signal.aborted && !signal.aborted
            }
          }
          else if (method === 'approve') {
            const command = row.command as Command
            const owner = broker.owner(row.token)
            const pending = approvals.get(owner.pageId)
            if (!pending || pending.asking || pending.approvedCommand || !command || !isNativeInputAction(command.action) || !broker.allowed(row.token, command) || !approval || !pending.exec.agent) {
              throw new Error('[agent-browser/approval-unavailable] 正式审批不可用或请求已失效，未执行输入')
            }
            const binding = parseInputTarget(row.binding)
            if (binding.reference !== pending.input.reference) {
              throw new Error('审批目标与Host参数不一致')
            }
            const approvalSignal = AbortSignal.any([pending.exec.signal, broker.requestSignal(row.token, command), approvalLifetime.signal, signal])
            let acknowledge: () => void = () => {}
            const drained = new Promise<void>((resolve) => {
              acknowledge = resolve
            })
            inputLifetimes.set(command.id, { token: row.token, pageId: owner.pageId, command: { id: command.id, epoch: command.epoch, action: command.action }, signal: AbortSignal.any([pending.exec.signal, broker.requestSignal(row.token, command), approvalLifetime.signal]), drained, acknowledge })
            pending.asking = true
            const service = approval
            const waiting = service.request({ agent: pending.exec.agent, toolName, callId: pending.exec.callId, reason: inputApprovalReason(owner.pageId, command.action, pending.input, binding), signal: approvalSignal })
            const waits = approvalRequests.get(row.token) ?? new Set<Promise<unknown>>()
            waits.add(waiting)
            approvalRequests.set(row.token, waits)
            let outcome: Awaited<ReturnType<PageApprovalService['request']>>
            try {
              outcome = await waiting
            }
            finally {
              waits.delete(waiting)
              if (!waits.size) {
                approvalRequests.delete(row.token)
              }
            }
            approvalSignal.throwIfAborted()
            if (service !== approval || outcome !== 'allowed-once' || !broker.allowed(row.token, command)) {
              throw new Error(`[agent-browser/approval-${outcome}] 审批未允许本次动作；未执行输入`)
            }
            pending.approvedCommand = command.id
            value = { allowed: true }
          }
          else if (method === 'input-started') {
            const command = row.command as Command
            if (approvals.get(broker.owner(row.token).pageId)?.approvedCommand !== command?.id) {
              throw new Error('缺少本次正式逐次批准，未执行输入')
            }
            broker.inputStarted(row.token, command)
            value = true
          }
          else if (method === 'pause') {
            if (typeof row.paused !== 'boolean') {
              throw new TypeError('暂停必须为布尔值')
            }
            const epoch = broker.pause(row.token, row.paused)
            await drain(row.token)
            value = { epoch }
          }
          else if (method === 'close') {
            broker.close(row.token, row.reason === 'disconnected' ? 'disconnected' : 'closed')
            await drain(row.token)
            value = true
          }
          else if (method === 'complete') {
            const capture = row.value as ScreenshotCapture | { kind: 'screenshot-ready' }
            if (capture?.kind === 'screenshot') {
              if (typeof row.id !== 'string' || preparingImages.has(row.id) || stagedImages.has(row.id)) {
                throw new Error('重复或无效的截图保存请求已拒绝，不重放捕获和写入')
              }
              preparingImages.add(row.id)
              const permit = (): void => {
                if (!broker.allowed(row.token as string, { id: String(row.id), action: 'screenshot', epoch: Number(row.epoch) })) {
                  throw new Error('截图请求已失效或人工接管；旧图片不交付')
                }
              }
              const writing = persistScreenshot(attachments, capture, permit)
              const writes = imageWrites.get(row.token) ?? new Set<Promise<unknown>>()
              writes.add(writing)
              imageWrites.set(row.token, writes)
              try {
                const observation = await writing
                permit()
                stagedImages.set(String(row.id), { pageId: broker.owner(row.token).pageId, token: row.token, observation })
                // 保存完成只返回元数据；Client再次核对同一文档后才允许最终交付。
                value = { documentId: observation.documentId }
              }
              finally {
                preparingImages.delete(row.id)
                writes.delete(writing)
                if (!writes.size) {
                  imageWrites.delete(row.token)
                }
              }
              return { ok: true, value }
            }
            if (capture?.kind === 'screenshot-ready') {
              const staged = stagedImages.get(String(row.id))
              if (!staged || staged.token !== row.token || !broker.allowed(row.token, { id: String(row.id), action: 'screenshot', epoch: Number(row.epoch) })) {
                throw new Error('截图结果已失效，不补发旧附件')
              }
              stagedImages.delete(String(row.id))
              broker.complete(row.token, String(row.id), staged.observation)
              return { ok: true, value: true }
            }
            const semantic = projectFileChoiceResult(row.value) ?? projectInputResult(row.value) ?? projectConsoleResult(row.value, [row.token]) ?? projectSemanticResult(row.value)
            if (semantic) {
              if (typeof row.id !== 'string') {
                throw new TypeError('缺少结果关联')
              }
              broker.complete(row.token, row.id, semantic)
              return { ok: true, value: true }
            }
            if (isNavigationResult(row.value)) {
              if (typeof row.id !== 'string') {
                throw new TypeError('导航结果缺少请求关联')
              }
              // 首次导航可能尚无观察地址，保持省略而非伪造请求地址；已有地址仍净化，接管页只交付无内容身份。
              const navigation: NavigationResult = row.value.kind === 'navigation'
                ? { kind: 'navigation', ...(row.value.url === undefined ? {} : { url: displayURL(row.value.url) }), loading: row.value.loading, canGoBack: row.value.canGoBack, canGoForward: row.value.canGoForward }
                : { kind: 'tabs', tabs: row.value.tabs.map(({ url, title, paused, ...tab }) => paused
                    ? { ...tab, paused: true }
                    : { ...tab, ...(url === undefined ? {} : { url: displayURL(url) }), ...(title === undefined ? {} : { title }) }) }
              const metadata = Array.isArray(row.metadata) ? row.metadata.filter((guard): guard is TabMetadataGuard => guard && typeof guard === 'object' && typeof guard.tabId === 'string' && typeof guard.pageId === 'string' && Number.isInteger(guard.epoch) && guard.epoch >= 0) : []
              broker.complete(row.token, row.id, navigation, metadata)
              return { ok: true, value: true }
            }
            const result = row.value as Observation
            if (typeof row.id !== 'string' || !result || typeof result.documentId !== 'string' || typeof result.count !== 'number' || typeof result.text !== 'string' || result.text.length > 200) {
              throw new Error('测试页结果无效')
            }
            // 白名单投影，避免 Client 附带其他网页字段或敏感输入。
            const observation: Observation = { documentId: result.documentId, count: result.count, text: result.text }
            if (typeof result.lastTrusted === 'boolean') {
              observation.lastTrusted = result.lastTrusted
            }
            broker.complete(row.token, row.id, observation)
            value = true
          }
          else if (method === 'fail') {
            broker.fail(row.token, String(row.id), String(row.message), row.notStarted === true)
            value = true
          }
          else if (method === 'self-test' && diagnose) {
            value = await diagnose(broker.owner(row.token), signal)
          }
          else {
            throw new Error('未知实验 endpoint')
          }
        }
        return { ok: true, value }
      }
      catch (error) {
        return { ok: false, error: { code: 'spike/unavailable', message: error instanceof Error ? error.message : String(error), details: {} } }
      }
    }
    const methods = ['register', 'poll', 'permit', 'approve', 'input-watch', 'input-drained', 'input-started', 'pause', 'close', 'complete', 'fail', ...(diagnose ? ['self-test'] : [])]
    // /api 只有一个 RPC interceptor，已经由官方 Gateway 占用；精确 Fetch 路由会在它之前分派。
    const disposers = methods.map(method => ctx.connection.fetch.register({
      path: `/api/${prefix}${method}`,
      methods: ['POST'],
      requestBody: 'buffered',
      async fetch(request) {
        if (request.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase() !== 'application/json') {
          return new Response('content type must be application/json', { status: 415 })
        }
        let envelope: unknown
        try {
          envelope = await request.json()
        }
        catch {
          return new Response('invalid RPC JSON', { status: 400 })
        }
        if (!envelope || typeof envelope !== 'object') {
          return new Response('invalid RPC envelope', { status: 400 })
        }
        const row = envelope as Record<string, unknown>
        if (row.type !== 'client-request' || typeof row.rpcId !== 'string' || row.rpcId.length > 200 || row.method !== `${prefix}${method}`) {
          return new Response('RPC endpoint or envelope mismatch', { status: 400 })
        }
        const result = await handle(`${prefix}${method}`, row.payload, request.signal)
        return Response.json({ type: 'server-response', rpcId: row.rpcId, result })
      },
    }))
    return async () => {
      disposeTool()
      broker.dispose()
      await drain()
      stagedImages.clear()
      for (const dispose of disposers.reverse()) {
        await dispose()
      }
    }
  })
  // 在真实宿主的既有 Gateway 组合上验证同一注册请求；它不创建原生 guest，也不冒充同页验收。
  const fetchHandler = ctx.connection.createSharedFetchHandler('/api')
  const rpcId = randomUUID()
  const request = new Request(`${fixtureUrl.replace(fixturePath, '')}/api/${prefix}register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'client-request', rpcId, method: `${prefix}register`, payload: { sessionId: 'spike-startup-probe' } }),
  })
  // 新版正式 Fetch 的路由权限检查依赖 Peer；通过官方工厂创建，禁止拼装身份对象充当 Peer。
  const peer = ctx.connection.createPeer?.({ principal: { kind: 'owner' }, interactions: 'none' })
  try {
    const response = await (peer ? fetchHandler.fetch(request, peer) : fetchHandler.fetch(request))
    health.registerStatus = response.status
    const envelope = await response.json() as { rpcId?: string, result?: { ok?: boolean, value?: { pageId?: string, token?: string } } }
    const token = envelope.result?.value?.token
    if (response.status !== 200 || envelope.rpcId !== rpcId || !envelope.result?.ok || typeof envelope.result.value?.pageId !== 'string' || typeof token !== 'string') {
      health.error = '真实 Host 注册探针未通过'
      throw new Error(health.error)
    }
    broker.close(token)
  }
  finally {
    await peer?.dispose()
  }
  health.ready = true
}

/** @param value Client 的无内容导航回复。@returns 仅接受完整的有限状态；导航地址尚未观察到时可省略，其他字段仍严格校验，不交付任意网页对象。 */
function isNavigationResult(value: unknown): value is NavigationResult {
  if (!value || typeof value !== 'object') {
    return false
  }
  const row = value as Record<string, unknown>
  if (row.kind === 'navigation') {
    return Object.keys(row).every(key => ['kind', 'url', 'loading', 'canGoBack', 'canGoForward'].includes(key)) && (row.url === undefined || (typeof row.url === 'string' && row.url.length <= 16384)) && typeof row.loading === 'boolean' && typeof row.canGoBack === 'boolean' && typeof row.canGoForward === 'boolean'
  }
  return row.kind === 'tabs' && Object.keys(row).every(key => ['kind', 'tabs'].includes(key)) && Array.isArray(row.tabs) && row.tabs.length <= 1000 && row.tabs.every((tab: unknown) => {
    if (!tab || typeof tab !== 'object') {
      return false
    }
    const item = tab as Record<string, unknown>
    return Object.keys(item).every(key => ['tabId', 'pageId', 'url', 'title', 'selected', 'paused'].includes(key)) && typeof item.tabId === 'string' && (item.pageId === undefined || typeof item.pageId === 'string') && (item.url === undefined || typeof item.url === 'string') && (item.title === undefined || typeof item.title === 'string') && (item.selected === undefined || typeof item.selected === 'boolean') && (item.paused === undefined || typeof item.paused === 'boolean')
  })
}
