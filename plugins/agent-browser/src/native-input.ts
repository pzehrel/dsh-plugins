/** 原生输入契约：所有动作逐次正式审批，不以网页声明或关键词推断安全。 */
import type { SelectedFileInfo } from './native-upload.js'
import type { ResolvedElement } from './protocol.js'

/** 当前主文档的原生输入动作；历史固定夹具click仍独立限于自有测试页。 */
export type NativeInputAction = 'click-element' | 'fill' | 'press' | 'scroll' | 'choose-file' | 'upload-submit'
/** 审批与执行共享的精确参数，不接受会话身份、脚本或任意坐标。 */
export interface NativeInput {
  /** 最近observe铸造的引用，执行前重新核验。 */
  reference: string
  /** upload-submit必填，只接受本页最近获准选择铸造的身份，不接受宿主路径。 */
  selectionId?: string
  /** fill确切替换内容，最多2000 UTF-16字符；不操作敏感或文件字段。 */
  text?: string
  /** press固定白名单键名，不接受任意组合修饰符。 */
  key?: string
  /** scroll水平相对增量，CSS像素，整数-1000到1000。 */
  x?: number
  /** scroll垂直相对增量，CSS像素，整数-1000到1000。 */
  y?: number
}
/** 已通过当前布局/命中的目标；仅认证Client和Host内部传输。 */
export interface InputTarget extends ResolvedElement {
  /** 当前目标所在的净化主文档地址。 */
  url: string
  /** 主文档快照摘要，审批之后必须逐字相等。 */
  fingerprint: string
  /** 真实元素标签；拒绝frame和插件嵌入元素。 */
  tag: string
  /** 感知得到的目标名称；不构成授权。 */
  name: string
  /** 当前目标节点的无内容身份；Client用它重核focus，仅认证Client/Host传输，不输出给模型或作为授权。 */
  nodeId: string
  /** 普通input当前类型；非input为空。 */
  inputType: string
  /** 只读字段不允许fill。 */
  readOnly: boolean
  /** 有界普通字段的确切内容；隐藏值只参与摘要，不进入展示。 */
  content?: string
}
/** 固定只读脚本取得的目标编辑事实；同步原生编辑调用返回不等于这些事实已成立。 */
export interface InputEditState {
  /** 同一Client闭包铸造的目标身份。 */
  nodeId: string
  /** 读取瞬间的实际焦点是否仍在目标。 */
  focused: boolean
  /** 普通目标当前完整值，最多2000 UTF-16字符，仅在本请求内核对。 */
  value: string
  /** DOM选区起点；email/number等不支持此API时为null。 */
  selectionStart: number | null
  /** DOM选区终点；不支持此API时为null。 */
  selectionEnd: number | null
  /** 读取瞬间的只读标记，不允许借选择阶段变化继续填写。 */
  readOnly: boolean
  /** 读取瞬间的禁用标记。 */
  disabled: boolean
  /** nullable范围的非空目标是否由唯一composed range精确包住且选中文字全文相等；不返回其他选区内容，空串不能证明全选。 */
  targetSelectionConfirmed: boolean
  /** 浏览器报告的编辑器无效输入；例如number内部显示不能由value确认时拒绝猜测。 */
  badInput: boolean
}
/** 一次原生输入的结果，只确认原生事件已发送，不承诺网站或服务器完成。 */
export interface InputResult {
  /** 输入结果类型。 */
  kind: 'input'
  /** 当前Client私有文档。 */
  documentId: string
  /** 执行所用最近观察。 */
  observationId: string
  /** 本次核验的元素引用；输入后不再复用。 */
  reference: string
  /** 已发送的固定输入动作。 */
  action: Exclude<NativeInputAction, 'choose-file'>
  /** 原生事件完成发送，不等于业务成功；须重新observe核对。 */
  status: 'issued'
}
/** @param action 工具动作。@returns 是否属于逐次审批的主文档原生输入。 */
export function isNativeInputAction(action: string): action is NativeInputAction {
  return ['click-element', 'fill', 'press', 'scroll', 'choose-file', 'upload-submit'].includes(action)
}
/** @param value 模型数据。@returns 有界参数；不接受空引用。 */
export function parseNativeInput(value: Record<string, unknown>): NativeInput {
  if (typeof value.reference !== 'string' || !value.reference || value.reference.length > 250) {
    throw new Error('原生输入需要最近observe的reference')
  }
  if (value.action === 'upload-submit' && (typeof value.selectionId !== 'string' || !/^[a-f0-9-]{36}$/u.test(value.selectionId))) {
    throw new Error('upload-submit需要本页最新获准选择的selectionId')
  }
  if (value.action === 'fill' && (typeof value.text !== 'string' || value.text.length > 2000)) {
    throw new Error('fill需要最多2000字符的确切text')
  }
  if (value.action === 'press' && !['Enter', 'Tab', 'Escape', 'Backspace', 'Delete', 'Up', 'Down', 'Left', 'Right', 'Home', 'End', 'PageUp', 'PageDown', 'Space'].includes(String(value.key))) {
    throw new Error('press仅支持固定键名白名单')
  }
  if (value.action === 'scroll' && (![value.x, value.y].every(delta => typeof delta === 'number' && Number.isInteger(delta) && Math.abs(delta) <= 1000) || (value.x === 0 && value.y === 0))) {
    throw new Error('scroll需要非零有限相对x/y整数增量，各-1000到1000像素')
  }
  return { reference: value.reference, ...(value.action === 'upload-submit' ? { selectionId: value.selectionId as string } : {}), ...(value.action === 'press' ? { key: value.key as string } : {}), ...(value.action === 'scroll' ? { x: value.x as number, y: value.y as number } : {}), ...(value.action === 'fill' ? { text: value.text as string } : {}) }
}
/** @param value 认证Client投影。@returns 审批展示所需有界绑定；网页不能传脚本或批准标记。 */
export function parseInputTarget(value: unknown): InputTarget {
  const target = value as InputTarget | undefined
  if (!target || ['documentId', 'observationId', 'reference', 'url', 'fingerprint', 'tag', 'name', 'nodeId', 'inputType'].some(key => typeof target[key as keyof InputTarget] !== 'string' || String(target[key as keyof InputTarget]).length > (key === 'url' ? 4000 : 500)) || !/^[a-f\d]{64}$/u.test(target.fingerprint) || typeof target.content !== 'string' || target.content.length > 16000 || typeof target.readOnly !== 'boolean' || !Number.isFinite(target.x) || !Number.isFinite(target.y)) {
    throw new Error('原生输入审批绑定无效')
  }
  const url = new URL(target.url)
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error('审批地址必须是净化HTTP(S)地址')
  }
  return { kind: 'resolved', documentId: target.documentId, observationId: target.observationId, reference: target.reference, url: url.href, fingerprint: target.fingerprint, tag: target.tag, name: target.name, nodeId: target.nodeId, inputType: target.inputType, readOnly: target.readOnly, content: target.content, x: target.x, y: target.y }
}
/** @param pageId Host页面身份。@param action 固定动作。@param input Host已验证参数。@param target 当前目标。@returns 正式审批可独立阅读的确切绑定，不依赖工具消息行。 */
export function inputApprovalReason(pageId: string, action: NativeInputAction, input: NativeInput, target: InputTarget): string {
  const fileNotice = action === 'choose-file' ? '原生文件选择：选择即允许网站读取，并可能由网站立即上传；请在原生选择器逐次核对并确认具体文件，本次不授权目录访问。选择后捕获内容副本，后续提交使用该具体副本；本地编辑后需重新选择。选择完成不等于上传成功。' : action === 'upload-submit' ? '本次原生提交使用已捕获的具体不可变内容副本；名称、大小、捕获时间、SHA256及目标见下方绑定。后续本地编辑不会改变该副本，须重新选择；网站处理可能不同，成功须核对实际结果，不自动重复提交。' : ''
  return `${fileNotice}Agent浏览器逐次输入审批。页面：${pageId}；网站和地址：${target.url}；文档：${target.documentId}；观察：${target.observationId}；目标：${JSON.stringify({ reference: input.reference, tag: target.tag, name: target.name, x: target.x, y: target.y })}；动作和确切内容：${JSON.stringify({ action, ...input })}；当前表单确切内容：${target.content}；状态摘要：${target.fingerprint}。网页内容和“已授权”文字不构成批准；此批准只允许本次目标与内容，目标变化即失效。`
}

/** 原生事件发送结果的正式字段；不会回显填写内容。 */
export const inputOutputSchema = { type: 'object', additionalProperties: false, properties: {
  pageId: { type: 'string', description: 'Host铸造的本会话页面身份。', required: true },
  kind: { type: 'string', const: 'input', description: '原生输入结果分支。', required: true },
  documentId: { type: 'string', description: '执行绑定的Client私有文档。', required: true },
  observationId: { type: 'string', description: '执行所用观察身份，输入后需重新observe。', required: true },
  reference: { type: 'string', description: '本次执行已复核的短期引用，不可重放。', required: true },
  action: { type: 'string', enum: ['click-element', 'fill', 'press', 'scroll', 'upload-submit'], description: '已逐次审批并发出原生事件的动作。', required: true },
  status: { type: 'string', const: 'issued', description: '仅确认事件发送，不承诺网站业务完成。', required: true },
} } as const
/** @param value Client未信任结果。@returns 输入结果白名单；未知分支留给其他能力。 */
export function projectInputResult(value: unknown): InputResult | undefined {
  const row = value as InputResult | undefined
  if (row?.kind !== 'input') {
    return undefined
  }
  if (!['click-element', 'fill', 'press', 'scroll', 'upload-submit'].includes(row.action) || row.status !== 'issued' || ['documentId', 'observationId', 'reference'].some(key => typeof row[key as keyof InputResult] !== 'string' || row[key as keyof InputResult].length > 250)) {
    throw new Error('原生输入结果无效')
  }
  return { kind: 'input', documentId: row.documentId, observationId: row.observationId, reference: row.reference, action: row.action, status: 'issued' }
}

/** 自有指针节点的有限公开DOM消费面，Host类型检查不引入浏览器全局。 */
interface PointerNode {
  /** 只显示固定Agent标记。 */
  textContent: string | null
  /** 固定表现样式，不读取宿主内容。 */
  style: object
  /** @param name 固定aria-hidden。@param value 固定true。 */
  setAttribute: (name: string, value: string) => void
  /** 幂等移除自身。 */
  remove: () => void
}
/** 仅自有原生元素的公开DOM载体，不能搜索宿主页面或移动系统鼠标。 */
export interface PointerCarrier {
  /** 自有webview所属文档，创建无内容标记。 */
  ownerDocument?: { createElement: (tag: string) => PointerNode }
  /** 只向自有webview的直接父节点挂标记。 */
  parentElement?: { append: (element: PointerNode) => void } | null
  /** @returns 自有webview在官方窗口中的当前边界。 */
  getBoundingClientRect?: () => { left: number, top: number }
}
/** @param guest 自有原生元素。@param target 已核验的CSS视口坐标。@param signal 同一请求生命周期。@returns 幂等移除函数；接管/关闭同步移除，未提供载体则拒绝输入。 */
export function showAgentPointer(guest: PointerCarrier, target: InputTarget, signal: AbortSignal): () => void {
  if (!guest.ownerDocument || !guest.parentElement || !guest.getBoundingClientRect) {
    throw new Error('自有页面没有公开指针载体，未发送原生输入')
  }
  const point = guest.ownerDocument.createElement('div')
  const rect = guest.getBoundingClientRect()
  point.textContent = '↖ Agent'
  point.setAttribute('aria-hidden', 'true')
  Object.assign(point.style, { position: 'fixed', left: `${rect.left + target.x}px`, top: `${rect.top + target.y}px`, zIndex: '2147483647', pointerEvents: 'none', color: '#fff', background: '#7349d8', borderRadius: '4px', padding: '2px 5px', font: 'bold 13px system-ui' })
  guest.parentElement.append(point)
  const remove = (): void => {
    point.remove()
    signal.removeEventListener('abort', remove)
  }
  signal.addEventListener('abort', remove, { once: true })
  if (signal.aborted) {
    remove()
  }
  return remove
}
/** @param signal 同一动作取消。@returns 500毫秒最短可见窗口；不是后台定时任务，接管立即清理并结算。 */
export function showPointerFrame(signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    let timer: ReturnType<typeof setTimeout>
    const finish = (): void => {
      clearTimeout(timer)
      signal.removeEventListener('abort', finish)
      resolve()
    }
    timer = setTimeout(finish, 500)
    signal.addEventListener('abort', finish, { once: true })
    if (signal.aborted) {
      finish()
    }
  })
}

/**
 * @param send 已核验的一组原生发送函数，按数组顺序在同一同步阶段启动；同步抛错后不再启动余项。
 * @returns 所有已启动操作实际结算后才完成；保留首个观察到的失败再拒绝，不因取消或早拒绝漏等迟到释放事件。
 */
export async function sendInputBatch(send: (() => Promise<void>)[]): Promise<void> {
  const started: Promise<void>[] = []
  let failed = false
  let firstError: unknown
  const remember = (error: unknown): void => {
    if (!failed) {
      failed = true
      firstError = error
    }
  }
  for (const start of send) {
    try {
      // 每项立即接上拒绝处理；即使下一项同步抛错，前面的原生操作仍由本批次持有至结算。
      started.push(Promise.resolve(start()).catch(remember))
    }
    catch (error) {
      remember(error)
      break
    }
  }
  await Promise.allSettled(started)
  if (failed) {
    throw firstError
  }
}

/** 专用上传提交的Client私有文件绑定，不是模型可传路径。 */
export interface InputFileBinding {
  /** 已选标准file input的同文档节点身份。 */
  nodeId: string
  /** 原生File对象的无内容身份，必须与当前FileList同一对象。 */
  fileId: string
  /** 此次重新完整读取且等于获准选择的文件事实。 */
  file: SelectedFileInfo
}
/**
 * @param scope Client私有页面绑定UUID。
 * @param nodeId 已由最新观察验证的节点身份。
 * @param fileChoice 仅已识别choose-file允许目标本身的单文件占位绑定；默认false，其他file仍拒绝。
 * @param fileBinding 仅upload-submit传入已重新核验的同一具体文件；默认省略，不能用于普通点击绕行。
 * @param emptyFileForFill 仅fill普通字段时允许同form空的标准单文件input占位；不授权文件选择或提交，已有文件仍拒绝。
 * @returns 固定有界表单状态脚本；只在输入请求中运行，不给普通observe增加隐藏值读取。
 */
export function createInputContentScript(scope: string, nodeId: string, fileChoice = false, fileBinding?: InputFileBinding, emptyFileForFill = false): string {
  if (!/^[0-9a-f-]{36}$/u.test(scope) || typeof nodeId !== 'string' || !nodeId || nodeId.length > 500) {
    throw new Error('输入内容绑定缺少有效Client节点身份')
  }
  return `(()=>{
const identity=document[Symbol.for(${JSON.stringify(`dsh.agent-browser.identities.${scope}`)})];
if(typeof identity!=='function')throw Error('输入节点身份已失效');
let target;let visited=0;for(const e of document.querySelectorAll('*')){if(++visited>5000)break;if(identity(e)===${JSON.stringify(nodeId)}){target=e;break}}
if(!target)throw Error('输入节点已替换');
const form=target.form||target.closest('form');
const candidates=form?[...form.elements]:[...document.querySelectorAll('input,textarea,select')].filter(e=>e.getClientRects().length>0);
const fields=[];const hidden=[];let sensitive=false,truncated=false,total=0;
const uploadFile=${JSON.stringify(fileBinding ?? null)};let matchedUpload=false;
if(uploadFile){
if(!target.form||!((target.tagName==='BUTTON'&&target.type==='submit')||(target.tagName==='INPUT'&&target.type==='submit')))throw Error('仅支持当前标准form提交按钮');
const method=target.hasAttribute('formmethod')?target.formMethod:target.form.method,enctype=target.hasAttribute('formenctype')?target.formEnctype:target.form.enctype,destination=target.hasAttribute('formaction')?target.formAction:target.form.action,context=target.hasAttribute('formtarget')?target.formTarget:target.form.target;
const url=new URL(destination);if(method.toLowerCase()!=='post'||enctype.toLowerCase()!=='multipart/form-data'||!['','_self'].includes(context.toLowerCase())||!['http:','https:'].includes(url.protocol)||url.username||url.password)throw Error('仅支持无凭据HTTP(S)、同页POST multipart原生表单');
const exact=url.href;url.search='';url.hash='';fields.push({name:'上传目标网站与地址',type:'upload-target',value:url.href});hidden.push({name:'确切上传地址',type:'hidden',value:exact});
// 相同属性的另一个form不是旧批准对象；只把实际身份纳入Client摘要，不输出模型参数。
hidden.push({name:'实际上传表单身份',type:'hidden',value:identity(target.form)});
}
for(const e of candidates){const type=String(e.type||e.tagName).toLowerCase();if(['button','submit','reset'].includes(type)&&!e.name)continue;
if(uploadFile&&type==='file'&&identity(e)===uploadFile.nodeId&&!e.disabled&&!e.multiple&&!e.webkitdirectory&&e.files.length===1&&identity(e.files[0])===uploadFile.fileId&&e.files[0].name===uploadFile.file.name&&e.files[0].size===uploadFile.file.size&&e.files[0].lastModified===uploadFile.file.lastModified){matchedUpload=true;fields.push({name:String(e.name||e.id||'文件').slice(0,200),type:'file',value:JSON.stringify({...uploadFile.file,capturedAtText:new Date(uploadFile.file.capturedAt).toISOString()+' UTC'})});continue}
if(${fileChoice}&&e===target&&type==='file'&&!e.multiple&&!e.webkitdirectory){fields.push({name:String(e.getAttribute('aria-label')||e.name||e.id||'文件').slice(0,200),type:'file-selection',value:'用户在原生选择器确认具体文件'});continue}
if(${emptyFileForFill}&&form&&type==='file'&&!e.multiple&&!e.webkitdirectory&&e.files.length===0&&(target.tagName==='TEXTAREA'||(target.tagName==='INPUT'&&['text','search','email','url','tel','number'].includes(target.type)))){fields.push({name:String(e.name||e.id||'文件').slice(0,200),type:'empty-file',value:'尚未选择文件，不授权选择或上传'});continue}
if(type==='password'||type==='file'||/(password|one-time-code|cc-|username)/i.test(e.getAttribute('autocomplete')||'')||e.closest('[data-agent-browser-sensitive]')){sensitive=true;continue}
if((type==='checkbox'||type==='radio')&&!e.checked)continue;
const name=String(e.getAttribute('aria-label')||e.name||e.id||'无名称字段').slice(0,200);const value=e.tagName==='SELECT'&&e.multiple?JSON.stringify([...e.selectedOptions].map(option=>option.value)):String(e.value||'');
if(fields.length+hidden.length>=20||value.length>2000||(total+=value.length)>8000){truncated=true;break}
(type==='hidden'?hidden:fields).push({name,type,value});
}
if(uploadFile&&!matchedUpload)sensitive=true;
const ordinary=target.tagName==='TEXTAREA'||(target.tagName==='INPUT'&&['text','search','email','url','tel','number'].includes(target.type));
const targetValue=ordinary?String(target.value||''):'';
const selectionStart=ordinary?target.selectionStart??null:null,selectionEnd=ordinary?target.selectionEnd??null:null;
let targetSelectionConfirmed=false;
if(ordinary&&targetValue.length>0&&selectionStart===null&&selectionEnd===null&&document.activeElement===target&&target.isConnected){
const selection=window.getSelection();
if(selection?.type==='Range'&&selection.rangeCount===1&&typeof selection.getComposedRanges==='function'){
// 不传shadowRoots，只接受UA内部选择提升后精确包住目标的范围；帧级同值文字不能证明归属。
const ranges=selection.getComposedRanges(),parent=target.parentNode,index=parent?Array.prototype.indexOf.call(parent.childNodes,target):-1,range=ranges.length===1?ranges[0]:null;
targetSelectionConfirmed=index>=0&&range?.startContainer===parent&&range.startOffset===index&&range.endContainer===parent&&range.endOffset===index+1&&selection.toString()===targetValue&&document.activeElement===target;
}}
const edit=ordinary?{nodeId:identity(target),focused:document.activeElement===target,value:targetValue.slice(0,2001),selectionStart,selectionEnd,readOnly:target.readOnly===true,disabled:target.disabled===true,badInput:target.validity?.badInput===true,targetSelectionConfirmed}:null;
return {fields,hidden,sensitive,truncated,edit};
})()`
}
/** @param raw 固定内容脚本的本次结果。@param target 已批准目标身份。@returns 有界编辑事实；不支持选区API保留null，仅认证Client内部使用目标归属事实，不将void返回或全frame同值文字当作选区证明。 */
export function inputEditState(raw: unknown, target: InputTarget): InputEditState {
  const row = (raw as { edit?: InputEditState } | undefined)?.edit
  if (!row || row.nodeId !== target.nodeId || typeof row.focused !== 'boolean' || typeof row.readOnly !== 'boolean' || typeof row.disabled !== 'boolean' || typeof row.badInput !== 'boolean' || typeof row.targetSelectionConfirmed !== 'boolean' || typeof row.value !== 'string' || row.value.length > 2000 || [row.selectionStart, row.selectionEnd].some(position => position !== null && (!Number.isInteger(position) || position < 0 || position > row.value.length))) {
    throw new Error('当前目标缺少可靠的普通编辑状态，未继续填写')
  }
  return { nodeId: row.nodeId, focused: row.focused, value: row.value, selectionStart: row.selectionStart, selectionEnd: row.selectionEnd, readOnly: row.readOnly, disabled: row.disabled, targetSelectionConfirmed: row.targetSelectionConfirmed, badInput: row.badInput }
}
/** @param target 当前语义目标。@param raw 固定输入状态脚本结果。@returns 包含有界普通字段展示与完整字段摘要的绑定，敏感或不完整内容拒绝。 */
export async function bindInputContent(target: InputTarget, raw: unknown): Promise<InputTarget> {
  const state = raw as { fields?: unknown[], hidden?: unknown[], sensitive?: boolean, truncated?: boolean }
  if (!state || state.sensitive !== false || state.truncated !== false || !Array.isArray(state.fields) || !Array.isArray(state.hidden) || state.fields.length + state.hidden.length > 20) {
    throw new Error('表单含敏感、文件或不完整内容，无法绑定确切批准；请人工处理')
  }
  let total = 0
  const project = (field: unknown): { name: string, type: string, value: string } => {
    const row = field as { name: string, type: string, value: string }
    if (!row || typeof row.name !== 'string' || row.name.length > 200 || typeof row.type !== 'string' || row.type.length > 100 || typeof row.value !== 'string' || row.value.length > 2000) {
      throw new Error('表单内容超过有界完整审批上限')
    }
    total += row.value.length
    if (total > 8000) {
      throw new Error('表单内容超过有界完整审批上限')
    }
    return { name: row.name, type: row.type, value: row.value }
  }
  const fields = state.fields.map(project)
  const hidden = state.hidden.map(project)
  const content = JSON.stringify({ fields, hiddenFieldCount: hidden.length, limitation: '仅绑定可枚举表单字段；无法推断网站事件处理器额外发送的JS状态或服务端副作用。' })
  const bytes = new TextEncoder().encode(JSON.stringify({ semantic: target.fingerprint, fields, hidden }))
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return { ...target, content, fingerprint: Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('') }
}

/** @param scope Client绑定UUID。@param target 已批准且重新解析的目标。@param focused 是否同时要求目标仍是实际焦点。@param fileChoice 仅本次choose-file允许精确命中目标file本身，默认false。@returns 原生发送前的固定即时命中检查；最后一次Host许可等待后不得只复用旧中心坐标。 */
export function createInputHitScript(scope: string, target: InputTarget, focused = false, fileChoice = false): string {
  if (!/^[0-9a-f-]{36}$/u.test(scope)) {
    throw new Error('输入命中检查缺少Client绑定')
  }
  return `(()=>{const inputHit=true;const identify=document[Symbol.for(${JSON.stringify(`dsh.agent-browser.identities.${scope}`)})];if(typeof identify!=='function')return false;let n=0;for(const e of document.querySelectorAll('*')){if(++n>5000)return false;if(identify(e)!==${JSON.stringify(target.nodeId)})continue;const b=e.getBoundingClientRect();const x=b.x+b.width/2,y=b.y+b.height/2;const s=getComputedStyle(e);const hit=document.elementFromPoint(x,y);return (!${focused}||document.activeElement===e)&&e.tagName===${JSON.stringify(target.tag)}&&(e.tagName!=='INPUT'||e.type===${JSON.stringify(target.inputType)})&&!e.disabled&&e.getAttribute('aria-disabled')!=='true'&&s.display!=='none'&&s.visibility!=='hidden'&&s.opacity!=='0'&&!e.closest('[hidden],[inert],[aria-hidden=true]')&&e.getClientRects().length>0&&Math.abs(x-${target.x})<0.5&&Math.abs(y-${target.y})<0.5&&!!hit&&(hit===e||e.contains(hit))&&!hit.closest('iframe,frame,object,embed')&&(${fileChoice}?(hit===e&&e.tagName==='INPUT'&&e.type==='file'&&!e.multiple&&!e.webkitdirectory):!hit.closest('input[type=file]'))&&!e.shadowRoot&&!hit.shadowRoot&&!e.tagName.includes('-')&&!hit.tagName.includes('-')}return false})()`
}
