# 当前页基础控制台验证

任务11实现 `agent_browser` 的按需 `console`，经正式工具、认证 Connection 与统一 Broker 的受控回归。任务11已完成当前页基础控制台切片的受控与官方 Desktop 原生验收；完整 G4/G5 和首版仍未通过。旧 `agent_browser_spike` 不开放此能力。

## 契约与公开依据

调用 `{ action: 'console', pageId?, durationMs? }`，窗口默认500毫秒，只接受50–2000毫秒整数。`pageId` 只能属于真实调用 Agent 的会话；省略时该会话须恰有一个已登记页面。不接受任意脚本、会话身份、CDP 或历史日志查询。

固定 [Electron v44.0.0 webview 文档](https://github.com/electron/electron/blob/v44.0.0/docs/api/webview-tag.md#event-console-message)定义数字 `level` 0–3（verbose/info/warning/error）及 `message/line/sourceId`；[同版本事件转发源码](https://github.com/electron/electron/blob/v44.0.0/lib/browser/web-view-events.ts)列出这四个字段。这里只是公开契约依据，不证明所安装 Desktop 的实际 Electron 版本及事件行为。运行时缺少 `addEventListener/removeEventListener` 或事件形状不同即停止，显示 `capability-missing/capability-mismatch`，不接私有调试端口。

结果为 `{ pageId, kind: 'console', documentId, url, durationMs, messages, truncated }`。`documentId` 使用 Client 私有文档身份，网页内标记只作额外一致性检查。`messages` 每项为 `{ level, message, line, sourceId }`。所有消息、行号与来源均是网站不可信数据，不授予任何工具、脚本或审批权限。

窗口仅监听增强插件自行持有的同一原生 guest，不默认启动长期订阅，不返回窗口前的错误。没有消息只表示本次窗口没有收到可交付消息。原生事件未提供可靠 frame 身份，因此不声称能按 frame 归属过滤；同一 guest 中的 frame 消息也可能出现，来源地址不构成 frame 授权。

## 敏感处理与上限

- 最多50条，每条消息最多1000个 UTF-16 字符；处理文本先取前10000字符，来源 URL 最多处理4000字符、输出2000字符。数量或消息长度截断、已知敏感模式省略时，`truncated=true`。
- 当前地址、来源及消息内 HTTP(S) URL 去除用户名、密码、query、hash；其他来源协议或非法 URL 隐藏。URL 路径仍可含网站自身数据，不能承诺识别所有路径秘密。
- 整条省略带明确 Cookie、Set-Cookie、Authorization、Bearer、password/passwd/pwd、token、secret、api-key、credential、sessionid、access/refresh-token、密码/口令标签或 JWT 形态的消息，支持普通标签和 JSON 引号形式。
- Client 与 Host 都检查本次登记的精确控制凭据；匹配消息整条丢弃、匹配 URL 隐藏。凭据仅用于插件内部过滤，不传给网页，不进入工具结果。
- 任意自然语言秘密、无标签 Cookie 值、未知编码或变形不能保证自动识别。本次仅用自有假数据验证，未访问真实账号；不能将上述规则写成全自动无泄漏保证。

## 生命周期与接管

所有动作复用同一 Broker/Client 命令、许可、取消和在途结算。窗口前后读取固定文档标记，所有等待后重核私有文档代次与同一 guest。接管同步中止该窗口、移除监听、清空队列；导航、关页、断连或卸载也撤销。交回须先成功执行新的 `observe` 或历史固定页 `read`；`console` 本身不解除交回观察屏障，不补发接管期消息。

Agent 取消由 Host 撤销请求，采集中每次最多等待50毫秒后发起同一 Broker 许可复核；该 RPC 遵守既有3秒通信超时。跨进程撤销存在传播延迟，但已撤销结果不会交付。采集的绝对截止独立于 RPC：即使通信等待也不延长请求窗口。结果离开窗口后仅作为本次待交付局部值，最终结算或失败即清空；无永久消息缓存。

## 受控回归与原生复现

`test/page-console.test.ts` 通过真实 `applyFixedPageHost`、正式工具和认证 Fetch，再到真实 Client；仅替换外部 guest 与执行上下文。覆盖窗口边界、数量与敏感处理、私有文档身份、会话越权、接管同步清理、不补发、交回先观察、导航、取消、卸载、事件形状不兼容及许可通信延迟不延长窗口。它不替代真实原生事件验收。

原生验收复用既有 `/spike-UUID/semantic` 自有页面与其控制台按钮、有限网站自身日志流，不另建浏览器或服务：

1. 在可见页面人工触发 warn，实际 ToolRuntime 的 `console` 收到同页标记及数字级别；记录本次构建指纹和白名单输出。
2. 采集中点击人工接管，确认请求取消且无消息交付；接管期人工触发自有日志。交回后旧窗口不可复用，先 `observe`，再开启新窗口，只收到新窗口消息。
3. 导航、明确关页及卸载时在途窗口停止，旧页面身份拒绝；其他会话工具不能读取。

## 官方 Desktop 原生记录

2026-10-16，官方 macOS Desktop `0.2.0-rc.2`，增强构建 `3d153edf9a36`。真实 Agent 通过正式 `ToolRuntime.execute` 查询同一可见自有动态页；不是模型自主调用。构建、最小输出及原始记录摘要见[控制台证据](evidence/page-console-verification.json)。

人工启动网页自身最多20条/5秒的warn流，2000毫秒窗口收到同页文档标记的#19/#20、数字level2、line24和同页sourceId。后续空窗口不补发历史。接管时新console拒绝；接管期人工运行有限日志至结束，交回后console先要求新observe，观察后新窗口为空，没有暂停期日志补发。

原生定时协调把人工操作放在2000毫秒窗口内：人工接管后在途请求cancelled且无内容，官方UI重载后在途请求cancelled且无内容。正式session锚点close-tab关闭该页，在途console返回closed，旧pageId的console拒绝。官方UI卸载增强时在途console返回unloaded且无内容，工具随后注销。精确起止时刻见证据，不将普通跨工具调度算作在途证明。

失败尝试如实保留：`race-reload`因同页已有在途请求而被Broker拒绝，不能作导航取消证据；`console-live-takeover`未赶上窗口、正常空窗，不能作接管取消证据。初次检查脚本误期望交回后console可读而KeyError，实际产品正确执行先观察屏障。新页刚创建时`second-observe`因未就绪拒绝，CUA确认后`second-ready-observe`成功，未把失败调用算通过。

同源码完整 `pnpm check` 退出0，19文件104项通过、0跳过，双轴复审各0未解决/0新增；Node22.20.0与要求24.21.0的警告保留。数量/敏感过滤、会话越权、事件不兼容及许可通信延迟等由受控回归覆盖，并未全部原生重演。无可靠frame身份，未知编码及任意自然语言秘密不保证识别；其他平台、模型自主调用、完整Network/CDP与完整G4/G5未由本轮证明。卸载后profile、端口和ASAR清理结果见证据记录。
