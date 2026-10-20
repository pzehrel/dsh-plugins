/** 任务02的一次性账号容器诊断；只处理本次自有存储标记，不改变框架工作区身份。 */
import type { createToolClient } from '../plugins/agent-browser/src/fixed-page-client.js'

type Scope = 'global' | 'workspace'
interface Account {
  /** 框架解析的真实工作区标识，绝不替换或回写。 */
  workspace: string
  /** 创建该页面时选定的账号范围。 */
  scope: Scope
  /** 仅本次插件诊断使用的存储账号，不是工作区身份或控制凭据。 */
  account: string
}
type Context = Parameters<typeof createToolClient>[0]
type Mount = Parameters<ReturnType<typeof createToolClient>['attach']>[1]
type Target = Parameters<ReturnType<typeof createToolClient>['attach']>[2] & { getAccount: () => string | undefined }

/** @param run 本次实验的独立命名空间。@returns 仅为新页面解析的账号策略；不改写来源身份。 */
export function createScopeAccounts(run: string): { select: (next: Scope) => void, resolve: (workspace: string) => Account } {
  let scope: Scope = 'global'
  return {
    select(next: Scope): void { scope = next },
    resolve(workspace: string): Account {
      if (!workspace.startsWith('cwd:') || workspace.length <= 4) {
        throw new Error('需要真实工作区绑定')
      }
      return { workspace, scope, account: `plugin:agent-browser-scope:${run}:${scope === 'global' ? 'global' : `workspace:${workspace}`}` }
    },
  }
}

/** @param ctx 认证 Client。@param create 既有固定工具 Client。@param run 本次诊断身份。@returns 自有账号解析与固定页诊断；不新增浏览器 UI。 */
export function createLoginScopeClient(ctx: Context, create: typeof createToolClient, run: string): { account: (sessionId: string, workspace: string) => string, attach: (sessionId: string, request: Mount, target: Target) => void, dispose: () => Promise<void> } {
  const policy = createScopeAccounts(run)
  const accounts = new Map<string, ReturnType<typeof policy.resolve>>()
  const cleanups = new Set<() => Promise<void>>()
  const marker = `dsh_scope_${run}`
  return {
    account(sessionId: string, workspace: string): string {
      const account = policy.resolve(workspace)
      accounts.set(`${sessionId}\0${account.account}`, account)
      return account.account
    },
    attach(sessionId: string, request: Mount, target: Target): void {
      if (request.signal.aborted) {
        return
      }
      let registration: { pageId: string, fixtureUrl: string } | undefined
      let timer: ReturnType<typeof setTimeout> | undefined
      let closing: Promise<void> | undefined
      let shown = false
      let previous = ''
      const lifetime = new AbortController()
      const signal = AbortSignal.any([request.signal, lifetime.signal])
      const client = create({ connection: { rpc: { call: async (channel, endpoint, payload, callSignal) => {
        const result = await ctx.connection.rpc.call(channel, endpoint, payload, callSignal)
        if (endpoint === 'agent-browser-spike/register' && result.ok) {
          registration = result.value as typeof registration
        }
        return result
      } } } })
      function close(): Promise<void> {
        if (closing) {
          return closing
        }
        lifetime.abort()
        clearTimeout(timer)
        request.signal.removeEventListener('abort', abort)
        closing = client.dispose().finally(() => {
          cleanups.delete(close)
        })
        return closing
      }
      function abort(): void {
        void close().catch(() => {})
      }
      request.signal.addEventListener('abort', abort, { once: true })
      cleanups.add(close)
      client.attach(sessionId, request, target)
      async function observe(): Promise<void> {
        try {
          const guest = target.getGuest()
          const account = accounts.get(`${sessionId}\0${target.getAccount()}`)
          if (signal.aborted || !guest || !account || !registration || guest.getURL() !== registration.fixtureUrl) {
            return
          }
          const command = String(await guest.executeJavaScript('document.querySelector(\'#human-input\').value'))
          if (shown && (command === previous || !command.startsWith('scope:'))) {
            previous = command
            return
          }
          previous = command
          const action = command.startsWith('scope:') ? command.slice(6) : 'read'
          if (!['global', 'workspace', 'read', 'write-A', 'write-B', 'write-C', 'clear', 'owners'].includes(action)) {
            return
          }
          shown = true
          if (action === 'global' || action === 'workspace') {
            policy.select(action)
          }
          // 只读写独立新分区中的一个本次测试键；绝不导出完整 cookie 或 storage。
          const operation = action.startsWith('write-')
            ? `localStorage.setItem(key,${JSON.stringify(action.slice(-1))});document.cookie=key+'='+${JSON.stringify(action.slice(-1))}+'; Path=/; SameSite=Lax';`
            : action === 'clear' ? 'localStorage.removeItem(key);document.cookie=key+\'=; Max-Age=0; Path=/; SameSite=Lax\';' : ''
          const value = await guest.executeJavaScript(`(()=>{const key=${JSON.stringify(marker)};${operation}const safe=v=>v===null||/^[A-C]$/.test(v)?v:'unexpected';return {storage:safe(localStorage.getItem(key)),cookie:safe(document.cookie.split('; ').find(v=>v.startsWith(key+'='))?.slice(key.length+1)??null)}})()`)
          const evidence = { sessionId, pageId: registration.pageId, ...account, action, value }
          const result = await ctx.connection.rpc.call('/api', 'login-scope-probe/report', evidence, signal)
          const owners = action === 'owners' ? await ctx.connection.rpc.call('/api', 'login-scope-probe/owners', {}, signal) : undefined
          if (!signal.aborted && guest === target.getGuest() && guest.getURL() === registration.fixtureUrl) {
            const visible = { scope: account.scope, action, value, reportUrl: result.ok ? result.value : undefined, owners: owners?.value }
            await guest.executeJavaScript(`document.querySelector('#identity').textContent=${JSON.stringify(`账号范围验收：${JSON.stringify(visible)}`)};document.querySelector('#human-input').value=''`)
          }
        }
        catch {
          // 保留未知，不把通信失败、未挂载或异常解释为验证通过。
        }
        finally {
          if (!signal.aborted) {
            timer = setTimeout(() => {
              void observe()
            }, 250)
          }
        }
      }
      void observe()
    },
    async dispose(): Promise<void> {
      await Promise.all([...cleanups].map(close => close()))
      accounts.clear()
    },
  }
}
