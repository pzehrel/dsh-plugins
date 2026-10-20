# 固定官方浏览器源码

来源是 [DeepSeek Harness 官方仓库](https://github.com/deepseek-ai/deepseek-harness/tree/dsh-v0.2.0-rc.2/packages/client/ui-sidebar-browser)，标签 `dsh-v0.2.0-rc.2`，提交 `639ed015397290b3745d163aafe02ffee4aa3f84`。只提取该包的 24 个 `src/` 文件及 `package.json`，不携带上游测试、构建产物或完整仓库。原 MIT 许可证保留于 `LICENSE`。

`official-browser-0.2.0-rc.2.tgz` 是未改动源码的定向归档，逐文件摘要及完整上游归档摘要见 `provenance.json`。`published-browser-0.2.0-rc.2.tgz` 是 npm 固定发布包，只供离线来源校验与比对，不用于增强构建。两份归档的内容均为官方公开文件，不含账号或控制凭据。

`enhancement.patch` 是本仓库的源码改动：隔离 Sidebar、locale、检查点身份，改为正式 extension，复用 builtin 快捷键，在自有页面创建点提供生命周期受控的有限 getter，并在原标题旁注入紧凑工具状态与显式人工接管、交回入口。未重写官方地址栏、导航、正文、标签管理或 CSS。构建器另外隔离模块及样式身份，装配固定页工具；它不对官方发布 bundle 做字符串替换。

从仓库根目录运行：

```sh
pnpm install --frozen-lockfile
pnpm --filter ./plugins/agent-browser run build
node tools/verify-official-browser-source.ts
```

源码会解压至忽略的 `.build/`，补丁必须无偏移、无模糊匹配地应用。构建采用锁文件中的 TypeScript 6.0.3、Vite 7.3.6、Rollup WASM 4.63.5 与官方 `0.2.0-rc.2` SDK；上游使用 tsdown/lightningcss，本仓库使用已有 Vite 工具链。校验命令比较全部 22 个声明文件的字节及七个关键函数的规范化 AST，不声称整个官方 bundle 可逐字节重建。

独立增强输出到 `../dist/enhanced/`；`dist/official-reference.js` 只供受控测试，不装入增强包。真实安装、测试边界和卸载结果见[独立装配验证](../docs/enhanced-assembly-validation.md)。

根包的默认 Host 和 Client 均装配这份官方源码增强；直接安装 `plugins/agent-browser/` 与安装指纹包使用同一浏览器实现。旧 `src/client.tsx` 实验面板不再由默认构建产出，历史实验不作为正常浏览器入口。

`published-connection-0.2.1-rc.2.tgz` 是官方 npm Connection 发布包，来源、npm integrity 与 SHA-256 见 `connection-provenance.json`。它只用于 `test/connection-peer.test.ts`：校验原始归档及入口摘要后，仅将模块格式编译为 CJS，运行实际路由权限检查与 Peer 生命周期。外部依赖沿用仓库锁定的 `0.2.0-rc.2` SDK 和 Cordis 4.0.4；这不是完整新版宿主模拟，也不参与产品构建或升级依赖。完整插件的新版运行结果须以实际 Desktop 复验为准。
