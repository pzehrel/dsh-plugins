/** 独立HTTP验收驱动只替换外部Agent driver与ToolRuntime，不假造审批答案或持久turn事件。 */
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it, vi } from 'vitest'
import { createNativeDriver } from '../../../tools/enhanced-native-driver.js'

it('防模型拦截按固定会话识别代理对象；同会话不同对象拒绝，真正其他会话才next', async () => {
  const s = await setup(false)
  try {
    await s.post('/approval/start', { action: 'click-element', reference: 'ref', pageId: 'owned-page' })
    const next = vi.fn(async () => ({ kind: 'pass' }))
    const marker = s.agent.inbox.nextTurn[0]!
    const payload = { messages: [marker], turn: 1, step: 1, signal: new AbortController().signal }
    expect(await s.listener()!({ ...payload, agent: { ...s.agent, session: { header: { id: 'another-session' } } } }, next)).toEqual({ kind: 'pass' })
    expect(next).toHaveBeenCalledTimes(1)
    next.mockClear()
    expect(await s.listener()!({ ...payload, agent: new Proxy(s.agent, {}) }, next)).toEqual({ kind: 'reject' })
    expect(next).not.toHaveBeenCalled()
    expect(s.calls).toEqual([])
  }
  finally { await s.close() }
})

it('取消发生在pre-step领取前也移除自身排队marker，idle之前不撤销防模型拦截器', async () => {
  const s = await setup(false)
  try {
    expect((await s.post('/approval/start', { action: 'click-element', reference: 'ref', pageId: 'owned-page' })).status).toBe(200)
    expect(s.agent.inbox.nextTurn).toHaveLength(1)
    await s.post('/approval/cancel')
    expect(s.listener()).toBeDefined()
    s.finishIdle()
    await vi.waitFor(() => expect(s.listener()).toBeUndefined())
    expect(s.agent.inbox.nextTurn).toEqual([])
    expect(s.calls).toEqual([])
  }
  finally { await s.close() }
})

it('只在合法pre-step里调用真实工具接口，并始终reject阻止模型step；结果收敛后解除拦截', async () => {
  const s = await setup(true)
  try {
    await s.post('/approval/start', { action: 'click-element', reference: 'ref', pageId: 'owned-page' })
    await vi.waitFor(() => expect(s.calls).toHaveLength(1))
    expect(s.calls[0]).toMatchObject({ name: 'agent_browser', arguments: { action: 'click-element', reference: 'ref', pageId: 'owned-page' } })
    expect(s.decision()).toEqual({ kind: 'reject' })
    expect(s.listener()).toBeDefined()
    s.finishIdle()
    await vi.waitFor(() => expect(s.listener()).toBeUndefined())
    expect(await s.get('/approval/job')).toMatchObject({ running: false, phase: 'settled', turn: 1, step: 1, isError: false })
  }
  finally { await s.close() }
})

it.each(['choose-file', 'upload-submit'] as const)('文件动作%s只在合法pre-step转发确切opaque选择身份，不收路径脚本或会话参数', async (action) => {
  const s = await setup(true, [action])
  try {
    const selectionId = '11111111-1111-4111-8111-111111111111'
    for (const extra of [{ filePath: '/tmp/not-authorized' }, { script: 'not-accepted' }, { sessionId: 'another-session' }]) {
      expect((await s.post('/approval/start', { action, pageId: 'owned-page', reference: 'ref', ...extra })).status).toBe(500)
    }
    expect(s.calls).toEqual([])
    const args = { action, pageId: 'owned-page', reference: 'ref', ...(action === 'upload-submit' ? { selectionId } : {}) }
    expect((await s.post('/approval/start', args)).status).toBe(200)
    await vi.waitFor(() => expect(s.calls).toHaveLength(1))
    expect(s.calls[0]).toMatchObject({ arguments: args })
    expect(s.decision()).toEqual({ kind: 'reject' })
    s.finishIdle()
  }
  finally { await s.close() }
})

it('文件动作拒绝短时call和无效选择身份，未启动turn或调用工具', async () => {
  const s = await setup(true, ['choose-file', 'upload-submit'])
  try {
    for (const action of ['choose-file', 'upload-submit']) {
      expect((await s.post('/call', { action, pageId: 'owned-page', reference: 'ref' })).status).toBe(400)
    }
    for (const args of [
      { action: 'upload-submit' },
      { action: 'upload-submit', selectionId: '/tmp/file' },
      { action: 'choose-file', selectionId: '11111111-1111-4111-8111-111111111111' },
    ]) {
      expect((await s.post('/approval/start', { ...args, pageId: 'owned-page', reference: 'ref' })).status).toBe(500)
    }
    expect(s.calls).toEqual([])
    expect(s.agent.inbox.nextTurn).toEqual([])
  }
  finally { await s.close() }
})

async function setup(claim: boolean, actions = ['click-element']) {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-approval-driver-'))
  const controlFile = join(directory, 'control.json')
  let dispose: (() => Promise<void>) | undefined
  let listener: ((payload: unknown, next: () => Promise<unknown>) => Promise<unknown>) | undefined
  let finishIdle: () => void = () => {}
  let decision: unknown
  const calls: unknown[] = []
  const idle = new Promise<void>((resolve) => {
    finishIdle = resolve
  })
  const agent = {
    session: { header: { id: 'session-dedicated-approval' } },
    status: 'idle',
    inbox: { nextTurn: [] as { id: string }[], nextStep: [], remove: (id: string) => {
      const found = agent.inbox.nextTurn.findIndex(message => message.id === id)
      if (found < 0) {
        return false
      }
      agent.inbox.nextTurn.splice(found, 1)
      return true
    } },
    ctx: { on: (_name: string, callback: typeof listener) => {
      listener = callback
      return () => {
        listener = undefined
      }
    } },
    followup: (message: { id: string }) => {
      agent.status = 'running'
      agent.inbox.nextTurn.push(message)
      if (claim) {
        agent.inbox.nextTurn.shift()
        void listener!({ agent, messages: [message], turn: 1, step: 1, signal: new AbortController().signal }, async () => undefined).then((result) => {
          decision = result
        })
      }
    },
    whenIdle: () => idle.then(() => { agent.status = 'idle' }),
    cancel: () => {},
  }
  createNativeDriver({ agents: { list: () => [agent] }, tools: { get: () => undefined, execute: async (request: unknown) => {
    calls.push(request)
    return { isError: false, value: { kind: 'input', status: 'issued' }, content: [] }
  } }, effect: (setup: () => () => Promise<void>) => {
    dispose = setup()
  } } as unknown as Parameters<typeof createNativeDriver>[0], { sessionId: agent.session.header.id, controlFile, lifecycle: false, actions, approvalProbe: true })
  let control: { port: number, secret: string } | undefined
  await vi.waitFor(async () => {
    control = JSON.parse(await readFile(controlFile, 'utf8'))
  })
  const post = (path: string, value?: unknown) => fetch(`http://127.0.0.1:${control!.port}${path}`, { method: 'POST', headers: { authorization: `Bearer ${control!.secret}` }, ...(value ? { body: JSON.stringify(value) } : {}) })
  const get = (path: string) => fetch(`http://127.0.0.1:${control!.port}${path}`, { headers: { authorization: `Bearer ${control!.secret}` } }).then(result => result.json())
  return { post, get, agent, calls, finishIdle, listener: () => listener, decision: () => decision, close: async () => {
    finishIdle()
    await dispose?.()
    await rm(directory, { recursive: true, force: true })
  } }
}
