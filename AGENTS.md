# 仓库代理指引

适用于整个仓库；子目录 `AGENTS.md` 就近覆盖，只写差异，不得放宽上层约束。本仓库面向官方 DeepSeek Harness Web 与 Desktop，不兼容第三方 Desktop 客户端，CLI 契约未验证。

## 始终遵守

- 文档、代理规则与代码注释使用简体中文；路径、命令和标识符保持原样，不创建英文对照文件（`.agents/skills/` 内的技能文件除外）。
- 只按已验证的官方 Web/Desktop 契约实施；未验证的宿主（含 CLI、第三方 Desktop）不得写成已支持。
- 不引入 Prettier；格式与校验统一由 ESLint 承担。
- 测试文件放各包根级 `test/` 目录，不与 `src/` 混放、不编译进 `dist/`；统一用 vitest 编写与运行。

## 常用命令

- `pnpm install --frozen-lockfile`
- `pnpm check`（本地检查，修改 TypeScript、配置或文档后直接运行并按需重复，无需逐步确认）
- `pnpm test`
- `pnpm lint:fix`

## 按任务查阅

- 判断需求归属 DSH 还是插件、新增插件或声明宿主兼容范围：读 [README.md](README.md) 的「仓库目标与 DSH 边界」「工作区布局」。
- 新增工作区包或调整工具链：以 [pnpm-workspace.yaml](pnpm-workspace.yaml)、[package.json](package.json) 和 [tsconfig.base.json](tsconfig.base.json) 的当前内容为准；新包须有 `typecheck` 脚本并被根递归 typecheck 执行。
- 编写或审查代码注释、API/Markdown 文档：用 `write-code-docs` skill；不可调用时读[中文版指引](.agents/skills/write-code-docs/SKILL.zh-CN.md)。
- 维护 `AGENTS.md` 或代理规则：用 `maintain-agents-md` skill；不可调用时读[中文版指引](.agents/skills/maintain-agents-md/SKILL.zh-CN.md)。

无法运行的检查或失败结果须如实说明，不宣称验证通过。
