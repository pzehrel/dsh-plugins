/**
 * 用 DSH 的侧边栏插槽提供“免选目录”入口；宿主仍为每次点击创建真实 Workspace。
 * 此脚本由 DSH Client Modules 作为经典脚本加载，不使用浏览器端 Node API。
 */
interface ReactModule {
  createElement: (tag: string, props: Record<string, unknown>, ...children: unknown[]) => unknown
  useState: <T>(initial: T) => [T, (next: T) => void]
  useRef: <T>(initial: T) => { current: T }
}

interface ClientContext {
  /** 等待侧边栏插槽声明后注册 UI，并在插件卸载时释放。 */
  slots: {
    inject: (name: string, register: () => () => void) => void
    register: (entry: { name: string, id: string }, component: (props: { wide: boolean }) => unknown) => () => void
  }
  /** 把主视图切换到新创建的 DSH 会话。 */
  uiWorkspace: { openSession: (sessionId: string) => void }
  /** 对宿主新建的会话按原身份接入本浏览器的会话列表。 */
  sessions: { create: (request: { sessionId: string, workspaceId: string }) => Promise<string> }
}

interface CreateResponse {
  /** 创建成功时为 true；失败时消息见 error。 */
  ok: boolean
  /** 此身份由宿主创建，浏览器只进行幂等接入。 */
  sessionId?: string
  /** 会话所属的真实 Workspace，非无工作区会话。 */
  workspaceId?: string
  /** 创建失败的可展示原因。 */
  error?: string
}

interface ModuleLoader {
  load: (entry: {
    id: string
    factory: (require: (name: string) => unknown) => {
      name: string
      inject: string[]
      apply: (ctx: ClientContext) => void
    }
  }) => void
}

;(window as unknown as { __ModuleLoader__: ModuleLoader }).__ModuleLoader__.load({
  id: 'dsh-projectless-session',
  factory: (require) => {
    const React = require('react') as ReactModule
    return {
      name: 'dsh-projectless-session',
      inject: ['slots', 'sessions', 'uiWorkspace'],
      apply: (ctx) => {
        function NewProjectlessSession({ wide }: { wide: boolean }): unknown {
          const [busy, setBusy] = React.useState(false)
          const inFlight = React.useRef(false)
          const [error, setError] = React.useState('')
          const chinese = document.documentElement.lang.toLowerCase().startsWith('zh')
          const label = chinese ? '新建自由会话（自动分配工作区）' : 'New independent chat (automatic workspace)'

          async function createSession(): Promise<void> {
            if (inFlight.current) {
              return
            }
            // React 的状态更新不会阻止同一渲染周期内的第二次点击。
            inFlight.current = true
            setBusy(true)
            setError('')
            try {
              const response = await fetch('/api/dsh-projectless-session/create', { method: 'POST' })
              const data = await response.json() as CreateResponse
              if (!response.ok || data.ok !== true || !data.sessionId || !data.workspaceId) {
                throw new Error(data.error || `HTTP ${response.status}`)
              }
              // 宿主已经创建并附着 Session；显式身份接入保证客户端列表随即可导航。
              const openedId = await ctx.sessions.create({ sessionId: data.sessionId, workspaceId: data.workspaceId })
              if (openedId !== data.sessionId) {
                throw new Error('宿主返回了不同的会话身份')
              }
              ctx.uiWorkspace.openSession(openedId)
            }
            catch (reason) {
              setError(reason instanceof Error ? reason.message : String(reason))
            }
            finally {
              inFlight.current = false
              setBusy(false)
            }
          }

          return React.createElement('div', { style: { display: 'flex', flexDirection: 'column', minWidth: 0 } }, React.createElement('button', {
            'type': 'button',
            'title': label,
            'aria-label': label,
            'disabled': busy,
            'onClick': () => { void createSession() },
            'style': {
              border: 0,
              borderRadius: 8,
              padding: wide ? '8px 10px' : '8px',
              color: 'inherit',
              background: 'transparent',
              cursor: busy ? 'wait' : 'pointer',
            },
          }, wide ? (busy ? (chinese ? '正在创建…' : 'Creating…') : label) : '✦'), error ? React.createElement('span', { role: 'alert', style: { fontSize: 12, padding: 4 } }, error) : null)
        }

        ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register(
          { name: 'sidebar.footer.action', id: 'dsh-projectless-session' },
          NewProjectlessSession,
        ))
      },
    }
  },
})
