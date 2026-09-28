/** 验证自动 Workspace、持久目录、失败保留策略及 Web 入口的跨站边界。 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { HostContext } from '../src/index.js'
import { EventEmitter } from 'node:events'
import { mkdtemp, readdir, realpath, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { apply, createProjectlessSession, isProjectlessDirectory, projectlessRoot } from '../src/index.js'

async function withRoot(run: (root: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-projectless-test-'))
  try {
    await run(root)
  }
  finally {
    await rm(root, { recursive: true, force: true })
  }
}

function mockHost(): {
  ctx: Pick<HostContext, 'workspaceRegistry' | 'sessionController'>
  created: string[]
  attached: Array<{ sessionId: string, workspaceId: string }>
} {
  const created: string[] = []
  const attached: Array<{ sessionId: string, workspaceId: string }> = []
  return {
    created,
    attached,
    ctx: {
      workspaceRegistry: {
        create: async (path) => {
          created.push(path)
          return { id: `workspace-${created.length}` }
        },
      },
      sessionController: {
        create: async (request) => {
          attached.push(request)
          return { sessionId: request.sessionId }
        },
      },
    },
  }
}

it('每次点击生成不同的真实 Workspace、Session 及 work/outputs', async () => {
  await withRoot(async (root) => {
    const host = mockHost()
    const first = await createProjectlessSession(host.ctx, root, new Date('2026-09-27T23:59:00Z'))
    const second = await createProjectlessSession(host.ctx, root, new Date('2026-09-28T00:01:00Z'))
    expect(first.workspaceId).toBe('workspace-1')
    expect(first.cwd).not.toBe(second.cwd)
    expect(host.created[0]).toBe(first.cwd)
    expect(host.attached[0]).toEqual({ sessionId: first.sessionId, workspaceId: first.workspaceId })
    expect(first.cwd).toMatch(/2026-09-27\/chat-[0-9a-f-]+$/)
    expect(second.cwd).toMatch(/2026-09-28\/chat-[0-9a-f-]+$/)
    expect((await stat(join(first.cwd, 'work'))).isDirectory()).toBe(true)
    expect((await stat(join(first.cwd, 'outputs'))).isDirectory()).toBe(true)
    const canonicalRoot = await realpath(root)
    expect(isProjectlessDirectory(canonicalRoot, first.cwd)).toBe(true)
    expect(isProjectlessDirectory(canonicalRoot, join(first.cwd, 'work'))).toBe(false)
    expect(isProjectlessDirectory(canonicalRoot, join(root, '..', 'outside'))).toBe(false)
  })
})

it('注册或会话失败时保留可能已持久化的目录', async () => {
  await withRoot(async (root) => {
    const host = mockHost()
    host.ctx.workspaceRegistry.create = async () => {
      throw new Error('registry unavailable')
    }
    await expect(createProjectlessSession(host.ctx, root)).rejects.toThrow(/registry unavailable/)
    const date = new Date().toISOString().slice(0, 10)
    expect((await readdir(join(root, date))).length).toBe(1)

    const hostWithPersistedSession = mockHost()
    hostWithPersistedSession.ctx.sessionController.create = async () => {
      throw new Error('reply lost')
    }
    await expect(createProjectlessSession(hostWithPersistedSession.ctx, root)).rejects.toThrow(/reply lost/)
    expect((await readdir(join(root, date))).length).toBe(2)
    expect(hostWithPersistedSession.created.length).toBe(1)
  })
})

it('非绝对配置拒绝加载，默认位置跟随 DSH_HOME', () => {
  expect(() => projectlessRoot({ root: 'relative' })).toThrow(/绝对路径/)
  expect(projectlessRoot({ root: '/tmp/example' })).toBe('/tmp/example')
})

it('web 路由拒绝异源与非 POST，仅同源本机请求创建会话', async () => {
  await withRoot(async (root) => {
    const host = mockHost()
    let handler: ((req: IncomingMessage, res: ServerResponse) => Promise<void>) | undefined
    let prompt: ((context: { agent?: { session?: { header: { cwd?: string } } } }) => string) | undefined
    const ctx: HostContext = {
      ...host.ctx,
      webServer: {
        register: (route) => {
          handler = route.handler
          return () => {}
        },
      },
      systemPrompt: {
        section: (section) => {
          prompt = section.text
          return () => {}
        },
      },
      effect: (callback) => { callback() },
    }
    apply(ctx, { root })
    expect(handler).toBeDefined()
    expect(prompt).toBeDefined()

    async function request(method: string, origin: string | undefined, remoteAddress = '127.0.0.1', contentLength = '0'): Promise<{ status: number, data: { ok: boolean, cwd?: string } }> {
      const req = Object.assign(new EventEmitter(), {
        method,
        headers: { 'host': '127.0.0.1:19387', 'origin': origin, 'content-length': contentLength },
        socket: { remoteAddress },
      }) as unknown as IncomingMessage
      let status = 0
      let body = ''
      const res = {
        writeHead: (value: number) => { status = value },
        end: (value: string) => { body = value },
      } as unknown as ServerResponse
      await handler!(req, res)
      return { status, data: JSON.parse(body) as { ok: boolean, cwd?: string } }
    }

    expect((await request('GET', 'http://127.0.0.1:19387')).status).toBe(405)
    expect((await request('POST', 'https://example.com')).status).toBe(403)
    expect((await request('POST', undefined)).status).toBe(403)
    expect((await request('POST', 'http://127.0.0.1:19387', '198.51.100.1')).status).toBe(403)
    expect((await request('POST', 'http://127.0.0.1:19387', '127.0.0.1', '42')).status).toBe(400)
    const success = await request('POST', 'http://127.0.0.1:19387')
    expect(success.status).toBe(201)
    expect(host.attached.length).toBe(1)
    expect(prompt!({ agent: { session: { header: { cwd: success.data.cwd } } } })).toContain('outputs/')
    expect(prompt!({ agent: { session: { header: { cwd: '/tmp/other' } } } })).toBe('')
  })
})
