# 纯插件原生共享页面：社区复用研究

状态：已完成一手来源核查、固定版本复用成本实验，并在官方 macOS Desktop `0.2.0-rc.2` 完成限定原生验证。加载、官方导航、同页工具读写及关页凭据撤销已实测；完整产品验收仍未完成。

## 当前边界与结论

用户最新明确：只能做插件，不能修改 DSH 主程序。不得修改安装包、调用私有 IPC，也不得把外部 Chrome、iframe 降级或画面流当作已满足原生侧栏共享页面。

这推翻了 [ADR 0003](../../../.agents/docs/adr/plugins/agent-browser/0003-upstream-browser-capabilities.md)中“上游补齐宿主能力”的交付路线。此前[连接前置检查](connection-validation.md)只否定了当前已有证据下的直接 CDP 接入入口，不足以否定所有纯插件路线。完整需求中的文件、完整调试和重启登录态尚存在冲突；本研究不擅自删除这些需求，也不承诺纯插件全部实现。

**当前优先方向：复用官方浏览器插件的现有界面、导航和恢复实现，作为独立增强插件只补页面控制、Agent 工具及必要的人机交互。** 原生 `webview` 与浏览器侧快照/定位库仍可用于工具适配，不应把最小实验的自建测试页直接扩大成整套浏览器界面重写。此方向已有受控测试和限定真实 Desktop 验证，结果见下文。

本轮新增的重要候选是 `playwright-injected@1.59.1`。它提供 Playwright 浏览器侧的快照、角色、可访问名称、选择器与元素状态逻辑，不等于完整 Playwright、MCP 服务或现成浏览器 UI。

## 官方内置浏览器复用核查

用户进一步明确希望复用官方内置浏览器，项目聚焦“浏览器加工具”。官方浏览器本身是独立的 `@deepseek-ai/dsh-client-ui-sidebar-browser` 插件，已有界面、导航、标签页及网址恢复实现。不能从“未取得内置页面控制器”推导出需要重新开发这些部分。

核查对象为当前安装版与[同版本官方 npm 发布包 `0.2.0-rc.2`](https://registry.npmjs.org/@deepseek-ai/dsh-client-ui-sidebar-browser/0.2.0-rc.2)。安装产物 `lib/client.js` 中的 `BrowserBody`、`BrowserTitle`、`createBrowserControllers`、`createElectronPage` 和持久化 store 均存在。发布包 `/client` 的声明导出部分类型，但运行时仅导出 `apply`、`inject`，没有可直接导入的视图或 controller 工厂；包声明的 `./src/*` 模式也不代表发布包实际包含源码。

| 方式 | 已核对边界 | 状态 |
| --- | --- | --- |
| 给正在运行的内置页面直接挂工具 | 公开 `openTab` 只负责打开；内置 controller、store 和 page factory 在 `apply` 闭包内，未找到取得现有 guest 或注册工具增强的正式入口。 | 未证明可行，也不能断言所有可能路线均不可行。 |
| 基于官方浏览器实现做独立增强插件 | 复用原界面、导航、标签页及网址恢复逻辑，通过正式 Sidebar extension 接管 browser kind，补页面控制、工具与人工接管。 | 用户已选择此路线；已通过固定官方代码的受控组合成本实验，不等于接管已打开的原 guest。真实 Desktop 装载、原界面、导航、固定同页读写与关页撤销已验证；完整生命周期仍未验收。 |
| 扩大现有自建实验页 | 仅证明固定测试字段读取、点击、暂停及限定方向隔离。 | 不作为重写整套浏览器界面的依据，也不能替代官方实现复用的验证。 |

正式 Sidebar 契约允许 extension 接管 builtin kind、卸载恢复 builtin；这不意味着直接调用原插件 `apply` 即可包装它，同 id 重复注册会冲突。独立增强插件需处理自己的注册身份与工具接入，不能靠扫描宿主 DOM、访问私有 controller 或修改安装包取得原页面。

官方发布包声明 MIT，安装包亦包含 DeepSeek 的 MIT LICENSE；复用时须保留适用声明。官方 GitHub 当前源码也可读取，但其 master 包版本为 `0.2.1-alpha.3`，不能直接当作本机 `0.2.0-rc.2` 的兼容性证明。复用实现仍受同一宿主的下载、调试及登录态限制，不自动解决这些能力缺口。

REA 对同版本发布包的静态分析记录为 `ev_20afc590367dd27cf5d7ba3cd809bf425bbdd8734fe31c159a3fdf12c9efefa9`；未执行包代码，语义图仍有未知项。上述导出和闭包结论另经安装产物、发布包声明及正文逐项检查；增强插件运行证据另见下文，不能由静态分析替代。

### 官方复用成本实验

用户已明确选定独立增强插件路线，要求先验证必要改动，不扩大自建浏览器范围。本次使用 SHA-512 固定的官方 npm `0.2.0-rc.2` 发布包，产物只写入临时目录，未修改当前 Desktop、profile 或既有实验 Client。成本与检查点摘要见[本次证据](evidence/official-browser-reuse-probe.json)。

| 项目 | 实际改动或结果 |
| --- | --- |
| 官方发布 bundle | 14 个唯一匹配的替换点；这是固定 bundle 的改动位置数，不是 14 行或生产源码工作量承诺。 |
| 注册隔离 | 独立模块/Sidebar 实现身份、extension 优先级、locale、检查点及 CSS 归属；保留原 browser kind，避免与 builtin 冲突。 |
| 快捷键 | 增强实现不重复认领 `browser.new`，沿用 builtin 的入口。 |
| 页面接入 | 在官方 controller 创建处提供自有 guest 的有限 getter，将框架会话、tab 与 occurrence 生命周期绑定到工具。没有扫描宿主 DOM 获取原 builtin 的对象。 |
| 独立工具适配 | 初次成本快照为 157 行 TypeScript，含类型与注释；本轮补强迟到登记撤销后为 163 行。只复用既有 Host 的登记、轮询、许可与结果通路，支持固定测试页读取和点击。验证脚本及测试代码另计。 |
| 官方实现保留 | `BrowserBody`、`BrowserTitle`、`ElectronWebViewImpl`、`ElectronWebviewPresentation` 和 Electron page 装配五个代码区块逐字节不变；原导航、网页挂载和恢复逻辑沿用。 |
| 既有实验 | Host、Broker、协议及旧 Client 未因本次验证重写；未新增生产浏览器界面、地址栏或导航实现。 |

本机安装版与同版本 npm 包并非整文件同摘要：只读比较表明差异限定在 CSS 构建区块，其余字节一致。两者生成的类名前缀不同，却使用相同 CSS 注册标识；因此增强实现隔离 CSS 注册标识与归属，样式正文保持不变，避免 builtin 已注册样式导致增强包跳过自己的样式注入。

受控测试实际执行原官方 Client、增强 Client、既有 Host 工具定义和同版本正式 Connection Fetch handler，并预占 Gateway 验证组合；认证上下文、Sidebar/locale/快捷键服务、store 与原生 guest 在外部边界模拟，React UI 未渲染。六项通过：builtin/extension 注册共存及样式隔离、同 guest 人工修改后读取与点击、会话隔离和接管拒绝/交回读取、关页撤销与 lease 清理、网址检查点及显式恢复、离开固定测试网址后拒绝动作。模拟输入返回 `lastTrusted: false`，不伪装真实原生事件，也不代表模型自主调用或完整 ToolRuntime 流水线通过。

复现命令在仓库根执行：

```bash
node tools/verify-official-browser-reuse.ts
```

命令校验官方包摘要，生成原始发布文件、增强 Client、完整补丁、JSON 结果和 MIT LICENSE，然后执行六项定向测试。测试仅在显式设置该命令生成的 `DSH_OFFICIAL_BROWSER_PROBE` 目录时运行；普通 `pnpm test` 不下载远端包，缺少该目录时明确跳过六项，不能将跳过算作通过。

适配代码的本地模块由既有 Vite 工具链打包为一个 CommonJS 入口，再装配进临时实验 Client。不能以单文件 TypeScript 转译代替打包，否则新增本地导入会留下无法解析的相对 `require`。每次重新生成仍须通过上述六项组合测试；旧实验目录可用于历史回归，不能代替生成器本次可复现的证明。

当前结论是“有证据支持保留官方浏览器实现、只增加有限工具适配”，不是完整产品已交付。该 bundle 补丁仅用于估算与验证；生产实现需整理成固定版本的源码级改动。限定真实 Desktop 加载、UI、原生点击与关页撤销已实测；完整会话切换、在途接管屏障及产品功能仍须验收；没有因此扩展到任意网页、完整快照、文件或调试功能。

### 限定真实 Desktop 验证与复现

本轮只验证官方实现复用，不扩大自建浏览器。当前官方 macOS Desktop 与浏览器包均为 `0.2.0-rc.2`。独立增强通过官方插件管理器本地加载，未修改主程序、安装包或私有 IPC。详细结果见[原生验证证据](evidence/official-browser-native-verification.json)。

- 官方地址栏、后退与前进保持可用；界面和原生页面由官方代码提供。
- 在同一可见测试页人工填入 `人工复用验收 C` 后，真实 Host 的 `ToolRuntime.execute` 完成固定 read/click/read。三次 `pageId`、`documentId` 相同，计数为 0/1/1，点击后 `lastTrusted: true`，侧栏同步显示 1。这是实际工具流水线验收，不是模型自主调用验收。
- 关页后，在下一测试页观察到 `guestUnavailable: true` 和 `hostRejectedClosedTarget: true`；后者仅接受 Host 明确返回 `Client 凭据失效`，异常或超时不算通过。
- 保持增强页打开时卸载临时包，原标签回退到内置空白页；重新打开测试页可正常人工浏览，验收标记不再触发工具。两轮临时包均已卸载，profile 的 `package.json`、`cordis.patch.yml`、锁文件和 workspace 文件与实验前逐字节相同。
- 诊断适配仅观察固定测试页的人工标记，每页最多运行一次；不暴露 RPC 凭据给 guest，也不采集真实账号。卸载等待已开始的关页清理和迟到登记撤销，另有替身回归覆盖这两种竞态。

生成可本地安装的临时诊断包：

```bash
node tools/verify-official-browser-reuse.ts --native
```

唯一可选参数 `--native` 默认关闭。启用后，在命令输出的 `artifactDirectory/native-plugin/` 中额外生成组合包，保留 MIT LICENSE；仍只生成临时文件，不自动安装或修改 profile。包名包含诊断内容摘要，避免同包名缓存造成旧版误判。默认命令的 `report.json` 仍将 `nativeDesktop` 标为 `not-verified`；生成成功不能证明真实 UI 通过。

真实复现前须在同一 Desktop profile 加载既有 `agent-browser` 实验 Host，并确认本机测试站就绪；组合包的空 Host companion 不重复注册工具。通过官方插件管理器添加该本地目录并启用，在当前会话用原浏览器入口或 `⌘ T` 打开 Host 给出的固定测试网址。在“人工修改内容”输入以 `人工复用验收` 开头的文字触发一次闭环。关闭该页，再开同一测试网址可读取关页拒绝结论。最后通过官方管理器卸载临时组合包，重新打开内置浏览器核对恢复；该 profile 的扩展选择影响其他会话，实验结束应移除组合包。

初次 14 个替换点和 157 行是我们对官方发布包副本的实验增量，不是官方原有改动。本轮仍为 14 个定点接入，工具适配增至 163 行；一次性原生诊断、生成器和测试另计，不是生产实现工作量承诺。网址恢复仅有受控测试证据；暂停隐私屏障、全局登录态、任意网页、完整快照、文件和调试能力不在本轮通过范围内。

## 证据等级

- **公开契约**：正式 Electron 方法与同版本 DSH 包声明。
- **源码依据**：候选库中实际存在相关函数、参数与副作用。
- **真实实测**：本节限定的官方 Desktop 装载、导航、同页固定工具与关页撤销。
- **待实测**：完整产品的暂停、隔离、生命周期及其他页面能力。

本报告分别记录静态、受控和真实结果，不互相代替。

## 原生承载与控制：无需默认走 CDP

### 原生侧栏接入

[DSH Sidebar `0.2.0-rc.2` 官方说明](https://unpkg.com/@deepseek-ai/dsh-client-ui-sidebar-right@0.2.0-rc.2/README.zh.md)公开了两阶段扩展：注册 tab 类型，然后注册 `sidebar.right.pane.tab` 正文；extension 可以接管 builtin kind，卸载后恢复 builtin。`keepMounted: true`声明保留已访问正文，涵盖切 tab、切 Session 和收起。这是契约说明，尚不是实验插件实测。

[同版本 browser 类型](https://unpkg.com/@deepseek-ai/dsh-client-ui-sidebar-browser@0.2.0-rc.2/lib/types/types.d.ts)公开 `acquire`、`release`与`onOpenRequested`。结合已安装产物的[租约检查证据](connection-validation.md#检查结果)，插件拥有自己创建的 guest 有静态依据；注册正文并不会取得原内置 browser 的私有 controller 或已有页面。

### 页面读取、截图与原生输入

[Electron `v44.0.0`公开 webview 方法表](https://github.com/electron/electron/blob/v44.0.0/lib/common/web-view-methods.ts)包含 `executeJavaScript`、`capturePage`、`insertText`、`sendInputEvent`。因此“Browser bridge 没有 CDP”与“自有 webview 不能执行任何页面读取/输入”不是同一个结论。

[Electron 方法说明](https://www.electronjs.org/docs/latest/api/webview-tag)规定方法需在 guest 就绪后调用；`executeJavaScript`在页面中执行代码，`insertText`向聚焦元素插入文本。该页面是滚动更新文档，具体版本依据以前述 `v44.0.0`方法表及安装产物为准。官方同时警告 webview 的架构稳定性；不能据此承诺所有 Electron 平台兼容。

建议的控制方式是插件持有自己的 webview 引用，而不是扫描宿主 DOM 获取别的插件页面。固定的读取和定位逻辑在 guest 内执行，返回可序列化观察结果；动作经过插件权限和页面身份复核后再调用公开输入方法。通过 JavaScript `click()`或事件分发得到的结果不能自动视作原生输入验收。

### Host 工具与 Client 的消息通路

[DSH Connection `0.2.0-rc.2`说明](https://unpkg.com/@deepseek-ai/dsh-client-connection@0.2.0-rc.2/README.zh.md)明确 Host 提供载体无关 RPC 与精确 Fetch 路由，Desktop 的 shell-owned carrier 分派共享 Fetch handler。纯插件可研究通过这些正式扩展契约关联 Host 工具请求与 Client 自有页面操作。

这不是已经实现的浏览器请求队列，也不能将普通 Web 的 `ctx.webServer` 路由直接当作 Desktop 已验证接口。Client 认证只代表操作者身份；具体工具的会话归属、连接与页面绑定仍须插件显式验证。不能信任模型或网页自报的 `sessionId`，不能让 guest 接触 DSH 凭据或 Host RPC。

## 候选复用矩阵

“可直接复用”仅指库提供相应算法或方法，不指整个产品已经能直接安装。

| 候选 | 可直接复用的部分 | 仍需适配 | 当前不能据此宣称支持 |
| --- | --- | --- | --- |
| `playwright-injected@1.59.1` | 浏览器侧 ARIA 快照、元素引用、角色/名称、选择器解析/生成与状态判断。 | 浏览器 bundle 注入、固定工具、页面与文档身份、原生动作、Host/Client 消息、暂停清理。 | 完整 Playwright 自动化、CDP、跨域 frame 控制、下载、重启持久化；不是浏览器 UI。 |
| DOM Testing Library | `getRoles`、`isInaccessible`与按角色/文本/标签查询。 | 快照序列化、元素引用和失效、原生输入与调度。 | 完整 Agent 快照树、浏览器自动化、跨域页面调试。 |
| `dom-accessibility-api` | DOM 元素的可访问名称与描述计算。 | 遍历、引用、定位、动作与插件集成。 | 浏览器引擎、完整 AX 树或自动化工具。 |
| `@medv/finder` | 从 DOM 元素生成 CSS selector。 | 页面身份、失效校验及操作通路。 | 动态页面上的永久稳定身份、Agent 快照或原生输入。 |
| DeepSeek-Harness-Browser | 官方 Desktop 分支的租约挂载与 live DOM 文本回传可作源码参考。 | 改为正式 Sidebar Slots，重做权限、请求关联及生命周期；其主要工具仅打开、读取、关闭。 | 不能整套照搬为完整自动化；其后台 CDP 与自制壳能力不能混算成官方 Desktop guest 能力。 |
| Playwright MCP / Vercel agent-browser 完整工具服务 | 现成工具设计与协议参考。 | 直接控制当前 guest 仍需其要求的正式连接入口，当前未找到。 | 不能把工具另开的 Chromium或画面流当作原生侧栏共享页面；不选伪造完整 CDP shim 作默认方案。 |

来源：[`playwright-injected`固定提交 README](https://github.com/kolodny/playwright-injected/blob/89c5c5441681aaf9822aeb8681ddc666fad247c8/README.md)、[DOM Testing Library 无障碍 API](https://testing-library.com/docs/dom-testing-library/api-accessibility/)、[ByRole 查询](https://testing-library.com/docs/queries/byrole/)、[`dom-accessibility-api` README](https://github.com/eps1lon/dom-accessibility-api)、[`finder` README](https://github.com/antonmedv/finder)、[社区 Client 源码](https://github.com/tonyd2wild/DeepSeek-Harness-Browser/blob/main/plugin/client.js)、[社区 Host 源码](https://github.com/tonyd2wild/DeepSeek-Harness-Browser/blob/main/plugin/index.js)、[Playwright MCP README](https://github.com/microsoft/playwright-mcp)、[Vercel README](https://github.com/vercel-labs/agent-browser)。除明确固定的来源外，滚动分支与文档不是已锁定依赖。

## `playwright-injected`：为什么优先实验，为什么不能直接认定成熟可用

### 已核对内容

- [发布包 `1.59.1`元数据](https://unpkg.com/playwright-injected@1.59.1/package.json)和[公开导出声明](https://unpkg.com/playwright-injected@1.59.1/dist/index.d.ts)实际可读取，不只看了 README。
- 包导出 `InjectedScript`及独立的 `generateAriaTree`、`renderAriaTree`等。[快照声明](https://unpkg.com/playwright-injected@1.59.1/dist/_types/injected/ariaSnapshot.d.ts)返回元素与引用映射；[类声明](https://unpkg.com/playwright-injected@1.59.1/dist/_types/injected/injectedScript.d.ts)列出查询、状态、快照和填写方法。
- 包声明记录的 Playwright 源提交为 `d466ac5358cae058cdc75d2ae3ab3ad220042730`；提取项目本轮 main 提交为 `89c5c5441681aaf9822aeb8681ddc666fad247c8`。这是声明与仓库证据，未做发布 bundle 与上游源的逐字节对应证明。
- [同步脚本](https://github.com/kolodny/playwright-injected/blob/89c5c5441681aaf9822aeb8681ddc666fad247c8/scripts/sync.mjs)将浏览器侧源码打包为 browser ESM；元数据不声明 runtime dependencies。浏览器侧执行不等于必须装 Node 到 guest。
- [Playwright `v1.59.1`快照源码](https://github.com/microsoft/playwright/blob/v1.59.1/packages/injected/src/ariaSnapshot.ts)遍历 DOM、计算名称与角色、生成引用；该部分不调用 CDP。它记录 iframe 节点，不递归取得跨域 iframe 内部 DOM。

### 必须处理的风险

1. **内部 API 稳定性**：项目自己的 README 明确这些是 Playwright 内部 API，不属于官方稳定契约。固定版本、针对行为测试，不把它包装成 Microsoft 官方嵌入 SDK。
2. **不是完整动作栈**：`fill`可能返回 `needsinput`；页面侧 helper 不等于完整的等待、滚动、命中校验和原生键鼠动作。插件必须处理真实输入及失败结果。
3. **暂停清理**：[InjectedScript 源码](https://github.com/microsoft/playwright/blob/v1.59.1/packages/injected/src/injectedScript.ts)构造时安装事件监听与 MutationObserver，也维护历史快照；公开类声明未提供统一 `dispose()`。不能只停按钮或忽略输出就宣称人工接管隐私屏障完成。优先实验按需调用独立快照函数、限制持久观察器与缓存，而不是无条件创建完整常驻类。
4. **引用与敏感数据**：快照源码为元素写入 `_ariaRef`，并可能把 input/textarea 当前值放入输出。必须过滤密码与其他敏感字段、在接管时停止采集、清理插件保留的结果与引用，并在交回后重新观察。可访问性算法不是隐私策略。
5. **页面不可信**：DOM 观察不等于系统可信快照，网站可篡改页面全局函数、属性和对象；固定 helper 不能接受网页或模型提供的任意代码，也不能向 guest 暴露 Host/Node 能力。
6. **许可复核**：提取包元数据声明 MIT，而其发布类型及上游源码保留 Microsoft Apache-2.0 头。不能只写“MIT 已核验”；采用或分发前需复核原始 Apache LICENSE/NOTICE及提取包的许可材料。本轮对提取仓库根 LICENSE 的请求返回 404，不能据此断言项目无许可证或已经侵权。

因此建议是“优先做版本固定的接入实验”，不是“立即采用生产依赖”。若观察器、许可或维护成本不可接受，备选是 DOM Testing Library / `dom-accessibility-api` / finder 组合，但这会增加自行拼装快照与定位的工作。

## 纯插件仍不能消除的宿主限制

[当前官方 browser 包限制](https://unpkg.com/@deepseek-ai/dsh-client-ui-sidebar-browser@0.2.0-rc.2/README.zh.md)明确：进程内分区的 Cookie/Web storage 不跨应用重启保留，guest 下载与权限被拒绝。公开租约返回已批准分区，不能自行改成 `persist:`来绕过。

- **原生下载与重启登录态**：上述限制不是换快照库可解决的；Host 自行 fetch 或 Cookie 导出不能算同等原生能力。
- **完整网络、断点和原始 CDP**：DOM helper 不提供宿主 debugger。注入页面网络 hook只能看特定范围，不能冒充完整 Network。
- **跨域 frame 与文件上传**：本轮主文档 DOM 路线没有证明任意跨域 frame 可读写；上传的人工文件选择、固定字节实验与完整路径上传必须区分，不能宣称全部可用。
- **人工接管与后台运行**：公开保活声明为生命周期提供依据，但完整暂停屏障与停止注入后台任务仍需工程验收。

在不能修改宿主的约束下，如果这些完整功能仍为硬性要求，目前没有证据支持“全部可交付”。需要实测后向用户提出明确的范围取舍，而不是静默降级或恢复宿主开发路线。

## 最小真实 Desktop 验证

以下保留为完整产品后续验收清单，不表示本轮全部执行；本轮已执行的限定项见上文。测试不使用真实账号，不做购买、删除或实际信息提交。

1. **承载**：实验插件用正式 Sidebar 类型与正文 Slots，以及公开租约创建自己的原生 guest。保留页面实例标识与文档代次。原入口能打开且有正常滚动、中文输入；不能仅显示截图。
2. **读取**：将固定且审查过的快照 bundle随插件打包，通过该 guest 的公开 `executeJavaScript`按需调用。用户手动改变可控测试页状态，Agent 工具必须从同一 guest 读到新值。先验证敏感字段过滤。
3. **动作**：定位同一文档的元素，复核可见性、唯一性、命中目标与页面归属，再通过公开输入方法完成点击或输入。结果应立即出现在用户侧栏；额外通过截图或新观察核对。
4. **失效**：人工滚动、重排、导航后拒绝或重新确认旧引用和坐标；不因相同 URL绑定另一 guest。跨域 frame明确返回未支持或无法读取，不作空白成功。
5. **暂停与关闭**：接管后拒绝新读写并丢弃迟到结果，不留存接管期采集缓存；交回重新观察。若存在未能撤销的观察器或后台任务，暂停不得标记成功。关页取消请求；收起与切会话验证实际保活。
6. **消息和隔离**：通过当前正式 Host/Client契约关联请求，不给 guest 注入 RPC权限；工具身份来自真实执行上下文。用两个 DSH 会话验证错误归属、过期页面、断线与结果不明。

失败判据：原生 guest 无法挂载，公开方法实际被拒绝，读写落到不同实例，敏感字段泄漏，人工接管屏障无法成立，或跨会话越权。出现任何一项就记录具体失败，不修改宿主、调用私有接口或改用外部窗口绕过。

## 推荐下一步

限定复用验证已通过。后续若进入产品实现，应把固定发布 bundle 的接入整理为同版本源码改动，继续保留官方界面、导航和恢复逻辑，再按首版规格扩展工具能力；不扩大自建实验页或实现 CDP 兼容层。

快照/定位库的选择只解决工具感知与动作适配，不替代官方浏览器复用。`playwright-injected` 尚未被选定为生产依赖；复用计划不能自动升级为“官方浏览器已经能够直接挂工具且满足全部需求”。首版产品取舍见[已确认首版范围](design.md#已确认首版范围)，跨工作区全局账号容器已由[任务02](login-scope-validation.md)取得可行证据，正式范围设置和完整验收仍待后续任务。
