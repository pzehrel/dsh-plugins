/** 上传选择沿用真实工具、认证Connection与Client；仅替换正式审批及原生guest外部边界。 */
import type { ToolDefinition, ToolRunContext } from '@deepseek-ai/dsh-tools'
import { createHash } from 'node:crypto'
import { runInNewContext } from 'node:vm'
import { Context } from '@deepseek-ai/cordis'
import { HostConnectionService } from '@deepseek-ai/dsh-client-connection'
import { expect, it, vi } from 'vitest'
import { createToolClient } from '../src/fixed-page-client.js'
import { applyFixedPageHost } from '../src/fixed-page-host.js'

it('文件选择发出后取消工具仍持有真实picker等待，可信结算前不确认接管且不追加文件采集', async () => {
  const s = await uploadScenario()
  let returned = false
  try {
    const observation = await s.call({ action: 'observe' }) as {
      elements: {
        reference: string
      }[]
    }
    const cancellation = new AbortController()
    const choosing = s.call({ action: 'choose-file', reference: observation.elements[0]!.reference }, cancellation.signal).catch(error => error).finally(() => {
      returned = true
    })
    await s.waitForPicker(choosing)
    cancellation.abort()
    let paused = false
    const takeover = s.client.takeover('上传会话', '上传页').then(() => {
      paused = true
    })
    await new Promise(resolve => setTimeout(resolve, 40))
    expect(returned).toBe(false)
    expect(paused).toBe(false)
    expect(s.questions).toHaveLength(1)
    expect(s.questions[0]).toContain('https://upload.invalid/form')
    expect(s.questions[0]).toContain('选择即允许网站读取')
    s.finish('cancelled')
    await takeover
    expect(await choosing).toMatchObject({ code: 'unknown', outcome: 'unknown' })
    expect(s.client.status('上传会话', '上传页').getSnapshot()).toBe('paused')
    expect(s.metadataReads()).toBe(0)
  }
  finally {
    s.finish('cancelled')
    await s.close()
  }
})
it('原生选择结算后才采集该文件的确切metadata和完整内容摘要，结果只标selected', async () => {
  const s = await uploadScenario()
  try {
    const observation = await s.call({ action: 'observe' }) as {
      elements: {
        reference: string
      }[]
    }
    const choosing = s.call({ action: 'choose-file', reference: observation.elements[0]!.reference })
    await s.waitForPicker(choosing)
    expect(s.metadataReads()).toBe(0)
    s.finish('selected')
    const result = await choosing as {
      kind: string
      status: string
      selectionId: string
      file: unknown
    }
    expect(result).toMatchObject({ kind: 'file-choice', status: 'selected', file: { name: 'fixture.txt', size: 3, lastModified: 1, sha256: 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad' } })
    expect(result.selectionId).toMatch(/^[a-f0-9-]{36}$/u)
    expect(result.file).not.toHaveProperty('fileId')
    expect(s.metadataReads()).toBe(1)
  }
  finally {
    s.finish('cancelled')
    await s.close()
  }
})
it('确切选择身份与文件内容绑定后原生提交标准表单，仍只报告事件issued', async () => {
  const s = await uploadScenario()
  try {
    const first = await s.call({ action: 'observe' }) as { elements: { reference: string }[] }
    const choosing = s.call({ action: 'choose-file', reference: first.elements[0]!.reference })
    await s.waitForPicker(choosing)
    s.finish('selected')
    const selected = await choosing as { selectionId: string }
    s.showSubmit()
    const next = await s.call({ action: 'observe' }) as { elements: { reference: string }[] }
    expect(await s.call({ action: 'upload-submit', reference: next.elements[1]!.reference, selectionId: selected.selectionId })).toMatchObject({ kind: 'input', action: 'upload-submit', status: 'issued' })
    expect(s.events).toEqual([{ type: 'mouseDown', x: 60, y: 140, button: 'left', clickCount: 1 }, { type: 'mouseUp', x: 60, y: 140, button: 'left', clickCount: 1 }])
    expect(s.questions).toHaveLength(2)
    expect(s.questions[1]).toContain('fixture.txt')
    expect(s.questions[1]).toContain('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
  }
  finally {
    s.finish('cancelled')
    await s.close()
  }
})

it('获准选择捕获不可变内容副本，本地文件随后修改不改变该已明确批准副本的原生提交字节', async () => {
  const s = await uploadScenario()
  try {
    const first = await s.call({ action: 'observe' }) as { elements: { reference: string }[] }
    const choosing = s.call({ action: 'choose-file', reference: first.elements[0]!.reference })
    await s.waitForPicker(choosing)
    s.finish('selected')
    const selected = await choosing as { selectionId: string, file: { contentSource: string, capturedAt: number } }
    expect(selected.file.contentSource).toBe('immutable-copy')
    expect(selected.file.capturedAt).toBeGreaterThan(0)
    s.changeOriginal('xyz')
    s.showSubmit()
    const next = await s.call({ action: 'observe' }) as { elements: { reference: string }[] }
    await expect(s.call({ action: 'upload-submit', reference: next.elements[1]!.reference, selectionId: selected.selectionId })).resolves.toMatchObject({ status: 'issued' })
    expect(s.receivedHashes).toEqual(['ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'])
    expect(s.questions[1]).toContain('immutable-copy')
    expect(s.questions[1]).toMatch(/capturedAtText[^\n\rT\u2028\u2029]*T.*UTC/u)
  }
  finally {
    s.finish('cancelled')
    await s.close()
  }
})

it('拒绝首审批不打开OS选择器；非可信网页change不能结算原生选择', async () => {
  const s = await uploadScenario()
  try {
    const first = await s.call({ action: 'observe' }) as { elements: { reference: string }[] }
    s.rejectNext()
    await expect(s.call({ action: 'choose-file', reference: first.elements[0]!.reference })).rejects.toThrow('rejected')
    expect(s.pickerStarted()).toBe(false)
    const fresh = await s.call({ action: 'observe' }) as { elements: { reference: string }[] }
    let returned = false
    const choosing = s.call({ action: 'choose-file', reference: fresh.elements[0]!.reference }).catch(error => error).finally(() => {
      returned = true
    })
    await s.waitForPicker(choosing)
    s.finish('selected', false)
    await new Promise(resolve => setTimeout(resolve, 30))
    expect(returned).toBe(false)
    expect(s.metadataReads()).toBe(0)
    s.finish('cancelled')
    await expect(choosing).resolves.toMatchObject({ kind: 'file-choice', status: 'cancelled' })
  }
  finally {
    s.finish('cancelled')
    await s.close()
  }
})

it.each(['file', 'form', 'form-owner'] as const)('上传批准后%s发生变化即拒绝发送，旧选择身份不能重试', async (change) => {
  const s = await uploadScenario()
  try {
    const first = await s.call({ action: 'observe' }) as { elements: { reference: string }[] }
    const choosing = s.call({ action: 'choose-file', reference: first.elements[0]!.reference })
    await s.waitForPicker(choosing)
    s.finish('selected')
    const selected = await choosing as { selectionId: string }
    s.showSubmit()
    const next = await s.call({ action: 'observe' }) as { elements: { reference: string }[] }
    s.onApproval(() => s.changeBinding(change))
    await expect(s.call({ action: 'upload-submit', reference: next.elements[1]!.reference, selectionId: selected.selectionId })).rejects.toBeDefined()
    expect(s.events).toEqual([])
    const fresh = await s.call({ action: 'observe' }) as { elements: { reference: string }[] }
    await expect(s.call({ action: 'upload-submit', reference: fresh.elements[1]!.reference, selectionId: selected.selectionId })).rejects.toBeDefined()
    expect(s.events).toEqual([])
    expect(s.questions).toHaveLength(2)
  }
  finally {
    s.finish('cancelled')
    await s.close()
  }
})

it('上传form未选文件时可先原生填写普通说明；填好后仍不能普通点击文件或绕行提交', async () => {
  const s = await uploadScenario()
  try {
    s.showOrdinary()
    const first = await s.call({ action: 'observe' }) as { elements: { reference: string }[] }
    await expect(s.call({ action: 'fill', reference: first.elements[1]!.reference, text: '人工批准的上传说明' })).resolves.toMatchObject({ action: 'fill', status: 'issued' })
    expect(s.ordinaryValue()).toBe('人工批准的上传说明')
    const next = await s.call({ action: 'observe' }) as { elements: { reference: string }[] }
    await expect(s.call({ action: 'click-element', reference: next.elements[0]!.reference })).rejects.toBeDefined()
    expect(s.pickerStarted()).toBe(false)
  }
  finally {
    s.finish('cancelled')
    await s.close()
  }
})

it('原生读取拒绝经远程桥接泛化后仍给清晰unknown，不安装内容副本或自动提交', async () => {
  const s = await uploadScenario()
  try {
    const first = await s.call({ action: 'observe' }) as { elements: { reference: string }[] }
    const choosing = s.call({ action: 'choose-file', reference: first.elements[0]!.reference }).catch(error => error)
    await s.waitForPicker(choosing)
    s.rejectRead()
    s.finish('selected')
    const error = await choosing
    expect(error).toMatchObject({ code: 'unknown', outcome: 'unknown' })
    expect(String(error)).toContain('文件内容读取失败')
    expect(String(error)).toContain('网站可能已读取或自动发送')
    expect(String(error)).toContain('未建立可提交内容副本')
    expect(String(error)).toContain('重新核对文件并授权')
    expect(String(error)).toContain('禁止自动重试')
    expect(String(error)).not.toContain('private-source-path')
    expect(error).not.toHaveProperty('selectionId')
    expect(s.installs()).toBe(0)
    expect(s.events).toEqual([])
    expect(s.receivedHashes).toEqual([])
    expect(s.metadataReads()).toBe(1)
    expect(s.questions).toHaveLength(1)
  }
  finally {
    s.finish('cancelled')
    await s.close()
  }
})

it('捕获前目标检查异常仍拒绝，不被误归类为文件读取拒绝', async () => {
  const s = await uploadScenario()
  try {
    const first = await s.call({ action: 'observe' }) as { elements: { reference: string }[] }
    const choosing = s.call({ action: 'choose-file', reference: first.elements[0]!.reference }).catch(error => error)
    await s.waitForPicker(choosing)
    s.invalidateCaptureTarget()
    s.finish('selected')
    const error = await choosing
    expect(error).toMatchObject({ code: 'unknown', outcome: 'unknown' })
    expect(String(error)).toContain('GUEST_VIEW_MANAGER_CALL')
    expect(String(error)).not.toContain('文件内容读取失败')
    expect(s.installs()).toBe(0)
    expect(s.events).toEqual([])
  }
  finally {
    s.finish('cancelled')
    await s.close()
  }
})

/** @returns 真正Host/Client组合与可控原生picker Promise；不模拟审批或drain算法。 */
async function uploadScenario() {
  const cleanup: (() => unknown)[] = []
  const connection = new HostConnectionService(new Context(), [], {} as ConstructorParameters<typeof HostConnectionService>[2])
  let tool: ToolDefinition | undefined
  const questions: string[] = []
  const events: object[] = []
  const receivedHashes: string[] = []
  let originalContent = 'abc'
  let denied = false
  let approvalEffect: (() => void) | undefined
  await applyFixedPageHost({ connection, tools: { register: (definition) => {
    tool = definition
    return () => {}
  } }, approval: { request: async (request) => {
    questions.push(request.reason)
    approvalEffect?.()
    approvalEffect = undefined
    if (denied) {
      denied = false
      return 'rejected'
    }
    return 'allowed-once'
  } }, effect: effect => cleanup.push(effect() as () => unknown) }, 'agent-browser')
  const handler = connection.createSharedFetchHandler('/api')
  let pageId = ''
  let started = false
  let acknowledgePicker: () => void = () => {}
  // 每个scenario只打开一次OS选择器；首审批拒绝不会确认，ACK仅由外部公开showPicker实际调用产生。
  const pickerOpened = new Promise<void>((resolve) => {
    acknowledgePicker = resolve
  })
  let metadataReads = 0
  let readRejected = false
  let installs = 0
  const listeners = new Map<string, Set<(event: { target: unknown, isTrusted: boolean, type: string }) => void>>()
  const file = { name: 'fixture.txt', size: 3, lastModified: 1, arrayBuffer: async () => {
    if (readRejected) {
      throw new Error('private-source-path: 原生文件读取拒绝')
    }
    return new TextEncoder().encode(originalContent).buffer
  } }
  const fileControl = { tagName: 'INPUT', type: 'file', multiple: false, webkitdirectory: false, disabled: false, isConnected: true, files: [] as typeof file[], addEventListener: (type: string, listener: (event: { target: unknown, isTrusted: boolean, type: string }) => void) => {
    const bucket = listeners.get(type) ?? new Set()
    bucket.add(listener)
    listeners.set(type, bucket)
  }, removeEventListener: (type: string, listener: (event: { target: unknown, isTrusted: boolean, type: string }) => void) => {
    listeners.get(type)?.delete(listener)
  }, showPicker: () => {
    started = true
    acknowledgePicker()
  } }
  const form = { method: 'post', enctype: 'multipart/form-data', action: 'https://upload.invalid/receive', target: '', elements: [] as object[] }
  const ordinary = { tagName: 'INPUT', type: 'text', name: 'note', value: '', selectionStart: 0, selectionEnd: 0, disabled: false, readOnly: false, validity: { badInput: false }, isConnected: true, getAttribute: () => null, closest: () => null }
  const submit = { tagName: 'BUTTON', type: 'submit', name: '', form, hasAttribute: () => false, getAttribute: () => null, closest: (selector: string) => selector === 'form' ? form : null }
  Object.assign(ordinary, { form })
  Object.assign(fileControl, { form, name: 'file', getAttribute: () => null, closest: (selector: string) => selector === 'form' ? form : null })
  form.elements = [fileControl, ordinary, submit]
  const identities = new WeakMap<object, string>([[fileControl, '文件'], [file, '原生File身份'], [submit, '提交'], [ordinary, '普通']])
  let fileIdentity = 0
  const identify = (value: object) => {
    let identity = identities.get(value)
    if (!identity) {
      identity = `文件对象${++fileIdentity}`
      identities.set(value, identity)
    }
    return identity
  }
  const fixtureDocument = new Proxy({ activeElement: undefined as object | undefined, querySelectorAll: () => [fileControl, ordinary, submit] }, {
    get: (target, key) => typeof key === 'symbol' ? identify : Reflect.get(target, key),
  })
  class FileTransfer {
    files: File[] = []
    items = { add: (value: File) => { this.files.push(value) } }
  }
  const fixture = { document: fixtureDocument, crypto, Symbol, Uint8Array, File, DataTransfer: FileTransfer, btoa, atob, URL }
  const finish = (status: 'cancelled' | 'selected', trusted = true) => {
    if (status === 'selected') {
      fileControl.files = [file]
    }
    const type = status === 'cancelled' ? 'cancel' : 'change'
    for (const listener of [...listeners.get(type) ?? []]) {
      listener({ target: fileControl, isTrusted: trusted, type })
    }
  }
  const raw = { activeNodeId: undefined as string | undefined, documentId: '自有上传文档', url: 'https://upload.invalid/form', title: '自有上传', text: '选择文件', truncated: false, viewport: [0, 0, 800, 600], elements: [{ nodeId: '文件', role: 'button', name: '文件', disabled: false, rect: [10, 20, 100, 40], hit: true, tag: 'INPUT', inputType: 'file', readOnly: false, fileHit: true }] }
  const pointer = { remove: () => { }, style: {}, setAttribute: () => { }, textContent: '' }
  const guest = Object.assign(new EventTarget(), {
    getURL: () => raw.url,
    getZoomFactor: () => 1,
    ownerDocument: { createElement: () => pointer },
    parentElement: { append: () => { }, getBoundingClientRect: () => ({ left: 0, top: 0 }) },
    getBoundingClientRect: () => ({ left: 0, top: 0 }),
    executeJavaScript: async (code: string, userGesture?: boolean) => {
      if (code.includes('const fileChoice=true')) {
        expect(userGesture).toBe(true)
        return runInNewContext(code, fixture)
      }
      if (code.includes('const fileCapture=true') || code.includes('const fileMetadata=true')) {
        metadataReads++
        try {
          return await runInNewContext(code, fixture)
        }
        catch {
          // 外部远程桥接只留下泛化错误；固定脚本不处理的拒绝不能在Client取回原始DOMException。
          throw new Error('Error invoking remote method \'GUEST_VIEW_MANAGER_CALL\': [object Object]')
        }
      }
      if (code.includes('const elements=[]')) {
        return structuredClone(raw)
      }
      if (code.includes('const fileInstall=true')) {
        installs++
        return runInNewContext(code, fixture)
      }
      if (code.includes('const fields=[]')) {
        return runInNewContext(code, fixture)
      }
      if (code.includes('const inputHit=true')) {
        return true
      }
      return raw.documentId
    },
    selectAll: () => {
      ordinary.selectionStart = 0
      ordinary.selectionEnd = ordinary.value.length
    },
    insertText: async (text: string) => {
      ordinary.value = text
      ordinary.selectionStart = text.length
      ordinary.selectionEnd = text.length
    },
    sendInputEvent: async (event: object) => {
      events.push(event)
      if ('type' in event && event.type === 'mouseUp' && raw.elements.some(element => element.nodeId === '普通')) {
        raw.activeNodeId = '普通'
        fixtureDocument.activeElement = ordinary
      }
      if ('type' in event && event.type === 'mouseUp' && fileControl.files.length) {
        receivedHashes.push(createHash('sha256').update(new Uint8Array(await fileControl.files[0]!.arrayBuffer())).digest('hex'))
      }
    },
  })
  const rpc = { call: async (channel: string, endpoint: string, payload: unknown, signal?: AbortSignal) => {
    const response = await handler.fetch(new Request(`http://localhost${channel}/${endpoint}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ type: 'client-request', rpcId: crypto.randomUUID(), method: endpoint, payload }), signal }))
    const envelope = await response.json() as {
      result: {
        ok: boolean
        value?: {
          pageId?: string
        }
        error?: {
          message: string
        }
      }
    }
    if (endpoint === 'agent-browser/register' && envelope.result.ok) {
      pageId = envelope.result.value!.pageId!
    }
    return envelope.result
  } }
  const client = createToolClient({ connection: { rpc } }, 'agent-browser')
  const page = new AbortController()
  client.attach('上传会话', { tabId: '上传页', signal: page.signal }, { getGuest: () => guest })
  await vi.waitFor(() => expect(pageId).not.toBe(''))
  const call = (args: Record<string, unknown>, signal = new AbortController().signal) => tool!.execute!({ pageId, ...args }, { agent: { session: { header: { id: '上传会话' } } }, signal, callId: crypto.randomUUID() } as ToolRunContext)
  return { waitForPicker: (choosing: Promise<unknown>) => Promise.race([pickerOpened, choosing.then((value) => {
    if (value instanceof Error) {
      throw value
    }
    throw new Error('真实showPicker调用前工具已提前结算')
  })]), rejectRead: () => {
    readRejected = true
  }, invalidateCaptureTarget: () => {
    fileControl.disabled = true
  }, installs: () => installs, ordinaryValue: () => ordinary.value, showOrdinary: () => {
    raw.elements.push({ nodeId: '普通', role: 'textbox', name: '普通说明', disabled: false, rect: [10, 70, 100, 40], hit: true, tag: 'INPUT', inputType: 'text', readOnly: false, fileHit: false })
  }, rejectNext: () => {
    denied = true
  }, onApproval: (effect: () => void) => {
    approvalEffect = effect
  }, changeBinding: (kind: 'file' | 'form' | 'form-owner') => {
    if (kind === 'file') {
      fileControl.files = [file]
    }
    else if (kind === 'form') {
      form.action = 'https://different.invalid/receive'
    }
    else {
      // 原生DOM边界：节点、字段、属性、布局和遍历顺序不变，只把实际归属移到另一form对象。
      const replacement = { ...form, elements: [...form.elements] }
      Object.assign(submit, { form: replacement })
      Object.assign(fileControl, { form: replacement })
      Object.assign(ordinary, { form: replacement })
    }
  }, client, call, questions, events, receivedHashes, changeOriginal: (text: string) => {
    originalContent = text
  }, showSubmit: () => {
    raw.elements.push({ nodeId: '提交', role: 'button', name: '原生上传提交', disabled: false, rect: [10, 120, 100, 40], hit: true, tag: 'BUTTON', inputType: '', readOnly: false, fileHit: false })
  }, pickerStarted: () => started, metadataReads: () => metadataReads, finish, close: async () => {
    page.abort()
    await client.dispose()
    for (const effect of cleanup.reverse()) {
      if (typeof effect === 'function') {
        await effect()
      }
    }
    await connection.dispose?.()
  } }
}
