/** 按需固定主文档感知与引用重核；不接收脚本、不安装观察器、不访问 frame，不持有网页内容缓存。 */
import type { InputTarget } from './native-input.js'
import type { ResolvedElement, SemanticElement, SemanticObservation } from './protocol.js'

/** 固定主世界文档标记脚本，供额外一致性检查；可被网页预设或伪造，不能作为权限或 Client 文档身份。 */
export const documentIdentityScript = `(()=>{const root=document.documentElement;if(!root)throw Error('文档尚未就绪');const key=Symbol.for('dsh.agent-browser.document.v1');if(!Object.prototype.hasOwnProperty.call(root,key))Object.defineProperty(root,key,{value:Array.from(crypto.getRandomValues(new Uint8Array(16)),byte=>byte.toString(16).padStart(2,'0')).join('')});return root[key]})()`

/**
 * @param scope Client为当前页面绑定铸造的UUID，只隔离无内容身份状态，不授予页面权限。
 * @returns 固定DOM感知脚本；整体5000布局节点、每个文本子树5000节点、200交互元素及20000正文字符上限，不接受模型代码。
 * WeakMap闭包只公开取身份函数，不公开Map或setter；Client前缀加闭包单调序号不依赖网页随机API。主世界结果仍不可信，不宣称隔离执行环境。
 */
export function createSemanticSnapshotScript(scope: string): string {
  if (!/^[0-9a-f-]{36}$/u.test(scope)) {
    throw new TypeError('固定感知器需要Client页面绑定UUID')
  }
  return `(()=>{
const documentId=${documentIdentityScript};
const identitiesKey=Symbol.for(${JSON.stringify(`dsh.agent-browser.identities.${scope}`)});
if(!Object.prototype.hasOwnProperty.call(document,identitiesKey))Object.defineProperty(document,identitiesKey,{value:(()=>{const identities=new WeakMap();const get=identities.get.bind(identities),set=identities.set.bind(identities);let next=0n;return node=>{let id=get(node);if(id===undefined){id=${JSON.stringify(scope)}+':'+(++next);set(node,id)}return id}})()});
const nodeIdentity=document[identitiesKey];
let textTruncated=false;
const clean=value=>String(value||'').replace(/\\s+/g,' ').trim();
const sensitive=e=>e.closest('input[type="password"],input[type="hidden"],[data-agent-browser-sensitive]')||/(password|one-time-code|cc-|username)/i.test(e.getAttribute('autocomplete')||'');
const visible=e=>{if(e.closest('[hidden],[inert],[aria-hidden="true"],script,style,noscript,template'))return false;const s=getComputedStyle(e);return s.display!=='none'&&s.visibility!=='hidden'&&s.opacity!=='0'&&e.getClientRects().length>0};
const safeText=e=>{if(!e||sensitive(e))return '';const walker=document.createTreeWalker(e,NodeFilter.SHOW_TEXT);let n,out='',visited=0;while((n=walker.nextNode())){if(visited++>=5000){textTruncated=true;break}const p=n.parentElement;if(p&&visible(p)&&!sensitive(p)&&!p.closest('textarea,input,select'))out+=' '+n.textContent;if(out.length>20000){textTruncated=true;break}}return clean(out)};
const role=e=>e.getAttribute('role')||({BUTTON:'button',A:e.hasAttribute('href')?'link':'',INPUT:({checkbox:'checkbox',radio:'radio',range:'slider',button:'button',submit:'button',reset:'button'})[e.type]||'textbox',TEXTAREA:'textbox',SELECT:'combobox',SUMMARY:'button'})[e.tagName]||(e.isContentEditable?'textbox':e.tabIndex>=0?'generic':'');
const name=e=>{const ids=(e.getAttribute('aria-labelledby')||'').trim().split(/\\s+/).filter(Boolean);return clean(e.getAttribute('aria-label')||(ids.length?ids.map(id=>safeText(document.getElementById(id))).join(' '):'')||(e.labels?[...e.labels].map(safeText).join(' '):'')||safeText(e)||e.getAttribute('title')||e.getAttribute('placeholder')).slice(0,500)};
const elements=[];let scanned=0,truncated=false;
for(const e of document.querySelectorAll('*')){if(++scanned>5000){truncated=true;break}if(!visible(e)||sensitive(e))continue;const r=role(e);if(!r)continue;const b=e.getBoundingClientRect();if(b.bottom<=0||b.right<=0||b.top>=innerHeight||b.left>=innerWidth)continue;if(elements.length>=200){truncated=true;break}const hit=document.elementFromPoint(b.x+b.width/2,b.y+b.height/2);const item={nodeId:nodeIdentity(e),role:r.slice(0,100),name:name(e),disabled:!!e.disabled||e.getAttribute('aria-disabled')==='true',rect:[b.x,b.y,b.width,b.height],hit:!!hit&&(hit===e||e.contains(hit)),frameHit:!!hit&&!!hit.closest('iframe,frame,object,embed'),fileHit:!!hit&&!!hit.closest('input[type=file]'),unknownShadow:!!e.shadowRoot||e.tagName.includes('-')||!!hit&&(!!hit.shadowRoot||hit.tagName.includes('-')),tag:e.tagName,inputType:e.tagName==='INPUT'?e.type:'',readOnly:!!e.readOnly};if('value' in e&&!sensitive(e)&&e.type!=='file')item.value=clean(e.value).slice(0,500);elements.push(item)}
const text=safeText(document.body);let url;try{const u=new URL(location.href);u.username='';u.password='';u.search='';u.hash='';url=u.href}catch{url='about:blank'}
return {documentId,url,title:clean(document.title).slice(0,500),text:text.slice(0,20000),elements,activeNodeId:document.activeElement?nodeIdentity(document.activeElement):'',viewport:[scrollX,scrollY,innerWidth,innerHeight],truncated:truncated||textTruncated||text.length>=20000};
})()`
}

/** 固定脚本的内部传输元素；nodeId 和布局不直接输出给模型。 */
interface RawElement {
  /** 当前 DOM 节点的无内容随机身份。 */
  nodeId: string
  /** 感知器推导角色。 */
  role: string
  /** 已过滤的显示名称。 */
  name: string
  /** 普通字段值；敏感字段不产生元素。 */
  value?: string
  /** 原生或 ARIA 禁用状态。 */
  disabled: boolean
  /** 视口 CSS 像素 x、y、width、height。 */
  rect: number[]
  /** 元素中心能命中自身或后代。 */
  hit: boolean
  /** 主文档元素标签，仅输入重核使用。 */
  tag?: string
  /** 中心是否实际命中嵌入文档；容器引用也不能绕过frame边界。 */
  frameHit?: boolean
  /** 中心命中file控件，需任务10独立文件授权。 */
  fileHit?: boolean
  /** 可识别的shadow宿主或自定义目标不能当成已确认的主文档内部目标。 */
  unknownShadow?: boolean
  /** 原生字段类型，作为审批绑定一部分。 */
  inputType?: string
  /** 原生只读状态，作为审批绑定一部分。 */
  readOnly?: boolean
}
/** 主文档原始快照，只在一次请求栈中保留，缓存仅保存摘要与随机节点身份。 */
interface RawSnapshot {
  /** 当前文档根节点标记。 */
  documentId: string
  /** 净化前的地址仅供单次解析，输出与摘要均净化。 */
  url: string
  /** 有界文档标题。 */
  title: string
  /** 已过滤的有界可见文字。 */
  text: string
  /** 有界交互元素。 */
  elements: RawElement[]
  /** scrollX、scrollY、视口宽高，单位 CSS 像素。 */
  viewport: number[]
  /** 任何遍历或输出达到上限。 */
  truncated: boolean
}
/** @param raw 原生固定脚本结果。@returns 有上限且形状正确的快照；不将缺失能力解释为一个空页面。 */
function parse(raw: unknown): RawSnapshot {
  if (!raw || typeof raw !== 'object') {
    throw new Error('页面感知结果无效')
  }
  const s = raw as RawSnapshot
  if (typeof s.documentId !== 'string' || typeof s.url !== 'string' || typeof s.title !== 'string' || typeof s.text !== 'string' || !Array.isArray(s.elements) || s.elements.length > 200 || !Array.isArray(s.viewport) || s.viewport.length !== 4 || !s.viewport.every(Number.isFinite) || s.text.length > 20000 || s.title.length > 500 || typeof s.truncated !== 'boolean') {
    throw new Error('页面感知结果无效')
  }
  const identities = new Set<string>()
  for (const e of s.elements) {
    if (!e || typeof e.nodeId !== 'string' || typeof e.role !== 'string' || typeof e.name !== 'string' || e.name.length > 500 || typeof e.disabled !== 'boolean' || typeof e.hit !== 'boolean' || !Array.isArray(e.rect) || e.rect.length !== 4 || !e.rect.every(Number.isFinite) || (e.value !== undefined && (typeof e.value !== 'string' || e.value.length > 500))) {
      throw new Error('页面元素结果无效')
    }
    if (identities.has(e.nodeId)) {
      throw new Error('页面元素身份冲突')
    }
    identities.add(e.nodeId)
  }
  // 再次净化原生返回的地址，避免把查询、片段或 HTTP 凭据输出；原始地址不留存。
  const url = new URL(s.url)
  url.username = ''
  url.password = ''
  url.search = ''
  url.hash = ''
  return { documentId: s.documentId, url: url.href, title: s.title, text: s.text, viewport: [...s.viewport], truncated: s.truncated, elements: s.elements.map(e => ({ nodeId: e.nodeId, role: e.role, name: e.name, disabled: e.disabled, rect: [...e.rect], hit: e.hit, ...(typeof e.tag === 'string' ? { tag: e.tag, frameHit: e.frameHit === true, fileHit: e.fileHit === true, unknownShadow: e.unknownShadow === true, inputType: e.inputType ?? '', readOnly: e.readOnly === true } : {}), ...(e.value === undefined ? {} : { value: e.value }) })) }
}
/** @param value 单次已过滤布局快照。@returns SHA-256 摘要，避免在引用注册表缓存网页文字或输入值。 */
async function digest(value: RawSnapshot): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(value))
  const hash = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('')
}
/** @returns 单页引用边界；调用方必须在每个 await 前后重新确认页面许可，并在接管/关闭时 clear。 */
export function createSemanticReader(): {
  /** @param raw 本次固定脚本结果。@returns 当前观察及新引用；新观察使此前全部引用失效。 */
  observe: (raw: unknown) => Promise<SemanticObservation>
  /** @param reference 工具提供的最新引用。@param raw 同一页面即时固定脚本结果。@returns 当前中心点；文档、布局、状态或命中变化均冲突。 */
  resolve: (reference: string, raw: unknown) => Promise<ResolvedElement>
  /** 同步撤销引用与摘要，不读取页面，也不恢复旧观察。 */
  clear: () => void
  /** @param reference 最近引用。@param raw 即时固定快照。@param fileChoice 默认false；仅choose-file允许精确标准file目标，其他file命中仍拒绝。@returns 带完整状态摘要的原生输入目标；frame拒绝。 */
  inputTarget: (reference: string, raw: unknown, fileChoice?: boolean) => Promise<InputTarget>
} {
  let revision = 0
  let current: { documentId: string, observationId: string, digest: string, refs: Map<string, string> } | undefined
  const reader = {
    clear: () => {
      revision++
      current = undefined
    },
    observe: async (raw: unknown) => {
      current = undefined
      const generation = ++revision
      const s = parse(raw)
      const observationId = crypto.randomUUID()
      const refs = new Map<string, string>()
      const elements: SemanticElement[] = s.elements.map((e, i) => {
        const reference = `${observationId}:${i}`
        refs.set(reference, e.nodeId)
        return { reference, role: e.role, name: e.name, disabled: e.disabled, ...(e.value === undefined ? {} : { value: e.value }) }
      })
      const fingerprint = await digest(s)
      if (generation !== revision) {
        throw new Error('观察已取消，不留存迟到引用')
      }
      current = { documentId: s.documentId, observationId, digest: fingerprint, refs }
      return { kind: 'semantic' as const, documentId: s.documentId, observationId, url: s.url, title: s.title, text: s.text, elements, truncated: s.truncated }
    },
    resolve: async (reference: string, raw: unknown) => {
      const saved = current
      const s = parse(raw)
      const fingerprint = await digest(s)
      const nodeId = saved?.refs.get(reference)
      const e = s.elements.find(e => e.nodeId === nodeId)
      if (!saved || current !== saved || saved.documentId !== s.documentId || fingerprint !== saved.digest || !e || e.disabled || !e.hit) {
        current = undefined
        throw new Error('[agent-browser/reference-conflict] 引用失效；页面、文档、滚动、布局或目标状态已变化，请重新 observe')
      }
      return { kind: 'resolved' as const, documentId: s.documentId, observationId: saved.observationId, reference, x: e.rect[0]! + e.rect[2]! / 2, y: e.rect[1]! + e.rect[3]! / 2 }
    },
  }
  return { ...reader, inputTarget: async (reference, raw, fileChoice = false) => {
    const resolved = await reader.resolve(reference, raw)
    const saved = current
    const snapshot = parse(raw)
    const nodeId = saved?.refs.get(reference)
    const element = snapshot.elements.find(element => element.nodeId === nodeId)
    if (!element?.tag || element.frameHit || ['IFRAME', 'FRAME', 'OBJECT', 'EMBED'].includes(element.tag)) {
      throw new Error('当前目标不具备已核验的主文档原生输入能力；frame另待任务09')
    }
    if (element.unknownShadow || (fileChoice ? element.tag !== 'INPUT' || element.inputType !== 'file' || !element.fileHit : element.fileHit || element.inputType === 'file')) {
      throw new Error('file或不可核验的shadow/custom目标不属于当前主文档输入；文件另待任务10授权')
    }
    return { ...resolved, url: snapshot.url, fingerprint: saved!.digest, tag: element.tag, name: element.name, nodeId: element.nodeId, inputType: element.inputType ?? '', readOnly: element.readOnly === true }
  } }
}
