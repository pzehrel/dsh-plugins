import type { InputResult, NativeInput } from './native-input.js'
/** 同一共享页的消息形状；不允许任意脚本或网页提供的会话权限进入动作参数，截图独立于文字观察。 */
import type { FileChoiceResult } from './native-upload.js'
import type { ScreenshotObservation } from './screenshot.js'

import type { NavigationInput, NavigationResult } from './session-navigation.js'

export interface Observation {
  /** 测试页本次文档实例的随机标记，导航后变化。 */
  documentId: string
  /** 可控按钮的当前计数。 */
  count: number
  /** 可控测试页的非敏感输入，最多 200 字符。 */
  text: string
  /** 最近一次测试按钮点击是否由浏览器原生输入触发；没有点击时为 false。 */
  lastTrusted?: boolean
}

export interface Command {
  /** Host 铸造的请求关联身份，不可重复执行。 */
  id: string
  /** 当前页面暂停代次；不匹配的请求不得执行或交付结果。 */
  epoch: number
  /** Host 白名单动作；网址仅通过 navigation 输入，不允许模型脚本或权限身份。 */
  action: PageAction
  /** resolve 仅接受本页最新观察铸造的引用，不接受 CSS 或任意代码。 */
  reference?: string
  /** 原生输入的Host白名单参数，审批和执行共用。 */
  input?: NativeInput
  /** 标签或导航参数，不含权限身份。 */
  navigation?: NavigationInput
  /** console 本次按需窗口，50–2000 毫秒；省略默认 500。 */
  durationMs?: number
}

/** 固定页面状态：idle 可用，running 有请求，uncertain 表示已发出点击可能生效且禁止重试；paused 阻止感知与操作。 */
export type PageActivity = 'idle' | 'running' | 'uncertain' | 'paused'

/** 标签metadata的内部交付约束，只在认证Client/Host传输，不输出给Agent。 */
export interface TabMetadataGuard {
  /** 正式框架标签身份，用于关联本次摘要项。 */
  tabId: string
  /** Host铸造的目标页面身份，不能使用会话锚点冒充网页。 */
  pageId: string
  /** 采集metadata时目标页的Host暂停代次；最后交付时必须仍相等。 */
  epoch: number
}

/** 固定主文档感知器返回的交互元素，不包含密码等敏感值。 */
export interface SemanticElement {
  /** 本次观察的短期引用；导航、布局变化、新观察或接管后不可复用。 */
  reference: string
  /** HTML/ARIA 推导角色；不是完整平台可访问性树。 */
  role: string
  /** 由 aria-label、标签或可见文字得到的可读名称，最多 500 字符。 */
  name: string
  /** 普通表单当前值，最多 500 字符；敏感控件省略。 */
  value?: string
  /** true 表示禁用，不可操作。 */
  disabled: boolean
}
/** 主文档按需快照；frame 内容与闭合 Shadow DOM 不在此结果中。 */
export interface SemanticObservation {
  /** 便于边界区分结果，不接受网页决定权限。 */
  kind: 'semantic'
  /** Client 私有文档身份；公开导航事件、页面实例或根标记变化换代，不以网页 UUID 授权。 */
  documentId: string
  /** Client 铸造且不重放的观察身份。 */
  observationId: string
  /** 当前地址；清除凭据、查询及片段，避免把 URL 中的口令交给模型。 */
  url: string
  /** 当前文档标题，最多 500 字符。 */
  title: string
  /** 可见主文档文字，最多 20000 字符；不读取敏感表单值。 */
  text: string
  /** 最多 200 个可见交互元素；引用只属于本页最近观察。 */
  elements: SemanticElement[]
  /** 文本或元素达到上限时为 true；不是完整页面成功承诺。 */
  truncated: boolean
}
/** 只读目标重核结果；可供后续原生输入在再次许可后使用。 */
export interface ResolvedElement {
  /** 重核结果类型，不表示输入已经发生。 */
  kind: 'resolved'
  /** 与引用绑定的同一文档。 */
  documentId: string
  /** 铸造引用的最近观察。 */
  observationId: string
  /** 经当前布局与命中复核的原引用。 */
  reference: string
  /** 元素中心的原生页面视口 CSS 像素。 */
  x: number
  /** 元素中心的原生页面视口 CSS 像素。 */
  y: number
}
/** 固定 Electron 公开 console-message 字段；只代表不可信网站消息，不构成授权。 */
export interface PageConsoleMessage {
  /** Chromium 数字级别 0–3；保留原级别，不假造新版字符串 API。 */
  level: number
  /** 最多 1000 字符；已知密码、Cookie、授权头与令牌模式整条丢弃。 */
  message: string
  /** 网站脚本报告的非负行号，不作为身份凭据。 */
  line: number
  /** 仅 HTTP(S) 来源，去凭据、查询、片段；其他来源隐藏。 */
  sourceId: string
}
/** 当前私有文档的按需窗口，无历史、不在窗口外监听、不补发接管期消息。 */
export interface ConsoleObservation {
  /** 便于统一 Broker 校验动作与结果。 */
  kind: 'console'
  /** Client 私有文档身份，导航或换页后失效。 */
  documentId: string
  /** 去凭据、查询、片段的当前 HTTP(S) 地址。 */
  url: string
  /** 本次请求窗口 50–2000 毫秒，不代表永久订阅。 */
  durationMs: number
  /** 最多 50 条当前窗口消息；没有消息不等于页面没有历史错误。 */
  messages: PageConsoleMessage[]
  /** 数量、长度或已知敏感模式导致省略时为 true。 */
  truncated: boolean
}
/** 动作到结果的统一映射；新能力在同一 Broker 内扩展，不旁路归属与暂停。 */
export interface PageActionResults {
  /** 逐次批准后原生选择单个文件；等待真实cancel/change，选择结算不等于上传。 */
  'choose-file': FileChoiceResult
  /** 绑定本页获准文件及标准form目标后逐次批准原生提交，仅报告事件发送。 */
  'upload-submit': InputResult
  /** 历史固定页读取。 */
  'read': Observation
  /** 历史固定页计数点击。 */
  'click': Observation
  /** 当前真实主文档按需感知，成功后解除交回观察屏障。 */
  'observe': SemanticObservation
  /** 对最近观察引用执行只读重核，不解除交回观察屏障。 */
  'resolve': ResolvedElement
  /** 主文档元素点击，正式逐次审批后发送原生事件。 */
  'click-element': InputResult
  /** 普通字段确切替换，逐次审批后使用公开原生insertText。 */
  'fill': InputResult
  /** 已聚焦主文档目标的原生按键，逐次审批。 */
  'press': InputResult
  /** 主文档目标处的有界相对滚动，逐次审批。 */
  'scroll': InputResult
  /** 单次截图经正式附件服务保存；不解除交回观察屏障。 */
  'screenshot': ScreenshotObservation
  /** 查询本会话标签，复用官方公开控制器。 */
  'list-tabs': NavigationResult
  /** 创建本会话标签，复用官方公开控制器。 */
  'create-tab': NavigationResult
  /** 选择本会话标签，复用官方公开控制器。 */
  'select-tab': NavigationResult
  /** 关闭本会话标签，复用官方公开控制器。 */
  'close-tab': NavigationResult
  /** 同页导航，复用官方公开控制器。 */
  'navigate': NavigationResult
  /** 同页后退，复用官方公开控制器。 */
  'back': NavigationResult
  /** 同页前进，复用官方公开控制器。 */
  'forward': NavigationResult
  /** 同页刷新，复用官方公开控制器。 */
  'reload': NavigationResult
  /** 有界读取当前文档本次窗口的原生控制台，不解除交回观察屏障。 */
  'console': ConsoleObservation
}
/** 仅由 Host 工具白名单准入的动作。 */
export type PageAction = keyof PageActionResults
/** 通过同一归属、代次与取消边界交付的结果。 */
export type PageResult = PageActionResults[PageAction]
