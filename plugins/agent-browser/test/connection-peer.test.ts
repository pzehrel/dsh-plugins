/** 固定新版真实 Connection 与插件启动组合，覆盖必需 Peer 和官方权限边界。 */
import { Context } from '@deepseek-ai/cordis'
import { createScope } from '@deepseek-ai/dsh-scope'
import { expect, it, vi } from 'vitest'
import { apply } from '../src/enhanced-host.js'
import { officialConnection } from './support/official-connection.js'

it('新版正式路由缺少 Peer 时复现 principal 错误，真实非 owner Peer 返回 403', async () => {
  const scope = createScope(new Context(), {})
  const connection = officialConnection(scope.ctx)
  const unregister = connection.fetch.register({ path: '/api/peer-regression', methods: ['GET'], fetch: async () => new Response('ok') })
  const request = new Request('http://localhost/api/peer-regression')
  const peer = connection.createPeer({ principal: { kind: 'regression-non-owner' }, interactions: 'none' })
  try {
    const handler = connection.createSharedFetchHandler('/api')
    await expect(async () => handler.fetch(request)).rejects.toThrow('Cannot read properties of undefined (reading \'principal\')')
    expect((await handler.fetch(request, peer)).status).toBe(403)
  }
  finally {
    await peer.dispose()
    unregister()
    await scope.dispose()
  }
})

it('增强 Host 在新版正式 Connection 上通过真实注册自测并立即释放 Peer', async () => {
  const scope = createScope(new Context(), {})
  const connection = officialConnection(scope.ctx)
  const createPeer = vi.spyOn(connection, 'createPeer')
  const cleanups: (() => unknown)[] = []
  try {
    await expect(apply({
      connection,
      tools: { register: () => () => {} },
      effect: (effect) => { cleanups.push(effect() as () => unknown) },
    })).resolves.toBeUndefined()
    expect(createPeer).toHaveBeenCalledExactlyOnceWith({ principal: { kind: 'owner' }, interactions: 'none' })
    expect(createPeer.mock.results[0]?.value.signal.aborted).toBe(true)
  }
  finally {
    for (const cleanup of cleanups.reverse()) {
      await cleanup()
    }
    await scope.dispose()
  }
})

it('正式路由拒绝启动自测时仍释放真实 Peer', async () => {
  const scope = createScope(new Context(), {})
  const connection = officialConnection(scope.ctx)
  const peer = connection.createPeer({ principal: { kind: 'regression-non-owner' }, interactions: 'none' })
  // 只在外部工厂边界注入真实非 owner Peer；403 及失败路径仍由原包执行。
  vi.spyOn(connection, 'createPeer').mockReturnValue(peer)
  const cleanups: (() => unknown)[] = []
  try {
    await expect(apply({
      connection,
      tools: { register: () => () => {} },
      effect: (effect) => { cleanups.push(effect() as () => unknown) },
    })).rejects.toThrow()
    expect(peer.signal.aborted).toBe(true)
  }
  finally {
    for (const cleanup of cleanups.reverse()) {
      await cleanup()
    }
    await scope.dispose()
  }
})
