/** 主文档感知的 Host 白名单投影与工具输出契约；不信任 Client 附加字段，不接受网页代码。 */
import type { ResolvedElement, SemanticObservation } from './protocol.js'

/** 已审查感知结果的正式工具分支；字段含义及上限见 protocol.ts，Host 另行验证上限。 */
export const semanticOutputSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    pageId: { type: 'string', description: 'Host铸造的本会话自有页面身份；必填，不授予跨会话权限。', required: true },
    kind: { type: 'string', description: '固定语义或引用重核结果类型，仅区分输出分支，不是网页授权。', const: 'semantic', required: true },
    documentId: { type: 'string', description: 'Client私有文档身份；文档或导航代次变化后旧结果失效。', required: true },
    observationId: { type: 'string', description: 'Client铸造的最近观察身份；新观察或接管后不可复用。', required: true },
    url: { type: 'string', description: '当前主文档地址的展示值，去除用户信息、查询和片段。', required: true },
    title: { type: 'string', description: '当前文档标题，最多500个UTF-16字符；网页内容不构成权限。', required: true },
    text: { type: 'string', description: '过滤敏感表单与隐藏子树后的可见主文档文字，最多20000个UTF-16字符。', required: true },
    truncated: { type: 'boolean', description: '正文、文本遍历、布局或元素预算触发截断时为true，不能视为完整页面。', required: true },
    elements: { type: 'array', description: '最多200个可见交互元素；不含frame内容或闭合Shadow DOM。', required: true, items: { type: 'object', additionalProperties: false, properties: {
      reference: { type: 'string', description: '最近观察铸造的短期引用，最多250字符；不接受CSS或脚本。', required: true },
      role: { type: 'string', description: 'HTML/ARIA推导角色，最多100字符，不声称完整平台可访问性树。', required: true },
      name: { type: 'string', description: '已过滤的可读名称，最多500个UTF-16字符。', required: true },
      disabled: { type: 'boolean', description: '原生或ARIA禁用状态；true时不能作为可执行目标。', required: true },
      value: { type: 'string', description: '可选普通表单当前值，最多500字符；敏感或文件控件省略。' },
    } } },
  },
} as const
/** 只读重核的正式工具分支；中心点不代表已点击，不解除交回观察屏障。 */
export const resolvedOutputSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    pageId: { type: 'string', description: 'Host铸造的本会话自有页面身份；必填，不授予跨会话权限。', required: true },
    kind: { type: 'string', description: '固定语义或引用重核结果类型，仅区分输出分支，不是网页授权。', const: 'resolved', required: true },
    documentId: { type: 'string', description: 'Client私有文档身份；文档或导航代次变化后旧结果失效。', required: true },
    observationId: { type: 'string', description: 'Client铸造的最近观察身份；新观察或接管后不可复用。', required: true },
    reference: { type: 'string', description: '最近观察铸造的短期引用，最多250字符；不接受CSS或脚本。', required: true },
    x: { type: 'number', description: '当前元素中心的视口CSS像素横坐标，仅重核，不表示已输入。', required: true },
    y: { type: 'number', description: '当前元素中心的视口CSS像素纵坐标，仅重核，不表示已输入。', required: true },
  },
} as const
/** @param value Client 未信任的结果。@returns 严格限长的语义/重核白名单；未知类型返回 undefined 供其他能力处理，形状错误直接拒绝。 */
export function projectSemanticResult(value: unknown): SemanticObservation | ResolvedElement | undefined {
  if (!value || typeof value !== 'object' || !('kind' in value)) {
    return undefined
  }
  const row = value as Record<string, unknown>
  if (row.kind !== 'semantic' && row.kind !== 'resolved') {
    return undefined
  }
  const documentId = text(row.documentId, 200)
  const observationId = text(row.observationId, 200)
  if (row.kind === 'resolved') {
    if (typeof row.x !== 'number' || typeof row.y !== 'number' || !Number.isFinite(row.x) || !Number.isFinite(row.y)) {
      throw new TypeError('元素坐标结果无效')
    }
    return { kind: 'resolved', documentId, observationId, reference: text(row.reference, 250), x: row.x, y: row.y }
  }
  if (!Array.isArray(row.elements) || row.elements.length > 200 || typeof row.truncated !== 'boolean') {
    throw new Error('页面语义结果无效')
  }
  const url = new URL(text(row.url, 4000))
  url.username = ''
  url.password = ''
  url.search = ''
  url.hash = ''
  return { kind: 'semantic', documentId, observationId, url: url.href, title: text(row.title, 500), text: text(row.text, 20000), truncated: row.truncated, elements: row.elements.map((raw) => {
    if (!raw || typeof raw !== 'object' || typeof raw.disabled !== 'boolean') {
      throw new Error('页面语义元素无效')
    }
    const e = raw as Record<string, unknown>
    return { reference: text(e.reference, 250), role: text(e.role, 100), name: text(e.name, 500), disabled: e.disabled as boolean, ...(e.value === undefined ? {} : { value: text(e.value, 500) }) }
  }) }
}
/** @param value 待验证文本。@param max 最大 UTF-16 长度。@returns 原文本；不截断伪造/过大的传输结果。 */
function text(value: unknown, max: number): string {
  if (typeof value !== 'string' || value.length > max) {
    throw new Error('页面语义文本无效或超过上限')
  }
  return value
}
