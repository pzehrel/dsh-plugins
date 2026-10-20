/** 经同版本正式 Connection Fetch 边界复现 Desktop 注册页 404；认证仅在载体边界模拟。 */
import { Context } from '@deepseek-ai/cordis'
import { HostConnectionService } from '@deepseek-ai/dsh-client-connection'
import { expect, it, vi } from 'vitest'
import { apply } from '../src/index.js'

const fixture = vi.hoisted(() => ({ active: false }))

// 测试站的 node:http 是外部边界；本测试不需要真实绑定端口，也不允许启动失败留下监听器。
vi.mock('node:http', () => ({
  createServer: () => ({
    once: () => {},
    listen: (_port: number, _host: string, ready: () => void) => {
      fixture.active = true
      ready()
    },
    address: () => ({ port: 43210 }),
    closeAllConnections: () => {},
    close: (done: () => void) => {
      fixture.active = false
      done()
    },
  }),
}))

it('client 的注册页请求应到达实验 Host，而不是 HTTP 404', async () => {
  const ctx = new Context()
  // shared Fetch handler 接收已认证请求，不在此读取任何真实凭据。
  const auth = {} as ConstructorParameters<typeof HostConnectionService>[2]
  const connection = new HostConnectionService(ctx, [], auth)
  // 真实宿主已由 API Gateway 认领共享通道；实验必须与已有 endpoint 所有者共存。
  const disposeExisting = connection.rpc.intercept('/api', endpoint => endpoint === 'builtin/ready', async () => ({ ok: true, value: 'ready' }))
  const cleanups: (() => unknown)[] = [disposeExisting]
  let activationError = ''
  await apply({
    connection,
    agents: { list: () => [] },
    tools: {
      register: () => () => {},
      execute: async () => {
        throw new Error('本回归仅验证页面注册，不伪造工具执行')
      },
    },
    effect: (effect) => {
      cleanups.push(effect() as () => unknown)
    },
  }).catch((error) => {
    activationError = String(error)
  })
  try {
    const response = await connection.createSharedFetchHandler('/api').fetch(new Request('http://127.0.0.1/api/agent-browser-spike/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'client-request', rpcId: 'spike-registration-regression', method: 'agent-browser-spike/register', payload: { sessionId: '测试会话' } }),
    }))
    expect(response.status, activationError || 'Host 必须为注册页请求提供正式 RPC 响应').toBe(200)
    const result = await response.json()
    expect(result.result.ok).toBe(true)
    expect(result.result.value.pageId).toEqual(expect.any(String))
    const builtin = await connection.createSharedFetchHandler('/api').fetch(new Request('http://127.0.0.1/api/builtin/ready', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'client-request', rpcId: 'builtin-preserved', method: 'builtin/ready', payload: {} }),
    }))
    expect(builtin.status).toBe(200)
    expect((await builtin.json()).result.value).toBe('ready')
  }
  finally {
    for (const dispose of cleanups.reverse()) {
      await dispose()
    }
  }
})

it('host 启动失败时也关闭独立测试站', async () => {
  const ctx = new Context()
  const connection = new HostConnectionService(ctx, [], {} as ConstructorParameters<typeof HostConnectionService>[2])
  const cleanups: (() => unknown)[] = []
  await expect(apply({
    connection,
    agents: { list: () => [] },
    tools: {
      register: () => {
        throw new Error('拒绝工具注册')
      },
      execute: async () => {
        throw new Error('本回归不执行工具')
      },
    },
    effect: (effect) => {
      cleanups.push(effect() as () => unknown)
    },
  })).rejects.toThrow('拒绝工具注册')
  for (const dispose of cleanups.reverse()) {
    await dispose()
  }
  expect(fixture.active).toBe(false)
})
