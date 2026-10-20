/** 真实 Desktop 的一次性诊断：仅在固定测试页人工输入标记后调用既有 ToolRuntime 闭环，不创建浏览器 UI。 */
interface Guest {
  /** 当前自有页面地址，必须与 Host 给出的测试网址完全相同。 */
  getURL: () => string
  /** 只读取固定人工字段或更新测试页的证据文本。 */
  executeJavaScript: (code: string) => Promise<unknown>
}
interface Context {
  /** 当前认证 Client 的正式 RPC，不向 guest 暴露。 */
  connection: { rpc: { call: (channel: string, endpoint: string, payload: unknown, signal?: AbortSignal) => Promise<{ ok: boolean, value?: unknown, error?: { message?: string } }> } }
}
interface Mount {
  /** 官方正文提供的标签页身份。 */
  tabId: string
  /** 关闭标签页时停止诊断和工具 Client。 */
  signal: AbortSignal
}
interface Target {
  /** 仅取得增强实现自己持有的就绪页面。 */
  getGuest: () => Guest | undefined
}
interface Client {
  /** 登记框架绑定的同一页面。 */
  attach: (sessionId: string, request: Mount, target: Target) => void
  /** 插件卸载时停止所有页面诊断。 */
  dispose: () => Promise<void>
}

/**
 * @param ctx 正式认证 Client；仅拦截自己的登记结果以启动诊断。
 * @param createClient 既有固定工具适配工厂，不替换其命令或归属检查。
 * @returns 生命周期绑定的诊断 Client；每个页面最多执行一次闭环。
 */
export function createNativeClient(ctx: Context, createClient: (ctx: Context) => Client): Client {
  const cleanups = new Set<() => Promise<void>>()
  const closedTargets: { guestUnavailable: boolean, hostRejectedClosedTarget: boolean }[] = []
  return {
    attach(sessionId, request, target) {
      if (request.signal.aborted) {
        return
      }
      const lifetime = new AbortController()
      const signal = AbortSignal.any([request.signal, lifetime.signal])
      let registration: { token: string, fixtureUrl: string } | undefined
      let timer: ReturnType<typeof setTimeout> | undefined
      let done = false
      let shownClosed = false
      let closing: Promise<void> | undefined
      const client = createClient({ connection: { rpc: { call: async (channel, endpoint, payload, callSignal) => {
        const result = await ctx.connection.rpc.call(channel, endpoint, payload, callSignal)
        if (endpoint === 'agent-browser-spike/register' && result.ok) {
          registration = result.value as typeof registration
        }
        return result
      } } } })
      async function finishClose(): Promise<void> {
        await client.dispose()
        if (registration) {
          let rejected = false
          try {
            // 先完成 close，再用已撤销凭据做有界负例；异常或超时不能当成拒绝成功。
            const result = await ctx.connection.rpc.call('/api', 'agent-browser-spike/self-test', { token: registration.token }, AbortSignal.timeout(1000))
            rejected = !result.ok && result.error?.message === 'Client 凭据失效'
          }
          catch {}
          closedTargets.push({ guestUnavailable: target.getGuest() === undefined, hostRejectedClosedTarget: rejected })
        }
      }
      function close(): Promise<void> {
        if (closing) {
          return closing
        }
        lifetime.abort()
        clearTimeout(timer)
        request.signal.removeEventListener('abort', abort)
        closing = finishClose().finally(() => {
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
      // 等待人工标记，不自动导航或点击；没有 guest 常驻观察器，轮询随页面/插件撤销。
      const observe = async (): Promise<void> => {
        const guest = target.getGuest()
        try {
          if (signal.aborted || done) {
            return
          }
          if (!shownClosed && closedTargets.length && registration && guest?.getURL() === registration.fixtureUrl) {
            shownClosed = true
            await guest.executeJavaScript(`document.querySelector('#identity').textContent=${JSON.stringify(`官方复用关页核验：${JSON.stringify(closedTargets)}`)}`)
          }
          if (registration && guest?.getURL() === registration.fixtureUrl
            && String(await guest.executeJavaScript('document.querySelector(\'#human-input\').value')).startsWith('人工复用验收')) {
            done = true
            const reply = await ctx.connection.rpc.call('/api', 'agent-browser-spike/self-test', { token: registration.token }, signal)
            const result = reply.value as { driver?: string, results?: { isError: boolean, value?: { pageId: string, documentId: string, count: number, text: string, lastTrusted?: boolean } }[] } | undefined
            const rows = result?.results ?? []
            const values = rows.map(row => row.value)
            const [before, clicked, after] = values
            const passed = reply.ok && rows.length === 3 && rows.every(row => !row.isError)
              && before && clicked && after && before.documentId === clicked.documentId && before.documentId === after.documentId
              && before.pageId === clicked.pageId && before.pageId === after.pageId
              && clicked.count === before.count + 1 && after.count === clicked.count && clicked.lastTrusted === true
            const evidence = { status: passed ? 'passed' : 'failed', source: '真实 Host ToolRuntime.execute；不是模型自主调用', values, closedTargets }
            if (!signal.aborted && target.getGuest() === guest && guest.getURL() === registration.fixtureUrl) {
              await guest.executeJavaScript(`document.querySelector('#identity').textContent=${JSON.stringify(`官方复用原生验收：${JSON.stringify(evidence)}`)}`)
            }
          }
        }
        catch {
          done = true
          // 不把未观察到的结果写成通过，也不输出可能含凭据的原始异常。
          if (!signal.aborted && registration && target.getGuest() === guest && guest?.getURL() === registration.fixtureUrl) {
            await guest.executeJavaScript('document.querySelector(\'#identity\').textContent=\'官方复用原生验收：failed，未取得有效工具结果\'').catch(() => {})
          }
        }
        finally {
          if (!signal.aborted && !done) {
            timer = setTimeout(() => {
              void observe()
            }, 200)
          }
        }
      }
      void observe()
    },
    dispose: async () => {
      await Promise.all([...cleanups].map(close => close()))
    },
  }
}
