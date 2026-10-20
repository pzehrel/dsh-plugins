/** 正式附件写入适配；只复用公开保存服务，保存结算必须纳入统一Host接管与卸载等待。 */
import type { AttachmentStore } from '@deepseek-ai/dsh-attachment'
import type { ScreenshotCapture, ScreenshotObservation } from './screenshot.js'
import { Buffer } from 'node:buffer'
import { screenshotDisplayURL } from './screenshot.js'

/** 与Client传输上限一致；宿主存储策略仍独立核验真实图片。 */
const maximumBytes = 4 * 1024 * 1024

/**
 * @param store 公开的图片保存服务；缺失时不写入任何附件。
 * @param capture 已通过统一许可的临时 Client 图片。
 * @param permit 统一 Broker 当前请求的许可，在保存前后复核。
 * @returns 宿主验证和保存的正式附件引用；旧结果不得交付。
 * @throws Error 服务缺失、数据无效、保存失败或许可变化时拒绝；已开始保存不可取消，调用方必须把本承诺纳入接管和卸载等待。
 */
export async function persistScreenshot(store: Pick<AttachmentStore, 'saveImage'> | undefined, capture: ScreenshotCapture, permit: () => void): Promise<ScreenshotObservation> {
  if (!store || typeof store.saveImage !== 'function') {
    throw new Error('[agent-browser/capability-missing] 当前宿主缺少公开 attachments.saveImage；截图已停止。')
  }
  permit()
  if (capture.kind !== 'screenshot' || typeof capture.documentId !== 'string' || typeof capture.url !== 'string' || typeof capture.dataUrl !== 'string' || !/^data:image\/png;base64,[A-Z0-9+/]+=*$/iu.test(capture.dataUrl)) {
    throw new Error('[agent-browser/screenshot-invalid] 截图结果无效。')
  }
  const data = Buffer.from(capture.dataUrl.slice(22), 'base64')
  if (!data.length || data.length > maximumBytes || data.toString('base64') !== capture.dataUrl.slice(22)) {
    throw new Error('[agent-browser/screenshot-invalid] 截图编码或大小无效。')
  }
  // 保存没有取消或公开删除契约：必须等待实际结算再确认接管，不能把丢弃迟到引用等同于擦除已保存图片。
  const attachment = await store.saveImage({ data, mediaType: 'image/png', name: 'agent-browser-screenshot.png' })
  permit()
  return { kind: 'screenshot', documentId: capture.documentId, url: screenshotDisplayURL(capture.url), attachment, exposureWarning: '截图包含全部可见像素；密码等可识别敏感输入已拒绝，但无法保证文字、图片、画布或动态内容不含秘密。请人工接管处理敏感页面。已经保存或发送的附件不能撤回。' }
}
