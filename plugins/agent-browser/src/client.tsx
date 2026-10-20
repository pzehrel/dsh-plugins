import type { ReactNode } from 'react'
import type { Command, Observation } from './protocol.js'
/** 原生共享页面实验 Client：仅持有自建 guest，通过正式 RPC 执行固定测试动作。 */
import { createElement as h, useEffect, useRef, useState } from 'react'
/** 只消费 Electron 文档公开的 webview 方法，不持有宿主私有对象。 */
interface Guest extends HTMLElement {
  /** 主文档已经加载的真实地址。 */
  getURL: () => string
  /** 导航至本插件唯一可控测试地址。 */
  loadURL: (url: string) => Promise<void>
  /** 在 guest 中执行固定且审查过的页面逻辑。 */
  executeJavaScript: (code: string) => Promise<unknown>
  /** 向 guest 派发原生键鼠事件，不移动系统鼠标。 */
  sendInputEvent: (event: object) => Promise<void>
}
interface DesktopBridge {
  /** 申请自有页面身份与宿主批准的分区。 */
  acquire: (workspace: string) => Promise<{
    lease: string
    partition: string
  }>
  /** 销毁对应原生 guest。 */
  release: (lease: string) => Promise<void>
}
interface ClientContext {
  /** 当前认证 Client 的正式 RPC caller。 */
  connection: {
    rpc: {
      call: (channel: string, endpoint: string, payload: unknown, signal?: AbortSignal) => Promise<{
        ok: boolean
        value?: unknown
        error?: {
          message?: string
        }
      }>
    }
  }
  /** 正式 Sidebar 页类型注册。 */
  sidebarRightTabs: {
    register: (definition: object) => () => void
  }
  /** 正式正文 Slot 注册和延迟注入。 */
  slots: {
    inject: (name: string, callback: () => unknown) => () => void
    register: (definition: object, component: (props: {
      sessionId: string
    }) => ReactNode) => () => void
  }
  /** 生命周期绑定。 */
  effect: (effect: () => unknown) => unknown
}
export const inject = ['connection', 'sidebarRightTabs', 'slots']
const kind = 'agent-browser-spike'
const id = 'dsh-plugin-agent-browser-spike'
const snapshotScript = `(()=>({documentId:document.body.dataset.spikeDocument,count:Number(document.querySelector('#count').textContent),text:document.querySelector('#human-input').value.slice(0,200),lastTrusted:window.spikeLastTrusted===true}))()`
/** @param ctx 已认证的官方 Client 服务。注册独立实验页，不接管原内置浏览器或已有页面。 */
export function apply(ctx: ClientContext): void {
  /** @param method 固定实验 endpoint。@param payload 插件自己生成的消息。@param signal Client 生命周期取消。@returns Host 成功值，任何载体或业务拒绝均抛错。 */
  async function rpc(method: string, payload: object, signal?: AbortSignal): Promise<unknown> {
    const result = await ctx.connection.rpc.call('/api', `agent-browser-spike/${method}`, payload, signal)
    if (!result.ok) {
      throw new Error(result.error?.message ?? 'Host 通信失败')
    }
    return result.value
  }
  /**
   * @param props 框架提供的会话绑定，不能以当前屏幕选择或网页参数替代。
   * @param props.sessionId 当前正文所属真实会话。
   * @returns 独立实验控制栏与原生页面容器。
   */
  function Body(props: {
    sessionId: string
  }): ReactNode {
    const container = useRef<HTMLDivElement>(null)
    const control = useRef<{
      token: string
      paused: boolean
      busy: boolean
    } | null>(null)
    const [status, setStatus] = useState('正在挂载原生测试页')
    const [pageId, setPageId] = useState('')
    const [paused, setPaused] = useState(false)
    const [evidence, setEvidence] = useState('')
    useEffect(() => {
      const lifetime = new AbortController()
      let lease: string | undefined
      let token: string | undefined
      let timer: ReturnType<typeof setTimeout> | undefined
      let guest: Guest | undefined
      const signal = lifetime.signal
      const bridge = (globalThis as unknown as {
        dshDesktop?: {
          browser?: DesktopBridge
        }
      }).dshDesktop?.browser
      if (!bridge) {
        setStatus('当前不是具有公开 Browser bridge 的官方 Desktop；不降级为 iframe')
        return
      }
      const box = container.current!
      const start = async (): Promise<void> => {
        const page = await rpc('register', { sessionId: props.sessionId }, signal) as {
          token: string
          pageId: string
          fixtureUrl: string
        }
        token = page.token
        if (signal.aborted) {
          await rpc('close', { token })
          return
        }
        setPageId(page.pageId)
        control.current = { token, paused: false, busy: false }
        const reservation = await bridge.acquire(`agent-browser-spike:${props.sessionId}`)
        lease = reservation.lease
        if (signal.aborted) {
          await bridge.release(lease)
          return
        }
        guest = document.createElement('webview') as Guest
        guest.setAttribute('name', lease)
        guest.setAttribute('partition', reservation.partition)
        guest.setAttribute('src', `about:blank#${lease}`)
        guest.style.cssText = 'display:flex;width:100%;height:100%;min-height:360px'
        await new Promise<void>((resolve, reject) => {
          const fail = (): void => reject(new Error('Client 挂载已取消'))
          signal.addEventListener('abort', fail, { once: true })
          guest!.addEventListener('dom-ready', () => {
            signal.removeEventListener('abort', fail)
            resolve()
          }, { once: true })
          box.append(guest!)
        })
        await guest.loadURL(page.fixtureUrl)
        setStatus('原生测试页已就绪；先人工修改内容，再运行工具闭环')
        // 只在父 Client 调度，不向 guest 注入观察器、持续采集、Host API 或 Node 能力。
        const poll = async (): Promise<void> => {
          if (signal.aborted) {
            return
          }
          const state = control.current
          if (!state) {
            return
          }
          let command: Command | null = null
          try {
            command = await rpc('poll', { token }, signal) as Command | null
            if (command) {
              state.busy = true
              if (state.paused || guest!.getURL() !== page.fixtureUrl || !await rpc('permit', { token, command }, signal)) {
                throw new Error('请求已失效、页面变化或人工接管')
              }
              if (command.action === 'click') {
                const target = await guest!.executeJavaScript(`(()=>{const e=document.querySelector('#bump');const b=e.getBoundingClientRect();const x=b.x+b.width/2,y=b.y+b.height/2;if(document.elementFromPoint(x,y)!==e)throw Error('目标被遮挡');return {x,y,documentId:document.body.dataset.spikeDocument}})()`) as {
                  x: number
                  y: number
                  documentId: string
                }
                if (state.paused || !await rpc('permit', { token, command }, signal)) {
                  throw new Error('点击前请求已失效')
                }
                const fresh = await guest!.executeJavaScript('document.body.dataset.spikeDocument')
                if (fresh !== target.documentId) {
                  throw new Error('文档变化，不能使用旧目标')
                }
                await guest!.sendInputEvent({ type: 'mouseDown', x: Math.round(target.x), y: Math.round(target.y), button: 'left', clickCount: 1 })
                await guest!.sendInputEvent({ type: 'mouseUp', x: Math.round(target.x), y: Math.round(target.y), button: 'left', clickCount: 1 })
              }
              if (state.paused || signal.aborted) {
                throw new Error('接管后不采集结果')
              }
              const observation = await guest!.executeJavaScript(snapshotScript) as Observation
              if (state.paused || signal.aborted) {
                throw new Error('接管后丢弃迟到结果')
              }
              await rpc('complete', { token, id: command.id, value: observation }, signal)
              setStatus(`工具 ${command.action} 已返回；当前计数 ${observation.count}`)
            }
          }
          catch (error) {
            if (command && !signal.aborted) {
              await rpc('fail', { token, id: command.id, message: error instanceof Error ? error.message : String(error) }, signal).catch(() => {
              })
            }
            if (!signal.aborted) {
              setStatus(error instanceof Error ? error.message : String(error))
            }
          }
          finally {
            state.busy = false
            if (!signal.aborted) {
              timer = setTimeout(poll, 300)
            }
          }
        }
        void poll()
      }
      void start().catch((error) => {
        if (!signal.aborted) {
          setStatus(String(error))
        }
      })
      return () => {
        lifetime.abort()
        clearTimeout(timer)
        control.current = null
        guest?.remove()
        if (token) {
          void rpc('close', { token }).catch(() => {
          })
        }
        if (lease) {
          void bridge.release(lease).catch(() => {
          })
        }
      }
    }, [props.sessionId])
    /** 先阻止 Client 新读写，再撤销 Host 在途请求；无常驻 guest 观察器，结果不会跨接管代次补发。 */
    async function togglePause(): Promise<void> {
      const state = control.current
      if (!state) {
        return
      }
      const target = !state.paused
      state.paused = true
      setStatus('正在建立暂停屏障')
      try {
        await rpc('pause', { token: state.token, paused: target })
        // 等待已经调用的公开方法停止；不能把按钮颜色视作屏障成立。
        while (state.busy) {
          await new Promise(resolve => setTimeout(resolve, 20))
        }
        state.paused = target
        setPaused(target)
        setStatus(target ? '人工接管已生效；固定工具的读取和操作均暂停' : '已交回；下一次工具请求重新观察')
      }
      catch (error) {
        setStatus(`暂停切换失败，保持本地暂停：${String(error)}`)
      }
    }
    return h('div', { style: { display: 'flex', flexDirection: 'column', height: '100%', minHeight: 420, padding: 8 } }, h('strong', null, 'Agent 浏览器：纯插件实验（Fetch v2）'), h('p', { style: { fontSize: 12, overflowWrap: 'anywhere' } }, `页面：${pageId || '未就绪'}；会话：${props.sessionId}`), h('div', null, h('button', { onClick: () => {
      void togglePause()
    }, disabled: !pageId }, paused ? '交回 Agent' : '人工接管'), h('button', { disabled: !pageId, onClick: async () => {
      try {
        setEvidence(JSON.stringify(await rpc('self-test', { token: control.current!.token }), null, 2))
      }
      catch (error) {
        setEvidence(String(error))
      }
    } }, '运行工具闭环')), h('p', { role: 'status', style: { fontSize: 12 } }, status), h('div', { ref: container, style: { flex: 1, minHeight: 360 } }), evidence ? h('pre', { style: { maxHeight: 180, overflow: 'auto', fontSize: 11 } }, evidence) : null)
  }
  ctx.effect(() => ctx.sidebarRightTabs.register({ id, kind, title: () => 'Agent 浏览器实验', priority: 'extension', keepMounted: true, guide: [{ id: 'new', title: () => 'Agent 浏览器实验', description: () => '仅本机测试页，不访问真实网站' }] }))
  ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({ name: 'sidebar.right.pane.tab', key: id }, Body)))
}
