# 官方公开能力复核：2026-10-18

任务05的 `openResourceIn` 候选已被同日官方 Desktop 原生验证否定：既有 browser `contentId` 使用 `sidebar://browser/<uuid>`，该公开方法只接受 `dsh-resource://`，真实调用在进入标签 registry 前即抛错。最初研究遗漏了这两个地址协议不匹配；本文已撤回原 **needs-probe** 推荐。05、09、12均保持 **blocked**，13/14不解锁，首版发布阻塞与既定范围保留。

最初研究只读取官方发布、源码、公开 npm 元数据和既有本地证据；随后任务05沿既有实验设施，在本机官方 `0.2.0-rc.2` 执行限定验证。没有升级宿主或依赖、修改 DSH 主程序、访问真实账号、调用模型自主步骤或操作既有后台 Agent。临时候选已撤回，产品源码与测试恢复到本轮前内容；原生结果与清理记录见[公开路径验证证据](evidence/session-navigation-public-route-verification.json)。源码推断、受控回归及原生实测分别记录。

## 结论与版本边界

| 任务 | 研究结论 | 对当前实施的影响 |
| --- | --- | --- |
| [05 本会话多标签与导航](../../../.scratch/agent-browser/issues/05-session-tabs-navigation.md) | blocked：真实既有标签的地址协议不被 `openResourceIn` 接受 | 候选已撤回；保留任务05及13/14依赖，不改为新建资源标签以缩减范围。 |
| [09 跨域 frame](../../../.scratch/agent-browser/issues/09-cross-origin-frames.md) | blocked：没有取得完整身份、输入路由和审批后目标绑定的新正面路径 | 保留 G4 frame/A11 阻塞；既有截图正例和输入负例只代表原实测版本。 |
| [12 获准页面脚本](../../../.scratch/agent-browser/issues/12-approved-page-scripts.md) | blocked：没有取得保留原文档的完整资源归属及停止路径 | 保留 G4 脚本/G5 阻塞；不新增任意脚本工具。 |

截至2026-10-18本轮查询，官方最新发布记录为预发布 **`dsh-v0.2.1-rc.2`**，发布时间为 `2026-10-17T08:16:33Z`，对应 commit **`687f282e8625c6b8d11ff58211a90524be2e4317`**；查询到的默认分支 `master` 也指向该 commit。已验基线为 **`dsh-v0.2.0-rc.2` / `639ed015397290b3745d163aafe02ffee4aa3f84`**。这是查询时的公开状态，不是本机已升级证明。[官方发布](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.2.1-rc.2)、[官方 tags API](https://api.github.com/repos/deepseek-ai/deepseek-harness/tags?per_page=50)、[本轮 master 查询入口](https://api.github.com/repos/deepseek-ai/deepseek-harness/commits/master)。

官方 npm 的 browser/sidebar-right 两包均已发布 `0.2.1-rc.2`，查询时 `next` 指向该版本，而 `latest` 分别仍为 `0.1.6-alpha.2` 和 `0.1.5-alpha.1`。因此不能用未指定版本的安装推定取得最新候选版。两包元数据没有 `gitHead`，本轮分别核对发布声明和固定源码，不声称 npm 整包与 Git 树已做逐文件等价证明。[browser 元数据](https://registry.npmjs.org/@deepseek-ai/dsh-client-ui-sidebar-browser)、[sidebar-right 元数据](https://registry.npmjs.org/@deepseek-ai/dsh-client-ui-sidebar-right)。

## 实际复核范围

下载并比较两个固定 commit 的完整官方归档，逐字节对照 browser、sidebar-right、ui-session、Desktop `src/` 及相关声明；再检查新版本 Electron 的方法表、转发实现、事件与关键输入源码。GitHub compare API 的文件列表达300项上限，因此没有用那个截断列表推定相关文件没变化。[基线归档](https://codeload.github.com/deepseek-ai/deepseek-harness/tar.gz/639ed015397290b3745d163aafe02ffee4aa3f84)、[候选归档](https://codeload.github.com/deepseek-ai/deepseek-harness/tar.gz/687f282e8625c6b8d11ff58211a90524be2e4317)。

| 对象 | 本轮实际结果 |
| --- | --- |
| 基线完整归档 SHA-256 | `bbc09e888e1df3aa37be049abdb7720951e76442d21e5432365d87a465d628f1`，与仓库既有 provenance 相同。 |
| 候选完整归档 SHA-256 | `157903b22c2881d3678d846755afe957a48df834e747deda805a1195ce25a146`。 |
| `ui-sidebar-browser/src/` | 两版本24个源码文件全部字节相同；包版本、构建配置、说明及 locale 有变化。 |
| `ui-sidebar-right/src/client/contract/seed.ts` | `28c2cd8e27288df34f0953c507086c779c2ae326b47766756203b3561c513240`（两版本相同） |
| `ui-sidebar-right/src/client/service.ts` | 有变化；已查差异是单实例 page 在目标 pane 的揭示/替换规则，未增加 session 定向 `focus`。多实例 browser 的既有唯一 `contentId` 不等于该单实例 page 地址。 |
| `ui-session/src/client/index.ts` | 新增 `useAccess/useSessionAccess` 与 `remoteAccess` 注入；这是调用方的 Session 访问投影，不是浏览器标签选择或 guest 执行域。 |
| Desktop browser bridge、guest 管理 | `preload-browser.ts`、`browser-guests.ts` 与基线字节相同。 |
| Electron | Desktop 声明由 `^44.0.0` 变成 `^44.7.0`，候选 lockfile 解析 `44.7.0`。本轮据此复核 `v44.7.0`，未声称本机安装包已运行该版本。 |

固定源码：[sidebar-right service](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/client/ui-sidebar-right/src/client/service.ts)、[Session 访问投影](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/client/ui-session/src/client/index.ts#L683-L699)、[Desktop 依赖](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/apps/desktop/package.json)、[锁文件](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/pnpm-lock.yaml)。

### 05：公开方法存在，但不能揭示既有 browser 标签

[验证报告](session-navigation-validation.md)记录的 `focus(tabId)` 仅作用屏幕会话仍成立。最初研究沿公开声明、registry、store 和原浏览器生命周期提出 `openResourceIn(owner, tab.contentId, {kind:'browser', revealIfOpened:true})`；后续核对完整入口与真实标签身份，确认这条组合不可用。

1. **声明公开，不等于适用于所有内容地址。** 基线与新版 `SidebarRightController` 都公开 `openResourceIn`，Context 也持有该类；无需升级即可调用。但该方法转入 `placeResource`，先要求 `address.startsWith('dsh-resource://')`，之后才调用 `tabs.claim(address, kind)`。显式 `kind:'browser'` 只能绕过 registry 的 patterns 匹配，不能绕过 service 的协议检查。[公开声明](https://unpkg.com/@deepseek-ai/dsh-client-ui-sidebar-right@0.2.0-rc.2/lib/types/client/service.d.ts)、[基线入口及检查](https://github.com/deepseek-ai/deepseek-harness/blob/639ed015397290b3745d163aafe02ffee4aa3f84/packages/client/ui-sidebar-right/src/client/service.ts#L345-L408)、[新版入口及检查](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/client/ui-sidebar-right/src/client/service.ts#L345-L408)。
2. **真实既有标签使用另一协议。** 两个固定版本的 `pageAddress(kind)` 都返回 `sidebar://${kind}`；browser 为 `multiple:true`，`placeTab` 再加随机 UUID，得到 `sidebar://browser/<uuid>`。之前把“page 地址加 UUID”误当成可接受的资源地址，是研究链中的错误。[基线地址生成](https://github.com/deepseek-ai/deepseek-harness/blob/639ed015397290b3745d163aafe02ffee4aa3f84/packages/client/ui-sidebar-right/src/client/contract/seed.ts#L39-L46)、[新版地址生成](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/client/ui-sidebar-right/src/client/contract/seed.ts#L39-L46)、[browser 定义](https://github.com/deepseek-ai/deepseek-harness/blob/639ed015397290b3745d163aafe02ffee4aa3f84/packages/client/ui-sidebar-browser/src/client/definition.tsx#L17-L37)。
3. **下游保留实例的源码分析不足以补上入口。** 相同 kind/contentId 时 store 规划 focusTab、已有 occurrence 不因 navigation revision 改变、BrowserBody 保留初始 URL，这些代码事实仍可查；但原标签地址过不了入口，不能把下游行为当作这条公开组合可到达的证据。[store](https://github.com/deepseek-ai/deepseek-harness/blob/639ed015397290b3745d163aafe02ffee4aa3f84/packages/client/ui-sidebar-right/src/client/stores.ts#L308-L352)、[TabDomain](https://github.com/deepseek-ai/deepseek-harness/blob/639ed015397290b3745d163aafe02ffee4aa3f84/packages/client/ui-sidebar-right/src/client/tab-domain.ts#L136-L144)、[BrowserBody](https://github.com/deepseek-ai/deepseek-harness/blob/639ed015397290b3745d163aafe02ffee4aa3f84/packages/client/ui-sidebar-browser/src/client/view/BrowserBody.tsx#L47-L70)。

**实际限定验证。** 本机官方 macOS Desktop 为 `0.2.0-rc.2`，系统为 `27.0.1`，未查询其实际 Electron runtime 版本。临时候选构建为 `cf128ceea652`。两个本轮自建真实 Agent 通过合法 pre-step 内的正式 ToolRuntime 调用工具，框架绑定、Connection、Broker、官方浏览器 controller 和共享 guest 均来自实际运行；没有调用模型。另有一次独立 Client 直接调用公开 `SidebarRightController`，专门区分工具自身预检查与官方入口拒绝。原始工具输出中的驱动名称带有“真实审批UI”通用描述，但本次读取及标签动作未触发实际审批界面，不将该名称计作审批证据。

| 证据层 | 实际结果与限制 |
| --- | --- |
| 临时候选受控回归 | 单文件11项及 typecheck 通过；但布局替身错误使用 `dsh-resource://page/browser/...`，未复现官方真实地址协议。绿例与候选双轴审查的零发现都不能证明原生可行性，新增适配和两项回归均已撤回。 |
| 实际 Agent 工具后台选页 | A 请求选择自己的旧 tab2，Client 在发出 `openResourceIn` 前拒绝：“后台选择需要唯一既有浏览器内容身份；未发出选择”。这条结果只证明本地拒绝，不能冒充官方方法已经执行。 |
| 独立 Client 单次公开调用 | 从实际 A 标签记录取原始 `sidebar://browser/31b71890-14a1-4a8c-b347-8c7854949b3e`，原样调用 `openResourceIn`，实际抛出 `Error: sidebarRight: no registered tab type claims "sidebar://browser/31b71890-14a1-4a8c-b347-8c7854949b3e"`。调用前后 A 标签集合、屏幕 B 会话及其 active tab3 均相同。这是公开 API 原生负例，独立于 Agent 工具结果。 |
| 其他有限原生结果 | 双向跨会话 pageId 读取拒绝；A 有保留页面时后台创建第二标签成功，B 仍选中原页，真实键入 `x` 落在 B 原输入框，pageId/文档标记保留。A 无保留标签且离开前台后没有有效锚点，后台首建明确拒绝。两个会话的四张自建页均由正式工具关闭，最终清单为空。以上不等于后台选择成功或任务05完整验收。 |

逐项原始结果、候选与源码摘要、恢复及清理记录见[验证证据](evidence/session-navigation-public-route-verification.json)。本轮没有继续执行后退/前进/刷新、浮窗、关闭重建、其他窗口、在途接管或竞态的完整原生矩阵；旧页仍在仅证明未发出动作后保留，不能算成功选页。

**边界结论。** 已检查的其他公开入口没有补上本候选：`openTabIn` 为多实例 browser 生成新身份；`tabActions.openResource` 仍进入相同协议检查；`focus`、布局及捕获目标操作受当前屏幕会话限制。不能改写 `sidebar://` 为 `dsh-resource://` 来伪装原内容身份，也不能改用只覆盖 Agent 新建资源标签的范围。此结论限定于本次固定版本及已检查入口，不证明所有纯插件设计永久不可能。任务05继续 blocked，完整导航、后台选页及接管屏障要求保留；没有新的已验证公开路径前，不解锁13/14或首版。

### 09：新版本未给出完整跨域目标绑定路径

**已确认公开契约。** Electron `v44.7.0` 的 webview 方法表仍提供 `capturePage`、`executeJavaScript`、`sendToFrame` 和 `sendInputEvent`。其中 `sendToFrame` 是向指定 renderer 发送 IPC，需要接收方；不等于可向任意 frame 执行脚本。公开导航事件仍包含 URL、main 标记和 process/routing 标识，事件表与已查 `v44.0.0` 字节相同。[方法表](https://github.com/electron/electron/blob/v44.7.0/lib/common/web-view-methods.ts)、[sendToFrame](https://github.com/electron/electron/blob/v44.7.0/docs/api/webview-tag.md#webviewsendtoframeframeid-channel-args)、[事件表](https://github.com/electron/electron/blob/v44.7.0/lib/browser/web-view-events.ts)。

**源码推断与局限。** 新版 `SendInputEvent` 的非 offscreen 鼠标路径仍向当前 guest widget 调用 `ForwardMouseEvent`，参数没有本次动作的目标 frame/document，返回也不提供实际命中身份。因此源码没有为旧 OOPIF 输入负例提供明确的新路由修复证据；也不能由此断言所有新版坐标输入都失败。`capturePage` 的画面、导航标识和 iframe `src` 仍不能单独证明审批后实际命中原 frame/网站/文档，内部重排与同 URL 替换问题仍需完整证据。[输入实现](https://github.com/electron/electron/blob/v44.7.0/shell/browser/api/electron_api_web_contents.cc#L4094-L4113)、[webview 截图契约](https://github.com/electron/electron/blob/v44.7.0/docs/api/webview-tag.md#webviewcapturepagerect)、[原限定实测及缺口](cross-origin-frame-validation.md)。

DSH 候选的 guest 管理仍固定 `nodeIntegrationInSubFrames:false`、`sandbox:true`、`webSecurity:true`，并清理调用方传入的 preferences，未新增自带特权 preload 或目标 WebContents 的公开桥。Electron main-process 的 `webFrameMain`、debugger 和隔离世界方法不会因为 Electron 有它们就自动成为该插件可用的 guest API。[DSH guest 配置](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/apps/desktop/src/browser-guests.ts#L79-L94)、[公开转发白名单](https://github.com/electron/electron/blob/v44.7.0/lib/browser/guest-view-manager.ts#L333-L360)。

**建议的最小实验，未执行。** 本轮没有足够的新接缝理由重复旧截图和点击探针。若后续公开 API 明确提供 frame 命中与实际文档身份，或存在有针对性的输入路由修复，再复用原自有跨源 A/B 设施：先证实 OOPIF、真实目标身份与可信计数；再覆盖重定向、同 URL 替换、布局/遮挡/缩放变化和审批等待中的目标变化，最后验证接管/取消/关页与迟到结果。有限点击成功也不能单独解除09。

### 12：执行结果仍不是持续资源停止证明

**已确认公开契约。** 新版 webview 的 `executeJavaScript(code,userGesture?)` 仍返回执行结果 Promise；没有每次调用的取消句柄、资源列表或 realm 销毁句柄。转发白名单不含 `executeJavaScriptInIsolatedWorld`，不能把 main-process 方法误记成 webview 可调用方法。新版实现仍可能等待 `did-stop-loading` 后才派发执行，取消 Host 等待不能证明 Guest 未执行。[执行声明](https://github.com/electron/electron/blob/v44.7.0/docs/api/webview-tag.md#webviewexecutejavascriptcode-usergesture)、[白名单](https://github.com/electron/electron/blob/v44.7.0/lib/common/web-view-methods.ts)、[实际延迟派发](https://github.com/electron/electron/blob/v44.7.0/lib/browser/api/web-contents.ts#L192-L223)。

**没有解除的约束。** `stop()` 的契约仍是停止待定导航；DSH `release(lease)` 会关闭并等待 guest 销毁，不能保留原网页文档。它们无法仅靠换名称成为任意脚本清理器。合作代码可登记 observer 或 worker 句柄并清理；这不能覆盖任意代码通过页面函数、缓存别名或派生 realm 创建的全部持续活动。停止工具结果交付也不代表这些活动结束。[stop](https://github.com/electron/electron/blob/v44.7.0/docs/api/webview-tag.md#webviewstop)、[DSH release](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/apps/desktop/src/browser-guests.ts#L49-L63)、[DOM observer 的实例清理](https://dom.spec.whatwg.org/#dom-mutationobserver-disconnect)、[Worker 对象终止](https://html.spec.whatwg.org/multipage/workers.html#dom-worker-terminate)。

本轮结论限定于上述 DSH bridge、Guest 生命周期和 Electron `v44.7.0` 公开转发接缝，没有证明所有理论上的纯插件设计永久不可能。沿用[既有页面脚本阻塞报告](approved-page-scripts-blockers.md)中的完整要求：保留原文档、准确归属并停止全部 Agent 持续任务、逐次审批确切目标与代码，以及统一接管/取消/超时/关页屏障。没有正面路径时继续阻塞，而不是改成固定脚本白名单来标完成。

**建议的最小实验，未执行。** 若后续出现可归属且可撤销的公开执行域，先在自有页面分别建立有界 timer、observer、worker 和“调用页面函数间接产生任务”的脚本，令调用先返回。接管时核对资源确已静止、迟到结果未交付、原文档与普通用户输入保留且网站自身活动可继续，再验证取消、超时和卸载。没有这类候选时，不重复演示 `stop()`、丢弃 Promise 或销毁整页。

## 不能混同的新能力

`0.2.1-rc.1` 发布说明新增实验性 Session 状态记录和内嵌 NodeJS 调试工具；它们值得另行评估13/14的数据记录适配，但发布说明本身没有把它们接到共享 guest 的 frame 定位、脚本资源所有权或撤销接口上。本轮没有据此宣称浏览器能力解锁。[官方 rc.1 说明](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.2.1-rc.1)。

官方已有 browser-use 的 Playwright MCP、Chrome DevTools MCP、Stagehand providers；其共享服务只是 provider 注册，启动或附接浏览器的配置由 provider 管理。该说明没有给出通过现有 browser lease 取得同一侧栏 guest 的公开附接链，不能拿另一个 Chromium 或 Node 调试窗口替代共享页面，也不以它们绕过本轮禁止 CDP 的边界。[官方 browser-use 文档](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/docs/subsystems/browser-use.md)。

升级还涉及 `./invariant` 移除、`engines.dsh` 兼容判断和访问控制投影变化。升级是独立兼容工作；不能为验证已存在于基线的05候选而顺带升级整个集成分支，更不能把源码检查等同新版原生验收。[官方兼容变更](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.2.1-rc.1)、[Session 实现](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/client/ui-session/src/client/index.ts)。

## 证据保存与未验证事项

本轮原始官方归档、API 元数据、精确源码副本和 npm 包保存在仓库外临时研究目录；不含账户、Cookie 或控制凭据。关键固定文件 SHA-256 如下，供比对实际获取内容，而非运行成功证明。

| 文件 | 候选 SHA-256 |
| --- | --- |
| `ui-sidebar-right/src/client/contract/seed.ts` | `28c2cd8e27288df34f0953c507086c779c2ae326b47766756203b3561c513240`（两版本相同） |
| `ui-sidebar-right/src/client/service.ts` | `5cee8516f72de671988f9b41b503bbff672fe1c1486042733feff9417f82b5e0` |
| `ui-sidebar-browser/src/client/browser/BrowserController.ts` | `56ddd382b91c5b5572f8d64231049c9882e1e6e682f0eaa64000bd895f8a5764` |
| `ui-sidebar-browser/src/client/view/BrowserBody.tsx` | `18376811bc1c44a3cb2658710f64b7cea39948319befd70d34d819e98a2e8ede` |
| `apps/desktop/src/preload-browser.ts` | `17c386171796e77f6a2bfa3c86382a20cce36013275beca978f31b424ef25e9e` |
| `apps/desktop/src/browser-guests.ts` | `5911d6bcbce79b68bd951d27da40bf8b8c9ab57b7d715dd0586d5e74e8e515f4` |
| Electron `v44.7.0/lib/common/web-view-methods.ts` | `de8b2d575ad8c6097d273e6790a321f86fec7843866d4c19664a93a58f294782` |
| Electron `v44.7.0/lib/browser/web-view-events.ts` | `ed7675603febebcc3de60b8fc2352b81b5f6b67ba76f36d233ae8f4eeca6f2dc` |
| Electron `v44.7.0/shell/browser/api/electron_api_web_contents.cc` | `78a0094687efba5bd3aac0290ffbba2440d956811e180762c526baf3471522f0` |

同日后续已构建临时候选并执行上述限定原生验证，候选失败后恢复源码与测试、卸载临时插件及清理自建页面/Agent；未安装新版、修改主程序、执行任意页面脚本或发布远端事项。09/12未追加原生实验，三个任务状态均未改变。本文保留已验证的公开事实并撤回05错误推荐；历史任务10的上传通过及常规回归均不能作为05/09/12的新能力证据。
