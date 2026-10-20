# 页面语义观察与元素引用

任务06已完成当前主文档观察与引用切片的受控回归及官方 Desktop 原生验收。本页描述仓内固定感知器 v1 的实际范围；任务06完成不代表完整 G4/G5、A04/A05 或首版通过。

## 选型与公开能力

复用固定官方浏览器 `0.2.0-rc.2` 自行持有的原生 guest，通过公开 `getURL`、`executeJavaScript` 执行固定主文档感知脚本，并使用公开导航事件撤销引用。没有完整 Playwright、CDP、后台浏览器或额外页面服务；既有 Host 测试站仍只用于验证。

核验了候选 [dom-accessibility-api v0.7.1 的 package.json](https://github.com/eps1lon/dom-accessibility-api/blob/v0.7.1/package.json)（版本 `0.7.1`、MIT）和[该版本许可证](https://github.com/eps1lon/dom-accessibility-api/blob/v0.7.1/LICENSE.md)。该库负责 accessible name/description，并不提供页面实例、滚动或布局引用有效性。当前选择仓内独立编写的固定 DOM 感知器 v1，没有复制该库代码或新增感知运行依赖；相关源码及构建器一起参与产物指纹。官方[公开 webview 文档](https://www.electronjs.org/docs/latest/api/webview-tag)是能力说明，实际平台通过范围仍须本版本原生证据支持。

感知器输出 HTML/ARIA 推导角色、标签及可见文字，**不声称完整 W3C 可访问性树**。它不穿透 frame 或闭合 Shadow DOM；跨域 frame 仍属于任务09。对当前文档没有 body/root 的情形直接拒绝或仅输出实际可见内容，不将方法缺失当作空白页成功。

## 工具契约

增强入口 `agent_browser` 增加两个动作，继续使用同一 Broker、真实调用 Agent 会话身份、Host 页面凭据与暂停代次；历史实验入口不开放这两个动作。

| 参数 | 行为 |
| --- | --- |
| `action=observe` | 按需读取当前自有真实主文档，不限定计数夹具网址；成功的新观察可解除交回后的观察屏障。 |
| `action=resolve` | 对此页最近观察返回的 `reference` 进行只读重核，返回当前视口中心坐标；不点击、不解除交回观察屏障。 |
| `pageId` | 可选；省略时只允许调用会话恰有一个已登记页面。 |
| `reference` | `resolve` 必填，最多250字符；不接受 CSS、脚本或网页提供的会话身份。 |

`read/click` 仍为历史计数夹具动作。正式输出使用 SDK `oneOf` 契约，Host 再对白名单字段和大小检查；完整成员含义见 [protocol.ts](../src/protocol.ts) 与 [Host 输出契约](../src/semantic-contract.ts)。

`observe` 返回 `pageId/kind/documentId/observationId/url/title/text/elements/truncated`；元素含 `reference/role/name/disabled`，普通表单另有可选 `value`。`resolve` 返回 `pageId/kind/documentId/observationId/reference/x/y`。URL 清除用户名、密码、查询及片段；输出文档身份由 Client 私有 nonce 与文档代次持有；任何公开导航事件、原生页面实例变化或根标记变化均换代。根节点无内容随机标记可被网页预设或伪造，只作为额外一致性检查，不能作为授权依据。脚本在不安全 HTTP 上也使用 `crypto.getRandomValues`，无需安全上下文的 `crypto.randomUUID`。

过滤规则覆盖 `password/hidden` 输入、密码/一次性验证码/银行卡/用户名 autocomplete 字段及显式 `data-agent-browser-sensitive` 子树；文本读取跳过脚本、样式、隐藏及敏感子树，不读取文件输入路径。普通输入值最多500字符，名称和标题最多500字符，主文档文字最多20000字符，交互元素最多200个，遍历布局节点最多5000个。达到上限返回 `truncated=true`，不能视为完整页面覆盖。此过滤不能证明截图、控制台或网页任意位置自行回显的秘密也已隐藏，相关能力需分别验收。

## 引用、暂停与确定性

每次新观察同步撤销旧引用，再铸造新的观察身份和引用。Client 仅保留文档/观察/节点身份与 SHA-256 摘要，不缓存已完成网页文字或输入值。感知脚本没有观察器、定时器、网络请求或持续采集；节点不再写入可复制的公开Symbol身份。

同一页面绑定使用Client UUID隔离的只读函数闭包，在WeakMap内以真实节点对象为键保存无内容身份；不暴露Map或setter。身份由Client前缀和闭包私有单调序号组成，不依赖网页的随机API；创建时绑定WeakMap方法，避免后续原型改写影响既有映射。同文档克隆即使复制全部公开Symbol属性、把网页crypto改为常量，也不能把旧节点身份赋给新节点。该主世界固定脚本仍读取不可信网页数据，不宣称隔离执行环境或完整恶意全局防御；Host归属权限和Client私有文档代次保持独立。

每个文本子树遍历最多5000个文本节点；预算耗尽且仍有节点时汇总为 `truncated=true`，即使总字符数不足20000也不会报告完整。外部guest VM回归实际执行固定脚本，覆盖5001个短文本节点和上述克隆复制情形；它不能代替原生DOM验收。

重核必须取得新的固定感知结果，并比较文档、视口滚动和尺寸、元素节点、语义状态及矩形等快照摘要；禁用或中心被遮挡也拒绝。变化返回 `[agent-browser/reference-conflict] 引用失效`，调用方必须重新 `observe`，不会猜测或自动选择另一个同名元素。公开导航事件也直接撤销引用并推进 Client 私有文档代次，包含同文档导航；它们只处理状态，不采集页面内容。即使网页预设相同 Symbol UUID，导航后输出的文档身份仍改变，旧引用不能恢复。

Client 在每个异步步骤前后检查本地取消、页面实例、Client 私有文档代次、Host 请求代次与许可；交付前再次读取文档标记，拒绝同网址换文档的旧结果。接管同步清除引用与摘要、阻止新采集，等待已开始的原生读取及通信结算；暂停后迟到结果不能生成可复用引用，交回必须重新观察。关闭或断线取消导航监听并撤销凭据，不自动恢复旧观察。

通用页面必须具有公开 `addEventListener/removeEventListener` 导航事件能力，缺少时明确拒绝观察、截图与控制台，而不是降级为只信任网页可伪造的根标记。

## 受控验证与复现步骤

[统一边界回归](../test/semantic-observation.test.ts)使用真实 Broker、Host Fetch 和 Client，仅在宿主服务、原生 guest 与执行上下文边界替换。覆盖非夹具页面、普通新文本、滚动/节点替换/导航引用失效、同网址换文档拒绝、接管等待旧读取、暂停不读取以及交回不能使用旧引用。受控替身不证明真实 DOM 行为；以下原生记录另行证明本次自有页面上的实际表现。

原生验收应记录当前增强构建摘要，并在本会话同一官方页面执行：

1. 打开自有动态测试页，包含普通输入、密码/验证码字段、可见文字、可重排按钮与可滚动内容；调用 `observe`，核对真实文字和元素名称、敏感值及 URL 凭据未输出。
2. 用官方 UI 修改普通内容后再次 `observe`；用最近引用 `resolve`，核对中心命中。分别人工重排、滚动、同网址重载和同文档导航，旧引用必须失败；重新观察后新引用可用。
3. 进行人工接管、暂停期编辑、交回；暂停 `observe/resolve` 必须拒绝，旧引用不能恢复，重新观察读到人工新状态。记录实际页/文档/观察关联，并如实列出未测项。

验收不得访问真实账号、修改主程序/ASAR/私有 IPC，或将 frame、完整脚本及其他未完成要求缩减为延期。


## 官方 Desktop 原生记录

2026-10-16 在官方 macOS Desktop `0.2.0-rc.2` 安装构建 `3d153edf9a36`，经真实 Agent 的正式 `ToolRuntime.execute` 调用同一可见自有动态页；没有发送模型消息。白名单记录与构建摘要见[语义观察证据](evidence/semantic-observation-verification.json)。

- 首次 `observe/resolve` 的 pageId、documentId 与 observationId 对应。密码、验证码假值及 frame 独立正文未进入观察；这只证明自有测试字段，不证明任意秘密自动脱敏。
- 官方 UI 人工填入“人工更新·原生验收 2026-10-16”，新观察取得该值且保持同页同文档。人工移动按钮、替换同名节点、滚动及同网址重载后，旧引用分别返回 `reference-conflict`；重载后 pageId 保持、私有 documentId 改变。
- 人工接管期间 `observe/resolve` 拒绝；交回未重新观察时写入拒绝。新 `observe` 读取“接管期人工内容·不自动补发”，旧页关闭后再次观察拒绝。

同一源码完整 `pnpm check` 退出0，19文件104项通过、0跳过；Standards / Spec 定向复审各0未解决、0新增。Node 实际22.20.0，仓库要求24.21.0，警告保留，不增加Node22支持。原生后的卸载与profile/端口/ASAR清理结论见证据记录。

5001文本节点截断、复制全部公开Symbol并将网页crypto改常量、异步读取迟到、会话越权及同文档导航仍引用受控边界回归，未伪称本轮逐项原生竞态。跨域 frame、闭合 Shadow DOM、模型自主调用及其他平台未由本轮证明。
