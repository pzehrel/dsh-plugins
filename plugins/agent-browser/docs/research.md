# Agent 浏览器能力调研

本文服务于[需求访谈](../README.md)，区分运行时契约、源码证据、旧会话记录与待验证假设。早期调研时没有加载插件或创建网页；后续最小闭环、官方复用与[任务02账号容器验证](login-scope-validation.md)已有各自限定的真实证据，不代表完整产品验收。

## 结论

原生侧栏网页与 Agent 自动化并非互斥：插件可研究通过公开浏览器租约创建自己拥有的 Electron `webview`，再通过公开侧栏槽展示。拿不到原插件已有页面，不代表只能使用画面流。

但当前安装版 DSH 的下载、调试、存储及部分网页策略限制，不能靠引入 Playwright 或 Puppeteer 自动消失。用户要求的完整能力尚不能标为纯插件已可交付。

## 已找到的旧调研

| 会话 | 可复核事件 | 结论及限制 |
| --- | --- | --- |
| `session-2c01bbce-667f-4086-8215-b0bfb1538ac2`，支持智能体的内置浏览器插件方案 | seq296，补充 seq304、seq312 | 建议接管原生 browser 入口，以专用 Chromium 加 CDP 画面投影实现；没有用户确认或端到端验证，展示方式与本轮原生要求冲突。 |
| `session-8852aefd-b755-4287-91eb-5a9eb6e97a22`，确认是否能调用内置浏览器 | seq326 用户授权；seq362 旧方案写入；seq616 旧说明写入；seq636 汇报 | 当时 M1 报告单测通过，同时明确未完成真实宿主验收；不能继承为本轮实现状态。 |
| `session-1f2a4ec2-7e41-4b82-86b0-c4b7ed9e4327`，查看内置浏览器当前内容 | 投影缓存第 704–735 行 | 第三方工具可用后，用户仍报告看不到侧栏；工具测试不能替代界面验收。 |

前两份原文位于 `$DSH_HOME/sessions/--Users-pzehrel-Documents-repositories-my-dsh-plugins--/<session-id>/session.v4.jsonl.zstd`；标题和摘要投影位于 `$DSH_HOME/storages/session_projcache/sessions/<session-id>.json`。这里只记录定位信息，不复制无关会话内容。

本轮起查时插件目录不存在；现有 git 历史只证明根 README 曾引用旧文档，不能证明其被删除或改名。旧实现没有在本轮恢复。

## 当前官方宿主证据

本机安装版：Desktop `0.2.0-rc.2`，构建 `5e9e301dd9dc8923b2762f76dacfc5751f6ca851`，Electron `44.0.0`。以下 ASAR 行号来自只读产物检查，不是源码 checkout，也不是未来版本保证。

产物根路径为 `/Applications/DeepSeek Harness.app/Contents/Resources/app.asar`。

### 展示与接入

- 官方 `@deepseek-ai/dsh-client-ui-sidebar-browser/README.zh.md` 第 12、63–71 行：Web 使用 iframe，Desktop 使用 `webview`；第 92–96 行明确不向模型注册页面工具或内容。
- 主会话的 Client Inspect 已验证 `sidebar.right.pane.tab` 是 session-scoped keyed Slot，其中存在官方 browser 正文；子调研会话的 Client 查询超时，不应将其记作验证成功。
- 官方 `@deepseek-ai/dsh-client-ui-sidebar-right/README.zh.md` 第 81–86 行：先通过 `sidebarRightTabs.register` 注册类型，再注册正文 Slot；同 kind 的 extension 可替换 builtin，卸载恢复。它复用位置与外框，不会移交旧页面对象。
- browser 包正式导出 `/types`。[同版本公开类型](https://unpkg.com/@deepseek-ai/dsh-client-ui-sidebar-browser@0.2.0-rc.2/lib/types/types.d.ts)包含 `DesktopBrowserBridge.acquire(workspace)`、`release`、`onOpenRequested`，以及租约和 partition 类型。
- `lib/main.js` 第 9682–9705 行验证有效租约、所属窗口、未附着和 partition 一致，不检查内置组件身份。自有正文按租约创建 `webview` 有静态依据；尚未实测。
- 原 browser controller 在其 `lib/client.js` 第 1595–1634 行的闭包中；不能由 Slot 注册自动取得旧 controller。
- Host Inspect 的 `browserUse` 只有 `register(name)`，是 provider 注册，不是网页控制 API。

### 能力矩阵

| 能力 | 当前证据与边界 |
| --- | --- |
| 原生输入、导航、主页面 DOM、脚本、视口截图 | Electron 44 的[公开 webview 方法表](https://github.com/electron/electron/blob/v44.0.0/lib/common/web-view-methods.ts)含 `sendInputEvent`、`insertText`、`executeJavaScript`、`capturePage` 等；纯插件有依据，尚未本机验证。 |
| 基础控制台 | [公开事件表](https://github.com/electron/electron/blob/v44.0.0/lib/browser/web-view-events.ts)含 `console-message`；不等于完整对象、堆栈、worker 调试。 |
| 完整 Network、断点、跨 frame 调试 | 现有 bridge 未开放 guest debugger/session；网页内脚本注入不能替代完整 Network 能力。 |
| 原生 DevTools | `lib/main.js` 第 9689–9705 行强制 `devTools: !app.isPackaged`，本安装版不开放。 |
| 网页下载 | `lib/main.js` 第 9762–9785 行注册 `will-download` 并取消下载；换成 `downloadURL` 不能绕过。Host 另行 fetch 不是同等原生下载能力。 |
| 上传 | 人工文件选择待实测；完整 Agent 本地路径上传、跨域 frame 文件选择未证明。字节注入只能算特定场景替代。 |
| 登录态 | 官方 browser README 明确 Cookie/Web storage 不跨应用重启；只承诺按规范化工作区 CWD 共享进程内分区。builtin 没有全局设置；后续任务02已通过公开 bridge 的自有账号命名验证跨工作区共享，完整配置仍待实现。 |
| 网站权限、dialogs、HTTP auth、弹出窗口 | 当前宿主存在拒绝/转发策略；完整流程需逐项验证，不能承诺所有网站。 |

范围访谈再次只读核对了同一安装版产物。官方 browser `README.zh.md` 第 110 行明确登录态与下载限制；`lib/client.js` 第 1424–1425 行以真实工作区路径或无工作区时的会话身份生成分区 key，第 1159–1161 行传给 `acquire`。`lib/main.js` 第 9630–9641 行按 `workspace identity` 字符串分配分区；未找到正式的全局 scope 配置。传固定字符串在实现层可能共用分区，但没有据此证明跨真实工作区的全局容器获得公开契约支持，也未做此运行态实验；这是范围访谈时的未解决结论，不能声称宿主已明确禁止。后续任务02区分了公开类型中的 storage account 与 builtin 的 CWD 策略，采用独立插件账号命名空间，取得了跨两个真实工作区的正面证据；具体契约、过程和限制见[验证报告](login-scope-validation.md)。

历史调研曾建议通过上游扩展补齐调试、文件与持久化，见已失效的 [ADR 0003](../../../.agents/docs/adr/plugins/agent-browser/0003-upstream-browser-capabilities.md)。用户后续明确只能做插件；当前首版取舍以[已确认首版范围](design.md#已确认首版范围)为准，不恢复宿主开发路线，不修改 ASAR 或调用私有 IPC。

## 社区源码参考

关于“直接嵌入现成 Agent 友好浏览器”与“复用自动化后端”的区别，见[社区方案复用与原生嵌入](community-reuse-research.md)。后续应先验证成熟工具对同一原生页面的接入可行性，不默认自研完整自动化栈。

### 原生承载的直接例子

[DeepSeek-Harness-Browser](https://github.com/tonyd2wild/DeepSeek-Harness-Browser)的[Client 源码](https://github.com/tonyd2wild/DeepSeek-Harness-Browser/blob/main/plugin/client.js)在官方 Desktop 分支使用 `dshDesktop.browser.acquire`、租约 partition、`about:blank#lease` 创建自己的 `webview`，并读取实时 DOM。工具主要是打开、读取、关闭；它的能力不是完整自动化的证明。

尤其不能整套照搬：该源码通过 `shell.overlay`、直接修改宿主 grid 和 MutationObserver 维持侧栏空间，不符合本仓库只走正式扩展契约的方向；我们应使用公开 Sidebar 类型与正文槽。README 同时描述了 Web 画面流和自制桌面壳，二者均不能混算为官方 Desktop 原生方案的验收。

### 自动化可借鉴，但展示方式不符合本轮要求

- [dsh-embedded-browser 的 screencast 实现](https://github.com/imroc/dsh-embedded-browser/blob/72998a7b8408ba053c478fd07789876da8893327/lib/screencast.js)：共享后台页面，通过帧流或截图展示、回放输入；不是原生侧栏网页。
- [BrowserSkill 的侧栏视图](https://github.com/Tencent/BrowserSkill/blob/4c8616b12273ac5a22ce4adb494cac941e20de2a/packages/dsh-plugin-browserskill/src/client/ObservationOverlay.tsx)：侧栏展示缩略图，真实网页在[外部 Chrome 窗口](https://github.com/Tencent/BrowserSkill/blob/4c8616b12273ac5a22ce4adb494cac941e20de2a/apps/extension/src/session-manager/agent-window.ts)。
- [dsh-playwright](https://github.com/whklwhkl/dsh-playwright/blob/e7ff42d8e0675ef7297f50d3b78768b47893de68/lib/index.js)：启动 Chromium 或通过 CDP 附着已有浏览器，没有原生侧栏 guest 实现。
- [Playwright MCP](https://github.com/microsoft/playwright-mcp)提供成熟的快照、操作、文件和调试接口参考；[CDP relay 源码](https://github.com/microsoft/playwright/blob/main/packages/playwright-core/src/tools/mcp/cdpRelay.ts)展示协议桥接。能桥接协议不代表 DSH 已公开同等 guest 能力。
- [Vercel agent-browser 的快照源码](https://github.com/vercel-labs/agent-browser/blob/main/cli/src/native/snapshot.rs)展示 AX 树、元素引用和文档身份失效处理；可借鉴引用生命周期，不能用旧引用盲点导航后的页面。

以上为源码阅读，不是这些插件在本机安装或验收通过。实现前仍需固定依赖版本、复核许可与当前宿主兼容性。

## Codex 参考：已验证与未知

旧 Codex 浏览器文档地址当前跳转至[官方 Browser 文档](https://learn.chatgpt.com/docs/browser)；它区分桌面内置浏览器与云端浏览器，不能混用结论。

- 桌面内置浏览器：用户与 Agent 共享页面，使用独立于常用浏览器的 profile，可直接登录；Agent 可点击、输入、截图和检查页面；敏感动作确认，全量 CDP 是额外开发者权限。
- 云端浏览器：文档明确描述登录时暂停、人工登录后用 “I'm done” 交回控制。
- [Windows 用户问题报告](https://github.com/openai/codex/issues/49935)描述 Agent 持有浏览器控制权时无法人工标注；[macOS 用户问题报告](https://github.com/openai/codex/issues/33133)展示 guest 生命周期和 browser session 所有权错误。这些是版本相关的用户报告，不是官方设计保证或本轮复现结果。
- 未证实：桌面内置浏览器是否在人类任意鼠标输入时自动抢占，以及人工接管时是否停止所有截图和 DOM 读取。不能把云端规则写成桌面内部实现。

Q9 后续用户提供了更具体的实测观察：Codex 有独立于用户鼠标的 Agent 指针，用户滚动页面时似乎没有出现提示，Agent 仍能正常操作。将其记为用户观察；它支持普通浏览不必强制交接的交互方向，但不能证明页面焦点、滚动状态或输入事件完全隔离，也不能证明敏感输入会自动停止采集。

Q9 调整后的建议已获用户接受，见 [ADR 0004](../../../.agents/docs/adr/plugins/agent-browser/0004-human-agent-interaction.md)：普通浏览允许人机交互并存，Agent 不移动用户的系统鼠标；共享页面变化后重新校验目标，坐标过期时不盲目执行。另提供可选的人工接管状态，用于登录等敏感场景，暂停该页的 Agent 读写，显式交回后重新感知。这是本插件的目标规则，并非已实现的能力或对 Codex 内部行为的断言。暂停不能撤回已发给模型的内容，也不能逆转已经完成的网站操作。

## 后续验收必须证明什么

- 用户看到、手动操作和 Agent 感知/操作的确实是同一个原生 guest。
- 页签切换、会话切换、关闭侧栏、取消和断线不会把命令落到另一页或重放已完成的敏感动作。
- 中文输入、复制粘贴、登录、文件、调试均有真实 Desktop 用例；mock 工具结果不算完成。
- 尚未确定的宿主缺口有正式解决路径；不通过私有调用或修改安装产物隐性绕过。
