/** 截图沿正式工具、Connection 与 Client 运行；仅替换原生 guest 和公开附件存储。 */
import type { ImageAttachmentRef, SaveImageAttachment } from '@deepseek-ai/dsh-attachment'
import type { ToolDefinition, ToolRunContext } from '@deepseek-ai/dsh-tools'
import type { SemanticObservation } from '../src/protocol.js'
import type { ScreenshotObservation } from '../src/screenshot.js'
import { Context } from '@deepseek-ai/cordis'
import { HostConnectionService } from '@deepseek-ai/dsh-client-connection'
import { afterEach, expect, it, vi } from 'vitest'
import { createToolClient } from '../src/fixed-page-client.js'
import { applyFixedPageHost } from '../src/fixed-page-host.js'

const cleanups: (() => Promise<unknown>)[] = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) {
    await cleanup()
  }
})

/**
 * @param options 外部存储与guest故障注入。
 * @param options.privateUrl 使用带自有测试口令的URL验证输出剔除，默认false。
 * @param options.saveImage 可选的宿主保存服务，默认立即返回自有图片引用。
 * @param options.sensitive 是否模拟可识别敏感输入，默认false。
 * @param options.capture 可选的原生捕获延迟。
 * @param options.missingStore 模拟缺失公开图片存储，默认false。
 * @param options.missingCapture 模拟缺失公开capturePage方法，默认false。
 * @returns 真实工具/Client组合，不创建独立页面控制器。
 */
async function setup(options: { saveImage?: (input: SaveImageAttachment) => Promise<ImageAttachmentRef>, sensitive?: boolean, capture?: () => Promise<{ toDataURL: () => string }>, missingCapture?: boolean, missingStore?: boolean, privateUrl?: boolean } = {}) {
  const stored: SaveImageAttachment[] = []
  let tool!: ToolDefinition
  let fixtureUrl = ''
  let pageId = ''
  let captures = 0
  let documentId = '截图文档甲'
  const effects: (() => unknown)[] = []
  const connection = new HostConnectionService(new Context(), [], {} as ConstructorParameters<typeof HostConnectionService>[2])
  const attachment = { attachmentId: '1'.repeat(64), mediaType: 'image/png', bytes: 3, width: 1, height: 1 } as ImageAttachmentRef
  await applyFixedPageHost({ connection, attachments: options.missingStore
    ? undefined
    : { saveImage: options.saveImage ?? (async (input) => {
        stored.push(input)
        return attachment
      }) }, tools: { register: (definition) => {
    tool = definition
    return () => {}
  } }, effect: effect => effects.push(effect() as () => unknown) }, 'agent-browser')
  cleanups.push(async () => {
    for (const effect of effects.reverse()) {
      await effect()
    }
  })
  const handler = connection.createSharedFetchHandler('/api')
  const client = createToolClient({ connection: { rpc: { call: async (_channel, endpoint, payload, signal) => {
    const response = await handler.fetch(new Request(`http://127.0.0.1/api/${endpoint}`, { method: 'POST', signal, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ type: 'client-request', rpcId: crypto.randomUUID(), method: endpoint, payload }) }))
    const reply = (await response.json()).result
    if (endpoint.endsWith('/register')) {
      if (options.privateUrl) {
        const privateUrl = new URL(reply.value.fixtureUrl)
        privateUrl.username = 'screenshot-user-secret'
        privateUrl.password = 'screenshot-password-secret'
        privateUrl.search = '?token=screenshot-query-secret'
        privateUrl.hash = 'screenshot-fragment-secret'
        reply.value.fixtureUrl = privateUrl.href
      }
      fixtureUrl = reply.value.fixtureUrl
      pageId = reply.value.pageId
    }
    return reply
  } } } }, 'agent-browser')
  cleanups.push(async () => client.dispose())
  const guest = Object.assign(new EventTarget(), {
    getURL: () => fixtureUrl,
    executeJavaScript: async (code: string) => code.includes('const elements=[]')
      ? { documentId, url: fixtureUrl, title: '截图组合页', text: '自有截图可见文字', truncated: false, viewport: [0, 0, 800, 600], elements: [{ nodeId: '组合节点', role: 'button', name: '增加', disabled: false, rect: [10, 20, 100, 40], hit: true }] }
      : code.includes('querySelectorAll') ? { sensitive: !!options.sensitive, frames: false } : documentId,
    sendInputEvent: async () => {},
    capturePage: options.missingCapture
      ? undefined
      : async () => {
        captures++
        return options.capture?.() ?? { toDataURL: () => 'data:image/png;base64,AQID' }
      },
  })
  client.attach('截图会话甲', { tabId: '截图页甲', signal: new AbortController().signal }, { getGuest: () => guest })
  await vi.waitFor(() => expect(fixtureUrl).not.toBe(''))
  const exec = { agent: { session: { header: { id: '截图会话甲' } } }, signal: new AbortController().signal } as ToolRunContext
  return { run: (action = 'screenshot', reference?: string) => tool.execute({ action, pageId, ...(reference === undefined ? {} : { reference }) }, exec), tool, client, stored, attachment, captured: () => captures, navigate: (keepMarker = false) => {
    if (!keepMarker) {
      documentId = '截图文档乙'
    }
    guest.dispatchEvent(new Event('did-navigate-in-page'))
  } }
}

it('截图只保存同一共享页的像素，以正式图片附件和页面文档关联交付，并提示信息暴露限制', async () => {
  const scenario = await setup({ privateUrl: true })
  const value = await scenario.run()
  expect(value).toMatchObject({ documentId: expect.any(String), attachment: scenario.attachment, exposureWarning: expect.stringContaining('全部可见像素') })
  expect(value).not.toMatchObject({ documentId: '截图文档甲' })
  expect(scenario.stored.map(input => ({ ...input, data: [...input.data] }))).toEqual([{ data: [1, 2, 3], mediaType: 'image/png', name: 'agent-browser-screenshot.png' }])
  expect(JSON.stringify(value)).not.toContain('secret')
  expect(scenario.captured()).toBe(1)
  expect(scenario.tool.output.render({ action: 'screenshot' }, value)).toContainEqual({ type: 'image', attachment: scenario.attachment })
})

it('附件保存期间发生导航时，不把旧文档截图交付给当前请求', async () => {
  let finish!: (ref: ImageAttachmentRef) => void
  let saving = false
  const scenario = await setup({ saveImage: async () => {
    saving = true
    return new Promise((resolve) => {
      finish = resolve
    })
  } })
  const result = scenario.run().catch(error => error)
  await vi.waitFor(() => expect(saving).toBe(true))
  scenario.navigate()
  finish(scenario.attachment)
  expect(await result).toBeInstanceOf(Error)
})

it('截图与语义观察使用同一Client私有文档身份，导航即使保留网页标记也拒绝旧引用', async () => {
  const scenario = await setup()
  const observation = await scenario.run('observe') as SemanticObservation
  const image = await scenario.run() as ScreenshotObservation
  expect(image.documentId).toBe(observation.documentId)
  expect(image.documentId).not.toBe('截图文档甲')
  scenario.navigate(true)
  await expect(scenario.run('resolve', observation.elements[0]!.reference)).rejects.toThrow('引用失效')
  const fresh = await scenario.run('observe') as SemanticObservation
  expect(fresh.documentId).not.toBe(image.documentId)
})

it('附件保存期间同文档导航保留网页标记时，仍按私有代次拒绝旧图', async () => {
  let finish!: (ref: ImageAttachmentRef) => void
  let saving = false
  const scenario = await setup({ saveImage: async () => {
    saving = true
    return new Promise((resolve) => {
      finish = resolve
    })
  } })
  const result = scenario.run().catch(error => error)
  await vi.waitFor(() => expect(saving).toBe(true))
  scenario.navigate(true)
  finish(scenario.attachment)
  expect(await result).toBeInstanceOf(Error)
})

it('接管等待已开始附件保存结算，不交付迟到截图；已接管时不再捕获或保存', async () => {
  let finish!: (ref: ImageAttachmentRef) => void
  let saves = 0
  const scenario = await setup({ saveImage: async () => {
    saves++
    return new Promise((resolve) => {
      finish = resolve
    })
  } })
  const result = scenario.run().catch(error => error)
  await vi.waitFor(() => expect(saves).toBe(1))
  let taken = false
  const taking = scenario.client.takeover('截图会话甲', '截图页甲').then(() => {
    taken = true
  })
  await vi.waitFor(() => expect(scenario.client.status('截图会话甲', '截图页甲').getSnapshot()).toBe('pausing'))
  expect(taken).toBe(false)
  finish(scenario.attachment)
  await taking
  expect(await result).toMatchObject({ code: 'cancelled' })
  expect(scenario.client.status('截图会话甲', '截图页甲').getSnapshot()).toBe('paused')
  await expect(scenario.run()).rejects.toThrow('人工接管')
  expect(scenario.captured()).toBe(1)
  expect(saves).toBe(1)
})

it('可识别敏感字段直接拒绝截图，不把过滤后的DOM等同于安全像素', async () => {
  const scenario = await setup({ sensitive: true })
  await expect(scenario.run()).rejects.toThrow('[agent-browser/screenshot-sensitive]')
  expect(scenario.captured()).toBe(0)
  expect(scenario.stored).toEqual([])
})

it('已开始原生捕获在接管后才返回时，不持久化、不补发，并等待结算再确认已接管', async () => {
  let finish!: (image: { toDataURL: () => string }) => void
  const scenario = await setup({ capture: () => new Promise((resolve) => {
    finish = resolve
  }) })
  const result = scenario.run().catch(error => error)
  await vi.waitFor(() => expect(scenario.captured()).toBe(1))
  const taking = scenario.client.takeover('截图会话甲', '截图页甲')
  expect(scenario.client.status('截图会话甲', '截图页甲').getSnapshot()).toBe('pausing')
  finish({ toDataURL: () => 'data:image/png;base64,AQID' })
  await taking
  expect(await result).toMatchObject({ code: 'cancelled' })
  expect(scenario.stored).toEqual([])
})

it('缺少公开capturePage时说明具体能力缺口，不回退其他页面或旧图片', async () => {
  const scenario = await setup({ missingCapture: true })
  await expect(scenario.run()).rejects.toThrow('capturePage')
  expect(scenario.captured()).toBe(0)
  expect(scenario.stored).toEqual([])
})

it('公开图片存储不可用时明确报告，不伪造附件引用或成功结果', async () => {
  const scenario = await setup({ missingStore: true })
  await expect(scenario.run()).rejects.toThrow('attachments.saveImage')
  expect(scenario.stored).toEqual([])
})

it('关闭等待已发出附件保存结算，旧页面不交付并保持已撤销', async () => {
  let finish!: (ref: ImageAttachmentRef) => void
  let saving = false
  const scenario = await setup({ saveImage: async () => {
    saving = true
    return new Promise((resolve) => {
      finish = resolve
    })
  } })
  const result = scenario.run().catch(error => error)
  await vi.waitFor(() => expect(saving).toBe(true))
  let closed = false
  const closing = scenario.client.dispose().then(() => {
    closed = true
  })
  await Promise.resolve()
  expect(closed).toBe(false)
  finish(scenario.attachment)
  await closing
  expect(await result).toMatchObject({ code: 'closed' })
  expect(scenario.client.status('截图会话甲', '截图页甲').getSnapshot()).toBe('closed')
  await expect(scenario.run()).rejects.toThrow('页面已关闭')
})
