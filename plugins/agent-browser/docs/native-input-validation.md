# 主文档原生输入与正式逐次审批

2026-10-20 连续浏览修复：`click-element/press` 的原生事件组完整结算且当前命令许可仍有效后返回 `issued`，允许其正常触发新文档；该结果只关联原批准目标，不证明新页面或业务成功。下一次 `observe` 取得新文档和新引用后可继续操作。取消、接管、断线、发送失败仍不交付成功，也不自动重发事件。以下为既有切片验证记录，不能替代当前连续浏览验收。

状态：任务07纵向切片已完成。构建`902d0c91cf1a`通过官方macOS 27.0.1 Desktop 0.2.0-rc.2同页原生输入、真实逐次审批及清理验收；[最小证据记录](evidence/native-input-verification.json)与[自有Guest截图](evidence/native-input-902.jpg)已归档。完整G3/G4/G5、任务16与首版仍未通过。复用原有官方页面、Broker与认证Connection，不修改主程序或ASAR，不访问真实账号。任务06/08/11的原生证据仍对应各自已记录构建，不能自动继承为本增量通过。

## 工具契约

所有输入使用本会话 `pageId` 与最新 `observe` 的 `reference`。不接收脚本、CSS选择器、权限身份或绝对输入坐标；输入后引用全部失效，必须重新观察效果。

| action | 附加参数与边界 |
| --- | --- |
| `click-element` | 点击最近观察的可见、未禁用、中心命中目标。 |
| `fill` | `text`必填，最多2000个UTF-16字符，空串允许；仅普通可编辑input/textarea，拒绝password、敏感autocomplete、file、只读及未知类型。先原生点击聚焦，非空旧值使用公开`selectAll()`，读到完整选区并重核批准/焦点后才调用`insertText()`；完成后核对实际目标值，不通过DOM赋值。 |
| `press` | `key`必填，仅`Enter`、`Tab`、`Escape`、`Backspace`、`Delete`、`Up`、`Down`、`Left`、`Right`、`Home`、`End`、`PageUp`、`PageDown`、`Space`；目标必须已经聚焦，不额外点击按钮。 |
| `scroll` | `x`与`y`必填，分别是水平/垂直相对增量，CSS像素整数，各为-1000到1000，不得同时为0。不是系统屏幕坐标。 |

当前只接受公开`getZoomFactor()===1`，无法确认比例或其他缩放时明确拒绝；不猜测CSS坐标到原生DIP的映射。frame、object及embed目标及中心实际命中这些元素的祖先引用均拒绝；已知file控件与其祖先命中、可识别的shadow/custom目标也拒绝，不代替任务10文件授权。无法识别的闭合Shadow DOM内部结构不在本切片已知能力内。frame相关目标拒绝，不能借generic引用绕过任务09。

所有写动作都走DSH正式逐次审批，包括普通按钮与滚动。Host使用真实ToolRunContext中的Agent、callId及已验证参数，认证Client只提供当前目标绑定；网页的“已经授权”文字无效。审批展示页面、网站/净化地址、Client私有文档、观察、引用、目标与动作确切内容。HTML form字段或非form当前可见普通字段以完整有界状态参与绑定：最多20项、每项2000字符、总值8000字符；多选值逐项绑定。隐藏字段值仅参与Client摘要，审批展示只含数量，绝不输出其值；密码/验证码/信用卡/文件字段或超量、不完整状态拒绝输入，转人工。不能推断任意网站事件处理器的额外JS状态或服务端副作用，未知风险仍须用户逐次确认。等待返回后复核同一文档、快照摘要、布局、可见性和中心命中；变化则旧批准失效。拒绝、取消或服务缺失均不发出原生输入，不默认允许。

输入请求最长等待120秒供人工审批，其他Broker请求仍为15秒。审批等待期间取消、超时或接管明确为`not-started`；进入原生发送边界后若取消、断线或结果丢失，则为`unknown`，不自动重试。成功结果`status: issued`仅确认原生事件已发出，不声称网站或服务器业务完成。

最后一次Host许可等待结束后，Client重新执行完整语义与表单内容绑定，再核对实际命中；这次复核后不再插入Host RPC等待。名称、只读状态、普通字段完整长值或隐藏字段摘要变化均使旧批准失效。`fill`聚焦和`selectAll()`可能触发网站改写或`selectstart`切焦，因此选择前及文字替换前都重复完整绑定与实际焦点/命中复核，不能只核对中心坐标。它没有冻结网页或推断任意网站JS状态，不承诺任意动态网页的原子事务。

鼠标按下/释放、按键含char事件作为同一在途组登记。任一操作先拒绝，仍等待其余已启动原生操作实际结算；发送函数同步抛错时停止启动余项，但先前已启动操作继续等待，再传播首个观察到的失败。该批次不因取消提前释放，接管、关闭与卸载都等待该批次结束；不在接管后追加单独释放事件。

`selectAll()`是公开同步void方法，返回只表示调用返回，不表示renderer已经选全。非空普通text/search/url/tel/textarea目标须实际读到`selectionStart=0`与`selectionEnd=value.length`；email/number的这两个DOM属性按契约为null。非空值只接受一套公开归属证据：实际焦点仍属于目标；Selection的type为Range且rangeCount为1；不传shadowRoots的`getComposedRanges()`返回唯一StaticRange，两个container都等于目标父节点，startOffset精确为目标childNodes索引，endOffset精确为该索引加1；选中文字与已批准非空完整值逐字相等。方法缺失或任一条件不符即拒绝，不回退帧级同值文字或传统collapsed Range。无法读到、局部化显示不匹配或`badInput`均拒绝，不以空选中文字推断成功。旧值为空时不调用全选，仍要求完整绑定、实际焦点与无`badInput`。902版已在自有有效email/number上逐次批准并验证整值替换、清空及从空值重填；这证明当前宿主与这些实际字段的路径，未穷举所有网站或局部化显示。任何条件不满足仍拒绝，不降级字符串比较。

`insertText()`保留实际Promise结算；仅未取消时启动一次有界只读核验，实际焦点/文档/普通目标值无法确认或值不等于确切text时返回`unknown`，不自动重试。取消后不为证明成功追加读取，已开始的读取/Promise仍等结算。业务替换未确认与命令清理是两回事：同步void不提供业务ACK，Client已无后续工作且真实Promise全部结算后仍发送drain ACK，避免未确认业务结果形成永久写屏障。公开只读核对与原生调用并非对任意网站JS原子事务。

协议版本6增加两条仅供认证Client使用的无内容RPC：`input-watch`接收原token和`command.id/epoch/action`，`initial=true`先确认监听路径可用，后续每次最长等待1000毫秒，真实Agent信号、Broker超时、接管、关页及卸载撤销立即返回false；通信失败也中止本命令。它不是250毫秒心跳状态推断，不读取网页。首次确认失败不发输入；持续watch使用独立AbortController，覆盖最终完整绑定期间的Guest等待。

`input-drained`携带相同清理身份，只在所有Guest读取及已started原生Promise实际结算后由Client finally发送，不使用已取消的命令信号。Host在原工具finally、pause、close及卸载中等待该确认，再完成撤销；ACK处理本身不等待这些流程。页面退休后仍保留仅含清理身份/信号的记录，允许对应watch和迟到ACK，不读取已经撤销的页面权限。等待三秒仍无确认时明确返回`unknown / cleanup-unconfirmed`，保留同页写屏障与记录，不把超时写成已停止；迟到的正确ACK才能回收，异token不能代为确认。必要RPC路由在drain后才拆除，清理未确认时不能报告卸载成功。跨进程取消存在通信传播时间；已取消请求的Host完成边界不会早于真实Client结算确认，失联只能保守报告未确认。

Agent指针是在自有webview直接父节点中显示的固定、无交互标记，不改变系统鼠标。操作期间至少保留500毫秒可见窗口，接管/关闭/取消同步移除；此窗口在请求内等待，不创建网页观察器、持续脚本或后台采集。共享页的表单焦点和滚动仍由人与Agent共用，普通人工滚动不自动接管，但旧引用会失效。

## 受控回归与实际原生验收

回归沿用“真实工具入口→认证Connection→Client→原生外部边界”的既定接缝。正式审批服务与原生guest可替换；替身不证明实际审批UI或Electron行为。已覆盖允许/拒绝、旧引用不重放、审批布局变化、接管撤销待审批且未发出、中文文字insertText、焦点错位拒绝、Enter/Space额外char事件与CSS正方向相对滚动（原生wheel delta取反）、frame/file/shadow拒绝、审批内容完整绑定及500字符后缀竞态。

独立审查发现的两处P1保留原报告并补红绿回归：通过真实Connection拦住最后Host许可响应，分别改变600字符后缀、隐藏值、名称及只读状态，断言原生事件数为0；通过原生事件边界模拟focus/selection改写，断言不继续选择或insertText。另分别让mouse、press一项提前拒绝或同步抛错，其余一项延迟，断言真实Client的pause/close在延迟释放前不完成；填写的真实Guest选区读取与`insertText` Promise也覆盖取消/接管/关闭/卸载等待实际结算。这些只替换外部Guest/通信服务，没有另写批准判断或在途结算算法；原生竞态仍须实际版本验收。

选区归属复审的P2也保留失败：固定content脚本在外部Guest VM实际执行，输入框保持焦点、页面另一span选中同值文本时，旧候选仍发出insertText，两类型均红。补强后同值span、selectNode(input)但文本为空、缺getComposedRanges、错端点、多range、Caret、无range及局部文本均拒绝，只有精确目标范围和完整非空文本通过。`getComposedRanges`不传shadowRoots时的UA shadow端点提升依据固定Chromium源码；这些模型与源码证据不能单独证明Electron44实际能力；902版真实nullable正路径另见下方原生记录，上述恶意选区反例仍为受控覆盖。

后续Spec复审发现最终本地读取缺少真实Agent取消传播，旧实现红例明确在取消后发出mouseDown/up。新增六项边界覆盖：最终snapshot/content等待时取消后零输入、首次及后续watch失败关闭、丢ACK只报未确认并保留身份/拒绝异token/接受迟到正确ACK、已started原生组取消仍等待真实结算。原失败日志保留，定向过滤的跳过项不计全量通过。

实际失败保留：构建`33a970d9b254`的官方macOS Desktop正式审批已展示确切绑定并获允许一次，但`fill`将“你好”追加为“你好原生填写·中文 2026-10-16”；工具返回`issued`不能证明替换正确，自有模拟提交计数仍为0。固定Electron 44源码显示合成`sendInputEvent`没有真实macOS NSEvent/EditCommands，不能可靠复用菜单的Cmd+A选择命令。因此撤去Meta+A，用公开`selectAll()`与实际只读选区确认；不将本次失败归因于已通过的操作系统IME/复制粘贴。902版随后以公开selectAll与实际选区确认通过原生整值替换；33版失败保留，不能以新结果抹去。

受控编辑模型保留初值“你好”，合成Meta+A不改变选区，只有公开原生选择改变实际编辑范围，断言最终值精确等于新text，旧实现红例为追加。另覆盖`selectstart`同步切焦另一字段时text/email/number/textarea均零insertText、同步选择失败/未选全、nullable选区归属确认、空值和无效number、后置值不符不重试；这些只证明统一工具边界的防护与生命周期，不把mock选区当真实Electron能力。

## 902版真实验收与逐项完成依据

本轮使用真实专用Agent，在合法open turn的pre-step内调用正式ToolRuntime，正式UI逐次选择拒绝或允许一次，随后reject模型step。它验证真实工具、审批和同一可见共享页，不代表模型自主选择工具。运行Host/Client SHA与902冻结一致；完整安全记录的184个摘要及49项原生断言经归档复核。CLI读取本记录仍只能报告`recorded`。

| 任务07条件 | 实际证据与范围 |
| --- | --- |
| 普通动态表单原生操作与目标复核 | text“你好”精确替换为“原生替换成功·中文 2026-10-16”；textarea两行替换、email/number有效值替换及清空/重填均重新observe核对，像素可见。审批期间人工改变内容或布局后，旧allow均被引用变化拒绝。 |
| 可见Agent指针与人工滚动 | CUA连续首帧见紫色↖Agent，系统鼠标仍在左侧composer，下一帧标记消失；不以DOM节点存在替代可见证据。人工滚动不触发暂停，旧引用拒绝，新observe后恢复。原生y+300使同一目标中心321.375→21.375。 |
| 正式审批与失败关闭 | 所有新输入均逐次正式审批；模拟提交拒绝后0次，允许click后1次且isTrusted=true。服务缺失等失败关闭由真实工具边界受控回归证明，不伪造一次真实服务故障。 |
| 确切绑定与旧批准失效 | 真实UI展示页面、地址、文档、动作与内容，内容/布局变化拒绝旧批准。同网址reload后旧问题没有立即撤回，随后点旧allow仍因文档变化拒绝；不写成reload立即撤回审批。 |
| 真实输入与模拟站 | CUA实际OS键产生ni hao预编辑、Space提交“你好”，CmdC/V后两字段复读为“你好”；不是insertText代替IME。Space文本尾空格由真实AX JSON确认，语义observe的空白规范化不能替代此证据。Enter提交到2次；人工聚焦按钮产生第3次基线，Agent Space仅再加1到4次。 |
| 接管、取消与不重放 | 待审批取消/接管撤销请求且无效果；接管期读写拒绝，交回必须先新observe并重新审批。绝对时间屏障命中已发送后取消：实际计数2→3，UI结果不明、job settled AbortError，后续observe明确agent-browser/unknown锁定，后续CUA仍3，无自动补发。 |

已发送后取消的成功命中使用allow开始1792124996519ms、点击完成6642ms、取消开始6764ms和结束6843ms（后3项共用179212499前缀）。先前late-pause/timed-cancel晚于完成、timed-cancel2早于批准，不作在途成功证据；无效旧AX定位也未触发点击。

同构建截图smoke沿正式attachment→imageBlock→readImage imageRef核对同一`sha256:ec55c8b468bded5e94693a8fe89044e51c9f1de341416c577ad1c93c55b865c6`，实际JPEG97982字节、1151×1718；像素中多行内容、refilled@example.invalid和789一致。它是自有Guest图片，外围Agent指针的CUA截图没有本地图片文件，未编造其SHA。控制台校准窗口采到同文档标记#10–17共8条；早期空窗口排除，不扩大任务11历史证据范围。

清理已通过官方UI：仅自有tab关闭、旧page拒绝、增强tabs为空，legacy页保留；增强与驱动均不在官方插件列表。59336/59303端口关闭，四个profile文件字节一致，ASAR SHA仍为`18d5036bbb58eaff41d351ede99314b8d06505aec06fb2e164c49874ada30f9e`。18个既有后台任务未重启或取消，无真实账号、主程序或远端事项操作。

未测边界继续保留：新输入并未额外验收任意后台OS焦点场景或其他平台；沿用任务03既有边界，不能因此升级整体G3。事件组早失败/迟到Promise、丢ACK/断线、隐藏摘要和选区恶意反例由受控测试证明；不能称为全部原生竞态通过。跨域frame、上传、页面脚本与整体首版由后继任务单独验收。

## 独立正式审批驱动

现有准备命令增加一个显式选项`--approval-probe`，默认关闭，仅限专用空白验收Agent。它在启动和每次任务前要求目标真实Agent处于idle、两个inbox为空；身份只来自准备配置，HTTP不可改变。普通`/call`没有合法turn，不能用于证明正式审批通过。

```sh
node tools/prepare-enhanced-native-probe.ts "${SESSION_ID:?专用空白验收会话}" --approval-probe --actions=observe,resolve,click-element,fill,press,scroll
```

- `POST /approval/start`：只接受配置白名单的输入action及`pageId/reference/text/key/x/y`，生成一次合法SDK UserMessage并调用专用Agent.followup，立即返回job身份。
- `GET /approval/job`：查询当前job，保留实际turn/step及有界工具结果；结果明确标为正式ToolRuntime驱动，不能混称模型自主调用。
- `POST /approval/cancel`：只取消该次专用job并撤销正式问题，不操作其他Agent。

驱动仅在该Agent.ctx注册公开`agent/pre-step`，收到唯一marker时于真实open turn内调用ToolRuntime，然后始终reject，阻止模型step。先比较固定会话身份，真正其他会话才调用next；同目标会话的不同对象或proxy，以及专用Agent的陌生输入均reject，不执行工具。驱动不写turn日志，不伪造allowed-once，不回答审批。job最长180秒，清理等待whenIdle后仅移除未领取的自身marker，再解除拦截器，防止取消留下将来误进模型的验收输入。卸载等待所属job与工具结算。

driver可安装包生成在仓库忽略目录`dist/native-probes/<唯一id>/driver`，声明精确普通依赖 `@deepseek-ai/dsh-llm: 0.2.0-rc.2`，沿既有祖先`node_modules`解析`/message`出口；control、profile备份、images与artifact.json仍在本次外部临时目录。该目录不属于构建会重建的`.build`，不增加SDK副本、自有loader或手工依赖链接。真实准备CLI回归仅替换四个外部profile读取，实际生成包并用独立Node import整个模块、检查apply导出但不调用；不读真实profile、不创建Agent任务。

失败尝试保留：最初L6临时目录包仅声明dependencies、无物理依赖，启用`failed to import`；随后改peer的临时目录包也失败，因为官方运行时解析表未热收集新linkedRoot。固定[官方rc.2 link解析](https://github.com/deepseek-ai/deepseek-harness/blob/639ed015397290b3745d163aafe02ffee4aa3f84/packages/boot/app-boot/src/profile-resolution/resolver.ts#L516-L554)的peer差分只证明已知linkedRoot内的路由，不足以证明热安装成功。实际官方Electron/PluginPackages验证祖先依赖路径可import，官方UI候选也已启用并产生control/status后卸载清理；这些早期结果只证明驱动加载。两次失败均发生在apply之前，未发新增input；902轮真实CLI生成的新驱动已在官方UI启用，并取得上列正式审批和原生输入证据。

公开API依据固定DSH `dsh-v0.2.0-rc.2`源码与[Electron 44 KeyboardInputEvent](https://github.com/electron/electron/blob/v44.0.0/docs/api/structures/keyboard-input-event.md)、[Electron webview公开方法](https://www.electronjs.org/docs/latest/api/webview-tag/)；实际可用性以当前Desktop原生验收为准。
