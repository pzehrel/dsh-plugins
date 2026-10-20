/** 共享原生页的按需截图；固定敏感字段检查不能过滤或证明任意像素安全，附件保存由统一 Host 生命周期等待。 */
import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'

/** 只持有增强实现创建的同一原生页，不接受其他页面或后台浏览器。 */
export interface ScreenshotGuest {
  /** @returns 当前真实页面网址，不用网址代替实例身份。 */
  getURL: () => string
  /** @param code 经审查的固定身份或敏感字段检查，不接受工具脚本。@returns 本次检查值。 */
  executeJavaScript: (code: string) => Promise<unknown>
  /** @returns 当前可见区域的原生图片；没有取消契约，调用者须等待结算。 */
  capturePage?: () => Promise<{ toDataURL: () => string }>
}
/** 仅在认证 Client 与 Host 之间流转的临时像素；不能直接成为模型结果。 */
export interface ScreenshotCapture {
  /** 固定判别标记，Host 仍须复核请求许可及关联。 */
  kind: 'screenshot'
  /** 捕获前后相同的文档身份。 */
  documentId: string
  /** 去除用户信息、查询与片段后的展示网址，不用于前后核对。 */
  url: string
  /** 最大 4 MiB PNG 字节的规范 base64；不记录日志或缓存。 */
  dataUrl: string
}
/** 工具正式交付的附件引用，不含临时编码像素、控制凭据或本地路径。 */
export interface ScreenshotObservation {
  /** 区分截图与文字观察，不使截图解除交回后的重新观察屏障。 */
  kind: 'screenshot'
  /** 捕获时的文档身份，导航后的迟到结果不交付。 */
  documentId: string
  /** 去除用户信息、查询与片段后的展示网址，不作为页面授权。 */
  url: string
  /** 由公开 AttachmentStore 保存后得到的真实引用。 */
  attachment: ImageAttachmentRef
  /** 明确截图含可见像素，DOM 过滤不能保证图片不含秘密。 */
  exposureWarning: string
}

/** 普通截图检查可识别的敏感输入与 frame；不观察网页变化，不注册后台任务。 */
const sensitiveScript = `(()=>({sensitive:[...document.querySelectorAll('input')].some(e=>e.type==='password'||/(?:^|\\s)(?:current-password|new-password|one-time-code|cc-number|cc-csc)(?:\\s|$)/i.test(e.autocomplete)||e.hasAttribute('data-private')),frames:document.querySelectorAll('iframe,frame').length>0}))()`
/** 单次传输有界，低于典型 SDK 图片上限；实际存储策略仍由宿主再验证。 */
const maximumBytes = 4 * 1024 * 1024

/**
 * @param guest 同一已拥有的原生页；方法缺失时拒绝。
 * @param permit 统一 Client/Broker 的许可复核；每个原生 await 后执行，取消或暂停必须拒绝。
 * @param identityScript 内部固定的文档身份脚本，不来自模型或网页参数。
 * @returns 一次性临时 PNG，调用方须立即交付 Host 或丢弃，不缓存、不轮询截图。
 * @throws Error 能力、敏感输入、frame、文档变化或许可不满足时停止，不替代为旧图片。
 */
export async function captureScreenshot(guest: ScreenshotGuest, permit: () => Promise<void>, identityScript: string): Promise<ScreenshotCapture> {
  if (typeof guest.capturePage !== 'function') {
    throw new TypeError('[agent-browser/capability-missing] 当前宿主缺少公开页面能力 capturePage；截图已停止。')
  }
  await permit()
  const documentId = await guest.executeJavaScript(identityScript)
  await permit()
  const url = guest.getURL()
  await rejectSensitive()
  const image = await guest.capturePage()
  await permit()
  await rejectSensitive()
  const after = await guest.executeJavaScript(identityScript)
  await permit()
  if (typeof documentId !== 'string' || after !== documentId || guest.getURL() !== url) {
    throw new Error('[agent-browser/screenshot-stale] 截图所属页面或文档已变化；图片不交付。')
  }
  const dataUrl = image.toDataURL()
  // 在传输前做有界格式检查；Host 用真实存储服务重新验证图片字节，不信任 Client 编码声明。
  if (!dataUrl.startsWith('data:image/png;base64,') || dataUrl.length <= 22 || dataUrl.length > 22 + Math.ceil(maximumBytes / 3) * 4 || dataUrl.slice(22).length % 4 !== 0 || !/^[A-Z0-9+/]+={0,2}$/iu.test(dataUrl.slice(22))) {
    throw new Error('[agent-browser/screenshot-invalid] 原生截图不是有效的有界 PNG 编码；图片不交付。')
  }
  return { kind: 'screenshot', documentId, url: screenshotDisplayURL(url), dataUrl }

  /** 固定检查不能作为像素脱敏：遇到已知敏感输入或无法检查的 frame 直接拒绝。 */
  async function rejectSensitive(): Promise<void> {
    const risk = await guest.executeJavaScript(sensitiveScript) as { sensitive?: boolean, frames?: boolean }
    await permit()
    if (!risk || typeof risk.sensitive !== 'boolean' || typeof risk.frames !== 'boolean') {
      throw new Error('[agent-browser/screenshot-unavailable] 无法核对截图的信息暴露条件；截图已停止。')
    }
    if (risk.sensitive || risk.frames) {
      throw new Error('[agent-browser/screenshot-sensitive] 页面含可识别敏感输入或无法检查的 frame；截图已拒绝。DOM 过滤不等于像素安全。')
    }
  }
}

/** @param raw 仅请求栈内使用的原始网址。@returns 去除用户信息、查询与片段的展示值；无效值仅返回固定占位，不泄露原文。 */
export function screenshotDisplayURL(raw: string): string {
  try {
    const url = new URL(raw)
    url.username = ''
    url.password = ''
    url.search = ''
    url.hash = ''
    return url.href
  }
  catch {
    return '[无法显示网址]'
  }
}
