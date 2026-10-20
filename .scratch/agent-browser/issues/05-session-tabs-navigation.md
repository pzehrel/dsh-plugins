# 05：本会话多标签页与导航

**要实现：** Agent 列出、创建、选择、关闭本会话标签页，并在同一共享页导航、刷新、前进后退；用户仍使用官方标签和导航界面。

**阻塞依赖：** [03 隐藏保活、取消与关闭清理](03-page-lifecycle.md)、[04 固定工具的人工接管与交回](04-human-takeover.md)

**状态：** blocked（`0.2.1-rc.2` 激活故障已修复，实际公开入口仍拒绝既有标签地址）

**依赖说明：** 03、04 已完成基础；本任务部分实现已受控验证，后台选页能力缺口仍阻塞，导航与session锚点须服从单页接管。

## 验收条件

- [ ] 页面归属来自实际 Agent 与框架上下文；模型不能指定会话、工作区或 guest 身份取得权限。
- [ ] 两个真实会话分别正反向验证越权拒绝；伪造、关闭、重建和其他窗口目标不误绑定。
- [ ] 导航、页面重建及文档切换使旧观察和请求失效；相同网址不代表同一页面。
- [ ] 创建或切换标签不抢其他会话焦点；关闭按 03 撤销，接管按 04 拒绝导航，后台状态准确。
- [ ] Agent 工具结果和侧栏的实际地址、标签及页面身份一致。

## 当前证据与阻塞

已整合正式 SessionBinding 锚点、同会话标签工具及官方同页导航，新增URL净化和锚点不可旁路接管的组合回归。2026-10-18在两个自建真实会话补充了有限后台创建、焦点保留及双向 pageId 越权拒绝；后台选页候选先被工具预检查拒绝，再由独立 Client 直接调用公开方法证实协议不兼容：真实 `sidebar://browser/<uuid>` 不被只接受 `dsh-resource://` 的 `openResourceIn` 接受。临时候选源码与测试已撤回，完整原生矩阵未通过；保持首版及13/14依赖阻塞，不缩减范围。原始结果及清理见[验证证据](../../../plugins/agent-browser/docs/evidence/session-navigation-public-route-verification.json)。见[验证报告](../../../plugins/agent-browser/docs/session-navigation-validation.md)。

2026-10-18随后确认官方安装包与实际关于窗口均为 `0.2.1-rc.2`。冻结的 `f755a57033c7` 曾在激活阶段报 `principal` 异常，未进入选页复验；该历史记录保留在[新版兼容证据](../../../plugins/agent-browser/docs/evidence/session-navigation-0.2.1-rc.2-compatibility.json)。本轮诊断确认启动自测缺少新版必需的 `PeerScope` 参数；通过官方 `createPeer` 创建本进程 Peer 并在 `finally` 释放后，最终构建 `24609831c765` 在真实新版显示运行中，自测 `ready=true、registerStatus=200`，原始激活循环转绿。SDK 与锁文件未升级。

随后仅使用两个自建空白 Agent 和 A 的两个自建页面，独立 Client 原样调用 `openResourceIn(A, existingContentId, {kind:'browser',revealIfOpened:true})`，新版实际抛出 `no registered tab type claims "sidebar://browser/..."`。A 标签集合及前台 B 会话未变化；B 没有网页，不能据此声称输入焦点通过。完整选页矩阵未展开，任务及13/14、发布继续阻塞，不缩减范围。原始结果、真实新版 Connection 回归和清理见[诊断与复验证据](../../../plugins/agent-browser/docs/evidence/connection-peer-startup-0.2.1-rc.2.json)；[既有标签选择公开接口需求](../../../plugins/agent-browser/docs/session-tab-selection-public-contract-spec.md)继续保留。

**主要覆盖：** A01、A06、A08、A11 的跨站导航部分；用户故事 7、8、12、23、28–30。

## 规格与实施边界

依据[首版实施规格](../../../plugins/agent-browser/docs/implementation-spec.md)、[领域词汇表](../../../plugins/agent-browser/GLOSSARY.md)及规格引用的 ADR。拆分已获确认；内容准备就绪不等于依赖已解除，也不表示本任务已开始或完成。

- 复用官方浏览器与统一页面控制边界，只补工具和必要交互；不修改 DSH 主程序、安装包或私有 IPC，不扩大自建浏览器。
- 权限来自真实 Agent 执行上下文及认证 Client 框架绑定，登录态共享不扩大页面权限。主验收边界是实际工具调用与同一可见共享页面结果。
- 固定测试页、替身测试和历史证据不代表完整产品通过。公开能力缺口保留为对应首版要求的阻塞，不擅自延期。
- 遵循仓库中文文档、ESLint、vitest 与统一门禁约定；记录实际版本、步骤、结果和未测项，不保存密码、Cookie 或控制凭据。
- 任务保存在本地，不自动发布远端事项、提交或推送代码。实际实施及宿主操作遵循用户的任务授权。

见[任务索引](../README.md)查看可推进项、依赖与共享完成条件。
