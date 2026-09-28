# 自动工作区会话（Web）

用户无需选项目目录：侧边栏底部的“新建自由会话”会让宿主先创建独立目录、注册**真实 Workspace**、创建并附着 Session，浏览器再接入该 Session。普通“新建会话”、工作区选择及现有项目会话不变。此处的“不选工作区”只是**免去手动选择**，不是让 Session 没有工作区；因此不需要修改 DSH 的组合输入框或已安装 bundle。

## 目录与写入约定

默认目录：`$DSH_HOME/projectless/YYYY-MM-DD/chat-<uuid>/`；未设置 `DSH_HOME` 时使用 `~/.dsh/projectless/`。日期取创建时的 UTC 日期。每个目录预建 `work/`（中间材料）和 `outputs/`（最终交付文件），工作区的 `path`、会话不可变的 `header.cwd` 与沙盒 `workspace-write` 根目录均指向 `chat-<uuid>/`，而不是 `work/`。插件只对符合该目录结构的会话注入一段中文提示；提示指导代理按约定存放文件，**不是文件工具的强制路由**：用户明确指定其他目标且权限允许时，工具仍依照 DSH 的实际沙盒策略运行。原始会话日志仍按 DSH 现有持久化规则保存；插件不自动清理目录和成果。手动删除工作区注册记录不会删除目录或会话日志。

`root` 是可选的宿主行配置：必须是绝对路径，默认取上述根目录；`root` 指向符号链接时以实际目录注册工作区。改变配置不移动原有目录和 Session，迁移须另行安排。请勿将根目录放入会自动同步敏感资料的目录（例如启用 iCloud 同步的 `~/Documents`）。

## 与参考项目的区别

参考 [DahliaVoid/dsh-temp-session](https://github.com/DahliaVoid/dsh-temp-session) 让会话不关联 Workspace 并按 cwd 存到临时目录，需改写已安装的 `dsh-client-ui-conversation/lib/client.js` 以绕过输入框禁用判断，还会回收无主临时目录。本插件**注册 Workspace 并持久保留文件**，不复制补丁、DOM 覆写或清理策略。两者都安装时，使用本插件的专属按钮；本插件不劫持参考项目的通用“新建会话”行为。

## 构建与接入

从仓库根目录运行 `pnpm install`，再运行 `pnpm --filter dsh-projectless-session build`。插件包的宿主入口、浏览器入口和 `cordis.patch.yml` 分别由 `package.json` 的 `exports`、`dsh.client` 和 `dsh.bundle.patch` 声明；构建后的 `dist/` 必须与包一起提供。开发环境可在 Web profile 中将本包加入依赖与 `dsh.profile.bundles`，由 DSH 的 bundle patch 插入宿主行；重新启动宿主以刷新入口声明。本仓库尚未发布该包，**不得把源码目录直接当作已构建产物**。

目前仅实现并检查官方 DSH **Web** 的插件路径：HTTP 创建路由限制本机同源 POST；桌面客户端可能使用 `file://` 与 IPC 而不走该路由，因此未验证 Desktop、也不声明 CLI 或第三方 Desktop 兼容。部署在远程、反向代理或非 HTTP Origin 上时该路由会拒绝请求，不能将当前实现当作通用 API。现有 Web profile 中若另装了修改内核的插件，应先单独验证组合行为，而不要把它的补丁归因于本插件。

## 失败与验证

目录预建失败时返回错误并回收本次尚未注册的目录；Workspace 注册或 Session 创建请求可能在持久化成功后失去响应，此时**保留**目录，避免误删现有会话和交付文件。浏览器的重入接入失败也会显示错误，宿主已经创建的会话可在原工作区中找回；重复点击会创建新的独立目录，不复用失败身份。

运行 `pnpm --filter dsh-projectless-session test` 验证目录、注册、失败策略及跨站请求；浏览器侧用例在隔离脚本上下文加载构建后的 `dist/client.js`。根目录的 `pnpm check` 包含本包的 ESLint、类型检查与测试。尚未在用户当前 Web GUI 中安装并端到端验证，因此 UI 交互和 Desktop 能力仍需实际宿主验收。

## 调研依据

- [Codex projectless 目录观察](https://github.com/openai/codex/issues/22875)：`~/Documents/Codex/<日期>/<会话名>` 与会话工作目录；这是用户报告，不等于公开稳定 API。
- [Codex work/outputs 观察](https://github.com/openai/codex/issues/35899)与[文件生成场景](https://github.com/openai/codex/issues/28857)：`work/` 和 `outputs/` 出现在生成的工作区中；具体写入规则是本插件的约定，不宣称逐字复刻 Codex 内部系统提示。
- [Codex 同步风险与配置诉求](https://github.com/openai/codex/issues/40304)：默认 `~/Documents/Codex` 可能受 iCloud 同步，因此本插件默认选择 DSH_HOME 下的持久目录。
- [DSH Workspace 契约](https://deepseek-harness.github.io/deepseek-harness/en/reference/subsystems/workspace)与[客户端模块契约](https://deepseek-harness.github.io/deepseek-harness/en/reference/subsystems/client-modules)：真实注册、会话 cwd、模块声明；[HTTP 服务文档](https://deepseek-harness.github.io/deepseek-harness/en/reference/subsystems/web-server)说明原生 Web 路由和 Desktop `file://` 的差异。
