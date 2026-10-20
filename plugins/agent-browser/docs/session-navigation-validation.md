# 本会话标签与官方导航：实施与待验收项

2026-10-20 连续浏览修复：导航最多等待一秒；仍在加载时返回官方控制器实际 `loading`、历史与已观察地址，没有实际地址则省略 `url`，不把请求地址冒充加载结果。后续 `observe` 核对新页面；慢资源不再触发未知写屏障。明确原生加载错误、关闭、取消与接管继续拒绝，订阅和计时器随请求结算清理。以下为既有切片验证记录。

任务05保持未完成。代码已接入统一 Broker、正式 Connection、框架 SessionBinding 和官方浏览器 controller；受控回归通过不代表双真实会话或后台选页已通过。

版本补充：用户更新后，本轮只读确认官方安装包为 `0.2.1-rc.2`；本文历史原生结果仍对应 `0.2.0-rc.2`，离线契约回归也仍锁定该旧版。随后限定复验已从官方关于窗口确认运行版本，但冻结构建在启用阶段异常，未执行公开选页调用；不能迁移旧版成功或失败结论。已整理[公开接口需求与新版复验边界](session-tab-selection-public-contract-spec.md)，任务05仍保持 blocked。

## 公开能力依据

依据固定官方 `dsh-v0.2.0-rc.2`、commit `639ed015397290b3745d163aafe02ffee4aa3f84`。浏览器源码及摘要见[来源记录](../upstream/provenance.json)。本次没有修改 DSH 主程序、安装包、私有 IPC 或创建另一套浏览器。

- `SidebarRightController.tabsIn/openTabIn/closeIn` 是当前版本类的公开成员。前两项读取及创建指定已 adopted 会话布局，`closeIn` 关闭该会话标签；它们不切换全局会话。不 adopted 时调用可无操作，适配器复核实际结果并报错。
- `SidebarRightController.focus(tabId)` 只作用屏幕会话，没有 session 参数。适配器先核对 mounted 与框架会话相同，再核对实际 active 标签。后台请求报 `background-select-unavailable`，不改私有 store、不切用户当前会话。**尚未取得后台选择既有标签的正面公开路径，因此任务05及依赖它的发布验收继续阻塞。**
- `UiSession.provide({props,resolve(binding)})` 接收 Controller-owned `SessionBinding`。当前 SDK 的 `materialize` 调用 resolver，`sourceFor` 缓存已物化绑定；`binding.ctx.effect` 绑定正式会话生命周期。生成入口在该边界登记无 guest 的 `scope=session` 控制锚点，避免要求先有网页才能创建第一张标签。它仍使用同一 Broker 和 Connection，并非另一个控制通道。尚未物化或代次已结束的会话没有锚点；不会退回屏幕会话权限。
- 页面导航使用原官方 `BrowserController.loadUrl/goBack/goForward/reload` 与状态订阅。地址解析、Chromium 历史、实际地址观察和页面生命周期继续属于官方实现。工具不直接另造导航状态机，也不把输入网址当作已加载网址。

已核对的安装包声明与实现分别位于 `@deepseek-ai/dsh-client-ui-session/lib/types/client/index.d.ts` 和 `lib/client.js` 的 `provide/sourceFor/materialize`，以及 `@deepseek-ai/dsh-client-ui-sidebar-right/lib/types/client/service.d.ts`。以上仅是固定版本公开契约证据；真实跨会话 UI 行为仍须原生验收。

## 工具契约

`agent_browser` 从实际 `exec.agent.session.header.id` 获取归属，模型没有会话、工作区或 guest 参数。`pageId` 只来自 Host 登记，`tabId` 只在本会话官方布局内核对；登录态不会扩大权限。`list-tabs` 返回已挂载增强页面的 `pageId` 与原 controller 已观察地址；尚未挂载时省略二者。后台 `selected` 省略，避免把当前屏幕别人的 active 标签当作后台事实。

对外 `url` 是实际已观察地址的净化展示值，Client 与 Host 均去除用户信息、查询及片段；不以请求输入推断站点重定向后仍安全。内部导航和真实地址核对继续使用原地址，净化值不能充当页面身份。

单页接管期间，session 锚点不能旁路页面屏障：`list-tabs` 对该页只返回无内容身份、布局选择状态及 `paused=true`，不读取或交付更新后的网址与标题；`select-tab/close-tab` 在发出官方写方法前拒绝。可以继续列无内容身份和创建别页，不暂停整个会话，也不缓存接管期 metadata。

已采集但尚未发送的摘要，在最后一次异步许可返回后同步重核目标页本地控制修订；本地 `pausing` 在Host确认前也去除旧标题和地址。传输仅附带内部页身份/暂停代次约束，Host在最终交付时再核对真实目标页归属、暂停状态与epoch，不只检查session锚点。接管再交回仍不能恢复旧摘要，未挂载或无法证明目标代次的标签也只返回无内容身份。两个外部传输延迟回归覆盖本地pausing和完成消息在途经历接管/交回，未将其写成原生故障注入。

| action | 输入与实际行为 |
| --- | --- |
| `list-tabs` | 无页面先决条件；返回本框架会话已 adopted 的浏览器标签。没有标签时为空数组。 |
| `create-tab` | 可选无凭据 HTTP(S) `url`；通过 `openTabIn` 创建并复核新标签。没有 adopted 布局时明确失败。 |
| `select-tab` | 必填本会话 `tabId`；仅当前屏幕会话可执行，后台明确拒绝。 |
| `close-tab` | 必填本会话 `tabId`；通过 `closeIn` 并复核移除，触发原 occurrence 清理。 |
| `navigate` | 必填 HTTP(S) `url`，不接受 URL 凭据；仍由原 controller 最终解析并加载同一页面。 |
| `back` | 必须存在 Chromium 后退历史；返回实际观察地址。 |
| `forward` | 必须存在 Chromium 前进历史；返回实际观察地址。 |
| `reload` | 刷新同一原生页；不创建新的 guest 或自动恢复旧工具请求。 |

早期固定 `read/click` 仅支持自有夹具；这个局限属于旧固定工具。当前通用主文档观察与原生表单操作分别由06和07交付，不能把旧固定工具边界当作整个工具集现状；任意页面脚本仍是独立的任务12要求。页面导航请求服从原暂停、归属、去重、串行和取消边界。写方法发出后取消保守报告结果不明，不声称已经撤回导航；参数或归属在任何写方法前失败时可明确报告未发出。会话锚点不是网页，不能用其 pageId 执行页面动作。会话标签写方法已发出但结果不明时，仍允许 list-tabs 查询实际布局，查询不会解除写屏障或重放动作；当前恢复仍须结束并重建该框架绑定，这个错误恢复体验尚未完成。

当前[主文档观察06](semantic-observation-validation.md)、[截图08](screenshot-validation.md)与[控制台11](page-console-validation.md)已分别完成受控与限定官方Desktop原生验收；[原生输入07](native-input-validation.md)也已完成其切片。统一登记协议为6。这些完成记录不解除05的后台选页/双会话缺口，也不提升整体G3/G4/G5或任务16结论。导航开始推进私有文档代次并清除旧引用，自己发起的导航不会无差别取消自身命令；旧观察、引用重核和截图按开始代次拒绝迟到结果。

## 受控证明与限制

`test/session-navigation.test.ts` 通过真实增强构建、正式 Connection、Broker 和原官方 controller 验证：同一 guest 导航及前进后退、接管拒绝新导航、无 guest 创建首张标签、后台创建不读取屏幕选择作为归属、跨会话伪造及关闭拒绝、前台选择与后台选择明确限制、无 adoption 失败、清单 pageId/实际地址、危险协议与凭据地址拒绝、旧页撤销，以及导航在途接管后的迟到结果丢弃。仅在宿主布局/Session 服务、renderer 元素工厂及 guest 边界使用替身；没有伪造内部 Broker/controller。

导航、页面重建和文档切换造成的通用观察及元素引用失效由任务06的统一观察代次整合；本任务的测试不代替该完整门槛。2026-10-18补充了两个真实会话的双向 pageId 越权拒绝、有限后台创建及前台焦点保留证据，见下节；其他窗口目标、关闭重建、完整导航地址与事件顺序、初次 SessionBinding 物化范围及完整双会话验收仍未完成。后台选旧标签缺口也没有被改成可选项。

原生验收由主任务统一安装合并后内容指纹一致的构建执行，记录具体版本、指纹和共享页面身份；本文件不宣称任务05完整原生通过。早期05实验当时共享主工作区Node依赖、worker未安装依赖；这只是该轮历史策略，不代表后续worker的当前依赖准备方式。不自动提交或发布的用户约束继续有效。

## 2026-10-18：后台选页候选否定与有限原生补证

[同日公开能力复核](public-capabilities-research-2026-10-18.md)原先推荐的 `openResourceIn(owner, existingContentId, {kind:'browser',revealIfOpened:true})` 已撤回。官方真实标签地址为 `sidebar://browser/<uuid>`；`placeResource` 先要求 `dsh-resource://`，显式 `kind` 不会绕过该检查。基线与本轮查询的新版均存在这项不匹配。

在官方 Desktop `0.2.0-rc.2`、macOS `27.0.1` 上，临时候选 `cf128ceea652` 的实际 Agent 工具先在 Client 预检查拒绝，未发出公开方法；随后独立 Client 原样使用真实 A 标签的 contentId 单次调用公开方法，取得官方异常，前后 A 标签集合、前台 B 会话及其 active tab3 均未变化。两条证据分别证明本地拒绝和真实公开 API 拒绝，不能混同。候选受控绿例使用了错误的 `dsh-resource://page/browser/...` 替身地址，因此11项通过和候选审查零发现均不是能力通过证明。四个实验源码/测试文件已恢复到本轮前字节，未留下后台选页实现。

同轮两个自建真实 Agent 通过合法 pre-step 内的正式 ToolRuntime、Connection 与 Broker 完成了有限验证：双向跨会话 pageId 读取拒绝；A 已有保留页时，在 B 前台创建 A 第二标签成功，B 原页选中状态、pageId、文档标记及输入焦点保留，实际键入 `x` 落在 B 原输入值中。A 无保留页离开前台后，后台首建因缺少有效框架锚点明确失败。A/B 的 tab2/tab3 是各会话局部 ID，不能声称同名 tabId 全局唯一。此轮未触发真实审批界面，驱动输出中的通用名称不代表审批证据。

四张自建页面已由正式工具关闭，两会话清单为空，随后只归档本轮两个会话并卸载临时插件。原有4个 live Agent 的身份集合保持一致；测试端口关闭，ASAR 摘要不变，原有7项插件及开关恢复。四个 profile 文件中三个与基线字节相同；`cordis.yml` 仅存在既有模型显示名的更新，保留当前应用值，未覆盖其他运行时配置。

原始结果、安全摘要与清理核对见[本轮验证证据](evidence/session-navigation-public-route-verification.json)。未完成的原生矩阵仍包括后台选择、完整前进/后退/刷新、浮窗、关闭重建、其他窗口、在途接管及竞态；不将有限正例扩写为完整05通过。任务05、13/14依赖与首版发布阻塞保持原状，不缩减范围。

## 离线宿主契约回归

[资源入口契约测试](../test/sidebar-resource-contract.test.ts)已固定本次负例，随 `pnpm check` 的常规 vitest 收集执行，无需设置 `DSH_OFFICIAL_BROWSER_PROBE`。它使用锁文件中的官方 sidebar-right 与 dockkit `0.2.0-rc.2` 发布实现，以及现有官方浏览器归档中的原始 `browserDefinition`；版本、发布文件及归档摘要漂移会直接失败。

[测试装配](../test/support/official-sidebar.ts)执行真实模块 factory、registry、侧栏 reducer、dockkit 规划器和公开控制器。只有组件渲染、框架 effect/slot 装配、资源 pin 与内存 store 引擎使用有限替身；不复制 `pageAddress`、创建地址或 `placeResource` 协议规则。测试经真实 slot 声明物化合成会话，再通过公开 `openTabIn/tabsIn/openResourceIn` 创建、读取和尝试揭示原标签。

两项回归分别验证：官方 browser 创建独立的 `sidebar://browser/<uuid>` 身份，原地址被资源入口拒绝且两个合成会话的标签不变；合法 `dsh-resource://` 地址可按显式 browser kind 打开及重复揭示，但属于独立内容，不是选择原 browser 页。后者是入口正常工作的正向对照。最初按已撤回候选的“不抛错”假设运行，真实入口确实抛出协议异常；最终回归保留这一拒绝契约。

从仓库根目录可单独运行：

```sh
pnpm exec vitest run plugins/agent-browser/test/sidebar-resource-contract.test.ts
```

这些回归捕获已知宿主契约误用，不验证 React 渲染、实际焦点、Immer 引擎、持久化介质或原生 guest，也不取代正式 Agent 工具及 Desktop 验收。任务05、13/14依赖和首版发布继续阻塞；本轮未增加后台选页产品实现。

## 0.2.1-rc.2 首次限定复验：历史激活失败

官方关于窗口实际显示 `DeepSeek Harness Version 0.2.1-rc.2`，与本轮安装包版本一致。本轮没有升级项目 SDK、浏览器归档或锁文件；从既有 `f755a57033c7` 输出复制冻结副本，通过新版官方插件管理器安装并点击“立即启用”。安装完成不等于激活成功：界面报 `TypeError: Cannot read properties of undefined (reading 'principal')`，插件详情为“共 1 个 · 1 异常”。该记录证明所验构建在当前新版环境未激活，尚未定位异常根因，不能直接归因于某一 SDK 或宿主模块。

因此本轮未安装后续诊断驱动，没有创建 Agent、会话页面或执行正式工具，也未调用 `openResourceIn`。新版公开选页仍为未验证，不能把激活异常写成协议拒绝，不能把旧版 `sidebar://` 负例复制为本次新版结果；双会话焦点、原页面保留及完整05矩阵均未进入。

临时构建已通过同一官方管理器卸载，回到当轮原有6项插件与相同开关；原有订阅插件的异常在安装前已存在，未处理或归因于本插件。当轮4个 profile 文件与基线字节相同，ASAR 摘要不变；未安装的驱动及冻结副本移出工作区。版本、构建摘要、白名单 UI 观察与清理记录见[历史兼容复验证据](evidence/session-navigation-0.2.1-rc.2-compatibility.json)。后续诊断及当前结论见下节。

## 0.2.1-rc.2 激活修复与实际公开入口复验

原始激活循环连续两次以同一 `principal` 异常变红，耗时约2.1秒。使用独立包名、组件、路径及实际执行标记复现完整 Host 后，调用栈定位到启动注册自测。最小化为一个自有精确 GET 路由仍失败；无匹配路由时不触发检查。早期复用同一包名的变体曾加载缓存 linkedRoot，相关结果已排除，不能用其绿例证明因果。

根因是新版公开 `ConnectionFetchHandler.fetch(request, peer)` 必须接收 `PeerScope`；原自测仅传 `Request`。命中路由时官方代码读取 `peer.principal.kind`，因此报错。修复仅在固定本地启动自测通过公开 `createPeer({principal:{kind:'owner'},interactions:'none'})` 取得真实本进程 Peer，原样传给 Fetch，成功或失败均在 `finally` 等待释放。原注册响应、身份检查及自测保留；旧宿主没有该工厂时沿用原单参数调用。此身份不能由网页或模型输入指定，也不代表外部请求认证。

[新版 Connection 回归](../test/connection-peer.test.ts)先在完整启动调用处以相同错误变红，再转绿，并覆盖真实非 owner 403 及失败释放。夹具执行固定官方 npm 原入口，仅转模块格式；外部依赖仍来自旧锁定 SDK，范围和摘要见[来源说明](../upstream/README.md)。它不代替完整新版运行验证。修复构建 `f52b8e1402d9` 在实际 Desktop 显示运行中，注册自测200；接口注释补齐后的最终构建 `24609831c765` 再次通过同一真实激活循环及 `ready=true、registerStatus=200`。SDK、浏览器来源和锁文件未升级。

随后复用既有驱动，仅创建两个空白 Agent。其合法 pre-step 前置钩子拒绝模型步骤；首次无框架锚点时清单明确失败，挂载后只读清单确认归属。A 通过正式工具创建两个官方浏览器页，切到 B 后，独立 Client 原样单次调用 `openResourceIn(A, originalContentId, {kind:'browser',revealIfOpened:true})`。真实新版抛出 `Error: sidebarRight: no registered tab type claims "sidebar://browser/..."`，对应官方资源协议检查；A 标签集合及前台 B 会话不变。该调用不是 Agent 工具已发出选择的证据；B 没有网页，也不作为输入焦点验收。

公开入口仍拒绝后，未扩大完整矩阵。正式工具关闭 A 首页成功；最后一页关闭返回结果不明，没有重试，重新进入 A 后实际 UI 无浏览器页且正式清单为空。只归档两个自有会话、释放两个自有 Agent 并卸载临时插件；原有1个实时 Agent 身份与状态保持，原有6项插件及开关、4个 profile 文件字节和 ASAR 摘要保持基线，测试端口关闭，临时探针移出工作区。

原始结果、构建摘要、回归和清理见[本轮诊断证据](evidence/connection-peer-startup-0.2.1-rc.2.json)。激活故障已修复；任务05、13/14依赖及首版继续 blocked。既有标签选择成功、完整导航与原生竞态矩阵仍未通过，不缩减范围，也未恢复自建浏览器或宿主修改路线。
