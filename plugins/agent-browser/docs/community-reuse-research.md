# 社区方案复用与原生嵌入

状态：本轮读取上游 main 分支文档及部分源码，未固定版本、安装依赖或验证 Desktop 兼容性。后台调研代理执行失败，本记录由主代理直接查阅一手来源整理。本文补充[既有调研](research.md)，不改变已确认产品边界，也不代表已选定实现依赖。

## 后续研究

用户后续明确只能做插件、不能修改主程序。本文及接入前置验证中的宿主扩展路线不再适用；当前浏览器侧库复用方案与实际限制见[纯插件复用研究](plugin-only-reuse-research.md)。

## 结论

应优先复用现成自动化工具，而不是自行实现整套快照、定位、点击、输入与调试栈。但“Agent 友好自动化工具”与“可原生嵌入 DSH 的浏览器组件”不是同一能力。下面的来源尚未证明存在满足全部要求的即插即用组件。

建议优先比较 Playwright MCP 与 Vercel agent-browser 对同一原生 guest 的接入可行性。DSH 集成负责原生页面承载、会话归属、审批、人工接管和生命周期；实际工作量必须由接入实验确定，不能提前称为薄适配或完整重建。

## 候选与证据

| 候选 | 已有能力与可复用部分 | 原生嵌入边界 |
| --- | --- | --- |
| [Vercel agent-browser](https://github.com/vercel-labs/agent-browser/blob/main/README.md) | CLI 与 Rust daemon，提供元素引用快照、点击、输入、截图等；CDP 模式可连接已有浏览器，文档列出 Electron。 | Electron 支持有暴露 CDP 端点的前提，不能据此推断 DSH 已开放该能力；其 WebSocket preview 是画面流，不满足原生侧栏要求。 |
| [Playwright MCP](https://github.com/microsoft/playwright-mcp/blob/main/README.md) | MCP 工具与结构化快照，支持通过 `--cdp-endpoint` 连接已有浏览器；可考虑复用工具服务或其下层 Playwright。 | MCP 不是原生页面 UI；通过 CDP 接入侧栏 guest 的兼容性、目标枚举、权限限制与暂停屏障仍须验证。 |
| [Browser Use](https://github.com/browser-use/browser-use/blob/main/README.md) | Python Agent 库、CLI 路线与云服务；文档中的集成可以驱动本地、云端或既有 CDP 浏览器。 | 不是上述文档已证明的 DSH 原生嵌入组件；若保留 DSH Agent，需区分复用浏览器驱动与再引入独立 Agent 循环的成本。 |
| [DeepSeek-Harness-Browser](https://github.com/tonyd2wild/DeepSeek-Harness-Browser/blob/main/plugin/client.js) | 源码包含官方 Desktop bridge 租约、自建 `webview` 与页面导航，可作为承载接入参考。 | 同一文件通过 `shell.overlay` 注册，并修改宿主 grid、以 MutationObserver 维持布局；不能整套照搬为本仓库正式 Sidebar 集成。其自制壳的持久化配置不能当作官方 Desktop 租约的持久化证明。 |

这些判断来自上述 README 或源码，不是本机运行结果。main 分支内容可变；采用前须固定版本、复核许可证及公开契约。

## 与已有决策的关系

[ADR 0001](../../../.agents/docs/adr/plugins/agent-browser/0001-native-desktop-browser.md)要求原生共享页面，不要求自动化必须自研；[ADR 0003](../../../.agents/docs/adr/plugins/agent-browser/0003-upstream-browser-capabilities.md)要求通过公开宿主接口补齐缺口，也不排斥成熟第三方自动化后端。因此优先复用不与这两项决策冲突。

现有[宿主证据](research.md#当前官方宿主证据)记录了调试通道、下载和持久化限制；后续[接入前置验证](connection-validation.md)已复核安装版 `0.2.0-rc.2` 的公开 bridge、guest 策略和主进程 TCP 监听状态，尚未执行真实同页闭环。引入第三方自动化不会自动解除宿主限制，也不应直接暴露整个 Electron 进程的调试端口。

## 下一步建议

先进行接入可行性验证，再定实现依赖和工作拆分：

1. 核实当前官方 Desktop 的公开页面租约及可用控制接口；明确是否能向候选工具提供仅限授权页面的协议入口。
2. 在可控测试页上，让人修改状态、工具读取，再由工具点击或输入；证明用户和工具操作同一个原生页面，而非两份相同网址或画面投影。
3. 验证候选工具不会访问 DSH 主界面或其他会话，人工接管能阻断读写与未交付结果。通用连接参数本身不证明这些安全边界成立。
4. 如果缺少正式控制通道，先形成有证据的宿主接口提案；不要因为无法接入就立即自行重写整套自动化，也不使用私有接口绕过。

上述是建议的实验范围，不构成安装、修改宿主、访问真实账号或执行敏感网页动作的授权。

## 2026-10-20：现有工具交互对照

本次仅查阅 `microsoft/playwright-mcp`、`browser-use/browser-use`、`browserbase/stagehand` 的当前一手 README/docs，未安装或运行上游。以下只为现有工具及内置浏览器 UI 提供交互参考，不改变纯插件路线，不构成官方 DSH 兼容证明。

- **标签页与导航**：Playwright MCP 的 `browser_tabs` 明确列出 list/new/close/select；Browser Use 将 `navigate`、`go_back` 与 `switch`、`close` 分开。现有 `list-tabs/create-tab/select-tab/close-tab` 可沿用这种明确动作与当前目标的表达，避免把导航成功混同于网页任务成功。来源：[Playwright MCP 工具表](https://github.com/microsoft/playwright-mcp#tools)、[Browser Use 工具表](https://docs.browser-use.com/open-source/customize/tools/available)。
- **观察与引用**：Playwright MCP 先提供 accessibility snapshot，再由动作引用目标；Stagehand 示例先 `observe` 获取 selector，再单独 `fill`。可借鉴“先观察、再作用于明确目标”的反馈顺序；本插件已有短期 `reference`，上游 selector 的存在不能证明其具有本插件的引用失效或防重放语义。来源：[Playwright MCP 工具表](https://github.com/microsoft/playwright-mcp#tools)、[Stagehand README 示例](https://github.com/browserbase/stagehand#readme)。
- **原生输入**：Browser Use 独立列出 `click`、`input`、`send_keys`、`scroll`。现有 `click-element/fill/press/scroll` 可保持同样明确的动作名称，完成后由重新观察核对页面结果。工具分类来自上游；“输入已发送不等于业务成功”及重新观察要求来自[本插件原生输入契约](../src/native-input.ts)。来源：[Browser Use 工具表](https://docs.browser-use.com/open-source/customize/tools/available)。
- **截图**：Playwright MCP 明确要求动作使用 snapshot，而非仅凭截图；Browser Use 将 screenshot 描述为视觉确认。现有截图可作为核对反馈，继续由语义观察提供动作引用。来源：[Playwright MCP 工具表](https://github.com/microsoft/playwright-mcp#tools)、[Browser Use 工具表](https://docs.browser-use.com/open-source/customize/tools/available)。
- **人工接管与审批**：Browser Use 开源文档展示 `pause()`、`resume()`；Playwright MCP 动作参数包含用于请求许可的人类可读目标说明。可借鉴清晰的暂停/恢复入口与审批目标描述，但上述文档未据此证明暂停能中断在途采集、阻止未交付结果，或提供 DSH 的逐次审批、会话归属与独占接管屏障；本轮所读 Stagehand README 也未据此证明这些能力。来源：[Browser Use 生命周期钩子](https://docs.browser-use.com/open-source/customize/hooks)、[Playwright MCP 工具表](https://github.com/microsoft/playwright-mcp#tools)、[Stagehand README](https://github.com/browserbase/stagehand#readme)。
