/** 正式 Host 工具的能力反馈回归；不让缺失能力变成页面动作或虚构文件结果。 */
import type { ToolDefinition, ToolRunContext } from '@deepseek-ai/dsh-tools'
import { Context } from '@deepseek-ai/cordis'
import { HostConnectionService } from '@deepseek-ai/dsh-client-connection'
import { expect, it } from 'vitest'
import { applyFixedPageHost } from '../src/fixed-page-host.js'

it('下载明确停止，保留能力仍是交付门槛，均不需要也不创建页面', async () => {
  let tool: ToolDefinition | undefined
  const cleanups: (() => unknown)[] = []
  const connection = new HostConnectionService(new Context(), [], {} as ConstructorParameters<typeof HostConnectionService>[2])
  await applyFixedPageHost({ connection, tools: { register: (definition) => {
    tool = definition
    return () => {}
  } }, effect: effect => cleanups.push(effect() as () => unknown) }, 'agent-browser')
  const exec = { agent: { session: { header: { id: '能力验证会话' } } }, signal: new AbortController().signal } as ToolRunContext
  try {
    await expect(tool!.execute({ action: 'download' }, exec)).rejects.toThrow('[agent-browser/download-unsupported]')
    await expect(tool!.execute({ action: 'download' }, exec)).rejects.toThrow('未生成文件')
    await expect(tool!.execute({ action: 'upload' }, exec)).rejects.toThrow('仍是首版交付门槛')
    await expect(tool!.execute({ action: 'frame' }, exec)).rejects.toThrow('仍是首版交付门槛')
    await expect(tool!.execute({ action: 'network' }, exec)).rejects.toThrow('首版延期')
    await expect(tool!.execute({ action: 'made-up-action' }, exec)).rejects.toThrow('[agent-browser/action-unavailable]')
  }
  finally {
    for (const cleanup of cleanups.reverse()) {
      await cleanup()
    }
  }
})

it('自有下载夹具提供同源附件和白名单请求计数，关闭Host后停止监听', async () => {
  const cleanups: (() => unknown)[] = []
  const connection = new HostConnectionService(new Context(), [], {} as ConstructorParameters<typeof HostConnectionService>[2])
  await applyFixedPageHost({ connection, tools: { register: () => () => {} }, effect: effect => cleanups.push(effect() as () => unknown) }, 'agent-browser')
  let fixtureUrl = ''
  try {
    const reply = await connection.createSharedFetchHandler('/api').fetch(new Request('http://127.0.0.1/api/agent-browser/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'client-request', rpcId: 'download-fixture-only', method: 'agent-browser/register', payload: { sessionId: '下载夹具验证会话' } }),
    }))
    fixtureUrl = (await reply.json()).result.value.fixtureUrl
    expect(await (await fetch(fixtureUrl)).text()).toContain('id="download-mode"')
    const semantic = await fetch(`${fixtureUrl}/semantic`)
    expect(semantic.status).toBe(200)
    expect(await semantic.text()).toContain('id="rearrange"')
    expect((await fetch(`${fixtureUrl}/semantic?other=1`)).status).toBe(404)
    expect(await (await fetch(`${fixtureUrl}/download-status`)).json()).toEqual({ attachmentRequests: 0 })
    const attachment = await fetch(`${fixtureUrl}/download.txt`)
    expect(attachment.headers.get('content-disposition')).toMatch(/^attachment; filename="dsh-agent-browser-[0-9a-f-]+\.txt"$/u)
    expect(await attachment.text()).toBe('DSH 自有下载验证文件。\n')
    expect(await (await fetch(`${fixtureUrl}/download-status`)).json()).toEqual({ attachmentRequests: 1 })
    expect((await fetch(`${fixtureUrl}/download.txt?other=1`)).status).toBe(404)
  }
  finally {
    for (const cleanup of cleanups.reverse()) {
      await cleanup()
    }
  }
  await expect(fetch(fixtureUrl)).rejects.toThrow()
})
