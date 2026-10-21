/** 指针的可见反馈与生命周期回归；模拟宿主 DOM/帧时钟，不声称真实 Desktop 输入验收。 */
import type { PointerCarrier, PointerNode } from '../src/agent-pointer.js'
import { afterEach, expect, it, vi } from 'vitest'
import { createAgentPointer } from '../src/agent-pointer.js'

const cleanups: (() => void)[] = []
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) {
    cleanup()
  }
  vi.useRealTimers()
})

/** 自有 DOM 边界，记录叠层创建和移除；不模拟网页输入。 */
class Node implements PointerNode {
  style: Record<string, string> = {}
  attributes = new Map<string, string>()
  children: PointerNode[] = []
  removed = false
  setAttribute(name: string, value: string): void { this.attributes.set(name, value) }
  append(child: PointerNode): void { this.children.push(child) }
  remove(): void { this.removed = true }
}

/** @param frames 是否让帧时钟正常到达；false 用于验证有界视觉超时。@returns 单页外部 DOM、可见性控制与真实指针控制器。 */
function fixture(frames = true) {
  vi.useFakeTimers()
  const nodes: Node[] = []
  const callbacks = new Map<number, () => void>()
  let foreground = true
  let serial = 0
  const guest: PointerCarrier & { ownerDocument: NonNullable<PointerCarrier['ownerDocument']> } = {
    isConnected: true,
    offsetWidth: 800,
    offsetHeight: 600,
    offsetLeft: 0,
    offsetTop: 0,
    getBoundingClientRect: () => ({ left: 100, top: 200, width: 800, height: 600 }),
    parentElement: new Node(),
    ownerDocument: {
      visibilityState: 'visible',
      hasFocus: () => true,
      createElement: () => {
        const node = new Node()
        nodes.push(node)
        return node
      },
      defaultView: {
        requestAnimationFrame: (callback: (time: number) => void) => {
          const id = ++serial
          callbacks.set(id, () => callback(Date.now()))
          if (frames) {
            setTimeout(() => {
              callbacks.get(id)?.()
              callbacks.delete(id)
            }, 16)
          }
          return id
        },
        cancelAnimationFrame: (id: number) => { callbacks.delete(id) },
      },
    },
  }
  let current = guest
  const reads = vi.fn(() => current)
  const pointer = createAgentPointer(reads, () => foreground)
  cleanups.push(pointer.dispose)
  return { guest, nodes, callbacks, reads, pointer, replace: (next: typeof guest) => {
    current = next
    pointer.refresh()
  }, foreground: (value: boolean) => {
    foreground = value
    pointer.refresh()
  } }
}

it('独立叠层穿透点击；活动间保留位置，inactive隐藏，下次活动复用同一节点', async () => {
  const f = fixture()
  f.pointer.setActive(true)
  expect(f.nodes).toHaveLength(2)
  expect(f.nodes[0]!.attributes.get('aria-hidden')).toBe('true')
  expect(f.nodes[0]!.style.pointerEvents).toBe('none')
  expect(f.nodes[1]!.style.pointerEvents).toBe('none')
  const moved = f.pointer.move({ x: 100, y: 80 }, new AbortController().signal)
  await vi.advanceTimersByTimeAsync(1500)
  await moved
  expect(f.nodes[1]!.style.transform).toBe('translate3d(100px, 80px, 0)')
  f.pointer.setActive(false)
  expect(f.nodes[0]!.style.display).toBe('none')
  const calls = f.reads.mock.calls.length
  f.pointer.refresh()
  expect(f.reads).toHaveBeenCalledTimes(calls)
  f.pointer.setActive(true)
  expect(f.nodes).toHaveLength(2)
  expect(f.nodes[1]!.style.transform).toBe('translate3d(100px, 80px, 0)')
})

it('移动有中间帧；后续命令替换旧等待，旧命令取消不会隐藏新的移动', async () => {
  const f = fixture()
  f.pointer.setActive(true)
  const old = new AbortController()
  const first = f.pointer.move({ x: 20, y: 20 }, old.signal)
  await vi.advanceTimersByTimeAsync(32)
  expect(f.nodes[1]!.style.transform).not.toBe('translate3d(20px, 20px, 0)')
  const second = f.pointer.move({ x: 500, y: 300 }, new AbortController().signal)
  await first
  old.abort()
  await vi.advanceTimersByTimeAsync(1500)
  await second
  expect(f.nodes[0]!.style.display).toBe('block')
  expect(f.nodes[1]!.style.transform).toBe('translate3d(500px, 300px, 0)')
})

it('后台和未获焦窗口跳过可见动画等待，切回只恢复位置不抢焦点', async () => {
  const f = fixture(false)
  f.pointer.setActive(true)
  f.foreground(false)
  await f.pointer.move({ x: 120, y: 70 }, new AbortController().signal)
  expect(f.nodes[0]!.style.display).toBe('none')
  expect(f.callbacks.size).toBe(0)
  f.foreground(true)
  expect(f.nodes[1]!.style.transform).toBe('translate3d(120px, 70px, 0)')
  f.guest.ownerDocument.hasFocus = () => false
  await f.pointer.move({ x: 200, y: 100 }, new AbortController().signal)
  expect(f.nodes[1]!.style.transform).toBe('translate3d(200px, 100px, 0)')
})

it('每页保存各自移动位置，切换后恢复本页坐标而不复用其他页的目标', async () => {
  const first = fixture(false)
  const second = fixture(false)
  first.guest.ownerDocument.defaultView = undefined
  second.guest.ownerDocument.defaultView = undefined
  first.pointer.setActive(true)
  second.pointer.setActive(true)
  first.foreground(false)
  await first.pointer.move({ x: 120, y: 70 }, new AbortController().signal)
  await second.pointer.move({ x: 500, y: 300 }, new AbortController().signal)
  first.foreground(true)
  second.foreground(false)
  expect(first.nodes[1]!.style.transform).toBe('translate3d(120px, 70px, 0)')
  expect(second.nodes[0]!.style.display).toBe('none')
  second.foreground(true)
  first.foreground(false)
  expect(second.nodes[1]!.style.transform).toBe('translate3d(500px, 300px, 0)')
  expect(first.nodes[0]!.style.display).toBe('none')
})

it('移动期间窗口失焦立即定位并结算等待，不依赖下一帧或超时', async () => {
  const f = fixture(false)
  f.pointer.setActive(true)
  const waiting = f.pointer.move({ x: 200, y: 100 }, new AbortController().signal)
  let arrived = false
  void waiting.then(() => {
    arrived = true
  })
  const late = [...f.callbacks.values()]
  f.guest.ownerDocument.hasFocus = () => false
  f.pointer.refresh()
  await vi.advanceTimersByTimeAsync(0)
  expect(arrived).toBe(true)
  expect(f.nodes[1]!.style.transform).toBe('translate3d(200px, 100px, 0)')
  expect(f.callbacks.size).toBe(0)
  expect(vi.getTimerCount()).toBe(0)
  for (const callback of late) {
    callback()
  }
  expect(f.nodes[1]!.style.transform).toBe('translate3d(200px, 100px, 0)')
  expect(f.callbacks.size).toBe(0)
})

it.each(['missing-clock', 'reduced-motion'] as const)('%s 时直接定位，不依赖帧回调或1500毫秒超时', async (mode) => {
  const f = fixture(false)
  if (mode === 'missing-clock') {
    f.guest.ownerDocument.defaultView = undefined
  }
  else {
    f.guest.ownerDocument.defaultView!.matchMedia = () => ({ matches: true })
  }
  f.pointer.setActive(true)
  expect(f.nodes[1]!.style).toMatchObject({ width: '24px', height: '24px', transform: 'translate3d(464px, 330px, 0)' })
  await f.pointer.move({ x: 200, y: 100 }, new AbortController().signal)
  expect(f.nodes[1]!.style.transform).toBe('translate3d(200px, 100px, 0)')
  f.pointer.dispose()
  expect(vi.getTimerCount()).toBe(0)
})

it('视口变化按自有布局更新；祖先缩放不重复乘入指针坐标，坐标超界时裁剪', async () => {
  const f = fixture(false)
  f.guest.offsetWidth = 400
  f.guest.offsetHeight = 300
  f.guest.offsetLeft = 8
  f.guest.offsetTop = 12
  f.guest.getBoundingClientRect = () => ({ left: 100, top: 200, width: 600, height: 450 })
  f.guest.ownerDocument.hasFocus = () => false
  f.pointer.setActive(true)
  await f.pointer.move({ x: 300, y: 180 }, new AbortController().signal)
  expect(f.nodes[0]!.style).toMatchObject({ left: '8px', top: '12px', width: '400px', height: '300px', overflow: 'hidden' })
  expect(f.nodes[1]!.style.transform).toBe('translate3d(300px, 180px, 0)')
  f.guest.offsetWidth = 250
  f.pointer.refresh()
  expect(f.nodes[1]!.style.transform).toBe('translate3d(250px, 180px, 0)')
})

it('帧时钟不响应时1500毫秒后结算视觉等待，取消与关闭立即清理且迟到帧不能复活', async () => {
  const f = fixture(false)
  f.pointer.setActive(true)
  const waiting = f.pointer.move({ x: 200, y: 100 }, new AbortController().signal)
  let arrived = false
  void waiting.then(() => {
    arrived = true
  })
  await vi.advanceTimersByTimeAsync(1499)
  expect(arrived).toBe(false)
  expect(f.nodes[1]!.style.transform).not.toBe('translate3d(200px, 100px, 0)')
  await vi.advanceTimersByTimeAsync(1)
  await waiting
  expect(arrived).toBe(true)
  expect(f.nodes[1]!.style.transform).toBe('translate3d(200px, 100px, 0)')
  const cancellation = new AbortController()
  const cancelled = f.pointer.move({ x: 400, y: 300 }, cancellation.signal)
  const late = [...f.callbacks.values()]
  cancellation.abort()
  await cancelled
  expect(f.nodes[0]!.style.display).toBe('none')
  f.pointer.dispose()
  for (const callback of late) {
    callback()
  }
  expect(f.callbacks.size).toBe(0)
  expect(f.nodes[0]!.removed).toBe(true)
  expect(f.nodes).toHaveLength(2)
})

it('视觉载体创建或可见性判断失败只是视觉降级，不把异常抛给输入调用者', async () => {
  const f = fixture()
  f.guest.ownerDocument.createElement = () => {
    throw new Error('自有视觉载体不可用')
  }
  expect(() => f.pointer.setActive(true)).not.toThrow()
  await expect(f.pointer.move({ x: 10, y: 20 }, new AbortController().signal)).resolves.toBeUndefined()
  expect(f.callbacks.size).toBe(0)
})

it('导航清除旧位置并移除图形；新文档不复用旧移动或回执', async () => {
  const f = fixture(false)
  f.pointer.setActive(true)
  const old = new AbortController()
  const waiting = f.pointer.move({ x: 10, y: 20 }, old.signal)
  const late = [...f.callbacks.values()]
  f.pointer.reset()
  await waiting
  expect(f.nodes[0]!.removed).toBe(true)
  f.pointer.refresh()
  expect(f.nodes).toHaveLength(4)
  expect(f.nodes[3]!.style.transform).toBe('translate3d(464px, 330px, 0)')
  const next = f.pointer.move({ x: 300, y: 200 }, new AbortController().signal)
  old.abort()
  for (const callback of late) {
    callback()
  }
  expect(f.nodes[2]!.style.display).toBe('block')
  expect(f.nodes[3]!.style.transform).toBe('translate3d(464px, 330px, 0)')
  await vi.advanceTimersByTimeAsync(1500)
  await next
  expect(f.nodes[3]!.style.transform).toBe('translate3d(300px, 200px, 0)')
})

it('页面实例替换结算旧等待，新实例不被迟到帧或旧动作取消污染', async () => {
  const f = fixture(false)
  f.pointer.setActive(true)
  const old = new AbortController()
  const waiting = f.pointer.move({ x: 10, y: 20 }, old.signal)
  const late = [...f.callbacks.values()]
  f.replace({ ...f.guest, offsetWidth: 400, offsetHeight: 300 })
  await waiting
  expect(f.nodes[0]!.removed).toBe(true)
  expect(f.nodes[3]!.style.transform).toBe('translate3d(232px, 165px, 0)')
  old.abort()
  for (const callback of late) {
    callback()
  }
  expect(f.nodes).toHaveLength(4)
  expect(f.nodes[2]!.style.display).toBe('block')
  expect(f.nodes[3]!.style.transform).toBe('translate3d(232px, 165px, 0)')
})
