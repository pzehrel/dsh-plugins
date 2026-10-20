# 现成自动化工具接入前置验证

状态：已执行公开契约、安装产物与进程前置检查；未创建测试 guest，未连接成熟工具，未完成原生同页闭环。此次结果不是插件兼容性验收，也不是完整产品交付。

## 后续约束变更

用户随后明确只能做插件，不能修改主程序。因此本文的宿主接口提案仅保留为历史讨论，不再推荐转到宿主仓库或补主程序接口。此次 CDP 前置检查不是对所有纯插件路线的否定；当前下一步见[纯插件复用研究](plugin-only-reuse-research.md)。

## 结论

优先复用现成工具的方向保持不变，但当前安装版没有已确认可供 Playwright 或 Vercel agent-browser 使用的正式 guest CDP 通道。接入实验在连接前置条件处停止，不通过开启整个 Electron 进程的调试端口、私有 IPC、修改安装包或另开 Chrome 来制造成功。

这不证明插件无法通过公开 `webview` 方法完成基础读取和输入；它只说明候选工具已有的 CDP 连接路线目前没有正式可用入口。实现一套新的协议兼容层也不能未经验证就称为薄适配，更不能据此直接转向全栈自研。

## 实际环境与方法

- 检查时间：`2026-10-12T16:21:27.785051+00:00`。
- 官方 macOS Desktop：`0.2.0-rc.2`；构建提交：`5e9e301dd9dc8923b2762f76dacfc5751f6ca851`。
- 主进程：PID `92529`，执行文件 `/Applications/DeepSeek Harness.app/Contents/MacOS/DeepSeek Harness`。
- 可用 Playwright CLI：`0.1.21`；本轮未安装 Vercel agent-browser，也未新增工作区依赖。
- 检查使用的 bundled Node：`v24.21.0`。
- 只读解析安装包的 ASAR header，提取相关文件到临时目录后读取；不修改归档，不执行其内部模块或私有 IPC。

安装归档为 `/Applications/DeepSeek Harness.app/Contents/Resources/app.asar`。以下路径和行号均相对于该归档，不是源代码仓库路径。

## 检查结果

| 检查 | 实际证据 | 判定 |
| --- | --- | --- |
| 原生承载 | browser 包 `README.zh.md:12,67–71` 描述 Electron `webview`、公开租约及 `keepMounted`；当前包版本为 `0.2.0-rc.2`。 | 有官方契约依据；本轮没有安装实验插件，尚未运行验证。 |
| 公开 Browser bridge | `lib/preload-app.cjs:769–784` 的 bridge 只有 `acquire`、`release`、`onOpenRequested`；与[同版本公开类型](https://unpkg.com/@deepseek-ai/dsh-client-ui-sidebar-browser@0.2.0-rc.2/lib/types/types.d.ts)一致。 | 创建页面租约不是自动化连接通道；没有 guest CDP endpoint、debugger 或协议收发接口。 |
| guest 隔离策略 | `lib/main.js:9682–9705` 验证租约、所属窗口和 partition，并强制 `nodeIntegration: false`、`sandbox: true`、`devTools: !app.isPackaged`。 | 不能靠给自己的 `webview` 添加调试参数解除宿主策略；`devTools` 配置本身不单独证明全部 CDP 行为。 |
| 运行中主进程 TCP 端点 | `lsof -nP -a -p 92529 -iTCP -sTCP:LISTEN` 返回 `1`，stdout 与 stderr 均为空。 | 该进程在检查时未发现 TCP LISTEN；不能推导为其他进程、管道或所有未来接口都不存在。 |
| Web GUI 可达性 | 对 `http://127.0.0.1:19387/` 的无凭据 HTTP 请求返回 `401`。 | Host 要求认证；这不是 CDP 端点，也不代表 Desktop guest 不可用。未绕过认证或接入其他已有浏览器会话。 |
| 候选工具前置条件 | [Playwright MCP](https://github.com/microsoft/playwright-mcp/blob/main/README.md)提供 `--cdp-endpoint`；[Vercel agent-browser](https://github.com/vercel-labs/agent-browser/blob/main/README.md)提供 `connect` / `--cdp`，Electron 支持以暴露 CDP endpoint 为前提。 | 有复用接口，但它们不会自动为 DSH 创建受控 guest endpoint。当前没有获证据支持的地址可传入。 |

没有对随机端口发起失败连接来冒充兼容性测试，也没有连接现有的外部 Chrome。只有正式入口出现后，才能测试协议兼容性和同页行为。

### 安装文件指纹

| ASAR 内文件 | SHA-256 |
| --- | --- |
| `lib/preload-app.cjs` | `f323eb67f7ace407d3b1d858f264f7846e436d9ba3e80c02b0454a6da0aed968` |
| `lib/main.js` | `10325004a1ddbd8118ed0607ea28d50a7b0d692dcaeb25a67a7d8aea9165019d` |
| `dsh/node_modules/@deepseek-ai/dsh-client-ui-sidebar-browser/README.zh.md` | `a172cd71fcd66e4181fb30bf438a6cf2daf4bf6de59380a66bede3a22be29839` |

指纹针对归档内的原始文件字节。主进程 PID 与监听状态只是当时的快照，复查时应重新查找实际 PID：

```bash
playwright-cli --version
ps -ax -o pid,command
lsof -nP -a -p <当前官方-Desktop-主进程-PID> -iTCP -sTCP:LISTEN
```

## 尚未执行的真实同页实验

以下全部未执行，不能记为成功或失败的产品验收：

1. 在正式 Sidebar Slot 中创建自有原生 guest，并显示可控测试站。
2. 人工修改测试页状态，成熟工具读取到该变化；工具点击或输入立即体现在同一 guest。
3. 确认页面不会因工具连接而换成后台或外部 Chrome；验证中文输入与普通人工滚动。
4. 验证跨会话隔离、人工接管、迟到结果处理、关闭取消与后台存活。

## 最小宿主接口提案：行为边界

这是待工程验证的提案，不声称存在以下同名 API，也未修改宿主或发布远端事项。

目标是提供成熟工具可接入的受控协议入口，而不是重新实现浏览器引擎或完整自动化工具栈。

- **绑定对象**：正式页面租约与真实调用会话；只暴露该调用有权访问的 guest，不暴露 DSH 主界面、其他会话或整个 Electron 进程。
- **协议适配**：首先验证受限 CDP transport 能否满足成熟工具连接、发现目标、读取、截图、点击与输入的实际需求。仅声明支持几个 CDP 命令不等于满足 Playwright 的连接握手和上下文要求。
- **权限收敛**：候选工具能枚举的 targets、contexts 和 sessions 都必须受宿主范围限制；任意脚本、原始 CDP 与敏感动作仍遵循已确认审批规则。不能把通用工具的任意执行能力直接透传给模型。
- **暂停屏障**：人工接管阻断读写、订阅、未交付及迟到结果；交回后重新观察，不能补发接管期间的数据。
- **生命周期**：租约关闭、会话归属变化或连接失效后撤销控制；结果不明时不得自动重试敏感动作。
- **能力发现**：按实际宿主版本与能力启用；缺失时明确返回限制。

下一项工程工作应在正式 DSH 开发仓库验证这个协议入口，再运行上述同页实验。若现有公开 `webview` 能力允许复用成熟库的部分页面逻辑，也可另行评估，但必须说明复用范围与需要自建的部分，不以此冒充完整工具接入。

参见[复用调研](community-reuse-research.md)、[既有宿主能力证据](research.md#当前官方宿主证据)与[ADR 0003](../../../.agents/docs/adr/plugins/agent-browser/0003-upstream-browser-capabilities.md)。
