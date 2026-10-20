# DeepSeek Harness 插件工作区

面向官方 DeepSeek Harness **Web 与 Desktop** 的插件 monorepo。不兼容第三方 Desktop 客户端；CLI 契约未验证，不在支持范围内。参与维护的代理请先阅读 [仓库代理指引](AGENTS.md)。

## 仓库目标与 DSH 边界

DSH 主程序定义插件的发现、加载、生命周期和宿主运行时；本仓库只实现、维护和验证插件本身，不修改或重新打包 DSH 核心。需要新的宿主能力时，改动归入 DSH 项目，本仓库不通过私有模块或补丁绕过。每个插件实际支持的宿主须逐一验证，未验证的端不标为兼容。

## 环境与命令

- Node.js **24.21.0**、pnpm **11.7.0**，与已安装 DSH primary runtime 对齐（见 `.node-version` 与根目录 `engines`）。
- 安装依赖：`pnpm install --frozen-lockfile`
- 全量检查（ESLint + 类型检查 + 测试）：`pnpm check`
- 运行测试：`pnpm test`（先递归构建各包，再由根 vitest 收集各包 `test/` 目录）
- 自动修复：`pnpm lint:fix`
- Agent 浏览器交付：[默认安装与使用](plugins/agent-browser/README.md)、[检查、冻结构建与真实 Desktop 验收](plugins/agent-browser/docs/verification.md)。`pnpm verify:agent-browser` 会重新构建，仅用于部署前的分级报告，不代替全量检查或原生实测。

依赖版本集中在 `pnpm-workspace.yaml` 的 catalog。TypeScript 固定 6.0.3，待 typescript-eslint 支持 7.x 后再评估升级。vitest 固定 4.x 并搭配 vite 7 与 `@rollup/wasm-node` 覆盖：DSH 托管 node 启用了 hardened runtime，会拒绝 dlopen 方式加载的第三方原生模块（rolldown 与 rollup native 均受影响），升级这些依赖前须确认替代链路不含 dlopen 原生依赖。格式与校验统一由 ESLint（Antfu 配置）承担，不使用 Prettier。

## 工作区布局

- `plugins/*`：每个插件一个独立 workspace 包；入口、构建与发布内容由官方契约确定。[自动工作区会话](plugins/projectless-session/README.md)与[消息分叉](plugins/message-fork/README.md)是目前的 Web 插件，Desktop 能力尚未验证；[Agent 浏览器](plugins/agent-browser/README.md)当前为官方 macOS Desktop 预览插件：从 `plugins/agent-browser/` 根目录安装，默认进入复用官方界面的浏览器，支持 Agent 在共享页面连续浏览与逐次审批输入。当前限制、[交付验收流程](plugins/agent-browser/docs/verification.md)和历史实验入口集中在插件说明；完整首版仍未交付，其他宿主未验证。领域术语见[词汇表索引](GLOSSARY-MAP.md)。
- `packages/*`：跨插件复用的 TypeScript 内部包。抽取前须确认至少两个插件确有相同需求；跨包引用使用 `workspace:` 且通过包名导入，不直接导入其他包的 `src/` 或 `dist/`，不反向依赖 `plugins/*`；供双端共用的入口保持宿主无关，宿主专用代码单独分包。目录内不放占位文件，首个真实包落地时再创建。
- 各包测试：放包根 `test/` 目录，不与 `src/` 混放，也不编译进 `dist/`。根 vitest 只收集 `plugins/*/test` 与 `packages/*/test`，ESLint 拒绝 `src/` 内出现测试文件；读取 `dist/` 构建产物的用例由各包 `test` 脚本先构建再运行。
- 根目录：统一工具链、锁文件与 CI。新增包自带 `typecheck` 脚本和继承 `tsconfig.base.json` 的独立 `tsconfig.json`；共享配置不注入 Node 类型，Web 包自行配置 DOM 类型，不将 Node API 导入 Web 入口。
- 根包永不发布；插件包的发布方式以实际验证过的 DSH 插件契约为准。
