# 事项跟踪：GitHub

本仓库的事项与规格保存在 GitHub Issues，使用 `gh` CLI 操作。
在仓库内通过 `git remote -v` 确认目标；在仓库外显式传入
`--repo pzehrel/dsh-plugins`。

## 内容语言

GitHub Issue 的标题、正文、评论、规格和关闭说明使用简体中文。
代码、命令、标识符和标签名保持原样。引用外文原文时保留原文，并补充中文解释。

## 常用操作

- 创建：`gh issue create --title "标题" --body "正文"`。
  多行正文使用 heredoc，配合 `--body-file -`。
- 读取：`gh issue view <编号> --json number,title,body,labels,comments`。
- 列表：`gh issue list --state open --json number,title,body,labels,comments`。
  按需指定 `--label`、`--state` 和 `--limit`，避免把截断结果当作全集。
- 创建子事项：`gh issue create --parent <父事项编号> --title "标题" --body "正文"`。
- 关联已有子事项：`gh issue edit <父事项编号> --add-sub-issue <子事项编号>`。
  CLI 或项目不支持时，在子事项正文顶部写 `Part of #<父事项编号>`，
  并在父事项任务列表中记录子事项。
- 评论：`gh issue comment <编号> --body "内容"`。
- 添加或移除标签：`gh issue edit <编号> --add-label "标签"` 或 `--remove-label "标签"`。
- 关闭：`gh issue close <编号> --comment "结论"`。

技能要求“发布到事项跟踪器”时，创建 GitHub issue；
要求“获取相关工单”时，读取对应 issue。
标签角色见 [分类标签](triage-labels.md)。

## PR 作为请求入口

PRs as a request surface: no.

此标志控制外部 PR 是否进入 triage 请求队列。
改为 `yes` 后，使用 `gh pr view`、`gh pr diff`、
`gh pr comment`、`gh pr edit` 和 `gh pr close` 处理对应操作；
外部请求指作者不属于 OWNER、MEMBER 或 COLLABORATOR 的 PR。

GitHub 的 issue 与 PR 共用编号空间。编号类型不明确时，
先用 `gh pr view <编号>` 核实，再按需读取 issue；
认证或网络错误不代表对象属于另一种类型。

## Wayfinder 约定

- 地图：使用带 `wayfinder:map` 标签的单个 issue，
  正文维护笔记、已有决策和待澄清问题（对应 Notes、Decisions-so-far 和 Fog）。
- 子工单：关联为地图的子事项，使用 `wayfinder:<type>` 标签；
  type 为 research、prototype、grilling 或 task。
  使用前确认标签存在；本次设置仅初始化 triage 标签。
- 阻塞：优先使用 GitHub 原生依赖。
  CLI 支持时使用
  `gh issue edit <子事项编号> --add-blocked-by <阻塞事项编号>`；
  否则使用原生 API：
  `gh api --method POST repos/{owner}/{repo}/issues/<子事项编号>/dependencies/blocked_by -F issue_id=<阻塞事项数据库ID>`。
  数据库 ID 通过
  `gh api repos/{owner}/{repo}/issues/<阻塞事项编号> --jq .id`
  获取，不使用事项编号或 node_id 替代。
  原生依赖不可用时，在正文顶部记录 `Blocked by: #<编号>, #<编号>`。
- 可领取工单：按地图顺序检查未关闭的子工单，
  排除已有负责人或仍有未关闭阻塞事项的工单。
  所有列表/API 查询须覆盖完整候选集。
- 领取：`gh issue edit <编号> --add-assignee @me`。
- 完成：先评论结论，再关闭工单，
  最后在地图的已有决策中追加摘要与链接。
