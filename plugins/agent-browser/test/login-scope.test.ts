/** 账号容器控制边界的语义回归；不代替真实 Desktop 分区与存储证据。 */
import { Context } from '@deepseek-ai/cordis'
import { HostConnectionService } from '@deepseek-ai/dsh-client-connection'
import { expect, it } from 'vitest'
import { createScopeAccounts } from '../../../tools/login-scope-client.js'
import { apply as applyScopeHost } from '../../../tools/login-scope-host.js'

it('默认全局容器跨真实工作区共享，但不回写工作区身份', () => {
  const accounts = createScopeAccounts('test-run')
  const first = accounts.resolve('cwd:/fixture/workspace-a')
  const second = accounts.resolve('cwd:/fixture/workspace-b')
  expect(first.account).toBe(second.account)
  expect(first.workspace).toBe('cwd:/fixture/workspace-a')
  expect(second.workspace).toBe('cwd:/fixture/workspace-b')
  expect(first.account.startsWith('cwd:')).toBe(false)
})

it('工作区容器同工作区共享、跨工作区隔离，并与全局容器分开', () => {
  const accounts = createScopeAccounts('test-run')
  const global = accounts.resolve('cwd:/fixture/workspace-a')
  accounts.select('workspace')
  const first = accounts.resolve('cwd:/fixture/workspace-a')
  expect(first.account).toBe(accounts.resolve('cwd:/fixture/workspace-a').account)
  expect(first.account).not.toBe(accounts.resolve('cwd:/fixture/workspace-b').account)
  expect(first.account).not.toBe(global.account)
})

it('未取得真实工作区绑定时拒绝容器解析', () => {
  const accounts = createScopeAccounts('test-run')
  expect(() => accounts.resolve('session:ungrouped')).toThrow('需要真实工作区绑定')
  expect(() => accounts.resolve('cwd:')).toThrow('需要真实工作区绑定')
})

/** @returns 经正式 Connection 与真实 loopback HTTP 读报告的外部边界夹具。 */
async function hostFixture() {
  const connection = new HostConnectionService(new Context(), [], {} as ConstructorParameters<typeof HostConnectionService>[2])
  const cleanups: (() => unknown)[] = []
  await applyScopeHost({ connection, agents: { list: () => [] }, tools: {
    register: () => () => {},
    execute: async () => {
      throw new Error('本回归不执行模型工具')
    },
  }, effect: (effect) => {
    cleanups.push(effect() as () => unknown)
  } })
  return {
    async report(payload: object) {
      const response = await connection.createSharedFetchHandler('/api').fetch(new Request('http://127.0.0.1/api/login-scope-probe/report', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ type: 'client-request', rpcId: 'scope-report-regression', method: 'login-scope-probe/report', payload }),
      }))
      return (await response.json()).result
    },
    async dispose(): Promise<void> {
      for (const dispose of cleanups.reverse()) {
        await dispose()
      }
    },
  }
}

const packet = {
  sessionId: 'session-00000000-0000-4000-8000-000000000001',
  pageId: '00000000-0000-4000-8000-000000000002',
  workspace: 'cwd:/fixture/workspace-a',
  account: 'plugin:agent-browser-scope:__LOGIN_SCOPE_RUN__:global',
  scope: 'global',
  action: 'read',
  value: { storage: 'A', cookie: 'A' },
}

it('诊断报告只导出两个自有测试字段，丢弃附加内容', async () => {
  const fixture = await hostFixture()
  try {
    const reply = await fixture.report({ ...packet, value: { ...packet.value, extra: '应丢弃的附加测试内容' } })
    expect(reply.ok).toBe(true)
    const recorded = await (await fetch(reply.value)).json()
    expect(recorded.observations[0].value).toEqual({ storage: 'A', cookie: 'A' })
    expect(JSON.stringify(recorded)).not.toContain('应丢弃的附加测试内容')
  }
  finally {
    await fixture.dispose()
  }
})

it.each([{ scope: '未知范围' }, { action: '未知动作' }])('拒绝非诊断范围或动作，不保留任意元数据 %j', async (invalid) => {
  const fixture = await hostFixture()
  try {
    const valid = await fixture.report(packet)
    expect((await fixture.report({ ...packet, ...invalid })).ok).toBe(false)
    const recorded = await (await fetch(valid.value)).json()
    expect(recorded.observations).toHaveLength(1)
  }
  finally {
    await fixture.dispose()
  }
})
