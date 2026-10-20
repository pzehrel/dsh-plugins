/** 源码增强的独立 Host；与旧实验共用固定页控制实现，部署产物不依赖旧插件。 */
import type { FixedPageHostContext } from './fixed-page-host.js'
import { applyFixedPageHost } from './fixed-page-host.js'

export const name = 'agent-browser'
export const inject = ['tools', 'connection']
/** @param ctx 宿主真实工具执行身份、正式 Connection 及生命周期。 */
export async function apply(ctx: FixedPageHostContext): Promise<void> {
  await applyFixedPageHost(ctx, 'agent-browser')
}
