# Agent 浏览器首版本地任务

16 项的粒度与依赖已获用户确认，每项单独保存。各任务按用户授权及依赖推进，当前状态见下方派生索引。不创建或修改 GitHub 事项，不自动提交或推送代码。

依据[首版实施规格](../../plugins/agent-browser/docs/implementation-spec.md)与[已确认拆分](../../plugins/agent-browser/docs/implementation-tickets-draft.md)，术语及 ADR 沿用规格引用。

## 任务状态与依赖

状态、直接依赖及可行性结论以 `issues/` 下的任务文件为唯一来源。下表由 `pnpm check:agent-browser-tasks --write` 生成；`pnpm check` 只检查一致性，不自动写文件。`ready-for-agent` 表示内容已备好，可推进项还须满足依赖与结论门槛。

<!-- task-status:begin -->

已完成：01、02、03、04、06、07、08、10、11、15。当前可推进：无。

| 编号 | 任务 | 派生状态 | 阻塞依赖 |
| --- | --- | --- | --- |
| 01 | [官方增强独立装配与固定同页工具](issues/01-official-browser-integration.md) | 已完成 | 无 |
| 02 | [跨工作区登录态可行性验证](issues/02-login-scope-feasibility.md) | 已完成 | 无 |
| 03 | [隐藏保活、取消与关闭清理](issues/03-page-lifecycle.md) | 已完成 | 01 |
| 04 | [固定工具的人工接管与交回](issues/04-human-takeover.md) | 已完成 | 01 |
| 05 | [本会话多标签页与导航](issues/05-session-tabs-navigation.md) | blocked | 03、04 |
| 06 | [页面语义观察与有效元素引用](issues/06-semantic-observation.md) | 已完成 | 04 |
| 07 | [原生页面操作、审批与 Agent 指针](issues/07-native-actions-approval.md) | 已完成 | 06 |
| 08 | [受接管约束的页面截图](issues/08-page-screenshot.md) | 已完成 | 04 |
| 09 | [跨域 frame 的观察与操作](issues/09-cross-origin-frames.md) | blocked | 07 |
| 10 | [获准文件的原生上传](issues/10-native-file-upload.md) | 已完成 | 07 |
| 11 | [当前页基础控制台](issues/11-page-console.md) | 已完成 | 04 |
| 12 | [逐次审批的页面脚本](issues/12-approved-page-scripts.md) | blocked | 07 |
| 13 | [登录态范围配置与容器切换](issues/13-login-scope-switching.md) | 等待05 | 02、05；02=feasible |
| 14 | [重启后的网址与归属恢复](issues/14-url-restoration.md) | 等待13 | 13 |
| 15 | [能力缺失与下载限制反馈](issues/15-capability-limitations.md) | 已完成 | 01 |
| 16 | [首版整体真实验收](issues/16-desktop-acceptance.md) | 等待09、12、14 | 08、09、10、11、12、14、15 |

<!-- task-status:end -->

任务按依赖顺序编号，仅列直接必要依赖，不强制全部串行。16 的直接依赖传递覆盖其余全部任务。

任务13同时要求02的正面可行结论与05完成；仅结束调查不能解除可行性门槛。G2/A07 完整产品验收及其他首版保留能力仍须分别满足。

## 维护索引

修改任务文件后运行 `pnpm check:agent-browser-tasks --write` 更新派生块，再运行 `pnpm check`。默认 `pnpm check:agent-browser-tasks` 只读；成功输出 `completed` 与 `ready` 编号数组，失败退出码为1。`--write` 只写本索引唯一的 `task-status` 标记块。`--root DIR` 指定包含本目录结构的仓库根，默认使用脚本所在仓库，不受当前 shell 目录影响。

任务文件按两位编号命名，以下既有字段是机器读取入口：

| 字段 | 语义 |
| --- | --- |
| `# 03：任务名称` | 一级标题提供索引名称，文件名提供编号。 |
| `**状态：**` | `done` 为该任务完成；兼容旧值 `completed`。`ready-for-agent` 为内容已准备，尚须检查依赖；`in-progress`、`blocked` 不进入可推进列表。值后可有中文括号说明。 |
| `**阻塞依赖：**` | 无依赖时填写「无」，可附中文括号说明；其他情况全部使用指向同目录任务文件的 Markdown 链接，以顿号分隔。解释放在独立的依赖说明字段。链接须存在，任务编号不能重复，依赖图不能有循环。 |
| `**可行性结论：**` | 可选：`feasible`、`blocked` 或 `unknown`；缺省视为未知。它与调查任务是否完成分别记录，不代替证据报告。 |
| `**所需结论：**` | 可选：`02=feasible` 这样的两位直接依赖编号及正面结论门槛；依赖 `done` 且其结论为 `feasible` 才能解除。当前用于任务13。 |

[检查脚本](../../tools/check-agent-browser-tasks.ts)核对派生块及依赖，不判断验收证据是否真实，也不授予实施授权。规格和拆分文档引用本索引；检查会拒绝这些文档或标记块外再次出现「当前可推进」紧接编号的手写列表。测试使用临时目录通过真实 CLI 验证，不修改现有任务。

## 交付与完成条件

- 每项是可独立验证的纵向切片，包含必要工具、Client、页面行为、结果与测试，不按全部后端、全部 UI 分层实施。
- 完成须保留真实证据与未测项；工程验证失败不自动缩小首版范围，也不授权修改宿主。
- 新增观察、截图、输入、控制台或脚本通路，必须证明自身归属、审批、接管与清理覆盖，不继承固定工具的部分通过作为完整结论。
- 全局登录态、上传、跨域 frame 和完整接管等未满足时，对应门槛与整体发布继续阻塞。
- G1–G5、A01–A17 及 44 条用户故事最终由 16 汇总当前版本验收；历史文件和 self-test 不代替实际工具与可见页面验收。
- 首版延期仅限网页下载、完整 Network/断点/原始 CDP 和跨重启登录态；网址恢复继续交付。
