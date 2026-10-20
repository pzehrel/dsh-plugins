/** 一次性驱动通过真实 HTTP 接口调用外部工具，卸载须停止后续步骤并等待已开始操作。 */
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it, vi } from 'vitest'
import { createNativeDriver } from '../../../tools/enhanced-native-driver.js'

it('显式开启的单次能力路由只使用配置的真实 Agent 与固定工具，拒绝未列动作', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-driver-actions-'))
  const controlFile = join(directory, 'control.json')
  let dispose: (() => Promise<void>) | undefined
  const agent = { session: { header: { id: 'session-owned-test' } } }
  const execute = vi.fn(async () => ({ isError: false, value: { kind: 'semantic', pageId: 'page-owned', documentId: 'doc-owned', elements: [] } }))
  const context = {
    agents: { list: () => [agent, { session: { header: { id: 'session-other-test' } } }] },
    tools: { get: () => undefined, execute },
    effect: (setup: () => () => Promise<void>) => { dispose = setup() },
  }
  createNativeDriver(context as unknown as Parameters<typeof createNativeDriver>[0], { sessionId: agent.session.header.id, controlFile, lifecycle: false, actions: ['observe'] })
  let control: { port: number, secret: string } | undefined
  try {
    await vi.waitFor(async () => {
      control = JSON.parse(await readFile(controlFile, 'utf8'))
    })
    const call = (body: unknown) => fetch(`http://127.0.0.1:${control!.port}/call`, {
      method: 'POST',
      headers: { 'authorization': `Bearer ${control!.secret}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
    expect((await call({ action: 'script', code: 'for(;;){}' })).status).toBe(400)
    expect((await call({ action: 'observe', sessionId: 'session-other-test' })).status).toBe(400)
    expect(execute).not.toHaveBeenCalled()
    const reply = await call({ action: 'observe', pageId: 'page-owned' })
    expect(reply.status).toBe(200)
    expect(await reply.json()).toMatchObject({ isError: false, value: { kind: 'semantic', pageId: 'page-owned' } })
    expect(execute).toHaveBeenCalledWith(expect.objectContaining({ name: 'agent_browser', agent, arguments: { action: 'observe', pageId: 'page-owned' } }))
  }
  finally {
    await dispose?.()
    await rm(directory, { recursive: true, force: true })
  }
})

it('驱动卸载等待普通 run 的在途读取，迟到成功不会继续点击', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-driver-lifecycle-'))
  const controlFile = join(directory, 'control.json')
  let dispose: (() => Promise<void>) | undefined
  let finish: (() => void) | undefined
  let executionSignal: AbortSignal | undefined
  const actions: unknown[] = []
  const sessionId = 'session-lifecycle-test'
  // 宿主对象只替换正式外部服务；测试通过驱动的实际 HTTP 路由触发控制流程。
  const context = {
    agents: { list: () => [{ session: { header: { id: sessionId } } }] },
    tools: {
      get: () => undefined,
      execute: async (request: { arguments: unknown, signal: AbortSignal }) => {
        actions.push(request.arguments)
        executionSignal = request.signal
        await new Promise<void>((resolve) => {
          finish = resolve
        })
        return { isError: false, value: { pageId: 'page-original', documentId: 'doc-original' } }
      },
    },
    effect: (setup: () => () => Promise<void>) => {
      dispose = setup()
    },
  }
  createNativeDriver(context as unknown as Parameters<typeof createNativeDriver>[0], { sessionId, controlFile, lifecycle: true })
  let control: { port: number, secret: string } | undefined
  try {
    await vi.waitFor(async () => {
      control = JSON.parse(await readFile(controlFile, 'utf8'))
    })
    const address = `http://127.0.0.1:${control!.port}`
    const running = fetch(`${address}/run`, { method: 'POST', headers: { authorization: `Bearer ${control!.secret}` } }).catch(() => undefined)
    await vi.waitFor(() => expect(actions).toHaveLength(1))
    let finished = false
    const disposing = dispose!().then(() => {
      finished = true
    })
    expect(executionSignal!.aborted).toBe(true)
    await Promise.resolve()
    expect(finished).toBe(false)
    finish!()
    await disposing
    await running
    expect(actions).toEqual([{ action: 'read' }])
    await expect(fetch(`${address}/status`)).rejects.toThrow()
    await dispose!()
  }
  finally {
    finish?.()
    await dispose?.()
    await rm(directory, { recursive: true, force: true })
  }
})
