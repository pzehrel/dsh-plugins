/** 真实工具、认证Connection与Client组合；仅正式审批服务、原生guest及自有指针载体可替换。 */
import type { ToolDefinition, ToolRunContext } from '@deepseek-ai/dsh-tools'
import type { SemanticObservation } from '../src/protocol.js'
import { runInNewContext } from 'node:vm'
import { Context } from '@deepseek-ai/cordis'
import { HostConnectionService } from '@deepseek-ai/dsh-client-connection'
import { expect, it, vi } from 'vitest'
import { createToolClient } from '../src/fixed-page-client.js'
import { applyFixedPageHost } from '../src/fixed-page-host.js'

/** @returns 宿主动画时钟替身；只调度指针帧，不操作系统鼠标或网页。 */
function animationClock() {
  let serial = 0
  const timers = new Map<number, ReturnType<typeof setTimeout>>()
  return {
    requestAnimationFrame: (callback: (time: number) => void) => {
      const id = ++serial
      timers.set(id, setTimeout(() => {
        timers.delete(id)
        callback(Date.now())
      }, 16))
      return id
    },
    cancelAnimationFrame: (id: number) => {
      clearTimeout(timers.get(id))
      timers.delete(id)
    },
  }
}

it('普通按钮同样先走正式逐次审批，拒绝不发送原生输入，审批绑定私有文档和确切动作', async () => {
  const scenario = await hostedInput('rejected')
  try {
    const observation = await scenario.observe()
    await expect(scenario.call({ action: 'click-element', reference: observation.elements[0]!.reference })).rejects.toThrow('rejected')
    expect(scenario.questions).toHaveLength(1)
    expect(scenario.questions[0]).toContain(observation.documentId)
    expect(scenario.questions[0]).toContain('click-element')
    expect(scenario.questions[0]).toContain('https://controlled.invalid/form')
    expect(scenario.events).toEqual([])
  }
  finally { await scenario.close() }
})

it('正式允许仅发送同一主文档目标的原生事件，结果不冒充网站业务完成，引用不可重放', async () => {
  const s = await hostedInput()
  try {
    const observation = await s.observe()
    expect(await s.call({ action: 'click-element', reference: observation.elements[0]!.reference })).toMatchObject({ kind: 'input', status: 'issued', documentId: observation.documentId })
    expect(s.events).toEqual([{ type: 'mouseDown', x: 60, y: 40, button: 'left', clickCount: 1 }, { type: 'mouseUp', x: 60, y: 40, button: 'left', clickCount: 1 }])
    await expect(s.call({ action: 'click-element', reference: observation.elements[0]!.reference })).rejects.toThrow('引用失效')
    expect(s.questions).toHaveLength(1)
  }
  finally { await s.close() }
})

it('指针缺失仅降级视觉反馈，正式审批和同页原生点击仍执行', async () => {
  const s = await hostedInput()
  try {
    s.guest.ownerDocument.createElement = () => {
      throw new Error('视觉载体故障')
    }
    const observation = await s.observe()
    await expect(s.call({ action: 'click-element', reference: observation.elements[0]!.reference })).resolves.toMatchObject({ status: 'issued' })
    expect(s.questions).toHaveLength(1)
    expect(s.events).toHaveLength(2)
  }
  finally { await s.close() }
})

it('帧时钟停滞只结束视觉等待，正式审批和输入前复核后才发送原生点击', async () => {
  const s = await hostedInput()
  try {
    s.activity(true)
    const observation = await s.observe()
    const before = s.pointerNodes[1]!.style.transform
    let framePending = false
    Object.assign(s.guest.ownerDocument, { defaultView: {
      requestAnimationFrame: () => {
        framePending = true
        return 1
      },
      cancelAnimationFrame: () => {},
    } })
    const input = s.call({ action: 'click-element', reference: observation.elements[0]!.reference }).catch(error => error)
    await vi.waitFor(() => {
      expect(framePending).toBe(true)
      expect(s.questions).toHaveLength(1)
    })
    expect(s.events).toEqual([])
    expect(s.pointerNodes[1]!.style.transform).toBe(before)
    await expect(input).resolves.toMatchObject({ kind: 'input', status: 'issued', documentId: observation.documentId })
    expect(s.pointerNodes[1]!.style.transform).toBe('translate3d(60px, 40px, 0)')
    expect(s.events).toEqual([{ type: 'mouseDown', x: 60, y: 40, button: 'left', clickCount: 1 }, { type: 'mouseUp', x: 60, y: 40, button: 'left', clickCount: 1 }])
  }
  finally { await s.close() }
})

it('同页指针随正式会话运行跨工具停顿保留，结束隐藏，接管不被运行状态刷新复活', async () => {
  const s = await hostedInput()
  try {
    s.activity(true)
    const observation = await s.observe()
    const [layer, arrow] = s.pointerNodes
    expect(layer?.style.display).toBe('block')
    await s.call({ action: 'click-element', reference: observation.elements[0]!.reference })
    expect(s.pointerNodes).toHaveLength(2)
    expect(arrow?.style.transform).toBe('translate3d(60px, 40px, 0)')
    expect(layer?.style.display).toBe('block')
    s.activity(false)
    expect(layer?.style.display).toBe('none')
    s.activity(true)
    expect(layer?.style.display).toBe('none')
    await s.client.takeover('会话甲', '页甲')
    s.activity(true)
    expect(layer?.style.display).toBe('none')
    await s.closePage()
    expect(layer?.removed).toBe(true)
  }
  finally { await s.close() }
})

it('等待指针动画时人工滚动使目标失效，到达后仍重新核验且不发出旧坐标', async () => {
  const s = await hostedInput()
  try {
    s.activity(true)
    const observation = await s.observe()
    const initialPosition = s.pointerNodes[1]!.style.transform
    Object.assign(s.guest.ownerDocument, { defaultView: animationClock() })
    const input = s.call({ action: 'click-element', reference: observation.elements[0]!.reference }).catch(error => error)
    await vi.waitFor(() => expect(s.pointerNodes[1]!.style.transform).not.toBe(initialPosition))
    expect(s.events).toEqual([])
    s.raw.elements[0]!.rect[0] = 400
    expect(await input).toMatchObject({ outcome: 'not-started' })
    expect(s.events).toEqual([])
  }
  finally { await s.close() }
})

it('指针动画等待中接管立即撤销本次输入并结算，不等视觉超时后发送', async () => {
  const s = await hostedInput()
  try {
    s.activity(true)
    const observation = await s.observe()
    const initialPosition = s.pointerNodes[1]!.style.transform
    Object.assign(s.guest.ownerDocument, { defaultView: animationClock() })
    const input = s.call({ action: 'click-element', reference: observation.elements[0]!.reference }).catch(error => error)
    await vi.waitFor(() => expect(s.pointerNodes[1]!.style.transform).not.toBe(initialPosition))
    await s.client.takeover('会话甲', '页甲')
    expect(await input).toMatchObject({ code: 'cancelled', outcome: 'not-started' })
    expect(s.pointerNodes[0]?.style.display).toBe('none')
    expect(s.events).toEqual([])
  }
  finally { await s.close() }
})

it('审批等待期间布局变化使旧批准失效，无原生事件，重新观察后才可再审批', async () => {
  const s = await hostedInput()
  try {
    const first = await s.observe()
    s.answer(async () => {
      s.raw.elements[0]!.rect[0] = 400
      return 'allowed-once'
    })
    await expect(s.call({ action: 'click-element', reference: first.elements[0]!.reference })).rejects.toThrow('引用失效')
    expect(s.events).toEqual([])
    const next = await s.observe()
    expect(await s.call({ action: 'click-element', reference: next.elements[0]!.reference })).toMatchObject({ status: 'issued' })
    expect(s.questions).toHaveLength(2)
  }
  finally { await s.close() }
})

it('接管撤销待审批问题且明确未发出，交回不复用批准或旧引用', async () => {
  const s = await hostedInput()
  let pendingSignal: AbortSignal | undefined
  s.answer(request => new Promise((resolve) => {
    pendingSignal = request.signal
    request.signal?.addEventListener('abort', () => resolve('unavailable'), { once: true })
  }))
  try {
    const first = await s.observe()
    const input = s.call({ action: 'click-element', reference: first.elements[0]!.reference }).catch(error => error)
    await vi.waitFor(() => expect(pendingSignal).toBeDefined())
    await s.client.takeover('会话甲', '页甲')
    expect(pendingSignal!.aborted).toBe(true)
    expect(await input).toMatchObject({ outcome: 'not-started', code: 'cancelled' })
    expect(s.events).toEqual([])
    await s.client.resume('会话甲', '页甲')
    await expect(s.call({ action: 'click-element', reference: first.elements[0]!.reference })).rejects.toThrow('先重新读取')
  }
  finally { await s.close() }
})

it('填写以原生insertText输入中文，审批显示确切文本，焦点不可靠时不得替换其他控件', async () => {
  const s = await hostedInput()
  try {
    Object.assign(s.raw.elements[0]!, { tag: 'INPUT', role: 'textbox', inputType: 'text', name: '备注' })
    const first = await s.observe()
    const result = await s.call({ action: 'fill', reference: first.elements[0]!.reference, text: '中文备注与粘贴内容' })
    expect(result).toMatchObject({ action: 'fill', status: 'issued' })
    expect(s.questions[0]).toContain('中文备注与粘贴内容')
    expect(s.events).toContainEqual({ insertText: '中文备注与粘贴内容' })
    expect(s.events).toContainEqual({ selectAll: true })
    expect(s.events.some(event => 'keyCode' in event && event.keyCode === 'A')).toBe(false)
    const next = await s.observe()
    s.raw.activeNodeId = '另一个控件'
    s.events.length = 0
    await expect(s.call({ action: 'fill', reference: next.elements[0]!.reference, text: '不得错填' })).rejects.toThrow('焦点')
    expect(s.events.some(event => 'insertText' in event)).toBe(false)
  }
  finally { await s.close() }
})

it('fill通过公开原生selectAll替换实际编辑范围；合成Meta+A不选中时也不能追加原值', async () => {
  const s = await hostedInput()
  try {
    Object.assign(s.raw.elements[0]!, { tag: 'INPUT', role: 'textbox', inputType: 'text', name: '备注' })
    s.form.fields[0]!.value = '你好'
    const observed = await s.observe()
    expect(await s.call({ action: 'fill', reference: observed.elements[0]!.reference, text: '原生填写·中文 2026-10-16' })).toMatchObject({ status: 'issued' })
    expect(s.form.fields[0]!.value).toBe('原生填写·中文 2026-10-16')
    expect(s.events.some(event => 'keyCode' in event && event.keyCode === 'A')).toBe(false)
  }
  finally { await s.close() }
})

it('缺少公开selectAll时fill在审批和任何输入前拒绝，不用快捷键替代', async () => {
  const s = await hostedInput()
  try {
    Object.assign(s.raw.elements[0]!, { tag: 'INPUT', role: 'textbox', inputType: 'text', name: '备注' })
    Object.assign(s.guest, { selectAll: undefined })
    const observed = await s.observe()
    await expect(s.call({ action: 'fill', reference: observed.elements[0]!.reference, text: '禁止追加' })).rejects.toMatchObject({ outcome: 'not-started' })
    expect(s.questions).toEqual([])
    expect(s.events).toEqual([])
  }
  finally { await s.close() }
})

it('按键只作用于已聚焦的引用，滚动使用有限相对delta，frame引用拒绝且不发审批', async () => {
  const s = await hostedInput()
  try {
    let observed = await s.observe()
    expect(await s.call({ action: 'press', reference: observed.elements[0]!.reference, key: 'Enter' })).toMatchObject({ action: 'press', status: 'issued' })
    expect(s.events).toEqual([{ type: 'keyDown', keyCode: 'Enter' }, { type: 'char', keyCode: 'Enter' }, { type: 'keyUp', keyCode: 'Enter' }])
    observed = await s.observe()
    s.events.length = 0
    expect(await s.call({ action: 'scroll', reference: observed.elements[0]!.reference, x: 0, y: 300 })).toMatchObject({ action: 'scroll' })
    expect(s.events).toEqual([{ type: 'mouseWheel', x: 60, y: 40, deltaX: 0, deltaY: -300, canScroll: true }])
    Object.assign(s.raw.elements[0]!, { tag: 'IFRAME', role: 'generic' })
    observed = await s.observe()
    const previous = s.questions.length
    s.events.length = 0
    await expect(s.call({ action: 'click-element', reference: observed.elements[0]!.reference })).rejects.toThrow('frame')
    expect(s.questions).toHaveLength(previous)
    expect(s.events).toEqual([])
  }
  finally { await s.close() }
})

it('主文档容器引用的中心若命中frame也不能绕过跨域输入边界', async () => {
  const s = await hostedInput()
  try {
    Object.assign(s.raw.elements[0]!, { tag: 'DIV', frameHit: true })
    const observed = await s.observe()
    await expect(s.call({ action: 'click-element', reference: observed.elements[0]!.reference })).rejects.toThrow('frame')
    expect(s.questions).toEqual([])
    expect(s.events).toEqual([])
  }
  finally { await s.close() }
})

it('正式审批不可用时失败关闭；原生发送之后断线为结果不明，不自动重试', async () => {
  const unavailable = await hostedInput('unavailable')
  try {
    const observed = await unavailable.observe()
    await expect(unavailable.call({ action: 'click-element', reference: observed.elements[0]!.reference })).rejects.toThrow('unavailable')
    expect(unavailable.events).toEqual([])
  }
  finally { await unavailable.close() }
  const s = await hostedInput()
  try {
    const observed = await s.observe()
    s.guest.sendInputEvent = async (event: object) => {
      s.events.push(event)
      throw new Error('原生返回丢失')
    }
    await expect(s.call({ action: 'click-element', reference: observed.elements[0]!.reference })).rejects.toMatchObject({ code: 'unknown', outcome: 'unknown' })
    const previous = s.events.length
    await expect(s.call({ action: 'click-element', reference: observed.elements[0]!.reference })).rejects.toThrow('上一操作结果不明')
    expect(s.events).toHaveLength(previous)
  }
  finally { await s.close() }
})

it('缺少可靠缩放比例不猜测坐标，且输入不能并发审批', async () => {
  const s = await hostedInput()
  let finish: () => void = () => {}
  try {
    let observed = await s.observe()
    s.guest.getZoomFactor = () => 1.25
    await expect(s.call({ action: 'click-element', reference: observed.elements[0]!.reference })).rejects.toThrow('缩放')
    expect(s.questions).toEqual([])
    s.guest.getZoomFactor = () => 1
    observed = await s.observe()
    s.answer(() => new Promise((resolve) => {
      finish = () => resolve('rejected')
    }))
    const first = s.call({ action: 'click-element', reference: observed.elements[0]!.reference }).catch(error => error)
    await vi.waitFor(() => expect(s.questions).toHaveLength(1))
    await expect(s.call({ action: 'click-element', reference: observed.elements[0]!.reference })).rejects.toThrow('不并发写入')
    finish()
    await first
    expect(s.events).toEqual([])
  }
  finally {
    finish()
    await s.close()
  }
})

it('正式审批展示确切表单内容，长值末尾变化使旧批准失效，不泄露隐藏字段值', async () => {
  const s = await hostedInput()
  try {
    s.form.fields[0]!.value = '甲'.repeat(600)
    s.form.hidden.push({ name: 'csrf', type: 'hidden', value: '不应进入审批展示的隐藏token' })
    const observed = await s.observe()
    s.answer(async () => {
      s.form.fields[0]!.value += '审批期间新增后缀'
      return 'allowed-once'
    })
    await expect(s.call({ action: 'click-element', reference: observed.elements[0]!.reference })).rejects.toThrow('目标变化')
    expect(s.questions[0]).toContain('甲'.repeat(600))
    expect(s.questions[0]).not.toContain('不应进入审批展示的隐藏token')
    expect(s.events).toEqual([])
  }
  finally { await s.close() }
})

it('已知file祖先命中与可识别shadow目标均不借普通点击绕过后续能力授权', async () => {
  const s = await hostedInput()
  try {
    for (const blocked of [{ fileHit: true, unknownShadow: false }, { fileHit: false, unknownShadow: true }]) {
      Object.assign(s.raw.elements[0]!, blocked)
      const observed = await s.observe()
      await expect(s.call({ action: 'click-element', reference: observed.elements[0]!.reference })).rejects.toThrow('file或不可核验')
      expect(s.questions).toEqual([])
      expect(s.events).toEqual([])
    }
  }
  finally { await s.close() }
})

it('最后Host许可等待后命中再变化仍拒绝，不使用审批前旧中心，也不发送原生事件', async () => {
  const s = await hostedInput()
  try {
    const observed = await s.observe()
    s.finalHit(false)
    await expect(s.call({ action: 'click-element', reference: observed.elements[0]!.reference })).rejects.toMatchObject({ outcome: 'not-started' })
    expect(s.questions).toHaveLength(1)
    expect(s.events).toEqual([])
  }
  finally { await s.close() }
})

it.each(['ordinary', 'hidden', 'name', 'readonly'] as const)('最后Host许可在途时%s批准绑定变化，未发出任何原生事件', async (field) => {
  const s = await hostedInput()
  let release: () => void = () => {}
  let entered = false
  try {
    s.form.fields[0]!.value = '甲'.repeat(600)
    s.form.hidden.push({ name: 'csrf', type: 'hidden', value: '原始隐藏假值' })
    const observed = await s.observe()
    s.finalPermit(() => new Promise<void>((resolve) => {
      entered = true
      release = resolve
    }))
    const result = s.call({ action: 'click-element', reference: observed.elements[0]!.reference }).catch(error => error)
    await vi.waitFor(() => expect(entered).toBe(true))
    if (field === 'ordinary') {
      s.form.fields[0]!.value += '最后许可期间的新后缀'
    }
    else if (field === 'hidden') {
      s.form.hidden[0]!.value = '最后许可期间的隐藏新值'
    }
    else if (field === 'name') {
      s.raw.elements[0]!.name = '不同的提交目标'
    }
    else {
      s.raw.elements[0]!.readOnly = true
    }
    release()
    expect(await result).toMatchObject({ outcome: 'not-started' })
    expect(s.events).toEqual([])
  }
  finally {
    release()
    await s.close()
  }
})

it.each(['focus', 'selection'] as const)('fill的%s阶段改变完整字段绑定后，不继续替换文字', async (stage) => {
  const s = await hostedInput()
  try {
    Object.assign(s.raw.elements[0]!, { tag: 'INPUT', role: 'textbox', inputType: 'text', name: '备注' })
    s.form.fields[0]!.value = '甲'.repeat(600)
    const observed = await s.observe()
    s.guest.sendInputEvent = async (event: object) => {
      s.events.push(event)
      if ('type' in event && stage === 'focus' && event.type === 'mouseUp') {
        s.form.fields[0]!.value += '原生阶段变化后缀'
      }
    }
    s.guest.selectAll = () => {
      s.events.push({ selectAll: true })
      if (stage === 'selection') {
        s.form.fields[0]!.value += '选择期间变化后缀'
      }
    }
    await expect(s.call({ action: 'fill', reference: observed.elements[0]!.reference, text: '不能使用旧批准' })).rejects.toMatchObject({ outcome: 'unknown' })
    expect(s.events.some(event => 'insertText' in event)).toBe(false)
    if (stage === 'focus') {
      expect(s.events.some(event => 'keyCode' in event)).toBe(false)
    }
  }
  finally { await s.close() }
})

it.each(['snapshot', 'content'] as const)('最终本地%s读取在途时真实工具取消，Host等待Client结算且不得发送输入', async (stage) => {
  const s = await hostedInput()
  let release: () => void = () => {}
  let entered = false
  try {
    const observed = await s.observe()
    s.finalRead(stage, () => new Promise<void>((resolve) => {
      entered = true
      release = resolve
    }))
    const cancellation = new AbortController()
    let returned = false
    const input = s.call({ action: 'click-element', reference: observed.elements[0]!.reference }, cancellation.signal).catch(error => error).finally(() => {
      returned = true
    })
    await vi.waitFor(() => expect(entered).toBe(true))
    cancellation.abort()
    await new Promise(resolve => setTimeout(resolve, 30))
    const returnedBeforeDrain = returned
    release()
    expect(await input).toBeInstanceOf(Error)
    await new Promise(resolve => setTimeout(resolve, 30))
    expect(s.events).toEqual([])
    expect(returnedBeforeDrain).toBe(false)
  }
  finally {
    release()
    await s.close()
  }
})

it.each([false, true])('撤销watch activeOnly=%s不可用时失败关闭，不先发输入或遗留Host等待', async (activeOnly) => {
  const s = await hostedInput()
  try {
    const observed = await s.observe()
    s.watchUnavailable(activeOnly)
    await expect(s.call({ action: 'click-element', reference: observed.elements[0]!.reference })).rejects.toBeInstanceOf(Error)
    expect(s.events).toEqual([])
  }
  finally { await s.close() }
})

it('丢失drain ACK只能返回cleanup-unconfirmed，保留清理身份且拒绝异token的迟到ACK', async () => {
  const s = await hostedInput()
  try {
    const observed = await s.observe()
    s.dropDrain(true)
    await expect(s.call({ action: 'scroll', reference: observed.elements[0]!.reference, x: 0, y: 100 })).rejects.toThrow('cleanup-unconfirmed')
    expect(s.events).toHaveLength(1)
    expect((await s.deliverDrain(true)).ok).toBe(false)
    await expect(s.call({ action: 'scroll', reference: observed.elements[0]!.reference, x: 0, y: 100 })).rejects.toBeInstanceOf(Error)
    expect((await s.deliverDrain(false)).value).toBe(true)
    expect(s.events).toHaveLength(1)
  }
  finally {
    s.dropDrain(false)
    await s.deliverDrain(false)
    await new Promise(resolve => setTimeout(resolve, 30))
    await s.close()
  }
}, 10000)

it('真实Agent取消已started的原生组时，原工具仍等该组实际结算且不重放', async () => {
  const s = await hostedInput()
  let release: () => void = () => {}
  let started = false
  try {
    const observed = await s.observe()
    s.guest.sendInputEvent = (event: object) => {
      s.events.push(event)
      if ('type' in event && event.type === 'mouseUp') {
        started = true
        return new Promise<void>((resolve) => {
          release = resolve
        })
      }
      return Promise.resolve()
    }
    const cancellation = new AbortController()
    let returned = false
    const result = s.call({ action: 'click-element', reference: observed.elements[0]!.reference }, cancellation.signal).catch(error => error).finally(() => {
      returned = true
    })
    await vi.waitFor(() => expect(started).toBe(true))
    cancellation.abort()
    await new Promise(resolve => setTimeout(resolve, 30))
    expect(returned).toBe(false)
    release()
    expect(await result).toBeInstanceOf(Error)
    expect(s.events).toHaveLength(2)
  }
  finally {
    release()
    await s.close()
  }
})

it.each([
  { action: 'click-element', synchronous: false, boundary: 'pause' },
  { action: 'press', synchronous: false, boundary: 'close' },
  { action: 'click-element', synchronous: true, boundary: 'close' },
  { action: 'press', synchronous: true, boundary: 'pause' },
] as const)('$action 事件组 synchronous=$synchronous 早失败时，$boundary 等待其余已started事件结算', async ({ action, synchronous, boundary }) => {
  const s = await hostedInput()
  let release: () => void = () => {}
  let pending = false
  let settled = false
  try {
    const observed = await s.observe()
    let nativeCalls = 0
    s.guest.sendInputEvent = (event: object) => {
      s.events.push(event)
      nativeCalls++
      if (nativeCalls === (synchronous ? 2 : 1)) {
        if (synchronous) {
          throw new Error('自有原生边界同步失败')
        }
        return Promise.reject(new Error('自有原生边界提前拒绝'))
      }
      if (nativeCalls === (synchronous ? 1 : 2)) {
        pending = true
        return new Promise<void>((resolve) => {
          release = () => {
            settled = true
            resolve()
          }
        })
      }
      return Promise.resolve()
    }
    const input = s.call({ action, reference: observed.elements[0]!.reference, text: '自有文字', key: 'Enter' }).catch(error => error)
    await vi.waitFor(() => expect(pending).toBe(true))
    let cleanupDone = false
    const cleanup = (boundary === 'pause' ? s.client.takeover('会话甲', '页甲') : boundary === 'close' ? s.closePage() : s.client.dispose()).then(() => {
      cleanupDone = true
    })
    // 给真实Host RPC和Client错误传播完成机会；未释放原生承诺时屏障仍不能完成。
    await new Promise(resolve => setTimeout(resolve, 30))
    expect(settled).toBe(false)
    expect(cleanupDone).toBe(false)
    if (boundary === 'pause') {
      expect(s.client.status('会话甲', '页甲').getSnapshot()).toBe('pausing')
    }
    release()
    await cleanup
    expect(settled).toBe(true)
    expect(await input).toBeInstanceOf(Error)
    expect(s.events.some(event => 'insertText' in event)).toBe(false)
  }
  finally {
    release()
    await s.close()
  }
})

it.each(['binding', 'focus', 'readonly', 'cancel', 'pause', 'close', 'unload'] as const)('全选后实际Guest选区读取等待期间%s发生时不insertText，等待已开始读取结算', async (change) => {
  const s = await hostedInput()
  let release: () => void = () => {}
  let acknowledgeRead: () => void = () => {}
  const readStarted = new Promise<void>((resolve) => {
    acknowledgeRead = resolve
  })
  try {
    Object.assign(s.raw.elements[0]!, { tag: 'INPUT', role: 'textbox', inputType: 'text', name: '备注' })
    s.form.hidden.push({ name: 'hidden-field', type: 'hidden', value: '原始自有值' })
    s.selectionRead(() => new Promise<void>((resolve) => {
      release = resolve
      acknowledgeRead()
    }))
    const observed = await s.observe()
    const cancellation = new AbortController()
    let returned = false
    const result = s.call({ action: 'fill', reference: observed.elements[0]!.reference, text: '不得追加或错填' }, cancellation.signal).catch(error => error).finally(() => {
      returned = true
    })
    // 外部Guest实际进入选区读取且可释放后才继续；早失败立即抛出，不用1秒轮询或增大产品timeout。
    await Promise.race([readStarted, result.then((value) => {
      if (value instanceof Error) {
        throw value
      }
      throw new Error('选区读取开始前工具已提前结算')
    })])
    let barrierDone = false
    let barrier: Promise<void> | undefined
    if (change === 'binding') {
      s.form.hidden[0]!.value = '选择期间变化后的自有值'
    }
    else if (change === 'focus') {
      s.raw.activeNodeId = '另一个控件'
    }
    else if (change === 'readonly') {
      s.raw.elements[0]!.readOnly = true
    }
    else if (change === 'cancel') {
      cancellation.abort()
    }
    else {
      barrier = (change === 'pause' ? s.client.takeover('会话甲', '页甲') : change === 'close' ? s.closePage() : s.client.dispose()).then(() => {
        barrierDone = true
      })
    }
    await new Promise(resolve => setTimeout(resolve, 30))
    expect(returned).toBe(false)
    expect(barrierDone).toBe(false)
    expect(s.events.some(event => 'insertText' in event)).toBe(false)
    release()
    await barrier
    expect(await result).toBeInstanceOf(Error)
    expect(s.events.some(event => 'insertText' in event)).toBe(false)
  }
  finally {
    release()
    await s.close()
  }
})

it.each(['text', 'email', 'number', 'textarea'] as const)('selectstart将%s目标焦点切给另一字段时不得错填', async (type) => {
  const s = await hostedInput()
  try {
    Object.assign(s.raw.elements[0]!, { tag: type === 'textarea' ? 'TEXTAREA' : 'INPUT', role: 'textbox', inputType: type === 'textarea' ? '' : type, name: '备注' })
    s.form.fields[0]!.value = type === 'number' ? '123' : type === 'email' ? 'a@example.invalid' : '你好'
    const selectAll = s.guest.selectAll
    s.guest.selectAll = () => {
      selectAll()
      s.raw.activeNodeId = '另一字段'
    }
    const observed = await s.observe()
    await expect(s.call({ action: 'fill', reference: observed.elements[0]!.reference, text: '不得错填' })).rejects.toMatchObject({ outcome: 'unknown' })
    expect(s.events.some(event => 'insertText' in event)).toBe(false)
  }
  finally { await s.close() }
})

it.each([
  { type: 'email', mode: 'span' },
  { type: 'number', mode: 'span' },
  { type: 'email', mode: 'select-node' },
  { type: 'number', mode: 'select-node' },
  { type: 'email', mode: 'missing-method' },
  { type: 'email', mode: 'wrong-end' },
  { type: 'email', mode: 'multiple' },
  { type: 'email', mode: 'caret' },
  { type: 'email', mode: 'no-range' },
  { type: 'email', mode: 'partial-text' },
  { type: 'email', mode: 'own' },
  { type: 'number', mode: 'own' },
] as const)('$type nullable范围仅接受目标原生选区；外部Selection为$mode', async ({ type, mode }) => {
  const s = await hostedInput()
  try {
    Object.assign(s.raw.elements[0]!, { tag: 'INPUT', role: 'textbox', inputType: type, name: '备注' })
    const original = type === 'number' ? '123' : 'a@example.invalid'
    const next = type === 'number' ? '456' : 'b@example.invalid'
    s.form.fields[0]!.value = original
    // 固定content脚本实际在外部Guest VM读取DOM Selection，不预填产品归属判定布尔值。
    const target = { tagName: 'INPUT', type, name: '内容', id: 'target', isConnected: true, form: { elements: [] as unknown[] }, parentNode: { childNodes: [] as unknown[] }, selectionStart: null, selectionEnd: null, readOnly: false, disabled: false, validity: { badInput: false }, get value() {
      return s.form.fields[0]!.value
    }, getAttribute: () => null, closest: () => null }
    const spanText = { textContent: original }
    target.form.elements = [target]
    target.parentNode.childNodes = [target, spanText]
    const hostRange = { startContainer: target.parentNode, startOffset: 0, endContainer: target.parentNode, endOffset: mode === 'wrong-end' ? 2 : 1 }
    const spanRange = { startContainer: spanText, startOffset: 0, endContainer: spanText, endOffset: original.length }
    // selectNode(input)有包住host的外层范围，但真实文本迭代不进入控件，选中文字为空。
    const selection = { type: mode === 'caret' ? 'Caret' : 'Range', rangeCount: mode === 'no-range' ? 0 : 1, toString: () => mode === 'select-node' ? '' : mode === 'partial-text' ? original.slice(1) : original, getComposedRanges: mode === 'missing-method' ? undefined : () => mode === 'span' ? [spanRange] : mode === 'multiple' ? [hostRange, hostRange] : [hostRange] }
    const execute = s.guest.executeJavaScript
    s.guest.executeJavaScript = async (code) => {
      if (!code.includes('const fields=[]')) {
        return execute(code)
      }
      const identityKey = JSON.parse(code.match(/Symbol\.for\(("[^"\n]+")\)/u)![1]!) as string
      const document = { activeElement: target, querySelectorAll: () => [target], [Symbol.for(identityKey)]: () => s.raw.elements[0]!.nodeId }
      return runInNewContext(code, { document, window: { getSelection: () => selection } }, { timeout: 1000 })
    }
    if (mode !== 'own') {
      // 页面取消selectstart，焦点A不变，内部编辑范围仍是末尾光标，只有frame的Selection变化。
      s.guest.selectAll = () => {
        s.events.push({ selectAll: true })
        s.editor.start = original.length
        s.editor.end = original.length
      }
    }
    const observed = await s.observe()
    const input = s.call({ action: 'fill', reference: observed.elements[0]!.reference, text: next })
    if (mode === 'own') {
      expect(await input).toMatchObject({ status: 'issued' })
      expect(s.form.fields[0]!.value).toBe(next)
    }
    else {
      await expect(input).rejects.toMatchObject({ outcome: 'unknown' })
      expect(s.raw.activeNodeId).toBe(s.raw.elements[0]!.nodeId)
      expect(s.events.filter(event => 'insertText' in event)).toHaveLength(0)
      expect(s.form.fields[0]!.value).toBe(original)
    }
  }
  finally { await s.close() }
})

it.each(['email', 'number'] as const)('%s的DOM范围为null时只接受外部Guest确认目标选区，不回退帧级文字', async (type) => {
  const s = await hostedInput()
  try {
    Object.assign(s.raw.elements[0]!, { tag: 'INPUT', role: 'textbox', inputType: type, name: '备注' })
    s.form.fields[0]!.value = type === 'number' ? '123' : 'a@example.invalid'
    let observed = await s.observe()
    const next = type === 'number' ? '456' : 'b@example.invalid'
    expect(await s.call({ action: 'fill', reference: observed.elements[0]!.reference, text: next })).toMatchObject({ status: 'issued' })
    expect(s.form.fields[0]!.value).toBe(next)
    s.editor.selectionVisible = false
    observed = await s.observe()
    s.events.length = 0
    await expect(s.call({ action: 'fill', reference: observed.elements[0]!.reference, text: next })).rejects.toMatchObject({ outcome: 'unknown' })
    expect(s.events.some(event => 'insertText' in event)).toBe(false)
  }
  finally { await s.close() }
})

it('空值不把空选区当ACK；无效number在审批前拒绝', async () => {
  const s = await hostedInput()
  try {
    Object.assign(s.raw.elements[0]!, { tag: 'INPUT', role: 'textbox', inputType: 'number', name: '数量' })
    s.form.fields[0]!.value = ''
    let observed = await s.observe()
    expect(await s.call({ action: 'fill', reference: observed.elements[0]!.reference, text: '123' })).toMatchObject({ status: 'issued' })
    expect(s.events.some(event => 'selectAll' in event)).toBe(false)
    expect(s.form.fields[0]!.value).toBe('123')
    s.form.fields[0]!.value = ''
    s.editor.badInput = true
    observed = await s.observe()
    s.events.length = 0
    const approvals = s.questions.length
    await expect(s.call({ action: 'fill', reference: observed.elements[0]!.reference, text: '456' })).rejects.toMatchObject({ outcome: 'not-started' })
    expect(s.questions).toHaveLength(approvals)
    expect(s.events).toEqual([])
  }
  finally { await s.close() }
})

it.each(['throw', 'no-selection'] as const)('selectAll的%s失败不追加文字，也不以快捷键回退', async (failure) => {
  const s = await hostedInput()
  try {
    Object.assign(s.raw.elements[0]!, { tag: 'INPUT', role: 'textbox', inputType: 'text', name: '备注' })
    s.guest.selectAll = failure === 'throw'
      ? () => {
          throw new Error('自有原生选择同步失败')
        }
      : () => {
          s.events.push({ selectAll: true })
        }
    const observed = await s.observe()
    await expect(s.call({ action: 'fill', reference: observed.elements[0]!.reference, text: '不得回退追加' })).rejects.toMatchObject({ outcome: 'unknown' })
    expect(s.events.some(event => 'insertText' in event)).toBe(false)
    expect(s.events.some(event => 'keyCode' in event && event.keyCode === 'A')).toBe(false)
  }
  finally { await s.close() }
})

it.each(['cancel', 'pause', 'close', 'unload'] as const)('insertText真实Promise在途时%s等待结算，取消后不再追加成功核验读取', async (boundary) => {
  const s = await hostedInput()
  let release: () => void = () => {}
  let started = false
  try {
    Object.assign(s.raw.elements[0]!, { tag: 'INPUT', role: 'textbox', inputType: 'text', name: '备注' })
    s.guest.insertText = text => new Promise<void>((resolve) => {
      s.events.push({ insertText: text })
      started = true
      release = resolve
    })
    const observed = await s.observe()
    const cancellation = new AbortController()
    let returned = false
    const input = s.call({ action: 'fill', reference: observed.elements[0]!.reference, text: '在途文字' }, cancellation.signal).catch(error => error).finally(() => {
      returned = true
    })
    await vi.waitFor(() => expect(started).toBe(true))
    const reads = s.contentReads()
    let done = false
    if (boundary === 'cancel') {
      cancellation.abort()
    }
    const cleanup = boundary === 'cancel'
      ? Promise.resolve()
      : (boundary === 'pause' ? s.client.takeover('会话甲', '页甲') : boundary === 'close' ? s.closePage() : s.client.dispose()).then(() => {
          done = true
        })
    await new Promise(resolve => setTimeout(resolve, 30))
    expect(returned).toBe(false)
    expect(done).toBe(false)
    release()
    await cleanup
    expect(await input).toMatchObject({ outcome: 'unknown' })
    expect(s.contentReads()).toBe(reads)
  }
  finally {
    release()
    await s.close()
  }
})

it('insertText实际失败或返回后值不符均为unknown，不自动重试且允许清理完成', async () => {
  for (const failure of ['reject', 'mismatch']) {
    const s = await hostedInput()
    try {
      Object.assign(s.raw.elements[0]!, { tag: 'INPUT', role: 'textbox', inputType: 'text', name: '备注' })
      s.guest.insertText = async (text) => {
        s.events.push({ insertText: text })
        if (failure === 'reject') {
          throw new Error('自有insertText异步失败')
        }
      }
      const observed = await s.observe()
      await expect(s.call({ action: 'fill', reference: observed.elements[0]!.reference, text: '不能虚报成功' })).rejects.toMatchObject({ outcome: 'unknown' })
      expect(s.events.filter(event => 'insertText' in event)).toHaveLength(1)
      await s.client.takeover('会话甲', '页甲')
      expect(s.client.status('会话甲', '页甲').getSnapshot()).toBe('paused')
    }
    finally { await s.close() }
  }
})

it.each(['click-element', 'press'] as const)('%s 正常引发跳转后返回已发送，随后可重新观察并连续操作', async (action) => {
  const s = await hostedInput()
  try {
    const before = await s.observe()
    s.guest.sendInputEvent = async (event: object) => {
      s.events.push(event)
      if ('type' in event && event.type === (action === 'press' ? 'char' : 'mouseUp')) {
        s.raw.documentId = '跳转后的新文档'
        s.raw.url = 'https://controlled.invalid/result'
        s.guest.dispatchEvent(new Event('did-start-navigation'))
        s.guest.dispatchEvent(new Event('dom-ready'))
      }
    }
    expect(await s.call({ action, reference: before.elements[0]!.reference, key: 'Enter' })).toMatchObject({ status: 'issued', documentId: before.documentId })
    await expect(s.call({ action: 'click-element', reference: before.elements[0]!.reference })).rejects.toThrow()
    const after = await s.observe()
    expect(after.documentId).not.toBe(before.documentId)
    expect(after.url).toBe('https://controlled.invalid/result')
    s.guest.sendInputEvent = async (event) => {
      s.events.push(event)
    }
    expect(await s.call({ action: 'click-element', reference: after.elements[0]!.reference })).toMatchObject({ status: 'issued' })
    expect(s.questions).toHaveLength(2)
  }
  finally { await s.close() }
})

async function hostedInput(outcome: 'allowed-once' | 'rejected' | 'unavailable' = 'allowed-once') {
  const cleanups: (() => unknown)[] = []
  const connection = new HostConnectionService(new Context(), [], {} as ConstructorParameters<typeof HostConnectionService>[2])
  let tool: ToolDefinition | undefined
  const questions: string[] = []
  const events: object[] = []
  let answer = async (_request: { signal?: AbortSignal, reason?: string }) => outcome
  await applyFixedPageHost({ connection, tools: { register: (definition) => {
    tool = definition
    return () => {}
  } }, approval: { request: async (request) => {
    questions.push(request.reason ?? '')
    return answer(request)
  } }, effect: effect => cleanups.push(effect() as () => unknown) }, 'agent-browser')
  const handler = connection.createSharedFetchHandler('/api')
  let pageId = ''
  let inputStarted = false
  let finalPermit: (() => Promise<void>) | undefined
  let finalRead: { stage: 'snapshot' | 'content', gate: () => Promise<void> } | undefined
  let watchUnavailable: 'all' | 'active' | undefined
  let dropDrain = false
  let savedDrain: Record<string, unknown> | undefined
  const raw = { documentId: '网页不可信标记', url: 'https://controlled.invalid/form', title: '自有表单', text: '模拟提交', truncated: false, viewport: [0, 0, 800, 600], activeNodeId: '按钮', elements: [{ nodeId: '按钮', role: 'button', name: '模拟提交', disabled: false, rect: [10, 20, 100, 40], hit: true, tag: 'BUTTON', inputType: '', readOnly: false }] }
  const form = { fields: [{ name: '内容', type: 'text', value: '自有普通字段' }], hidden: [] as { name: string, type: string, value: string }[], sensitive: false, truncated: false }
  const editor = { start: 0, end: 0, selectedText: '', selectionVisible: true, badInput: false }
  let selectionStarted = false
  let selectionRead: (() => Promise<void>) | undefined
  let contentReads = 0
  let finalHit = true
  const pointerNodes: { style: Record<string, string>, removed: boolean }[] = []
  const createPointer = () => {
    const node = { style: {} as Record<string, string>, removed: false, setAttribute: () => {}, append: () => {}, remove: () => {
      node.removed = true
    } }
    pointerNodes.push(node)
    return node
  }
  let sessionRunning: boolean | undefined
  const statusListeners = new Set<() => void>()
  const sessionStatus = {
    getSnapshot: () => new Map([['会话甲', { running: sessionRunning }]]),
    subscribe: (listener: () => void) => {
      statusListeners.add(listener)
      return () => {
        statusListeners.delete(listener)
      }
    },
  }
  const guest = Object.assign(new EventTarget(), { getURL: () => raw.url, getZoomFactor: () => 1, executeJavaScript: async (code: string) => {
    if (inputStarted && finalRead && code.includes(finalRead.stage === 'snapshot' ? 'const elements=[]' : 'const fields=[]')) {
      const gate = finalRead.gate
      finalRead = undefined
      await gate()
    }
    if (code.includes('const fields=[]')) {
      contentReads++
      if (selectionStarted && selectionRead) {
        const gate = selectionRead
        selectionRead = undefined
        await gate()
      }
      const target = raw.elements[0]!
      const nullable = ['email', 'number'].includes(target.inputType)
      return { ...structuredClone(form), edit: { nodeId: target.nodeId, focused: raw.activeNodeId === target.nodeId, value: form.fields[0]!.value, selectionStart: nullable ? null : editor.start, selectionEnd: nullable ? null : editor.end, readOnly: target.readOnly, disabled: target.disabled, badInput: editor.badInput, targetSelectionConfirmed: editor.selectionVisible && editor.selectedText !== '' && editor.selectedText === form.fields[0]!.value } }
    }
    return code.includes('const inputHit=true') ? finalHit : code.includes('const elements=[]') ? structuredClone(raw) : raw.documentId
  }, sendInputEvent: async (event: object) => {
    events.push(event)
  }, insertText: async (text: string) => {
    events.push({ insertText: text })
    const current = form.fields[0]!.value
    form.fields[0]!.value = current.slice(0, editor.start) + text + current.slice(editor.end)
    editor.start += text.length
    editor.end = editor.start
    editor.selectedText = ''
  }, selectAll: () => {
    events.push({ selectAll: true })
    selectionStarted = true
    editor.start = 0
    editor.end = form.fields[0]!.value.length
    editor.selectedText = form.fields[0]!.value
  }, offsetWidth: 800, offsetHeight: 600, getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }), ownerDocument: { createElement: createPointer }, parentElement: { append: () => {} } })
  const client = createToolClient({ uiSession: { sessionStatus }, connection: { rpc: { call: async (_channel, endpoint, payload, signal) => {
    if (endpoint.endsWith('/input-watch') && watchUnavailable && (watchUnavailable === 'all' || !(payload as { initial?: boolean }).initial)) {
      return { ok: false, error: { message: 'watch unavailable' } }
    }
    if (endpoint.endsWith('/input-drained') && dropDrain) {
      savedDrain = payload as Record<string, unknown>
      throw new Error('自有传输边界丢失drain ACK')
    }
    const response = await handler.fetch(new Request(`http://127.0.0.1/api/${endpoint}`, { method: 'POST', signal, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ type: 'client-request', rpcId: crypto.randomUUID(), method: endpoint, payload }) }))
    const reply = (await response.json()).result
    if (endpoint.endsWith('/register') && reply.ok) {
      pageId = reply.value.pageId
    }
    if (endpoint.endsWith('/input-started') && reply.ok) {
      inputStarted = true
    }
    else if (inputStarted && endpoint.endsWith('/permit') && finalPermit) {
      const gate = finalPermit
      finalPermit = undefined
      await gate()
    }
    return reply
  } } } }, 'agent-browser')
  const mount = new AbortController()
  client.attach('会话甲', { tabId: '页甲', signal: mount.signal }, { getGuest: () => guest })
  await vi.waitFor(() => expect(pageId).not.toBe(''))
  const call = (args: Record<string, unknown>, signal = new AbortController().signal) => tool!.execute({ ...args, pageId }, { agent: { session: { header: { id: '会话甲' } } }, callId: crypto.randomUUID(), signal } as ToolRunContext)
  return { call, form, editor, pointerNodes, activity: (running: boolean) => {
    sessionRunning = running
    for (const listener of statusListeners) {
      listener()
    }
  }, selectionRead: (gate: () => Promise<void>) => {
    selectionRead = gate
  }, contentReads: () => contentReads, watchUnavailable: (activeOnly = false) => {
    watchUnavailable = activeOnly ? 'active' : 'all'
  }, dropDrain: (drop: boolean) => {
    dropDrain = drop
  }, deliverDrain: async (foreign: boolean) => {
    if (!savedDrain) {
      return { ok: false }
    }
    const response = await handler.fetch(new Request('http://127.0.0.1/api/agent-browser/input-drained', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ type: 'client-request', rpcId: crypto.randomUUID(), method: 'agent-browser/input-drained', payload: { ...savedDrain, ...(foreign ? { token: 'foreign-token' } : {}) } }) }))
    return (await response.json()).result as { ok: boolean, value?: boolean }
  }, finalRead: (stage: 'snapshot' | 'content', gate: () => Promise<void>) => {
    finalRead = { stage, gate }
  }, closePage: () => {
    mount.abort()
    return client.dispose()
  }, finalPermit: (gate: () => Promise<void>) => {
    finalPermit = gate
  }, finalHit: (value: boolean) => {
    finalHit = value
  }, observe: () => call({ action: 'observe' }) as Promise<SemanticObservation>, raw, guest, client, questions, events, answer: (next: typeof answer) => {
    answer = next
  }, close: async () => {
    await client.dispose()
    for (const cleanup of cleanups.reverse()) {
      await cleanup()
    }
  } }
}
