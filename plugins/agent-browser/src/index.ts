/** 保留历史实验入口；一次性 ToolRuntime 诊断不进入独立增强 Host。 */
import type { ToolRunContext, ToolRuntime } from '@deepseek-ai/dsh-tools'
import type { FixedPageHostContext } from './fixed-page-host.js'
import { randomUUID } from 'node:crypto'
import { applyFixedPageHost } from './fixed-page-host.js'

/** 历史实验额外使用实时 Agent 注册表和工具执行流水线。 */
export interface HostContext extends FixedPageHostContext {
  /** 正式工具执行器，仅诊断回调使用 execute。 */
  tools: Pick<ToolRuntime, 'register' | 'execute'>
  /** 正式实时 Agent 注册表，不冷恢复已有会话。 */
  agents: { list: () => NonNullable<ToolRunContext['agent']>[] }
}
export const name = 'agent-browser-spike'
export const inject = ['tools', 'connection', 'agents']
/** @param ctx 当前 profile 的正式 Host 服务；卸载时一并撤销诊断与页面通路。 */
export async function apply(ctx: HostContext): Promise<void> {
  await applyFixedPageHost(ctx, 'agent-browser-spike', async (page, signal) => {
    const agent = ctx.agents.list().find(agent => agent.session.header.id === page.sessionId)
    if (!agent) {
      throw new Error('该会话尚无实时 Agent；先在此会话发送一条消息')
    }
    const results = []
    for (const action of ['read', 'click', 'read']) {
      results.push(await ctx.tools.execute({ name: 'agent_browser_spike', arguments: { action, pageId: page.pageId }, agent, callId: `spike-${randomUUID()}` as ToolRunContext['callId'], signal }))
    }
    return { driver: '公开 ToolRuntime.execute，真实 Agent 身份；不是模型自动生成调用', results }
  })
}
