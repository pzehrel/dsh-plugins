/** 真实固定感知脚本在外部guest VM最小DOM中运行；不重写感知/引用逻辑，也不代表原生DOM验收。 */
import type { ToolDefinition, ToolRunContext } from '@deepseek-ai/dsh-tools'
import type { SemanticObservation } from '../src/protocol.js'
import { createContext, runInContext } from 'node:vm'
import { Context } from '@deepseek-ai/cordis'
import { HostConnectionService } from '@deepseek-ai/dsh-client-connection'
import { expect, it, vi } from 'vitest'
import { createToolClient } from '../src/fixed-page-client.js'
import { applyFixedPageHost } from '../src/fixed-page-host.js'

/** 仅实现本组可见、非敏感DOM数据所需的公开形状；不包含过滤或身份算法。 */
class Element {
  attributes: Record<string, string> = {}
  tabIndex = -1
  disabled = false
  constructor(readonly tagName: string) {}
  getAttribute(name: string): string | null { return this.attributes[name] ?? null }
  hasAttribute(name: string): boolean { return name in this.attributes }
  closest(): null { return null }
  getClientRects(): object[] { return [this.getBoundingClientRect()] }
  getBoundingClientRect() { return { x: 10, y: 20, width: 100, height: 40, left: 10, top: 20, right: 110, bottom: 60 } }
  contains(node: object): boolean { return node === this }
}

/** @param textNodes 自有可见容器中的短文本节点数量。@returns 真实Host/Connection/Client及执行固定脚本的VM guest。 */
async function setup(textNodes = 1) {
  const body = new Element('BODY')
  let button = new Element('BUTTON')
  button.attributes['aria-label'] = '同名目标'
  const document = {
    documentElement: new Element('HTML'),
    body,
    title: '自有VM主文档',
    querySelectorAll: () => [body, button],
    getElementById: () => null,
    elementFromPoint: () => button,
    createTreeWalker: (element: object) => {
      const nodes = element === body ? Array.from({ length: textNodes }, () => ({ textContent: 'x', parentElement: body })) : []
      let index = 0
      return { nextNode: () => nodes[index++] ?? null }
    },
  }
  // 网页可以把自身主世界随机API改成常量；不修改Client或Host的真实crypto。
  const guestCrypto = { getRandomValues: (bytes: Uint8Array) => bytes.fill(0) }
  const vm = createContext({ document, crypto: guestCrypto, URL, NodeFilter: { SHOW_TEXT: 4 }, getComputedStyle: () => ({ display: 'block', visibility: 'visible', opacity: '1' }), location: { href: 'https://controlled.invalid/dom' }, scrollX: 0, scrollY: 0, innerWidth: 800, innerHeight: 600 })
  const guest = Object.assign(new EventTarget(), { getURL: () => 'https://controlled.invalid/dom', executeJavaScript: async (code: string) => runInContext(code, vm, { timeout: 1000 }), sendInputEvent: async () => {} })
  const connection = new HostConnectionService(new Context(), [], {} as ConstructorParameters<typeof HostConnectionService>[2])
  const effects: (() => unknown)[] = []
  let tool!: ToolDefinition
  await applyFixedPageHost({ connection, tools: { register: (definition) => {
    tool = definition
    return () => {}
  } }, effect: setup => effects.push(setup() as () => unknown) }, 'agent-browser')
  const handler = connection.createSharedFetchHandler('/api')
  let pageId = ''
  const client = createToolClient({ connection: { rpc: { call: async (_channel, endpoint, payload, signal) => {
    const response = await handler.fetch(new Request(`http://127.0.0.1/api/${endpoint}`, { method: 'POST', signal, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ type: 'client-request', rpcId: crypto.randomUUID(), method: endpoint, payload }) }))
    const reply = (await response.json()).result
    if (endpoint.endsWith('/register') && reply.ok) {
      pageId = reply.value.pageId
    }
    return reply
  } } } }, 'agent-browser')
  client.attach('会话DOM', { tabId: '页DOM', signal: new AbortController().signal }, { getGuest: () => guest })
  await vi.waitFor(() => expect(pageId).not.toBe(''))
  const exec = { agent: { session: { header: { id: '会话DOM' } } }, signal: new AbortController().signal } as ToolRunContext
  return { run: (action: string, reference?: string) => tool.execute({ action, pageId, ...(reference === undefined ? {} : { reference }) }, exec), cloneTarget: () => {
    // 模拟网页复制旧节点全部公开字符串/Symbol属性，保持语义与几何完全相同。
    const clone = new Element('BUTTON')
    Object.defineProperties(clone, Object.getOwnPropertyDescriptors(button))
    button = clone
  }, close: async () => {
    await client.dispose()
    for (const dispose of effects.reverse()) {
      await dispose()
    }
  } }
}

it('5001个短文本节点触发固定脚本遍历预算时明确truncated，不冒充完整观察', async () => {
  const scenario = await setup(5001)
  try {
    const result = await scenario.run('observe') as SemanticObservation
    expect(result.text.length).toBeLessThan(20000)
    expect(result.elements).toHaveLength(1)
    expect(result.truncated).toBe(true)
  }
  finally {
    await scenario.close()
  }
})

it('同文档克隆复制所有公开Symbol属性后，旧引用仍拒绝重新绑定新节点', async () => {
  const scenario = await setup()
  try {
    const observation = await scenario.run('observe') as SemanticObservation
    const reference = observation.elements[0]!.reference
    await expect(scenario.run('resolve', reference)).resolves.toMatchObject({ kind: 'resolved' })
    scenario.cloneTarget()
    await expect(scenario.run('resolve', reference)).rejects.toThrow('引用失效')
  }
  finally {
    await scenario.close()
  }
})
