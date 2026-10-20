/** 从本地任务文件派生 Agent 浏览器索引；默认只检查，--write 仅更新索引标记块，不修改任务或远端事项。 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

interface Task {
  /** 文件名中的两位任务编号，不允许重复。 */
  id: string
  /** 任务一级标题，不含编号。 */
  title: string
  /** issues/ 内的原始文件名，用于索引链接。 */
  file: string
  /** 任务字段的状态；completed 兼容旧记录并归一为 done。 */
  status: string
  /** 阻塞依赖字段中明确链接的任务编号。 */
  dependencies: string[]
  /** 可行性调查结果；缺省为未知，不能代替正面证据。 */
  conclusion?: string
  /** 还须取得 feasible 结论的直接依赖；不能仅凭 done 解除。 */
  requiredConclusion?: string
}
const begin = '<!-- task-status:begin -->'
const end = '<!-- task-status:end -->'

/** 检查或更新索引并输出派生结果；无效任务、依赖或过期索引导致失败。 */
function main(): void {
  let root = fileURLToPath(new URL('../', import.meta.url))
  let write = false
  let rootProvided = false
  const args = process.argv.slice(2)
  for (let index = 0; index < args.length; index++) {
    if (args[index] === '--write' && !write) {
      write = true
    }
    else if (args[index] === '--root' && !rootProvided && args[index + 1] && !args[index + 1]!.startsWith('--')) {
      root = resolve(args[++index]!)
      rootProvided = true
    }
    else {
      throw new Error('用法：node tools/check-agent-browser-tasks.ts [--write] [--root 仓库目录]')
    }
  }
  const directory = join(root, '.scratch/agent-browser')
  const files = readdirSync(join(directory, 'issues')).filter(file => /^\d{2}-.+\.md$/.test(file)).sort()
  const tasks: Task[] = files.map((file) => {
    const source = readFileSync(join(directory, 'issues', file), 'utf8')
    const id = file.slice(0, 2)
    const title = source.match(new RegExp(`^# ${id}：(.+)$`, 'm'))?.[1]
    const status = source.match(/^\*\*状态：\*\* (done|completed|ready-for-agent|in-progress|blocked)(?=\s|（|$)/m)?.[1]
    const dependency = source.match(/^\*\*阻塞依赖：\*\* (.+)$/m)?.[1]
    if (!title || !status || !dependency) {
      throw new Error(`任务${id}缺少有效标题、状态或阻塞依赖`)
    }
    const reference = /\[[^\]\n]+\]\(([^)\n]+)\)/g
    const links = [...dependency.matchAll(reference)].map(match => match[1]!)
    const noDependencies = /^无(?:（[^）]*）)?$/.test(dependency)
    // 整个声明都须可识别，不能在合法链接旁静默丢弃裸编号或说明中的依赖。
    const remainder = dependency.replace(reference, '').replace(/[、\s]/g, '')
    if (!noDependencies && (remainder || links.length === 0)) {
      throw new Error(`任务${id}的阻塞依赖须全部使用同目录任务链接；说明请放入依赖说明字段`)
    }
    for (const link of links) {
      if (!/^\d{2}-[^/]+\.md$/.test(link) || !files.includes(link)) {
        throw new Error(`任务${id}的阻塞依赖文件不存在`)
      }
    }
    const dependencies = links.map(link => link.slice(0, 2))
    const conclusion = source.match(/^\*\*可行性结论：\*\* (feasible|blocked|unknown)(?=\s|（|$)/m)?.[1]
    const requirement = source.match(/^\*\*所需结论：\*\* (.+)$/m)?.[1]
    if (requirement && !/^\d{2}=feasible$/.test(requirement)) {
      throw new Error(`任务${id}的所需结论须为两位依赖编号=feasible`)
    }
    return { id, title, file, status: status === 'completed' ? 'done' : status, dependencies, conclusion, requiredConclusion: requirement?.slice(0, 2) }
  })
  if (tasks.length === 0 || new Set(tasks.map(task => task.id)).size !== tasks.length) {
    throw new Error('任务为空或编号重复')
  }
  const byId = new Map(tasks.map(task => [task.id, task]))
  for (const task of tasks) {
    if (task.requiredConclusion && !task.dependencies.includes(task.requiredConclusion)) {
      throw new Error(`任务${task.id}的所需结论必须来自直接依赖`)
    }
    for (const dependency of task.dependencies) {
      if (!byId.has(dependency)) {
        throw new Error(`任务${task.id}引用不存在的依赖${dependency}`)
      }
    }
  }
  const visited = new Set<string>()
  const visiting = new Set<string>()
  /** @param id 当前依赖节点。拒绝循环，避免将无效任务图静默解释为没有可推进任务。 */
  function validate(id: string): void {
    if (visiting.has(id)) {
      throw new Error(`任务依赖存在循环：${id}`)
    }
    if (visited.has(id)) {
      return
    }
    visiting.add(id)
    for (const dependency of byId.get(id)!.dependencies) {
      validate(dependency)
    }
    visiting.delete(id)
    visited.add(id)
  }
  for (const task of tasks) {
    validate(task.id)
  }
  /** @param task 当前任务。@returns 未满足的直接依赖及结论门槛，调查完成不等于能力可行。 */
  function blockers(task: Task): string[] {
    const result = task.dependencies.filter(id => byId.get(id)!.status !== 'done')
    if (task.requiredConclusion && byId.get(task.requiredConclusion)!.conclusion !== 'feasible') {
      result.push(`${task.requiredConclusion}正面可行证据`)
    }
    return result
  }
  const completed = tasks.filter(task => task.status === 'done').map(task => task.id)
  const ready = tasks.filter(task => task.status === 'ready-for-agent' && blockers(task).length === 0).map(task => task.id)
  const rows = tasks.map((task) => {
    const state = task.status === 'done' ? '已完成' : ready.includes(task.id) ? '可推进' : task.status === 'ready-for-agent' ? `等待${blockers(task).join('、')}` : task.status
    return `| ${task.id} | [${task.title}](issues/${task.file}) | ${state} | ${task.dependencies.join('、') || '无'}${task.requiredConclusion ? `；${task.requiredConclusion}=feasible` : ''} |`
  })
  const generated = `${begin}\n\n已完成：${completed.join('、') || '无'}。当前可推进：${ready.join('、') || '无'}。\n\n| 编号 | 任务 | 派生状态 | 阻塞依赖 |\n| --- | --- | --- | --- |\n${rows.join('\n')}\n\n${end}`
  const file = join(directory, 'README.md')
  const source = readFileSync(file, 'utf8')
  const start = source.indexOf(begin)
  const stop = source.indexOf(end)
  if (start < 0 || stop < start || source.includes(begin, start + begin.length) || source.includes(end, stop + end.length)) {
    throw new Error('任务索引必须包含唯一且完整的 task-status 标记块')
  }
  // 规格和拆分文档引用索引；禁止再次手写当前可推进编号，避免旧状态复制回流。
  const liveList = /当前可推进项?[为：:]?[ \t]*\d/
  const outside = source.slice(0, start) + source.slice(stop + end.length)
  const documents = ['implementation-spec.md', 'implementation-tickets-draft.md'].map(name => join(root, 'plugins/agent-browser/docs', name))
  if (liveList.test(outside) || documents.some(file => existsSync(file) && liveList.test(readFileSync(file, 'utf8')))) {
    throw new Error('当前可推进项不得在派生块外重复维护，请引用任务索引')
  }
  const expected = source.slice(0, start) + generated + source.slice(stop + end.length)
  if (source !== expected) {
    if (!write) {
      throw new Error('任务索引已过期；运行 pnpm check:agent-browser-tasks --write 更新派生块')
    }
    writeFileSync(file, expected)
  }
  process.stdout.write(`${JSON.stringify({ completed, ready })}\n`)
}
try {
  main()
}
catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : '任务状态检查失败'}\n`)
  process.exitCode = 1
}
