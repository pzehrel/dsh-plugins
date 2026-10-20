# 纯插件最小接入实验记录

状态：纯插件最小接入实验已在真实官方 macOS Desktop 完成同页读写、人工接管及 A→B 会话隔离负例验证；未修改主程序。本实验不是完整浏览器产品。实际工具结果与用户确认见[证据记录](evidence/desktop-spike-verification.json)。

## 实验范围

- 只使用插件自己的 loopback 测试站，不访问真实网站、账号或文件。
- 通过正式 Sidebar 类型和正文 Slot 创建独立“Agent 浏览器实验”页，不替换原内置浏览器及其已有页面。
- Host 注册 `agent_browser_spike`工具；认证 Client 通过正式 Connection RPC 接收固定动作，持有自己创建的原生 `webview`。
- 当前只支持读取已知测试字段与点击计数按钮，不接受任意 URL、脚本或模型提供的会话身份。密码测试字段不进入工具结果。
- 未接入第三方快照库；先验证通信与原生方法，不能把固定测试字段读取称为完整页面感知。

## 工具与验证按钮

`agent_browser_spike`只有两个必填参数：

| 参数 | 接受值与效果 |
| --- | --- |
| `pageId` | 实验侧栏显示的 Host 页面身份。Host 将它与实际调用 Agent 的会话核对，越权、关闭或过期身份拒绝。 |
| `action` | `read`读取测试页字段；`click`通过公开原生输入方法点击已知计数按钮。其他值拒绝。 |

“运行工具闭环”按钮使用公开 `ToolRuntime.execute`与该会话真实 Agent 身份，按读取、点击、再读取的顺序调用工具。它是注册表/流水线接入实验，不是模型自主生成调用的证明。会话尚无实时 Agent 时会明确拒绝。点击结果中的 `lastTrusted`用于辅助核对是否触发了原生输入事件，不能单独替代同实例证明。

“人工接管”先阻止 Client 新读写，再撤销 Host 在途请求，并等待已调用方法结算。实验不注入常驻 guest 观察器或持续采集；迟到结果不跨接管代次补发。它只覆盖本实验的两个固定动作，不证明未来任意脚本和完整调试订阅都已实现暂停。

## 已观察到的 Desktop 失败及修复

用户提供的 `Screenshot 2026-10-14 at 11-34-55.png`显示实验侧栏已加载，但页面身份为“未就绪”，注册请求失败：

```text
Error: transport failure for /api/agent-browser-spike/register: HTTP 404
```

该失败发生在租约申请和 webview 创建之前。不能把侧栏标题可见或测试站已经监听，当作 Host 工具和 RPC 激活成功。

通过与当前宿主一致的官方 Connection `0.2.0-rc.2`公开 Fetch handler，以及本插件真正的 `apply`路径建立[协议回归测试](../test/connection.test.ts)。只在外部边界模拟认证、Agent/工具服务与 node:http测试站，不读取真实凭据，不伪造 Desktop guest。

旧代码会先报 `schema.required is not supported by the value schema DSL`，随后同一个注册页请求返回 404。根因是 `defineTool`接收作者侧 value schema DSL，而不是原始 JSON Schema；必填标记应写在每个属性上。工具注册抛错使其后的 RPC interceptor未安装。修正输出 DSL 后，同一请求返回 200并取得页面身份；没有修改 Client endpoint。

用户在重启后提供第二张截图，仍是同一 404。前一协议测试只使用空的 Connection service，遗漏了真实宿主已有 API Gateway 的组合条件。补上已有共享 interceptor 后，测试稳定报 `connection: shared RPC channel "/api" already has an interceptor`，注册请求仍返回 404。官方同版服务只允许该通道有一个 interceptor。

当前修正为通过 `ctx.connection.fetch.register`注册本插件的八个精确 POST 路由，承载既有 RPC 请求/响应信封，不再认领共享 interceptor。Client地址不变；回归同时检查实验注册成功及原有 Gateway endpoint仍返回 200。此修复已在含已有 Gateway 的公开协议边界通过，仍须真实 Desktop加载新版后验证。

另补启动失败清理回归：测试站在工具注册前获得插件生命周期归属，后续启动失败也撤销监听。此前失败启动遗留的测试站只能随旧进程结束清除；本轮不通过私有 IPC或强杀当前宿主处理它。

SDK 测试依赖与当前宿主统一到 `0.2.0-rc.2`，避免用 `rc.1`工具库和 `rc.2`通信库混合验收。静态类型检查不是启动验证，今后构建通过仍需执行协议测试与真实 Desktop 验证。

## 自动检查记录

后续 P1改进已清理未使用的 catalog 项，`pnpm install --frozen-lockfile`与完整 `pnpm check`均通过，当前共15条测试。新增[分级验收命令](verification.md)区分本次自动检查和历史原生证据，不自动操作 Desktop。以下保留最小实验当时的检查记录：

- 实验控制边界与正式通信协议：6 条测试通过。
- 实验 Host/Client 构建、类型检查与定向 ESLint：通过。
- SDK peer 检查：无版本冲突。
- 当时 `pnpm check`因未使用的 `puppeteer-core` catalog 项失败，后续检查未执行；这是历史失败记录，已由上述 P1门禁修复恢复，不能改写成当时全量通过。
- 当前构建生成独立插件入口 `dist/host-fetch-routes-2.js`，profile指向该物理路径以区分旧 Node模块缓存；不依赖 file URL query。界面显示“Fetch v2”。用户重启后，真实 Host探针返回 `build: fetch-routes-v2`、`ready: true`、`registerStatus: 200`，随后完成下述真实工具验证。

## 运行时注册探针

新版启动时通过当前真实 Host的公开共享 Fetch handler验证注册请求、请求关联 id和页面身份，然后立即释放探针页面记录。这不创建 Agent或原生 guest，不读取真实会话，也不模拟同页产品验收。

测试站的只读 `GET /_agent_browser_spike_status`仅返回四个字段：`build`是实验构建标记，`ready`表示上述 Host注册探针通过，`registerStatus`是其 HTTP状态，`error`是有限的非敏感探针错误说明。此状态不含 Cookie、Client控制 token、真实会话 id或账号数据；它不代表 Desktop物理传输、原生页面、工具点击或人工接管已通过。

## 真实最小验收结果

结果记录时间为 `2026-10-15T05:13:10Z`，以执行环境 UTC 时钟为准。具体页面和会话身份保存在[证据 JSON](evidence/desktop-spike-verification.json)；没有保存 Client控制 token、Cookie或密码字段。

| 场景 | 真实证据与结论 |
| --- | --- |
| 独立实验侧栏与 Host激活 | 用户打开 Fetch v2实验页并提供顶部页面身份；当前真实 Host注册探针返回 200。 |
| 原生同页读取与点击 | 当前 Agent直接调用 `agent_browser_spike`，读、点、再读的计数为 `1、2、2`；页面身份与文档标记均不变，点击结果为 `lastTrusted: true`；用户确认侧栏可见计数为 2。 |
| 人工修改后读取 | 用户把输入框改成“人工验证 A”，实际工具读取到该值，计数仍为 2。 |
| 人工接管拒绝读写 | 用户确认“人工接管已生效”后，实际读取和点击均返回“该页处于人工接管”；用户确认计数没有变化。 |
| 交回后重新观察 | 用户在接管期间修改字段并交回，实际读取返回“接管期间修改”，同一文档、计数仍为 2。 |
| 两个真实会话的页面归属 | 用户在 B会话创建另一原生实验页；当前 A会话 Agent读取和点击 B页均返回“不能操作其他会话的共享页面”。实际验证方向为 A→B，未从 B会话 Agent反向调用 A页。 |
| 切换会话后的 A页存活 | 用户创建 B页并切回后，A页仍保留同一页面身份、同一文档、计数 2及最新人工修改内容。 |

页面身份与文档标记不是同一个 UUID。用户最初提供的是测试页底部的文档标记，将它作为 `pageId`调用会明确失败；改用实验控制栏顶部的页面身份后，当前 Agent直接调用成功。

本次没有取得独立的操作系统窗口截图：截图命令返回 `could not create image from window`，原生无障碍树只暴露窗口外框。可见计数依据用户确认，数据变化、拒绝结果与文档一致性依据真实工具调用；没有用后台 Chrome、模拟网页或截图流替代 Desktop验收。

### 仍未验证

- 真实 Desktop中的延迟回调/在途结果压力场景仅有控制边界自动测试，不把当前暂停新读写的实测扩展成完整并发隐私验收。
- B会话 Agent反向访问 A页、复杂多窗口与所有隐藏状态的生命周期。
- 第三方完整快照库、任意网站、截图工具、文件、完整调试、重启登录态和完整产品外观。

这些剩余项不影响本轮限定的可控测试页最小闭环结论，也不能据此宣称完整浏览器已交付。

## 构建、复查与撤销

```bash
pnpm --filter dsh-plugin-agent-browser-spike build
pnpm --filter dsh-plugin-agent-browser-spike typecheck
pnpm exec vitest run plugins/agent-browser/test
pnpm check
```

当前 Desktop profile已通过用户 patch中的独立 `agent-browser-spike-experiment`插入项加载本地构建入口。此操作修改插件配置，不修改 DSH安装包或主程序；配置影响该 profile的所有会话。

重建插件不自动替换 Node已缓存的 Host模块。修复部署必须明确让 Host重新导入新构建，并刷新 Desktop Client，不能只刷新 Web页面后宣称原生验收成功。如需要重启 Desktop，应先保存用户工作，由用户决定时机。

撤销实验时仅移除 profile用户 patch中的该实验 `insert`块，保留其余用户配置。不删除工作区源码或用户数据。实验卸载应撤销工具、RPC和测试站，旧页面身份不再有效。

完整产品边界仍以[纯插件复用研究](plugin-only-reuse-research.md)及用户最新“不能修改主程序”的约束为准；本记录不将下载、持久化或完整调试标为已支持。
