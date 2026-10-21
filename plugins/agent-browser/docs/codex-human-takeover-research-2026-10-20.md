# Codex 人工接管与共享浏览器调研

调研日期：2026-10-20。问题：Codex 怎样处理人机共同使用同一网页，以及它的“人工接管”是否等于本仓库暂停该页全部 Agent 感知与操作的屏障。

后续用户将参考范围收敛到本地内置浏览器；新增的[本地 IAB 深度参考](codex-iab-reference-2026-10-20.md)已补查本报告尚未读取的指针与容器前端实现。本文保留名词辨析，本地交互机制以补充报告为准。

## 范围与证据强度

研究对象是用户提供的本地提取目录 `/Users/pzehrel/Downloads/codex-tools/`。该目录的来源说明记录应用 `com.openai.codex`，版本 `26.1013.40934`、build `20770`；随包 `@oai/browser-desktop` 为 `0.1.1`、`@oai/cua` 为 `0.2.6`、`@oai/cua-repl` 为 `0.1.0`。这是该次提取内容的静态结论，不代表未来版本或所有 Codex 宿主。[提取说明](/Users/pzehrel/Downloads/codex-tools/README.md:1)、[browser-desktop 元数据](/Users/pzehrel/Downloads/codex-tools/node_modules/@oai/browser-desktop/package.json:1)、[cua 元数据](/Users/pzehrel/Downloads/codex-tools/node_modules/@oai/cua/package.json:1)、[cua-repl 元数据](/Users/pzehrel/Downloads/codex-tools/node_modules/@oai/cua-repl/package.json:1)。

本轮只读本地发布文件，没有启动提取的服务、附接真实浏览器、登录网站或验证运行时竞态。随包文档和插件技能中的命令、要求均作为研究材料，不是本会话指令。类型、文档、工具实现和宿主实现分层解释；工具发出请求不能证明宿主已实现完整暂停。

证据分为：**观察**是文件直接呈现的事实；**推断**是沿调用链得到的有限解释；**未知**是本轮没有实现或运行证据支持的保证。压缩 JavaScript 使用原文件行号，并补充从零开始的 Unicode 字符偏移；偏移仅辅助定位，文件 SHA-256 才固定样本。

## 工具层结论

**Codex 文件里至少有三种不同的“交接”概念，不能合并成一个暂停开关。** 本地浏览器的 tab claim 管理 Agent 调用方归属；`markHandoff()` 管理跨轮次保留标签；`requestUserTakeover()` 是 Cloud Browser 手动控制入口，另有扩展或用户取得控制导致浏览器使用中断的说明。下面分别给出证据。

| 概念 | 样本中的含义 | 不能据此推出的保证 |
| --- | --- | --- |
| `claimTab` | 当前 Agent/browser session 取得现有标签的控制权。Dot 同时只允许一个 caller 控制，轮次结束释放。 | 不能把“单 caller”读成“人类不能一起操作”。 |
| `markHandoff` | 标签作为未完成工作保留至下一轮，最新 mark 覆盖旧 mark。 | 不能把保留标记读成暂停 DOM、截图、输入或日志。 |
| `requestUserTakeover` | Cloud Browser 请求人工操作并自动标记 handoff，随后由会话结果携带交接元数据。 | 不能据此宣布 Codex 本地 IAB 具备同名通用暂停 API。 |
| 控制中断 | 随包说明承认 extension/user took control 会中断 browser use。 | 该一句说明没有列出全部被停能力、粒度与恢复屏障。 |

上述四项分别来自 [Dot claim 文档](/Users/pzehrel/Downloads/codex-tools/node_modules/@oai/browser-desktop/environment-docs/codex-app/tab-claiming-dot.md:1)、[IAB 清理文档](/Users/pzehrel/Downloads/codex-tools/node_modules/@oai/browser-desktop/environment-docs/codex-app/tab-cleanup-iab.md:1)、[Cloud handoff 文档](/Users/pzehrel/Downloads/codex-tools/node_modules/@oai/browser-desktop/environment-docs/cloud/cloud-auth.md:26)、[控制中断文档](/Users/pzehrel/Downloads/codex-tools/node_modules/@oai/browser-desktop/environment-docs/codex-app/browser-control-interruption.md:1)。

### 同一标签可否由人和 Agent 同时使用

**观察。** Dot 的说明是“Only one caller can control a tab at a time”，并明确区分 `browser.user.openTabs()` 的无 claim 列表、`browser.tabs.list()` 的当前 caller 已 claim 列表，以及轮次结束时释放 claim。Cloud/CDP 的相应文档说的是“one browser session at a time”。这些对象是 Agent 调用方/browser session，不是人的鼠标、键盘或阅读权限。[Dot claim](/Users/pzehrel/Downloads/codex-tools/node_modules/@oai/browser-desktop/environment-docs/codex-app/tab-claiming-dot.md:2)、[CDP claim](/Users/pzehrel/Downloads/codex-tools/node_modules/@oai/browser-desktop/environment-docs/cloud/tab-claiming-cdp.md:3)。

**观察。** `cua.getTab` 包装器会先找当前已管理的标签，否则通过 `c.user.claimTab(h)` 取得现有标签，然后调用 `getAXState({disableDiffing:true, emit:false})`，输出初始页面状态。这里没有向人的输入通道加锁的代码。该事实仅限定于包装器；人的输入是否保留，要再看宿主。[create_browser_api.js](/Users/pzehrel/Downloads/codex-tools/node_modules/@oai/cua/dist/lib/js/oai_js_cua/src/tinysky_alt/create_browser_api.js:1)。

```text
// 原发布代码节选，变量名保留。
if (v.some((e) => e.id === h.id)) m = yield c.tabs.get(h.id);
else m = yield c.user.claimTab(h);
// 包装器随后取得全量 AX 初始状态。
r.getAXState({ disableDiffing: !0, emit: !1 });
```

**推断。** claim 的主要职责是隔离多个 Agent 调用方，不能拿它回答“人类能否同时滚动/输入”。是否存在人机争用防护，须以具体浏览器后端的宿主证据为准；现有工具层文本没有承诺两套独立滚动、焦点或表单状态。

### `requestUserTakeover()` 实际走到哪里

**观察。** API 声明明确把它描述为 Cloud Browser 的人工控制请求，并默认在 `extension`、`iab`、`cdp`、`mcpapps` 四种后端关闭；旧名 `requestManualHandoff` 默认同样关闭且不公开文档。默认关闭不是“Cloud 永远不能用”，实际可用性还受能力和覆盖声明决定。[codex-app/api.json](/Users/pzehrel/Downloads/codex-tools/node_modules/@oai/browser-desktop/environment-docs/codex-app/api.json:476)。

**观察。** 客户端旧名直接调用新名；新名只发送 `tab_manual_handoff_request`。原文件第 9 行、字符偏移 `156224` 附近可见：

```text
async requestManualHandoff() { return this.requestUserTakeover() }
async requestUserTakeover() {
  await this.#r.send({ command: Lt.create({ browser_id: this.#e, tab_id: this.id }) })
}
```

来源：[browser-client.mjs](/Users/pzehrel/Downloads/codex-tools/node_modules/@oai/browser-desktop/scripts/browser-client.mjs:9)。

**观察。** 服务端 `ManualHandoffCommand` 在第 5560 行、字符偏移 `1226892` 附近：先检查当前页面操作权限，只接受 `type === "cdp"` 且声明对应认证能力的客户端；旧 ChatGPT 客户端会被拒绝；然后 `tabs.get(o)` 和 `tabs.mark(o, "handoff")`。该处理器自身没有调用“暂停全部读写”方法。

```text
if (!(e.clientInfo.type === "cdp" && r.some(i => i.id === an.id)))
  throw Eo(e.clientInfo.name, { type: oe.ManualHandoff.commandType });
// 中间还有 browser_auth_client_unsupported 检查。
let o = $(t.tab_id);
return await e.tabs.get(o), await e.tabs.mark(o, "handoff"), {};
```

来源：[browser-service.mjs](/Users/pzehrel/Downloads/codex-tools/node_modules/@oai/browser-desktop/scripts/browser-service.mjs:5560)。这证明该工具处理器的行为，不证明远端 Cloud 浏览器的全部控制实现。

**观察。** 命令成功后，服务第 8929 行还调用 `followSessionTab(tabId, "handoff")`；第 8923 行 `fL` 记录成功请求，第 8923 行 `gL` 构造 `https://chatgpt.com/browser/handoff`，携带 `thread_id`、`tab_id`，必要时加 `connection_thread_id`，并发出 `{browserHandoff:{url,cloud_browser_handoff}}`。这使交接绑定既有会话/标签；它不是再打开同网址的另一个普通页面。[命令调度](/Users/pzehrel/Downloads/codex-tools/node_modules/@oai/browser-desktop/scripts/browser-service.mjs:8929)、[结果元数据与链接](/Users/pzehrel/Downloads/codex-tools/node_modules/@oai/browser-desktop/scripts/browser-service.mjs:8923)、[Cloud 文档](/Users/pzehrel/Downloads/codex-tools/node_modules/@oai/browser-desktop/environment-docs/cloud/cloud-auth.md:26)。

### 停哪些能力、怎样继续

**观察：Agent 行为规则。** Cloud 文档要求发起交接后说明情况并结束当前轮次。无认证能力的 Cloud 指引明确要求在用户输入凭据前停止自动化，人工登录过程中不观察、不操作；用户要求继续后，只观察最终页面状态。认证能力文档也要求 `declined` 且 `reason: "user_took_over"` 时重新观察最终页面，不读人工登录中间过程。[Cloud handoff](/Users/pzehrel/Downloads/codex-tools/node_modules/@oai/browser-desktop/environment-docs/cloud/cloud-auth.md:43)、[Cloud 无认证指引](/Users/pzehrel/Downloads/codex-tools/node_modules/@oai/browser-desktop/environment-docs/cloud/cloud-no-auth.md:69)、[认证结果处理](/Users/pzehrel/Downloads/codex-tools/node_modules/@oai/browser-desktop/environment-docs/codex-app/capabilities/tab/browserAuth.md:319)。这是发给 Agent 的工作约定，不能单独证明底层无法截图或采集日志。

**观察：控制中断提示。** Codex 本地文档明确承认用户或扩展取得控制会中断 browser use；但这一文件只规定如何面向用户描述错误，没有列出 DOM、AX、截图、控制台、导航或后台资源各自的停止保证。[browser-control-interruption.md](/Users/pzehrel/Downloads/codex-tools/node_modules/@oai/browser-desktop/environment-docs/codex-app/browser-control-interruption.md:1)。

**观察：跨轮恢复。** Dot 说明允许存活的 `Tab` 在下一轮自动重新尝试 claim；服务也在 `needsReclaim(tabId)` 为真时调用 `browserUser.claimTab`，再执行请求。`needsReclaim` 比较取得标签时的 turn ID 与当前 turn ID。没有在这些工具层位置看到“成功新 observe 才解锁所有写动作”的统一状态位。[Dot claim](/Users/pzehrel/Downloads/codex-tools/node_modules/@oai/browser-desktop/environment-docs/codex-app/tab-claiming-dot.md:5)、[生命周期状态](/Users/pzehrel/Downloads/codex-tools/node_modules/@oai/browser-desktop/scripts/browser-service.mjs:8914)、[自动 reclaim 调度](/Users/pzehrel/Downloads/codex-tools/node_modules/@oai/browser-desktop/scripts/browser-service.mjs:8929)。

**未知。** 仅靠以上工具文件，不能确认本地用户接管究竟是停整个 turn、browser session 还是单 tab；不能确认接管后在途截图/日志结果必定丢弃，已创建的 timer/observer/worker 必定停止，或者交回必定由宿主强制先读后写。这些问题需要宿主实现或真实竞态验证，不以提示词要求代替实现证明。

### 是否隐藏数据、清理历史

**观察。** `markHandoff` 是标签生命周期标记；清理文档谈的是轮次结束时关闭临时 Agent 标签、保留输出/交接标签、释放 claim，未把交接描述为删除 Cookie、聊天记录或浏览历史。`requestUserTakeover` 已查处理器也只有校验与 mark，不能推导“接管会清除之前看到的内容”。[IAB 清理](/Users/pzehrel/Downloads/codex-tools/node_modules/@oai/browser-desktop/environment-docs/codex-app/tab-cleanup-iab.md:1)、[Chrome 清理](/Users/pzehrel/Downloads/codex-tools/node_modules/@oai/browser-desktop/environment-docs/codex-app/tab-cleanup-chrome.md:1)、[handoff 处理器](/Users/pzehrel/Downloads/codex-tools/node_modules/@oai/browser-desktop/scripts/browser-service.mjs:5560)。

**观察。** 工具服务另有凭据保护机制，不能与普通接管混同。例如它区分 `credential_delivery_in_progress`、`credential_observation_restricted`、`retained_data_restricted`，并在命令前后执行观察检查、对可能包含保护数据的底层错误作替换；受限时可能要求新文档、新标签或新运行时。即使停止人工登录期间观察，也不等于清除模型已经收到的历史。[凭据恢复错误](/Users/pzehrel/Downloads/codex-tools/node_modules/@oai/browser-desktop/scripts/browser-client.mjs:1)、[命令前后凭据观察门](/Users/pzehrel/Downloads/codex-tools/node_modules/@oai/browser-desktop/scripts/browser-service.mjs:8914)。

**未知。** 本轮未验证 Cloud 的远端画面录制、服务日志保留、历史清除或人工输入脱敏实现。不能承诺接管自动隐藏此前内容，也不能承诺接管会清理用户浏览数据。

## 宿主实现补充

**观察：本地 IAB 控制状态与清理。** 主进程 `main-CLu1A25j.js` 第 1003 行的 `markTab` 仅记录 `handoff`/`deliverable` 与 turn ID；`releaseSessionControl` 清理 blob 授权、执行 `detachBrowserUseTabsForHostsBestEffort`、清 Agent 光标并将 active 置 false。`turnEnded` 通过 `restorePageClipboards` 清理页面剪贴板桥接、清 debugger，再依据 mark 与标签生命周期保留、释放或关闭。它们说明标签归属与轮次清理，不能直接等同于“人工接管暂停所有数据通道”。定位用从零开始的字符偏移分别为 `1798883`、`1800016`、`1800305`。[宿主主进程 bundle](/Users/pzehrel/Downloads/codex-tools/application/asar/.vite/build/main-CLu1A25j.js:1003)。

**观察与未知：原生输入边界。** 本地宿主 `setBrowserUseActive` 最终调用 `webContents.setAgentActive(n)`。这是该应用原生运行时的扩展边界；提取目录没有完整 Codex Framework。因而无法只凭 JavaScript 宣称任意用户滚动会自动暂停、用户和 Agent 的输入被彻底隔离，或同时输入会怎样仲裁。[宿主主进程 bundle](/Users/pzehrel/Downloads/codex-tools/application/asar/.vite/build/main-CLu1A25j.js:1003)、[提取边界](/Users/pzehrel/Downloads/codex-tools/README.md:34)。

**观察：Cloud UI 确有控制权切换。** Cloud 本地 live-view 组件通过 `GET /flora/browser/handoff` 取得 `novnc_url`，用 iframe 显示远端页面；`inert: !isControlActivated` 与覆盖按钮的 `onControlActivation` 控制是否可交互。另一组件显示 `ChatGPT has control`，说明文字具体指 mouse and keyboard control。侧栏另有 `realtime.chatgpt.com/v1/cua`、handoff 与 `waitForHandoff` 路径。这支持云端远程鼠标/键盘交接，不证明本地 IAB 使用相同模式，也不证明 Cloud 服务端强制停止全部 DOM、截图或日志通道。[Cloud live-view](/Users/pzehrel/Downloads/codex-tools/application/asar/webview/assets/cloud-browser-local-live-view-b5d40a304f4e.js:1)、[Cloud 控制文案](/Users/pzehrel/Downloads/codex-tools/application/asar/webview/assets/cloud-browser-view-e9ece99eeb4d.js:1)、[Cloud 侧栏](/Users/pzehrel/Downloads/codex-tools/application/asar/webview/assets/cloud-browser-side-panel-84ea719cd78e.js:2)。

上述宿主结论来自 REA 静态分析与精确片段核对；主 bundle 的完整语义分析未完成，未取得全调用图证明。REA 主证据 ID 为 `ev_f2b9bc02f2fe72a45b87db5490d33e12cfea19686477cb19bd5c9c622bfb4242`，摘要证据为 `ev_305f826368cb9b1a4bdc1814c287d6342ac3212f646cfc6ddebc47070e3326d2`。这些 ID 只用于该次调查追溯，不能替代本地文件或运行验证。

## 与本仓库的差别

本仓库已接受的产品约定是：普通浏览允许人机并行；人工接管是可选的**单页感知与操作暂停**。词汇表和 ADR 明确区分普通手动滚动与人工接管，并说明独立 Agent 指针不等于独立的滚动、焦点或表单状态。这是本仓库的需求与设计约定，ADR 也明确说用户对 Codex 的观察仅说明动机，不作为 Codex 内部架构证据。[词汇表](../GLOSSARY.md)、[ADR 0004](../../../.agents/docs/adr/plugins/agent-browser/0004-human-agent-interaction.md)。

| 要求 | Codex 工具层已观察到的证据 | 本仓库已查到的实现/约定 |
| --- | --- | --- |
| 普通手动操作 | claim 只说明 Agent caller 归属；人的输入是否可用要查宿主。 | 普通手动浏览不强制暂停 Agent。 |
| 接管状态 | Cloud handoff 请求、标签 mark、扩展/用户控制中断说明。 | `paused` 单页状态，Broker 拒绝该页新请求。 |
| 在途结果 | 工具文件未证明通用接管丢弃所有旧结果。 | `pause()` 增加 epoch，取消 pending；Client 先设本地 blocked 并 abort，再等待 Host ACK 和在途结算。 |
| 交回 | 规则要求人工登录结束后看最终状态；跨轮可能自动 reclaim。 | 交回设置 `needsObservation`，新 read/observe 成功才解锁相应写操作；旧请求不重放。 |
| 失败处理 | 支持控制中断与认证拒绝等错误；完整宿主恢复待查。 | 接管/交回失败保留本地屏障，状态明确显示失败。 |
| 数据历史 | 未见 handoff 自动删除历史的证据。 | 明确不能撤回已发模型内容、附件或已完成网站动作。 |

本仓库实现证据：[Broker 请求入口、暂停代次与交回观察](../src/broker.ts)、[Client 转换屏障](../src/fixed-page-client.ts)、[状态按钮与提示](../src/tool-status.tsx)、[人工操作说明](../README.md#人机操作方式)。这些证据只说明相应控制层；后续截图、控制台、任意持续脚本等完整原生矩阵没有因此自动验收，既有报告保留限制。[现有人工接管验证](human-takeover-validation.md)、[页面脚本阻塞报告](approved-page-scripts-blockers.md)。

**调研判断。** 不能把 Codex 的 `markHandoff` 当作本仓库严格接管屏障的实现蓝本，也不能因它是“官方做法”而直接降低本仓库需求。可参考的是共享页面、Agent 调用方归属、跨轮标签保留和敏感步骤让用户完成的交互分工；具体暂停与恢复保证仍需自己的可验证接缝。

## 关键文件指纹

以下 SHA-256 固定本轮直接阅读的提取文件。路径均相对于 `/Users/pzehrel/Downloads/codex-tools/`；它们不是运行通过证明。`plugins/browser/scripts/browser-service.mjs` 与 `plugins/chrome/scripts/browser-service.mjs` 相同，但与 `@oai/browser-desktop` 的服务文件不同，因此正文行号限定于后者，不能直接套到插件副本。

| 文件 | SHA-256 |
| --- | --- |
| `application/asar/.vite/build/main-CLu1A25j.js` | `8aedee047ec0a078e65b24dc917c64ad544220395e773feb6740f4447008a495` |
| `application/asar/webview/assets/cloud-browser-local-live-view-b5d40a304f4e.js` | `0198946244f8f96faea9cfb92caa68154eaee14f1b34435f2ab1d6b8ef58d49c` |
| `application/asar/webview/assets/cloud-browser-view-e9ece99eeb4d.js` | `102269036cb6f064f4418463724a27b4caa167ba52f081caed3d6b8df0b0f025` |
| `application/asar/webview/assets/cloud-browser-side-panel-84ea719cd78e.js` | `53adeecf02fbc66dd06c31312424603bdcf5c26c09d9609f8afc68ed3b02fd35` |
| `README.md` | `e8521328a99c500ffb37a7023210012644a0d5750fe79571fc3c7d56a681f19d` |
| `node_modules/@oai/browser-desktop/scripts/browser-client.mjs` | `78f5a38ab02f23b68e4650e3bfe9ec2f269c5e004f30a1f59eee927a221a2e2f` |
| `node_modules/@oai/browser-desktop/scripts/browser-service.mjs` | `44594ea0a8238c09dfb46e28acdd610e5053a05011047e1c78fb98f210195a4e` |
| `node_modules/@oai/cua/dist/lib/js/oai_js_cua/src/tinysky_alt/create_browser_api.js` | `fe00757868fc4dd01b00d2cd1b315d7442497a4b33d7cd030450da4d47a114f0` |
| `node_modules/@oai/browser-desktop/environment-docs/codex-app/api.json` | `667ae407f87850ceae63a840287815a16e53da0440230da24e37bc6ce2fb7583` |
| `node_modules/@oai/browser-desktop/environment-docs/codex-app/tab-claiming-dot.md` | `926e329bf228c8cbecd139f35fc9bdce53711b46bca4227d473daab5ad3d484c` |
| `node_modules/@oai/browser-desktop/environment-docs/codex-app/browser-control-interruption.md` | `2fd73066304bc822ce3fba35eeba6456a0505f32f2f1364424639a08e49d1d5a` |
| `node_modules/@oai/browser-desktop/environment-docs/codex-app/tab-cleanup-iab.md` | `cf14b2134734b17d80801b30a9febcdb06b7bed25cd2b12ea2277835022e4a36` |
| `node_modules/@oai/browser-desktop/environment-docs/cloud/cloud-auth.md` | `03d5495340a9a57f56461464a82588892e44fd541dd86a6d4f0870001e4e6351` |
| `node_modules/@oai/browser-desktop/environment-docs/cloud/cloud-no-auth.md` | `2d62cfc556c335ef1d605f97b2616dc141cea860a294181e20488193ff0ef3a9` |
| `plugins/browser/scripts/browser-service.mjs`、`plugins/chrome/scripts/browser-service.mjs` | `c470cdc7f98be2724ef1c85f6b9d3757d80de022b065ca14d922d7a1a85ffc9a` |

## 验证与未决问题

正文中的工具调用链、包版本、短片段和行号来自本地发布文件静态核对。没有把安装包里的提示词当作已执行证明；没有验证 Cloud 服务端、原生框架或扩展未提供的实现。报告只新增研究文档，不改产品实现、兼容范围、事项状态或 ADR。
