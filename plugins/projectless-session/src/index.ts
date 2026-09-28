/**
 * 为不要求用户选目录的 Web 会话创建真实 Workspace，并提供专属目录约定。
 * 仅使用宿主公开的工作区、会话、提示词及 HTTP 服务，不修改 DSH 客户端产物。
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import { randomUUID } from 'node:crypto'
import { mkdirSync, realpathSync } from 'node:fs'
import { mkdir, realpath, rm } from 'node:fs/promises'
import { homedir } from 'node:os'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import process from 'node:process'

/** Web 客户端创建入口；不接受调用者传入的目录或会话身份。 */
export const CREATE_PATH = '/api/dsh-projectless-session/create'

/** 宿主配置；未设置时使用当前 DSH_HOME 下的 projectless 目录。 */
export interface Config {
  /** 自动创建会话的持久目录根；必须是绝对路径，改变后不迁移既有会话。 */
  root?: string
}

/** 本插件使用的宿主契约子集，便于在不导入宿主实现的前提下测试。 */
export interface HostContext {
  /** 把目录注册为真实 DSH Workspace，返回稳定的工作区身份。 */
  workspaceRegistry: {
    create: (path: string, title?: string) => Promise<{ id: string }>
  }
  /** 创建、持久化并将 Session 附着到指定的 Workspace。 */
  sessionController: {
    create: (request: { sessionId: string, workspaceId: string }) => Promise<{ sessionId: string }>
  }
  /** 将 HTTP 路由注册到当前 Web 宿主；卸载时使用返回的清理函数。 */
  webServer: {
    register: (route: {
      kind: 'exact'
      path: string
      handler: (req: IncomingMessage, res: ServerResponse) => Promise<void>
    }) => () => void
  }
  /** 只对本插件生成的会话贡献写入目录说明。 */
  systemPrompt: {
    section: (section: {
      name: string
      order: number
      text: (context: { agent?: { session?: { header: { cwd?: string } } } }) => string
    }) => () => void
  }
  /** 注册随插件卸载清理的副作用。 */
  effect: (callback: () => (() => void), label: string) => void
}

/** 供 Cordis 按服务就绪顺序装载本插件。 */
export const inject = ['webServer', 'workspaceRegistry', 'sessionController', 'systemPrompt']

/**
 * 返回持久根目录，不展开用户输入的 ~。
 * @param config 可选的目录配置；未给出时使用 DSH_HOME 或用户家目录。
 * @returns 规范化的绝对目录路径，不创建目录。
 * @throws 配置了非绝对路径时抛错。
 */
export function projectlessRoot(config: Config = {}): string {
  const configured = config.root
  if (configured !== undefined) {
    if (!isAbsolute(configured)) {
      throw new Error('root 必须是绝对路径')
    }
    return resolve(configured)
  }
  return resolve(process.env.DSH_HOME?.trim() || join(homedir(), '.dsh'), 'projectless')
}

/**
 * 仅把根目录的两层子目录视作本插件会话，避免给普通项目注入专属约定。
 * @param root 已规范化的持久目录根，需与会话 cwd 使用相同的真实路径。
 * @param cwd 会话工作目录；缺失时不是自动生成的工作区。
 * @returns 路径满足日期与 chat-uuid 目录形状时为 true。
 */
export function isProjectlessDirectory(root: string, cwd: string | undefined): boolean {
  if (cwd === undefined) {
    return false
  }
  const parts = relative(root, cwd).split(sep)
  return parts.length === 2
    && /^\d{4}-\d{2}-\d{2}$/.test(parts[0] ?? '')
    && /^chat-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(parts[1] ?? '')
}

/**
 * 生成一次有真实工作区身份的会话及其两个持久目录。
 * @param ctx 宿主公开的 Workspace 与 Session 服务；创建失败时保留可能已持久化的会话。
 * @param root 已选定的绝对根目录；存在的符号链接在创建前转成规范路径。
 * @param now 用于目录日期的 UTC 时刻，默认使用当前时间。
 * @returns 可由浏览器按 sessionId 重新接入的会话、工作区与绝对 cwd。
 * @throws 失败时抛出原始错误；注册或创建会话阶段失败保留可能已持久化的目录。
 */
export async function createProjectlessSession(ctx: Pick<HostContext, 'workspaceRegistry' | 'sessionController'>, root: string, now = new Date()): Promise<{ sessionId: string, workspaceId: string, cwd: string }> {
  await mkdir(root, { recursive: true })
  const canonicalRoot = await realpath(root)
  const date = now.toISOString().slice(0, 10)
  const parent = join(canonicalRoot, date)
  await mkdir(parent, { recursive: true })
  const uuid = randomUUID()
  const sessionId = `session-${uuid}`
  const cwd = join(parent, `chat-${uuid}`)
  await mkdir(cwd)
  try {
    await mkdir(join(cwd, 'work'))
    await mkdir(join(cwd, 'outputs'))
  }
  catch (error) {
    // 工作区注册尚未开始，目录仅由本次请求生成，可以安全回收。
    await rm(cwd, { recursive: true, force: true })
    throw error
  }
  // 注册或会话创建可能在“写入成功、回复失败”时抛错：不得删除可能已持久化的目录。
  const workspace = await ctx.workspaceRegistry.create(cwd, `自由会话 ${date} ${uuid.slice(0, 8)}`)
  const workspaceId = workspace.id
  const result = await ctx.sessionController.create({ sessionId, workspaceId })
  return { sessionId: result.sessionId, workspaceId, cwd }
}

function sendJson(res: ServerResponse, status: number, payload: object): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  res.end(JSON.stringify(payload))
}

function isAuthorizedBrowserRequest(req: IncomingMessage): boolean {
  const address = req.socket.remoteAddress
  if (address !== '127.0.0.1' && address !== '::1' && address !== '::ffff:127.0.0.1') {
    return false
  }
  const origin = req.headers.origin
  const host = req.headers.host
  // Web 路由不继承 API Gateway 身份验证；必须拒绝跨站表单和跨站 fetch。
  return typeof origin === 'string' && typeof host === 'string' && origin === `http://${host}`
}

/**
 * 安装 Web 创建入口与仅作用于自动目录的系统提示。
 * @param ctx 同时提供 HTTP、Workspace、Session、Prompt 以及 Cordis effect 的宿主。
 * @param config 可选的持久目录根；相对路径会使插件装载失败。
 * @throws 配置无效或服务注册失败时抛错，不修改任何 DSH 安装文件。
 */
export function apply(ctx: HostContext, config: Config = {}): void {
  const configuredRoot = projectlessRoot(config)
  mkdirSync(configuredRoot, { recursive: true })
  const root = realpathSync(configuredRoot)
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: CREATE_PATH,
    handler: async (req, res) => {
      if (req.method !== 'POST') {
        sendJson(res, 405, { ok: false, error: '只接受 POST' })
        return
      }
      if (!isAuthorizedBrowserRequest(req)) {
        sendJson(res, 403, { ok: false, error: '仅接受本机同源 Web 页面' })
        return
      }
      if (req.headers['content-length'] !== undefined && req.headers['content-length'] !== '0') {
        sendJson(res, 400, { ok: false, error: '请求不能携带正文' })
        return
      }
      try {
        const value = await createProjectlessSession(ctx, root)
        sendJson(res, 201, { ok: true, ...value })
      }
      catch (error) {
        sendJson(res, 500, { ok: false, error: error instanceof Error ? error.message : String(error) })
      }
    },
  }), 'projectless-session: Web 创建入口')

  ctx.systemPrompt.section({
    name: 'plugin:dsh-projectless-session',
    order: 109,
    text: (context) => {
      const cwd = context.agent?.session?.header.cwd
      if (!isProjectlessDirectory(root, cwd)) {
        return ''
      }
      return `这是未手动选择目录时自动创建的独立工作区：${cwd}。请将中间材料、草稿和临时文件写入 work/；将最终交付给用户的文件写入 outputs/。需要修改真实项目时应先征求用户指定该项目目录，不要将 DSH 安装目录作为项目目录。`
    },
  })
}
