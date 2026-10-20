# 逐次审批页面脚本的公开契约阻塞

2026-10-16，[任务12](../../../.scratch/agent-browser/issues/12-approved-page-scripts.md)的前置调查完成，产品能力仍为 blocked。任务07的正式逐次审批已完成其原生输入切片；这没有为任意脚本增加资源归属或终止能力。本轮没有开放脚本工具，也没有修改既有观察、输入、控制台或接管实现。

## 结论与范围

固定官方公开契约能向同一原生 guest 执行代码，但本轮未找到同时满足以下三个条件的正面路径：脚本具有任意页面 DOM 能力；人工接管可识别、停止和清理全部 Agent 注入的持续任务；原网页实例与文档保留，供用户继续操作。

因此 G4 脚本部分、G5 完整持续任务屏障及任务12对应的 A05/A10/A14/A15 保持未通过。逐次核对确切代码是必要授权，不是运行时终止保证。不能以“工具结果已丢弃”“脚本 Promise 已返回”或“用户已批准”宣称完整接管。

这是固定版本与已查公开接缝的缺口结论，不是数学上的不可能性证明，也不以缺少 CDP 作为唯一理由。首版仍保留逐次审批页面脚本要求；本报告没有将其延期、缩减为固定 DOM 白名单或改成独立浏览器。

## 固定来源与实际复核

DSH 使用官方 tag `dsh-v0.2.0-rc.2`，commit `639ed015397290b3745d163aafe02ffee4aa3f84`；归档与浏览器源码摘要见[官方来源记录](../upstream/provenance.json)。固定 Desktop 依赖声明为 Electron `^44.0.0`，本轮复核 `v44.0.0` 的公开文档及转发源码；这不证明安装包实际运行的 Electron 版本。本地 SDK `@deepseek-ai/dsh-tools` 为 `0.2.0-rc.2`。

八份 Electron 下载副本全部匹配既有研究清单的 SHA256；DSH bridge、guest 生命周期、原浏览器类型与实现以及 SDK 声明对应摘要保存在[固定来源摘要](evidence/approved-page-scripts-feasibility.json)。复核沿用同一版本研究，又打开官方固定方法表、webview 文档及 DSH bridge 来源确认，未发现新增正面接缝。

| 已查公开边界 | 已有能力 | 不能由此推出的能力 |
| --- | --- | --- |
| [webview 执行](https://github.com/electron/electron/blob/v44.0.0/docs/api/webview-tag.md#L368-L377)与[完整方法表](https://github.com/electron/electron/blob/v44.0.0/lib/common/web-view-methods.ts#L11-L76) | `executeJavaScript(code, userGesture?)` 返回执行结果 Promise。 | 没有每次执行的租约、取消句柄、`AbortSignal`、资源列表或指定 realm 终止方法。结果完成不表示后台资源结束。 |
| [方法转发白名单](https://github.com/electron/electron/blob/v44.0.0/lib/browser/guest-view-manager.ts#L297-L324) | 只转发公开表中的方法。 | 主进程的 `WebContents` 或 renderer 的 `webFrame` API 不自动成为插件可调用的目标 guest API；不能从内部实现绕到私有 IPC。 |
| [延迟执行](https://github.com/electron/electron/blob/v44.0.0/lib/browser/api/web-contents.ts#L150-L180) | 加载尚未完成时等待 `did-stop-loading` 再派发代码。 | 取消 Host 等待不证明代码没执行；未来实现仍须解决审批到实际执行之间的文档绑定，不能仅比较开始时 URL。 |
| [导航停止](https://github.com/electron/electron/blob/v44.0.0/docs/api/webview-tag.md#L289-L290) | `stop()` 停止待定导航。 | 不承诺停止 JavaScript、timer、observer 或 worker。 |
| [DSH browser bridge](https://github.com/deepseek-ai/deepseek-harness/blob/639ed015397290b3745d163aafe02ffee4aa3f84/apps/desktop/src/preload-browser.ts#L20-L33) | `acquire`、`release`、`onOpenRequested`。 | 不返回目标 `WebContents`、脚本管理器或可撤销执行域；它不是脚本执行租约。 |
| [guest 释放与隔离](https://github.com/deepseek-ai/deepseek-harness/blob/639ed015397290b3745d163aafe02ffee4aa3f84/apps/desktop/src/browser-guests.ts#L49-L91) | 释放关闭 guest 并等待销毁；固定隔离选项覆盖传入 preferences。 | 销毁不保留原文档；容器保留也不能证明所有共享或服务 worker 都停止。不能假设插件可注入自带特权 preload。 |
| SDK `ToolDefinition.execute` 与 `timeoutMs` 声明 | 要求转发取消信号，工具拥有的工作静止后才结算；明确不能硬杀同进程代码。 | 框架超时不是 guest 脚本强制终止，不能替插件实现资源归属和停止。 |

## 已查候选与缺少的证明

| 候选 | 可以证明的局部行为 | 尚缺的完整保证 |
| --- | --- | --- |
| 主世界包装 timer、observer、worker 并记录 disposer | 固定且经审查的内部代码可登记自己持有的资源。 | 任意脚本可经页面缓存的原生别名、其他同源 realm、DOM 插入脚本、页面函数的间接调用产生任务；包装若干全局名称不涵盖这些路径。 |
| `AbortSignal`、`try/finally`、脚本自行返回清理函数 | 合作代码可停止已登记任务。 | 任意代码不必合作；清理后仍可能排新任务。审批、超时和信号本身不会终止执行。 |
| 隔离世界或可删除 iframe | 某些 Electron 进程有隔离世界 API；可删除自有 iframe。 | 当前公开接缝没有目标 guest 的对应执行域与销毁接口。能访问原 DOM 的跨 realm 回调、注册和派生资源仍需可撤销归属证明。 |
| 独立 Worker 或解释器加 DOM 代理 | 持有的 Worker 可终止。 | Worker 无直接 DOM；自建完整可撤销 DOM 平台超出本轮范围，几项代理动作也不满足任意脚本语义。 |
| 冻结、隐藏、重载、导航或释放 guest | 可改变整个页面的运行或生命周期。 | 冻结妨碍用户继续操作且恢复后可能继续任务；隐藏不是停止；重载、导航和释放改变或销毁原文档。 |

Web 的清理 API 按已知句柄工作：[timer 依 ID 清除](https://html.spec.whatwg.org/multipage/timers-and-user-prompts.html#timers)、[MutationObserver 依实例 disconnect](https://dom.spec.whatwg.org/#interface-mutationobserver)、[Dedicated Worker 依对象 terminate](https://html.spec.whatwg.org/multipage/workers.html#dom-worker-terminate)。它们没有通用的“枚举并撤销某次 Agent 脚本全部资源”接口。事件处理器、微任务和间接页面调用也不能从单个执行结果中推导归属。SharedWorker 端口关闭、Service Worker unregister 均不能直接当作全部关联活动已停的证明；本轮未验证 DSH guest 是否允许创建这些资源。

最小反例模型是“创建有限 timer、observer 或 worker，立即返回普通结果”。返回 Promise 可完成，而任务仍可存活。该模型仅说明推理缺口，本轮没有在真实页面运行它，更未执行无限循环或创建共享、服务 worker。

## 解除阻塞需要的正面证据

新路径须来自本轮允许的正式公开契约，并能取得同一可见共享页面的真实对象；不依赖修改主程序、安装包、私有 IPC、CDP 或外部浏览器。仅增加一个 API 名称或调用示例不足以解除阻塞。

需要证明脚本及派生资源有执行归属，并在接管、取消、超时、关页和卸载时达到可核验的静止；原网页文档、用户输入和网站自身活动仍可继续。Agent 注入的持续任务不能改称网站活动而豁免。若发现具体候选，先以自有有限测试页验证资源清理和原文档不变，再按真实工具到共享页面的既定边界逐项验收。

后续实现还须绑定页面、文档、网站和确切代码的逐次正式审批，执行前重核目标；页面变化、拒绝或审批不可用时不执行。批准脚本不能自动批准其后续敏感动作。取消和迟到结果须复用统一页面控制边界，结果不明时不自动重试，也不承诺撤销已发生的网站副作用。这些要求仍是未实现、未验收的任务12内容。

## 本轮验证与未测项

本轮只修改阻塞文档与本地任务状态，没有产品行为改动，因此不新增单元测试。依赖安装、派生索引同步与仓库门禁结果由本轮交接记录，不把既有171项回归或历史原生输入证据算作脚本能力证明。

没有操作官方 Desktop UI、访问真实账号、运行任意脚本、做脚本停止原生探针或变更既有后台任务。当前没有值得追加原生探针的新正面候选；重复演示 `stop()` 不是脚本取消不会解除已知契约缺口。其他平台、其他 Electron 版本和理论上的其他纯插件设计均未由本轮排除。
