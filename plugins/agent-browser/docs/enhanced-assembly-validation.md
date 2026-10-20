# 官方源码增强独立装配验证

任务01实现固定自有页面的纵向切片：原浏览器入口打开页面，真实 Host 工具读取、点击、再读取。工具名为 `agent_browser`，没有旧实验插件依赖。完整首版、模型自主调用及 A01/A02/A06/A08 的全部场景仍等待后续任务与整体验收；本文件不提升其完成状态。

## 源码与装配

固定来源、许可证和源码补丁见[上游记录](../upstream/README.md)。官方标签、包版本与 npm 产物相符；重新生成的 22 个类型声明与发布包逐字节一致，七个关键函数体的规范化 AST 一致。已安装 Desktop 的官方浏览器运行代码此前与同版 npm 包除 CSS 外一致。这些证据确认本切片使用匹配的官方实现，不声称宿主完整构建提交公开或整个 bundle 字节相同。

增强构建使用源码归档和补丁，保留官方 UI、原生页、导航与主题；源码补丁只加入有限页面能力和装配身份。原 `browser.new` 命令仍归 builtin，正式 `browser` kind 的 extension 选择增强实现。模块、Sidebar、locale、CSS 类名及 style 归属、持久化键分别隔离，增强不读取旧 builtin 检查点。style 标签沿用官方模块注册方式；卸载后留下的隔离规则不作用于 builtin。

Host 与 Client 使用 `agent-browser/` 正式 Connection 精确 Fetch 路由，不覆盖 Gateway interceptor。工具执行身份来自 `exec.agent.session.header.id`；页面归属来自官方正文框架的会话绑定，工具参数不能指定会话。只允许插件自有、地址完全匹配的固定测试页及 `read`、`click` 动作，不开放任意网址、脚本或真实账号。省略 `pageId` 时，本会话必须恰有一个已登记页面；其他情况须明确目标，不能跨会话猜测。

独立 Host/Client 与旧实验仅共享源码中的固定页面控制实现。增强 Host 不加载历史实验入口，不消费 Agent 注册表，不注册 `self-test`；人工标记观察与 `ToolRuntime.execute` 驱动保留在 `tools/` 验证设施。Host 物理入口使用内容摘要文件名，避免本地重装误用旧 Node 模块缓存。

## 构建与安装

仓库固定运行时为 Node 24.21.0、pnpm 11.7.0。本轮实际 shell 为 Node 22.20.0，检查成功但有引擎警告，不能据此声明 Node 22 为项目支持版本。

```sh
pnpm install --frozen-lockfile
pnpm --filter ./plugins/agent-browser run build
node tools/verify-official-browser-source.ts
pnpm check
```

构建生成可独立安装目录 `plugins/agent-browser/dist/enhanced/`，包含 manifest、Host、Client、Cordis patch、许可证及构建摘要。该历史验证时根包仍使用旧实验入口；2026-10-20 起根包默认装配同一官方源码增强版，当前安装方式见[使用说明](../README.md)。任务01的增强包名为 `dsh-plugin-agent-browser`；任务03起使用 `dsh-plugin-agent-browser-<构建指纹>`，先卸载旧增强再安装新构建，无 `dsh-plugin-agent-browser-spike` 部署依赖。

在官方插件管理器中添加该绝对目录并启用，即可从原浏览器入口或 `Cmd+T` 使用增强。固定测试网址由 `agent_browser` 工具说明提供；在地址栏手动打开它后，正常工具参数为 `{"action":"read"}`、`{"action":"click"}`，或附带已有结果的 `pageId`。此切片不能用于普通网站自动化。

受控测试通过注册的真实工具定义和正式 Connection 到官方源码控制器，仅替换外部 store、宿主注册服务和原生 guest，覆盖同页结果、工具身份、跨会话拒绝、诊断路由不存在、Gateway 共存、关页撤销、卸载恢复及工具注销。Broker 与适配生命周期的既有取消、暂停、迟到登记测试继续适用。受控结果不代表真实原生输入通过。

## 真实 Desktop 证据

限定环境为 macOS 官方 Desktop `0.2.0-rc.2`。通过官方插件管理器加载独立增强；另装一次性 Host 验收驱动，仅用公开 `ToolRuntime.execute` 和当前真实 Agent 身份调用新工具，不提供浏览器页面或生产工具，也未发送模型消息。

首次实测与最终构建复验均通过。最终构建中，原 `Cmd+T` 打开官方浏览器；人工输入「源码最终验收 B」后，正常 read/click/read 返回同一 `pageId`、同一文档 `1bab7959-8ec0-43cd-9a2c-ca4c0111371f`，计数 `0、1、1`，点击后的 `lastTrusted=true`，AX 可见计数为1。首次实测还验证地址栏追加 hash、后退和前进，文档保持不变；最终 Client 与该次 Client 逐字节一致。最终构建关页后，旧目标明确返回「页面已关闭或不存在」。

保持第二张增强页打开时卸载最终构建，浏览器回退到 builtin 空白页；原地址栏重新打开自有测试站成功。新工具注销、增强测试站及验收驱动端口均明确拒绝连接。四个 profile 文件与测试前逐字节一致，主程序 ASAR 摘要保持不变。两个临时插件均已通过官方管理器卸载，本轮测试标签页已关闭。两次最终构建的 Host/Client 摘要一致；34 项测试全部通过，含历史发布包复用回归，无跳过。独立 Standards 与 Spec 审查均无发现，机器证据见[验证记录](evidence/enhanced-assembly-verification.json)。

历史记录中的磁盘 Host/Client 摘要只能证明安装产物，不能单独证明当时运行入口一致。任务03观察到同名重装未更新运行 Host，现已增加内容身份包、协议握手与运行指纹；最终当前版本的同页及生命周期证据见[任务03验证](page-lifecycle-validation.md)。本文件保留任务01历史结果，不将其补记为运行指纹已验证。

源码来源证据保存在[比对记录](evidence/official-source-correspondence.json)。本切片不验证任意网页感知、账号登录、多标签页工具、隐藏保活、完整接管屏障、审批、截图、上传、控制台、脚本或重启恢复；对应首版门槛继续保留。

## 复现原生工具调用

先打开一个已有实时 Agent 的验收会话，不发送消息。运行以下命令生成一次性驱动与 profile 基线副本；会话身份只用于验证设施选择真实 Agent，不进入产品工具参数。

```sh
node tools/prepare-enhanced-native-probe.ts session-实际验收身份
```

脚本返回临时插件目录与 `control.json` 路径。通过官方管理器安装驱动并启用；其回环服务只接受该文件中的临时 Bearer 凭据。`GET /status` 返回工具存在状态及自有测试网址，`POST /run` 执行正常工具的 read/click/read，关页后 `POST /closed` 使用此前目标执行拒绝负例。验证结束须卸载增强和驱动，关闭测试标签页，核对 profile 基线、端口及主程序摘要。控制文件不进入仓库或机器证据。
