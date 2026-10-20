# 能力缺失与下载限制验证

任务15的固定页切片已通过受控回归与真实官方 macOS Desktop `0.2.0-rc.2` 下载限制验收。最终构建指纹为 `3b082962fd39`，Host 运行指纹与构建证据一致，最小结果见[白名单记录](evidence/capability-limitations-verification.json)。结论限于该固定通路，不代表完整首版通过。

## 当前行为

任务15当次验收仅覆盖自有固定测试页的 `read/click`，权限由真实 Agent 会话和统一页面控制边界检查。当前已整合的 `observe/resolve`、`screenshot`、`console` 和标签导航分别以各自验证报告为准，尚未因此完成原生验收或首版。固定 `read/click` 仍不扩展为任意网页输入或文件结果。

| 情况 | 反馈与下一步 |
| --- | --- |
| Host 与 Client 的协议或构建指纹不一致 | 撤销登记，不操作页面；标题显示“工具版本不匹配，请重新安装”。反复重新打开不能替代重装匹配构建。 |
| 缺少 `getURL`、`executeJavaScript`，或点击所需的 `sendInputEvent` | `[agent-browser/capability-missing]` 列出缺失的公开方法并停止；不调用私有接口或创建替代页面。方法存在本身不证明平台已验收。 |
| 明确请求 `download` | `[agent-browser/download-unsupported]`，说明当前官方 Desktop 不支持网页下载、未生成文件并停止步骤。 |
| 自有固定页的本次点击触发下载标记 | 同样返回下载限制，不交付点击成功观察；已发出点击仍遵循结果不明与禁止自动重试规则。这个标记只用于自有夹具，不能识别任意网页下载。 |
| `network`、`breakpoint`、`cdp`、`restart-login` | `[agent-browser/capability-deferred]`，仅对应已确认首版延期的完整 Network、断点、原始 CDP、跨重启登录态。 |
| `upload`、`frame`、`login-scope`、`input`、`keyboard`、`scroll`、`script` | `[agent-browser/capability-pending]`，当前尚未实现，仍是首版交付门槛。标签导航和其他新通路已有受控增量，仍须分别实际验收；不把能力缺失降级为可选。 |
| 其他动作 | `[agent-browser/action-unavailable]`，未知动作已停止。 |

本轮平台证据限于 macOS 官方 Desktop `0.2.0-rc.2`。其他操作系统、Web 和 CLI 不因方法检查通过而成为已支持平台；旧记录不能证明新构建正在运行。每次真实验收仍须先由现有验收工具核对 Host、Client 和构建证据。

## 自有下载夹具

夹具复用既有随机固定页及同一 loopback server，没有外部网站、账号、Cookie 导出、私有接口或额外浏览器。页面提供独立人工下载链接，以及“下一次增加计数同时触发下载”开关；Agent 仍调用既有固定 `click`，无需增加下载或导航工具。

附件只含一行自有测试文字，文件名为 `dsh-agent-browser-<本次随机 UUID>.txt`。`<固定页 URL>/download-status` 仅返回 `{ "attachmentRequests": 数字 }`；这个计数只证明服务器收到附件请求，不能证明下载完成、文件存在或已被宿主拒绝。测试代码中的普通 HTTP 请求仅验证附件响应，不能用作浏览器下载验收或代替用户文件。

真实 Desktop 验收顺序：

1. 核对当前 Host/Client 指纹、宿主版本及隔离的自有文件名，记录目标下载目录的该文件不存在。
2. 人工点击自有附件链接；记录页面限制说明、宿主表现及文件仍不存在。
3. 重新打开同一自有固定页，勾选下载验证模式；经正常 `ToolRuntime.execute` 调用 `read/click/read`。点击结果须包含下载限制、未交付成功观察且不返回文件路径；后续结果不明不能自动重试。
4. 核对同名文件仍不存在、请求计数与实际步骤，关闭测试页并卸载临时验证设施；确认监听器关闭。没有文件不能单独证明宿主拒绝，须结合真实页面触发和运行版本证据。

不把人工页面上的限制文字或附件请求计数当作宿主拒绝的单独证据，也不通过 Host 请求、`downloadURL`、私有 IPC、Cookie 迁移或其他浏览器绕过。

本轮附件请求计数依次为0（操作前）、1（人工点击）和2（Agent 原生点击）。只核对 `~/Downloads` 中本次精确自有文件 `dsh-agent-browser-7d28335b-7de2-4e1c-87af-8622cad25f92.txt`，三次均不存在，没有遍历下载目录。结合固定官方源码 `apps/desktop/src/browser-guests.ts` 的 `will-download` 取消处理、实际页面触发和匹配运行指纹，确认两条路径受当前宿主限制。

Agent 点击返回 `unknown` 与 `download-unsupported`，明确“未生成文件”；未交付成功观察或文件路径，后续读取继续为 `unknown`，不得自动重试。用户仍在同一文档看到计数3和下载限制说明：点击已经发生，不等于文件已生成。关闭后旧页面拒绝，卸载后工具注销、临时端口关闭，四个 profile 文件及主程序 ASAR 摘要未变。

## 受控回归与剩余门槛

受控回归通过正式 Host 工具与 Client/原生 guest 边界，覆盖能力分类、明确拒绝下载、缺少公开输入能力、版本不匹配撤销及固定页下载尝试不交付成功观察。真实 `HostConnectionService` 和 HTTP server 验证附件白名单路由、无敏感内容、请求计数及卸载清理。

构建不匹配撤销、缺少公开方法时停止及能力分类只有受控回归，本轮没有通过替换真实宿主版本制造故障。证据文件经现有验收 CLI 读取时始终仅为 `recorded`。

任务15在当前固定通路内完成；任意网页下载检测、完整 frame、上传、全局账号配置和其他后续工具仍未因此交付。保留能力的缺失继续阻塞相应任务与首版验收；完整 Network、断点、原始 CDP 和跨重启登录态仍按已确认范围延期。

相关依据：[首版规格](implementation-spec.md)、[任务15](../../../.scratch/agent-browser/issues/15-capability-limitations.md)、[当前验收命令](verification.md)、[既有宿主能力证据](research.md#当前官方宿主证据)。
