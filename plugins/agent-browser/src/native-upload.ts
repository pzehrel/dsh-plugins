/** 原生文件选择的固定脚本及结果；选择结算不等于上传，取消后等待真实原生Promise以复用统一drain屏障。 */
import type { InputTarget } from './native-input.js'
/** 当前原生File的有界内容事实；不当成重新stat或稍后上传内容不变的证明。 */
export interface SelectedFileInfo {
  /** 浏览器给出的文件basename，最多255字符，不含路径分隔符。 */
  name: string
  /** 本次完整读取的字节数，当前上限16MiB。 */
  size: number
  /** 浏览器File快照的Unix毫秒修改时间，不是重新stat。 */
  lastModified: number
  /** 本次完整读取内容的SHA256，不输出原始文件内容。 */
  sha256: string
  /** 此次内容副本完成捕获并由Client核验的Unix毫秒时间，不是原磁盘文件当前时间。 */
  capturedAt: number
  /** 明确提交的是获准内容的不可变字节副本；之后编辑原文件须重新选择。 */
  contentSource: 'immutable-copy'
}
/** 原生选择器本次结算；不声明网站收到文件或上传成功。 */
export interface FileChoiceResult {
  /** 独立于普通输入与上传的结果分支。 */
  kind: 'file-choice'
  /** 本次选择所属Client私有文档。 */
  documentId: string
  /** 执行前批准的观察身份，结算后不再复用。 */
  observationId: string
  /** 经最新观察核验的标准单文件input引用。 */
  reference: string
  /** cancelled表示原生cancel，包含取消或同文件未改变，不新增文件授权；selected仍不表示上传成功。 */
  status: 'cancelled' | 'selected'
  /** selected时的本次选择身份；不是任意路径权限或上传成功凭据。 */
  selectionId?: string
  /** 仅selected且完整读取核验后返回；cancelled省略。 */
  file?: SelectedFileInfo
}
/** 文件选择的结果字段，不把selected投影为上传成功。 */
export const fileChoiceOutputSchema = { type: 'object', additionalProperties: false, properties: {
  pageId: { type: 'string', description: 'Host铸造的本会话页面身份。', required: true },
  kind: { type: 'string', const: 'file-choice', description: '原生文件选择结算，不是上传。', required: true },
  documentId: { type: 'string', description: '选择所属Client私有文档。', required: true },
  observationId: { type: 'string', description: '批准所用观察身份，结算后须重新observe。', required: true },
  reference: { type: 'string', description: '本次单文件input引用，不可重放。', required: true },
  status: { type: 'string', enum: ['cancelled', 'selected'], description: 'cancelled含取消或同文件未改变、无新授权；selected不表示上传成功。', required: true },
  selectionId: { type: 'string', description: 'selected时的本次选择身份；不授予任意路径权限。' },
  file: { type: 'object', additionalProperties: false, description: '仅selected返回获准文件本次读取的metadata与SHA256，不是上传结果。', properties: {
    name: { type: 'string', description: '文件basename，最多255字符。', required: true },
    size: { type: 'number', description: '完整读取字节数，0至16MiB。', required: true },
    lastModified: { type: 'number', description: 'File快照修改时间，Unix毫秒，不是重新stat。', required: true },
    sha256: { type: 'string', description: '完整内容SHA256十六进制，不返回文件字节。', required: true },
    capturedAt: { type: 'number', description: 'Client核验内容副本完成的Unix毫秒时间，不是重新stat。', required: true },
    contentSource: { type: 'string', const: 'immutable-copy', description: '提交使用此次获准内容副本；原文件后续编辑须重新选择。', required: true },
  } },
} } as const
/** @param value 认证Client本次结果。@returns 选择结果白名单；其他分支留给对应能力，未知身份或状态拒绝。 */
export function projectFileChoiceResult(value: unknown): FileChoiceResult | undefined {
  const row = value as FileChoiceResult | undefined
  if (row?.kind !== 'file-choice') {
    return undefined
  }
  if (!['cancelled', 'selected'].includes(row.status) || [row.documentId, row.observationId, row.reference].some(value => typeof value !== 'string' || value.length > 250)) {
    throw new Error('文件选择结果无效')
  }
  if (row.status === 'selected' && (typeof row.selectionId !== 'string' || !/^[a-f0-9-]{36}$/u.test(row.selectionId))) {
    throw new Error('选择身份无效')
  }
  return { kind: 'file-choice', documentId: row.documentId, observationId: row.observationId, reference: row.reference, status: row.status, ...(row.status === 'selected' ? { selectionId: row.selectionId, file: parseSelectedFileInfo(row.file) } : {}) }
}
/**
 * @param scope Client页面绑定UUID，不接受模型脚本或选择器。
 * @param target 已逐次批准并完整复核的标准单文件input。
 * @returns 固定原生showPicker脚本；userGesture必须由Client固定传true。只等可信cancel/change，不读FileList或内容；Promise不因Host取消提前结算。
 */
export function createFileChoiceScript(scope: string, target: InputTarget): string {
  if (!/^[a-f0-9-]{36}$/u.test(scope) || target.tag !== 'INPUT' || target.inputType !== 'file') {
    throw new Error('文件选择需要标准单文件input')
  }
  return `(()=>{const fileChoice=true;const identify=document[Symbol.for(${JSON.stringify(`dsh.agent-browser.identities.${scope}`)})];if(typeof identify!=='function')throw Error('文件目标身份已失效');let target,visited=0;for(const node of document.querySelectorAll('*')){if(++visited>5000)throw Error('文件目标超过检查上限');if(identify(node)===${JSON.stringify(target.nodeId)}){target=node;break}}if(!target||target.tagName!=='INPUT'||target.type!=='file'||target.multiple||target.webkitdirectory||target.disabled||typeof target.showPicker!=='function')throw Error('缺少可核验的标准单文件选择器');return new Promise((resolve,reject)=>{const cleanup=()=>{target.removeEventListener('cancel',settled);target.removeEventListener('change',settled)};const settled=event=>{if(event.target!==target||event.isTrusted!==true)return;cleanup();resolve({status:event.type==='cancel'?'cancelled':'selected'})};target.addEventListener('cancel',settled);target.addEventListener('change',settled);try{target.showPicker()}catch(error){cleanup();reject(error)}})})()`
}
/** @param value 固定脚本或认证Client文件摘要。@returns 有界公开事实白名单，不转发原生File身份或路径；无效大小、名称、时间与摘要拒绝。 */
export function parseSelectedFileInfo(value: unknown): SelectedFileInfo {
  const row = value as SelectedFileInfo | undefined
  if (!row || typeof row.name !== 'string' || !row.name || row.name.length > 255 || (row.name.includes('/') || row.name.includes('\\') || Array.from(row.name).some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)) || !Number.isInteger(row.size) || row.size < 0 || row.size > 16 * 1024 * 1024 || !Number.isFinite(row.lastModified) || row.lastModified < 0 || typeof row.sha256 !== 'string' || !/^[a-f0-9]{64}$/u.test(row.sha256) || row.contentSource !== 'immutable-copy' || !Number.isFinite(row.capturedAt) || row.capturedAt <= 0) {
    throw new Error('文件metadata或完整内容摘要无效；当前最多16MiB')
  }
  return { name: row.name, size: row.size, lastModified: row.lastModified, sha256: row.sha256, capturedAt: row.capturedAt, contentSource: 'immutable-copy' }
}
/**
 * @param scope Client页面绑定UUID。
 * @param target 已完成原生选择且仍获准的同一单文件input。
 * @returns 完整读取当前具体File并计算SHA256的固定脚本；只在选择结束且重新取得许可后调用，取消后不追加调用。元数据相等不被当作重新stat。
 */
export function createFileMetadataScript(scope: string, target: InputTarget): string {
  if (!/^[a-f0-9-]{36}$/u.test(scope) || target.tag !== 'INPUT' || target.inputType !== 'file') {
    throw new Error('文件核验需要同一单文件input')
  }
  return `(async()=>{const fileMetadata=true;const identify=document[Symbol.for(${JSON.stringify(`dsh.agent-browser.identities.${scope}`)})];if(typeof identify!=='function')throw Error('文件节点身份已失效');let target,visited=0;for(const node of document.querySelectorAll('*')){if(++visited>5000)throw Error('文件目标超过检查上限');if(identify(node)===${JSON.stringify(target.nodeId)}){target=node;break}}if(!target||target.tagName!=='INPUT'||target.type!=='file'||target.multiple||target.webkitdirectory||target.disabled||target.files.length!==1)throw Error('当前不是同一获准单文件选择');const file=target.files[0],name=file.name,size=file.size,lastModified=file.lastModified,fileId=identify(file);if(size>16777216)throw Error('当前文件核验最多16MiB');const data=await file.arrayBuffer();if(data.byteLength!==size||target.files[0]!==file||!target.isConnected)throw Error('文件选择或内容已变化');const digest=await crypto.subtle.digest('SHA-256',data);if(target.files[0]!==file||!target.isConnected)throw Error('文件选择已变化');return {name,size,lastModified,fileId,sha256:Array.from(new Uint8Array(digest),value=>value.toString(16).padStart(2,'0')).join('')}})()`
}

/** 仅Client内部暂存一次获准捕获；字节从不进入Host工具结果，安装/取消后丢弃引用。 */
export interface CapturedFile {
  /** 本次完整内容副本的公开事实。 */
  file: SelectedFileInfo
  /** 来自刚才OS选择的具体File对象身份，不接受模型传入。 */
  sourceFileId: string
  /** 有界实际内容的规范base64，只在同一Client/guest操作内使用，不输出模型。 */
  base64: string
}
/**
 * @param scope 当前Client页面绑定UUID。
 * @param target 已真实OS选定且仍获准的单文件input。
 * @returns 固定有界内容捕获脚本；不改FileList、不安装后台缓存、不存原始字节于document，取消后只等待该次读取真实结算；仅arrayBuffer拒绝转为无内容read-failed，目标检查等其他异常不吞。
 */
export function createFileCaptureScript(scope: string, target: InputTarget): string {
  if (!/^[a-f0-9-]{36}$/u.test(scope) || target.tag !== 'INPUT' || target.inputType !== 'file') {
    throw new Error('内容捕获需要同一原生单文件input')
  }
  return `(async()=>{const fileCapture=true;const identify=document[Symbol.for(${JSON.stringify(`dsh.agent-browser.identities.${scope}`)})];if(typeof identify!=='function')throw Error('文件节点身份已失效');let target,visited=0;for(const node of document.querySelectorAll('*')){if(++visited>5000)throw Error('文件目标超过检查上限');if(identify(node)===${JSON.stringify(target.nodeId)}){target=node;break}}if(!target||target.tagName!=='INPUT'||target.type!=='file'||target.multiple||target.webkitdirectory||target.disabled||target.files.length!==1)throw Error('当前不是同一获准单文件选择');const file=target.files[0],name=file.name,size=file.size,lastModified=file.lastModified,fileId=identify(file);if(size>16777216)throw Error('当前文件捕获最多16MiB');let buffer;try{buffer=await file.arrayBuffer()}catch{return {kind:'file-capture-failed',reason:'read-failed'}}const data=new Uint8Array(buffer);if(data.byteLength!==size||data.byteLength>16777216||target.files[0]!==file||!target.isConnected)throw Error('文件选择或读取内容已变化');let binary='';for(let i=0;i<data.length;i+=32768)binary+=String.fromCharCode(...data.subarray(i,i+32768));return {name,size,lastModified,fileId,base64:btoa(binary)}})()`
}
/**
 * @param value 本次固定捕获脚本结果，不能由模型提供。
 * @returns 由Client完整解码并独立计算摘要的有界暂存；临时解码字节在finally清零，不把metadata或Guest摘要当内容证明；固定read-failed只给出无路径的核对/重新授权提示，调用方保持unknown与原drain。
 */
export async function captureSelectedFile(value: unknown): Promise<CapturedFile> {
  const row = value as { name?: unknown, size?: unknown, lastModified?: unknown, fileId?: unknown, base64?: unknown, kind?: unknown, reason?: unknown } | undefined
  if (row?.kind === 'file-capture-failed' && row.reason === 'read-failed' && Object.keys(row).length === 2) {
    // 此函数仅在Client重新复核许可后调用；选择已经发生，不把内容读取失败回退为未发出。
    throw new Error('文件内容读取失败；请核对文件是否存在、可读或已变化。原生选择已发生，网站可能已读取或自动发送；未建立可提交内容副本，请重新核对文件并授权后重新选择；禁止自动重试')
  }
  if (!row || typeof row.fileId !== 'string' || !row.fileId || row.fileId.length > 500 || typeof row.base64 !== 'string' || row.base64.length > 22369624) {
    throw new Error('原生文件捕获缺少有界身份或内容')
  }
  const checked = parseSelectedFileInfo({ ...row, sha256: '0'.repeat(64), capturedAt: Date.now(), contentSource: 'immutable-copy' })
  const binary = atob(row.base64)
  if (btoa(binary) !== row.base64 || binary.length !== checked.size) {
    throw new Error('文件内容编码或实际大小不一致')
  }
  const data = Uint8Array.from(binary, character => character.charCodeAt(0))
  try {
    const digest = await crypto.subtle.digest('SHA-256', data)
    const sha256 = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
    return { file: { ...checked, sha256, capturedAt: Date.now() }, sourceFileId: row.fileId, base64: row.base64 }
  }
  finally {
    data.fill(0)
  }
}
/**
 * @param scope 当前Client页面绑定UUID。
 * @param target 与捕获相同的获准原生input。
 * @param captured 同次Client核验的具体内容；不接受任意路径、模型字节或其他会话对象。
 * @returns 固定同步安装脚本：公开File/DataTransfer将获准不可变字节副本设回同一input，不合成change或上传。只在取消信号仍有效时发出，返回实际副本身份；失败不恢复/重试旧选择。
 */
export function createFileInstallScript(scope: string, target: InputTarget, captured: CapturedFile): string {
  if (!/^[a-f0-9-]{36}$/u.test(scope) || target.tag !== 'INPUT' || target.inputType !== 'file') {
    throw new Error('内容副本需要同一单文件input')
  }
  return `(()=>{const fileInstall=true;const identify=document[Symbol.for(${JSON.stringify(`dsh.agent-browser.identities.${scope}`)})];if(typeof identify!=='function')throw Error('文件节点身份已失效');let target,visited=0;for(const node of document.querySelectorAll('*')){if(++visited>5000)throw Error('文件目标超过检查上限');if(identify(node)===${JSON.stringify(target.nodeId)}){target=node;break}}if(!target||target.tagName!=='INPUT'||target.type!=='file'||target.multiple||target.webkitdirectory||target.disabled||!target.isConnected||target.files.length!==1||identify(target.files[0])!==${JSON.stringify(captured.sourceFileId)})throw Error('内容捕获后文件选择已变化');if(typeof File!=='function'||typeof DataTransfer!=='function')throw Error('当前页面缺少公开不可变File副本能力');const data=Uint8Array.from(atob(${JSON.stringify(captured.base64)}),value=>value.charCodeAt(0));const snapshot=new File([data],${JSON.stringify(captured.file.name)},{lastModified:${captured.file.lastModified},type:target.files[0].type||''});const transfer=new DataTransfer();transfer.items.add(snapshot);target.files=transfer.files;if(target.files.length!==1||target.files[0]!==snapshot)throw Error('无法确认同一input已持有获准内容副本');return {fileId:identify(snapshot)}})()`
}
