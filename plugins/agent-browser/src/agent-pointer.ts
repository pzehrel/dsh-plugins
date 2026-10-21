/** 自有 webview 的穿透点击指针：只读宿主几何与可见性；视觉失败不授权、阻断或重放网页输入。 */

/** 指针自有 DOM 的有限能力，不向页面注入图形或读取网页正文。 */
export interface PointerNode {
  /** 仅写自有节点的布局和表现。 */
  style: object
  /** @param name 固定无障碍/诊断属性。@param value 固定值，不含网页内容。 */
  setAttribute: (name: string, value: string) => void
  /** @param child 自有指针图形。 */
  append: (child: PointerNode) => void
  /** 幂等移除自有节点。 */
  remove: () => void
}
/** 只消费自有原生元素及其宿主文档的公开 DOM 能力。 */
export interface PointerCarrier {
  /** 自有元素是否仍附着；缺失时仅以父节点和几何作保守检查。 */
  isConnected?: boolean
  /** 未经过宿主 CSS 变换的宽度，CSS 像素；与同父叠层共享祖先缩放。 */
  offsetWidth?: number
  /** 自有原生元素未经过变换的高度，CSS 像素。 */
  offsetHeight?: number
  /** 相对自有定位容器的水平偏移，CSS 像素；缺失时为零。 */
  offsetLeft?: number
  /** 相对自有定位容器的垂直偏移，CSS 像素；缺失时为零。 */
  offsetTop?: number
  /** @returns 宿主视口内经祖先变换后的边界；原生输入不使用这些坐标。 */
  getBoundingClientRect?: () => {
    /** 左边缘相对宿主视口的水平位置，CSS 像素。 */
    left: number
    /** 上边缘相对宿主视口的垂直位置，CSS 像素。 */
    top: number
    /** 可选的变换后宽度，CSS 像素；省略时以 offsetWidth 判断可见性。 */
    width?: number
    /** 可选的变换后高度，CSS 像素；省略时以 offsetHeight 判断可见性。 */
    height?: number
  }
  /**
   * @param options 包含祖先不透明度及 CSS 可见性检查。
   * @param options.checkOpacity 检查包括祖先在内的不透明度。
   * @param options.checkVisibilityCSS 检查 CSS 可见性。
   * @returns 是否可绘制；不改变焦点。
   */
  checkVisibility?: (options: { checkOpacity: boolean, checkVisibilityCSS: boolean }) => boolean
  /** 自有 webview 的直接父容器；其相对定位由增强样式保证。 */
  parentElement?: { append: (child: PointerNode) => void } | null
  /** 宿主文档，仅创建自有节点和读取窗口可见性。 */
  ownerDocument?: {
    /** @param tag 固定 div。@returns 自有图形节点。 */
    createElement: (tag: string) => PointerNode
    /** 后台文档不等待动画。 */
    visibilityState?: string
    /** @returns 宿主窗口是否获焦；false 直接结算移动且不排帧，缺失时不据此阻止展示。 */
    hasFocus?: () => boolean
    /** 宿主帧时钟；缺失时直接定位，不创建替代后台定时循环。 */
    defaultView?: {
      /** @param callback 帧时间，毫秒。@returns 可取消的帧身份。 */
      requestAnimationFrame: (callback: (time: number) => void) => number
      /** @param id 自己创建的帧身份。 */
      cancelAnimationFrame: (id: number) => void
      /** @param query 固定的减少动态效果查询。@returns 系统动态效果偏好。 */
      matchMedia?: (query: string) => { matches: boolean }
    } | null
  }
}
/** 每页独立的视觉控制器；所有方法只影响自有叠层。 */
export interface AgentPointer {
  /** @param active 该页仍有 Agent 浏览活动；false 隐藏并结算动画，但保留位置。 */
  setActive: (active: boolean) => void
  /** 重核自有几何与当前可见性；后台仍可更新位置，不能抢回视图。 */
  refresh: () => void
  /**
   * @param target 已核验的 CSS 页面坐标。
   * @param target.x 目标水平 CSS 坐标。
   * @param target.y 目标垂直 CSS 坐标。
   * @param signal 同一输入生命周期。
   * @returns 动画到达、取消或最多 1500ms 后结算；纯视觉失败不抛错。
   */
  move: (target: { x: number, y: number }, signal: AbortSignal) => Promise<void>
  /** 导航或实例变化时清除旧位置和图形，不留下旧文档目标。 */
  reset: () => void
  /** 关页或卸载时取消帧、等待者并移除所有自有 DOM。 */
  dispose: () => void
}

/**
 * @param getGuest 只返回当前页自有原生元素，未就绪时为空。
 * @param foreground 框架会话和标签是否正在展示；只控制视觉，不作为输入许可。
 * @returns 按页面持有的控制器，不移动系统鼠标、不创建网页观察器。
 */
export function createAgentPointer(getGuest: () => PointerCarrier | undefined, foreground: () => boolean): AgentPointer {
  let guest: PointerCarrier | undefined
  let layer: PointerNode | undefined
  let arrow: PointerNode | undefined
  let frame: number | undefined
  let frameRevision = 0
  let frameWindow: NonNullable<NonNullable<PointerCarrier['ownerDocument']>['defaultView']> | undefined
  let active = false
  let disposed = false
  let visible = false
  let point: { x: number, y: number } | undefined
  let motion: { x: number, y: number, vx: number, vy: number, time?: number, finish: () => void } | undefined

  /** 仅结算视觉等待，不把结果当作网页输入成功。 */
  function finish(): void {
    const held = motion
    motion = undefined
    held?.finish()
  }
  /** 先取消自己的帧，旧回调不能再次显示已接管或已关闭的页面。 */
  function stopFrame(): void {
    frameRevision++
    if (frame !== undefined) {
      try {
        frameWindow?.cancelAnimationFrame(frame)
      }
      catch { /* 时钟失效时仍撤销本地身份；迟到帧会复核活动状态。 */ }
      frame = undefined
    }
    frameWindow = undefined
  }
  /** 清除实例图形，位置由调用者决定是否保留。 */
  function remove(): void {
    stopFrame()
    finish()
    try {
      layer?.remove()
    }
    catch { /* 仅清理自有图形；不可把 DOM 故障升级为输入错误。 */ }
    layer = undefined
    arrow = undefined
    visible = false
  }
  /** @returns 当前可见性；异常只撤销图形，下一次刷新可重新创建。 */
  function render(): boolean {
    if (disposed) {
      return false
    }
    const next = getGuest()
    if (guest !== next) {
      remove()
      point = undefined
      guest = next
    }
    const document = guest?.ownerDocument
    const bounds = guest?.getBoundingClientRect?.()
    const width = guest?.offsetWidth ?? bounds?.width ?? 0
    const height = guest?.offsetHeight ?? bounds?.height ?? 0
    const show = !disposed && active && foreground() && guest?.isConnected !== false
      && document?.visibilityState !== 'hidden' && (bounds?.width ?? width) > 0 && (bounds?.height ?? height) > 0
      && guest?.checkVisibility?.({ checkOpacity: true, checkVisibilityCSS: true }) !== false
    if (!show || !document || !guest?.parentElement) {
      if (layer) {
        Object.assign(layer.style, { display: 'none' })
      }
      visible = false
      if (motion && point) {
        point = { x: motion.x, y: motion.y }
      }
      finish()
      return false
    }
    if (document.hasFocus?.() === false) {
      // 帧时钟在窗口失焦后可能暂停；既有心跳须直接结算已开始的移动，不能等待下一帧或超时。
      stopFrame()
      if (motion) {
        point = { x: motion.x, y: motion.y }
        finish()
      }
    }
    if (!layer) {
      const created = document.createElement('div')
      layer = created
      created.setAttribute('aria-hidden', 'true')
      created.setAttribute('data-agent-browser-pointer', '')
      Object.assign(created.style, { position: 'absolute', overflow: 'hidden', pointerEvents: 'none', zIndex: '20' })
      arrow = document.createElement('div')
      // 使用自有 CSS 图形，不复制参考应用的图片；尖端即输入的 CSS 坐标。
      Object.assign(arrow.style, { position: 'absolute', width: '24px', height: '24px', pointerEvents: 'none', background: '#7349d8', clipPath: 'polygon(0 0, 0 90%, 24% 67%, 41% 100%, 58% 91%, 42% 59%, 78% 59%)', filter: 'drop-shadow(0 1px 2px #0008)', willChange: 'transform' })
      created.append(arrow)
      guest.parentElement.append(created)
    }
    point ??= { x: Math.round(width * 0.58), y: Math.round(height * 0.55) }
    point.x = Math.max(0, Math.min(width, point.x))
    point.y = Math.max(0, Math.min(height, point.y))
    // 叠层和 webview 共享定位容器与祖先变换，避免用屏幕 rect 再乘一次宿主缩放。
    Object.assign(layer.style, { display: 'block', left: `${guest.offsetLeft ?? 0}px`, top: `${guest.offsetTop ?? 0}px`, width: `${width}px`, height: `${height}px` })
    Object.assign(arrow!.style, { transform: `translate3d(${point.x}px, ${point.y}px, 0)` })
    visible = true
    return true
  }
  /** @param time 宿主帧时间；受限窗口用有界步长，避免恢复前台时弹跳。 */
  function tick(time: number): void {
    frame = undefined
    try {
      if (!render()) {
        return
      }
      const moving = motion
      if (moving && point) {
        const dt = Math.min(0.032, Math.max(0.001, (time - (moving.time ?? time - 16)) / 1000))
        moving.time = time
        // 临界阻尼附近的弹簧只控制视觉位置；每次发送输入仍必须独立重核真实目标。
        moving.vx += ((moving.x - point.x) * 550 - moving.vx * 44) * dt
        moving.vy += ((moving.y - point.y) * 550 - moving.vy * 44) * dt
        point.x += moving.vx * dt
        point.y += moving.vy * dt
        if (Math.hypot(moving.x - point.x, moving.y - point.y) < 0.5 && Math.hypot(moving.vx, moving.vy) < 5) {
          point = { x: moving.x, y: moving.y }
          finish()
        }
        render()
      }
      schedule()
    }
    catch { remove() }
  }
  /** 只给获焦窗口的可见活动页排帧；隐藏或失焦页由既有 Client 心跳刷新，不留额外后台定时器。 */
  function schedule(): void {
    const view = guest?.ownerDocument?.defaultView
    if (frame === undefined && visible && active && guest?.ownerDocument?.hasFocus?.() !== false && view?.requestAnimationFrame) {
      frameWindow = view
      const revision = ++frameRevision
      frame = view.requestAnimationFrame((time) => {
        if (revision === frameRevision) {
          tick(time)
        }
      })
    }
  }
  /** 几何或 DOM 错误只能降级展示，不能阻断已获准的网页动作。 */
  function refresh(): void {
    try {
      if (!active || disposed) {
        stopFrame()
        finish()
        if (layer) {
          Object.assign(layer.style, { display: 'none' })
        }
        visible = false
        return
      }
      if (render()) {
        schedule()
      }
      else {
        stopFrame()
      }
    }
    catch { remove() }
  }
  return {
    setActive: (value) => {
      active = value
      refresh()
    },
    refresh,
    move: async (target, signal) => {
      try {
        const previouslyVisible = visible
        finish()
        refresh()
        if (signal.aborted || disposed || !Number.isFinite(target.x) || !Number.isFinite(target.y)) {
          return Promise.resolve()
        }
        const view = guest?.ownerDocument?.defaultView
        if (!previouslyVisible || !visible || !view?.requestAnimationFrame || guest?.ownerDocument?.hasFocus?.() === false || view.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
          point = { ...target }
          refresh()
          return Promise.resolve()
        }
        return await new Promise<void>((resolve) => {
          const cancel = (): void => {
            active = false
            refresh()
            finish()
          }
          // 和参考行为相同，1500ms 只是视觉等待上限，不能变成输入成功或取消判断。
          const timer = setTimeout(() => {
            point = { ...target }
            finish()
            refresh()
          }, 1500)
          motion = { ...target, vx: 0, vy: 0, finish: () => {
            clearTimeout(timer)
            signal.removeEventListener('abort', cancel)
            resolve()
          } }
          signal.addEventListener('abort', cancel, { once: true })
          if (signal.aborted) {
            cancel()
          }
          else {
            refresh()
          }
        })
      }
      catch { remove() }
    },
    reset: () => {
      remove()
      point = undefined
      guest = undefined
    },
    dispose: () => {
      disposed = true
      active = false
      remove()
      point = undefined
      guest = undefined
    },
  }
}
