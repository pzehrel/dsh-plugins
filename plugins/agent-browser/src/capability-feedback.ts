/** 当前固定页切片的能力拒绝说明；区分首版延期与仍待交付的能力，不代替运行态能力验证。 */

/** 未生成文件的明确反馈；原生点击可能已发生，调用方不得把此错误解释为动作未发出。 */
export class DownloadUnsupportedError extends Error {
  /** 调用方可稳定识别的限制，不提供下载路径或文件成功结果。 */
  readonly code = 'download-unsupported'
  /** 创建首版已接受的下载限制，始终停止当前步骤。 */
  constructor() {
    super('[agent-browser/download-unsupported] 当前官方 Desktop 不支持网页下载；未生成文件，请停止该步骤。不要改用 Host 请求或其他浏览器绕过。')
    this.name = 'DownloadUnsupportedError'
  }
}

/**
 * @param action 工具参数中的动作，不接受网页传入的授权或宿主身份。
 * 正常返回仅表示 read/click/screenshot 可继续进入页面归属和许可检查。
 * @throws DownloadUnsupportedError 下载停止且不返回虚构文件。
 * @throws Error 缺失动作说明首版延期、保留交付门槛或未知参数；不执行任何页面操作。
 */
export function requireFixedPageAction(action: unknown): asserts action is 'read' | 'click' | 'screenshot' {
  if (action === 'read' || action === 'click' || action === 'screenshot') {
    return
  }
  if (action === 'download') {
    throw new DownloadUnsupportedError()
  }
  if (['network', 'breakpoint', 'cdp', 'restart-login'].includes(String(action))) {
    throw new Error('[agent-browser/capability-deferred] 完整 Network、断点、原始 CDP 和跨重启登录态首版延期；当前不可用。')
  }
  if (['upload', 'frame', 'login-scope', 'observe', 'navigate', 'input', 'keyboard', 'scroll', 'tabs', 'console', 'script'].includes(String(action))) {
    throw new Error('[agent-browser/capability-pending] 当前固定页切片未实现该能力；它仍是首版交付门槛，不能视为可选或已验证支持。')
  }
  throw new Error('[agent-browser/action-unavailable] 当前仅允许自有固定测试页的 read、click 或 screenshot；未知动作已停止。')
}

/**
 * @param page 增强实现自行持有的原生页面，不扫描或附着到其他页面。
 * @param action 当前固定动作；read 不要求输入能力，click 另需公开原生输入。
 * 正常返回仅表示必需公开方法存在；不探测私有接口或创建替代页面。
 * @throws Error 列出具体缺失的公开方法，停止当前动作；存在方法不等于当前平台已通过原生验收。
 */
export function requirePageCapabilities(page: object, action: 'read' | 'click'): void {
  const methods = action === 'click' ? ['getURL', 'executeJavaScript', 'sendInputEvent'] : ['getURL', 'executeJavaScript']
  const missing = methods.filter(method => typeof Reflect.get(page, method) !== 'function')
  if (missing.length) {
    throw new Error(`[agent-browser/capability-missing] 当前宿主缺少公开页面能力 ${missing.join('、')}；此动作已停止。请使用已验收的官方 Desktop 版本，不改用私有接口。`)
  }
}
