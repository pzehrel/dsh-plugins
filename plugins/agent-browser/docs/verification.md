# 交付流程与分级验收

当前默认安装入口和工具使用见[插件说明](../README.md#安装与开始使用)。交付以官方 Desktop 中用户可见的同一共享页面为准，代码检查、当前运行身份与真实任务分别记录。

`pnpm verify:agent-browser` 把本次构建、协议检查、可选 Host 探针和历史原生证据分开报告。它会重新构建产物，只适合部署前使用；它不启动、重启或操作 Desktop，不访问账号，不代替仓库的 `pnpm check`。

## 从检查到真实交付

使用仓库规定的 Node.js 24.21.0 与 pnpm 11.7.0。下面顺序适用于本地交付；各命令的通过、失败、跳过数量按当次输出记录。仅在新增修改、检查失败或问题未解决时重复必要检查，不固定未来测试总数。

1. **检查修改文件。** 先运行这些文件的 ESLint，例如本次入口与说明改动：

   ```bash
   pnpm exec eslint README.md plugins/agent-browser/README.md plugins/agent-browser/docs/verification.md --max-warnings 0
   ```

2. **运行相关定向测试。** 按改动选择既有回归；下面覆盖默认根安装、正常点击/按键跳转及慢加载，不增加同义镜像测试。需要构建产物的用例先完成构建：

   ```bash
   pnpm --filter ./plugins/agent-browser run build
   pnpm exec vitest run plugins/agent-browser/test/default-entry.test.ts plugins/agent-browser/test/native-input.test.ts plugins/agent-browser/test/session-navigation.test.ts
   ```

3. **完成统一检查与明确请求的补充检查。**

   ```bash
   pnpm check
   node tools/verify-official-browser-reuse.ts
   ```

   普通 `pnpm check` 中历史官方包复用套件没有临时夹具时会跳过六项；单独的历史回归入口负责下载固定版本、核对摘要、生成临时夹具和实际执行六项，缺少夹具或执行失败不能算通过。两步分别报告通过、失败和跳过数，不能将第二步的通过归入第一步。CI 同样将历史入口作为独立可失败步骤。需要分级报告时，也在此阶段运行下文的 `pnpm verify:agent-browser`。

   CI 的统一检查通过可选环境变量 `DSH_CI_VITEST_REPORT` 指定 Vitest JSON 报告文件路径，当前设为 `${{ runner.temp }}/dsh-check-vitest.json`，同时保留 `default` reporter。未设置或为空时，仅使用 `default` reporter，不生成该 JSON 报告。非空 `VITEST_WORKER_ID` 表示测试 worker 或继承其身份的子进程，此时忽略报告路径，防止测试内子进程覆盖根检查报告。独立历史回归不设置该报告变量；这两个变量用于内部报告协调，浏览器用户无需设置。

4. **冻结已检查构建。** 记录 `plugins/agent-browser/dist/enhanced/build-evidence.json` 的 `package`、12 位 `fingerprint`、`hostSha256` 和 `clientSha256`，记录待安装根目录的绝对路径。此后不再编辑输入或重建产物。所有会改变产物的构建、类型检查和测试到此结束；需要修改或重建时结束本轮验收，重新完成受影响的检查并冻结。

5. **通过官方插件管理器安装。** 添加已冻结工作区中 `plugins/agent-browser/` 的绝对路径并启用，按默认根安装验证，不用旧实验或临时诊断插件代替。打开官方浏览器入口或 `Cmd+T`，核对标签、地址栏和导航可见。根包和 `dist/enhanced/` 指纹包只启用一个。本地更新出现旧模块缓存时，待其他活跃任务安全结束后正常退出并重新打开 DSH，再核对身份；不修改宿主、加载器或安装包，不为验收中断他人任务。

6. **只读核对运行身份。** 从本次自有插件运行信息取得实际随机 loopback 端口，只 GET 既有 `/_agent_browser_status`，与冻结构建记录比较。部署后禁止调用 `pnpm verify:agent-browser`，包括加了 `--host-probe` 的形式：该入口仍先构建。也不要 import 该脚本；它没有供只读执行的入口隔离。只读示例见下一节。Host 必须 `ready=true`、`registerStatus=200`、`error=""`，且 `build` 与冻结 `fingerprint` 一致；不匹配则结束本轮验收，不把混合版本结果算作通过。

7. **执行真实 GPT 连续任务。** 在获准的 macOS 官方 Desktop 自有会话中，使用 GPT 和正式 `agent_browser`，在同一共享页面完成：Wikipedia 搜索 Hangzhou，实际点击词条中的 Prefecture-level 链接，读取新页面，后退确认 Hangzhou 页面，前进确认目标页面。等价公共任务也可，但链接必须实际点击，不能以直接导航代替。每步核对共享页面 URL/标题和相关内容；正常路径的人工接管与交回均为零，常规逐次审批继续保留。慢加载时等待并重新 `observe`，不重复发出写动作；真实取消、断线和发送失败也不能自动重放。结束后再次只读核对同一指纹，并将可用插件与最终网页留在本次自有会话中。

UI 操作复用既有 CUA 通道，默认读取状态差异与所需片段。每次操作后取得新状态，再选择新的元素编号；不复用旧编号。只有定位信息缺失或最终视觉核对时才取完整状态或截图。模型的正式 `agent_browser` 页面引用同样需要在页面变化后重新观察。

固定夹具证明确定性回归；公共真实网站证明当前 Desktop 的可见连续任务。Linux CI 不执行原生 Desktop 任务，不能把 CI 通过写成原生通过；一次连续任务也不解除后台选页、跨域 frame、页面脚本等首版门槛。

### 部署后的只读指纹核对

在仓库根运行，先通过 `export PROBE_URL=...` 将环境变量设为本次实际状态端点的完整 URL。`BUILD_EVIDENCE` 可选，默认指向本轮冻结的增强构建记录；若本轮另存了冻结记录，设置为其实际路径。两者只是本示例的 shell 环境变量，脚本入口不会自动读取它们。下例只读文件并 GET 状态，不构建、不安装、不操作网页：

```bash
node --input-type=module <<'JS'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const url = new URL(process.env.PROBE_URL)
assert(url.protocol === 'http:' && ['127.0.0.1', '[::1]'].includes(url.hostname))
assert(url.pathname === '/_agent_browser_status' && !url.username && !url.password && !url.search && !url.hash)
const expected = JSON.parse(readFileSync(process.env.BUILD_EVIDENCE ?? 'plugins/agent-browser/dist/enhanced/build-evidence.json', 'utf8'))
assert(/^[a-f0-9]{12}$/.test(expected.fingerprint))
assert.equal(expected.package, `dsh-plugin-agent-browser-${expected.fingerprint}`)
const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(2000) })
assert.equal(response.status, 200)
const body = await response.text()
assert(Buffer.byteLength(body) <= 4096)
const actual = JSON.parse(body)
assert.equal(actual.build, expected.fingerprint)
assert.equal(actual.ready, true)
assert.equal(actual.registerStatus, 200)
assert.equal(actual.error, '')
console.log({ expectedBuild: expected.fingerprint, observedBuild: actual.build, ready: actual.ready, registerStatus: actual.registerStatus, error: actual.error })
JS
```

磁盘指纹只说明候选构建；Host 状态只证明当前 Host 就绪。还要通过真实工具调用确认 Client 不存在版本不匹配，并以同一共享页面的可见变化证明任务结果。旧实验的 `fetch-routes-v2` 状态不能作为当前增强构建证据。

### 本轮证据记录

本轮执行情况见[交付流程验收记录](evidence/delivery-flow-verification.json)，以记录中的实际状态和未测项为准，不预先宣称通过。每次交付填写一份记录，可附在本说明或链接到既有 `docs/evidence/`。尚未执行的项填写“未测”，历史证据保留原时间与来源。记录以下字段，不保存账号、控制凭据或无关会话内容：

| 记录项 | 本轮应填写的内容 |
| --- | --- |
| 时间与环境 | 实际验收日期、时区、macOS 与官方 Desktop 版本、实际 GPT 模型版本。 |
| 检查 | 每条实际命令及退出码；测试文件数和测试通过、失败、跳过数；历史独立六项另计。 |
| 冻结构建与安装 | 默认根安装绝对路径、构建包名、指纹与 Host/Client 摘要。 |
| 当前运行 | 原生任务前后的只读 Host 状态、与冻结指纹的比较、Client 版本匹配结果。 |
| 可见任务 | 搜索、真实点击、读取、后退、前进各步结果；说明是否为同一共享页面。 |
| 人机交互 | 人工接管次数、交回次数、是否保留常规逐次审批；异常与恢复过程如实记录。 |
| 交付状态 | 最终 URL/标题、插件与页面是否留在本次自有会话可继续使用。 |
| 证据范围 | 固定夹具、真实 Desktop 和历史记录分别引用；未测项及仍阻塞的首版能力。 |

## 部署前分级报告的使用

```bash
pnpm verify:agent-browser
pnpm verify:agent-browser --evidence plugins/agent-browser/docs/evidence/desktop-spike-verification.json
pnpm verify:agent-browser --evidence plugins/agent-browser/docs/evidence/page-lifecycle-verification.json
pnpm verify:agent-browser --evidence plugins/agent-browser/docs/evidence/native-input-verification.json
pnpm verify:agent-browser --help
```

默认执行既有构建与类型检查（包含独立增强），以及[控制回归](../test/broker.test.ts)和[已有 Gateway组合回归](../test/connection.test.ts)。协议层只运行这两份测试，避免 CLI回归再次启动自身。完整测试套件仍由根 `pnpm check`运行。

只有明确指定当前测试站的状态 URL时才执行 Host探针。例如先在当前 shell中设置 `PROBE_URL`，再运行：

```bash
pnpm verify:agent-browser --host-probe "${PROBE_URL:?请先设置当前实验状态探针的完整URL}"
```

`PROBE_URL`只是上述示例的 shell变量，不是脚本自动读取的配置。不要复用历史端口来断言当前版本已经运行。

正式增强的状态路径为 `/_agent_browser_status`。探针必须就绪、注册成功，并返回与本次生成的 `plugins/agent-browser/dist/enhanced/build-evidence.json` 相同的12位构建指纹；不同即失败。CLI 不负责安装，安装中的构建须与检查产物相同。需要比较明确指定的其他构建时，使用 `--build-evidence FILE`；报告保留实际比较来源，不把磁盘摘要单独当作运行证明。

## 命令行选项

| 选项 | 默认及行为 |
| --- | --- |
| `--host-probe URL` | 默认不访问 Host。仅接受数值 loopback主机 `127.0.0.1`或 `[::1]`的 HTTP地址，路径为旧实验 `/_agent_browser_spike_status` 或正式增强 `/_agent_browser_status`；拒绝凭据、查询、片段和重定向。2秒超时，响应最多4 KiB。旧实验须为 `fetch-routes-v2`；正式增强须匹配构建指纹。两者均须就绪、注册状态200且无错误。 |
| `--build-evidence FILE` | 仅允许配合正式增强探针使用。相对路径基于仓库根，默认使用本次增强构建记录；文件必须为不超过4 KiB的普通 JSON文件，`fingerprint` 为12位小写十六进制，`package` 与指纹包名一致。只选择比对来源，不安装或部署产物。 |
| `--evidence FILE` | 默认不读证据文件。相对路径基于仓库根；接受最多1 MiB的已知结构 JSON对象，保留 `observedAtUtc` 或 `recordedAt` 的原时间。只输出格式、摘要和原时间，不打印网页或账号字段。无论记录时间多新，都只标记为 `recorded`。 |
| `--help` | 只输出用法，不执行检查。未知、重复或缺值的参数拒绝执行；错误不会回显可能包含凭据的输入。 |

脚本优先复用调用方的标准 `npm_execpath`所指包管理器，否则从当前 `PATH`调用 `pnpm`，不更改全局 Node、PATH或包管理器设置。需要已安装仓库依赖，并使用仓库规定的 Node版本。

历史记录兼容以下最小结构，不验证自报的 `status`、G2、G3 或完成结论：`observations` 数组；带包身份及 `native.normalToolRuntime.results` 的增强装配；带包身份及 `cases` 数组的官方浏览器验证；带构建指纹、`initial` 数组及 `backgroundComplete` 对象的生命周期记录。输出 `recordFormat` 分别为 `observations`、`enhanced-assembly`、`official-browser-cases`、`page-lifecycle`。日期无效或结构无法识别时失败。

## 四级结论

| 层级 | `passed`的范围 | 不可据此推断 |
| --- | --- | --- |
| `build` | 本次既有构建及 Host/Client类型检查通过，包含独立增强。 | 不代表协议、当前运行进程或原生页面可用。 |
| `protocol` | 本次控制与已有 Gateway共存回归通过。 | 不代表真实 Desktop物理传输、页面或鼠标输入已验收。 |
| `host` | 显式指定的本机 Host 就绪、注册200；正式增强还须匹配所选构建指纹。 | 旧实验不证明当前源码已部署；增强指纹匹配也不代表原生 guest或用户可见效果通过。 |
| `native` | 此命令不生成 `passed`。未提供文件为 `not-verified`；有效文件仅为 `recorded`。 | 文件自报的成功、历史 Host就绪及旧时间戳都不是本次采集。 |

每层 `status`只允许：`passed`（本次自动检查通过）、`failed`（本次请求的检查失败）、`not-verified`（未执行/不能推断）、`recorded`（只引用历史文件）。构建失败时不再执行协议命令或 Host 探针，二者保持 `not-verified`；显式提供的历史文件仍单独读取。

动态主文档验收复用增强 Host 的既有随机 loopback 测试站：在固定测试页地址后追加 `/semantic`。该自有页包含普通输入、合成密码和验证码、节点移动与替换、同网址重新加载、滚动及独立 frame 占位；只供核对观察与引用行为。敏感字段和 frame 占位均可由人工移除后验证截图，不能据此宣称真实网页像素均无敏感内容或跨域 frame 已支持。页面可生成自有控制台消息，但不提供任意代码接口。此夹具及一次性驱动的受控测试不等于真实 guest 已通过；原生复现入口见[生命周期验证](page-lifecycle-validation.md#复现)。

页面「启动5秒自有控制台消息流」由人工触发网页自身最多20条消息，每250毫秒一条，带本页随机标记和递增编号；可人工停止，导航结束时也停止。它不是 Agent 注入的持续任务；接管期网站自身日志可继续产生，Agent 窗口不得采集、缓存或交回后补发。

一次性驱动准备命令支持 `--actions=` 的显式动作白名单。`/call` 只接受这些动作及工具数据字段（包括控制台的 `durationMs`），工具名称、真实 Agent、调用身份及输出目录均由驱动持有，不能通过请求改变：

```bash
node tools/prepare-enhanced-native-probe.ts "${SESSION_ID:?请先设置已授权的实时会话身份}" --lifecycle --actions=list-tabs,create-tab,select-tab,close-tab,navigate,back,forward,reload,observe,resolve,screenshot,console
```

可安装driver位于仓库忽略的`dist/native-probes/<唯一id>/driver`，通过已有祖先`node_modules`解析精确SDK普通依赖，避免外部临时link热安装未进入宿主启动解析表；不会安装依赖或创建自有loader。命令输出的`directory`仍为本次外部临时目录，control、profile备份、images和artifact.json留在那里。先通过官方管理器卸载，再按artifact记录清理本次唯一插件目录；不删除其他验收实例。

当且仅当白名单包含 `screenshot`，prepare 在本次临时目录创建权限0700的 `images/` 并固定配置。成功截图须同时具有匹配的正式 image 块；驱动只将其引用交给正式作用域中的 `attachments.readImage`，核对关联、媒体类型、尺寸及字节数后，以随机文件名和0600权限导出。不接受 HTTP 附件身份、文件路径或任意读取请求，也不调用新的页面操作。没有图片服务或匹配块时明确拒绝导出。驱动卸载会中止读取并等待实际结算，迟到返回不再写文件。

`/call` 图片证据字段为 `artifactFile`（本次随机路径）、`imageRef`（正式读取返回的真实引用）、`bytes`（实际编码长度）、`imageBlock`（本次成功输出中匹配的块）。扩展名按正式媒体类型选 `.png/.jpg/.webp/.gif`；不打印base64或整份内容块。导出文件只供像素核验，不能仅凭JSON引用就宣布看到了真实图片；它也不是产品的文件导出接口。普通调用没有这些字段。历史证据仍仅为 `recorded`。

退出码0只表示本次执行或显式请求的检查没有 `failed`，不表示四级验收全部通过；退出码1表示命令、显式探针、证据读取或参数校验失败。命令不保留子进程原始输出；失败时可单独运行报告列出的既有命令查看诊断。

## JSON报告字段

报告器本身的 stdout固定输出一个 JSON报告；`--help`和参数错误除外。需要采集纯 JSON时使用 `pnpm --silent verify:agent-browser`，避免包管理器自身的提示混入。

| 字段 | 含义 |
| --- | --- |
| `schemaVersion` | 报告格式版本，当前为1。 |
| `checkedAtUtc` | 本次生成报告的 UTC时间，不替换历史观察时间。 |
| `fullyVerified` | 当前固定为 `false`：CLI不执行原生任务，不替人宣告完整验收。 |
| `levels` | 包含 `build`、`protocol`、`host`、`native`四项独立结论。 |
| `levels.*.status` | 上述四种状态之一。 |
| `levels.*.summary` | 人可读的结论及限制。 |
| `levels.*.commands` | 自动检查实际执行的命令数组；每项 `command`是可独立复查的命令，`exitCode`为退出码，启动失败或信号终止时可为 `null`。 |
| `levels.*.source` | 显式提供的本机探针 URL或解析后的证据路径；未提供时省略。 |
| `levels.host.observedBuild` | 本次探针返回的已识别构建标识；不匹配时也保留，其他无效文本不回显。 |
| `levels.host.expectedBuild` | 正式增强须匹配的构建指纹；旧实验省略。 |
| `levels.host.buildEvidenceSource` | 正式增强所比较的构建 JSON绝对路径；旧实验省略。 |
| `levels.native.observedAtUtc` | 历史文件自报的观察时间；没有有效文件时省略。 |
| `levels.native.recordFormat` | 识别的历史结构，仅表示记录可读取。 |
| `levels.native.sha256` | 该历史文件原始字节的 SHA-256；它区分文件，不证明内容真实性或新鲜度。 |

[报告器](../../../tools/verify-agent-browser.ts)由根 typecheck检查；[CLI回归](../test/verification.test.ts)在真实命令行输入/输出 seam测试默认缺证据、历史文件、Host探针、失败和输入拒绝。测试只用外部进程/HTTP夹具，不构成新的 Desktop实测。

[最小实验记录](spike-validation.md)是旧实验的历史证据，只支持其中注明来源、时间和未测项的限定结论。当前默认入口的交付以本说明前半部分的冻结构建和本轮真实任务记录为准，不能用旧记录替代。

主文档原生输入的正式审批验收另见[原生输入与审批驱动](native-input-validation.md)，包括显式`--approval-probe`及三条job路由；普通`/call`不具备合法turn，不能当作审批成功证据。
