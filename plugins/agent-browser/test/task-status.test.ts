/** 从真实 CLI 与临时任务文件验证派生索引；不替换任务分析内部逻辑。 */
import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'

const command = fileURLToPath(new URL('../../../tools/check-agent-browser-tasks.ts', import.meta.url))

/** @param tasks 已存在临时任务文件夹。@param args 只接受公开 CLI 参数。@returns 真实进程退出与输出。 */
async function invoke(tasks: string, args: string[] = []): Promise<{ code: number, stdout: string, stderr: string }> {
  return new Promise((resolve) => {
    execFile(process.execPath, [command, '--root', tasks, ...args], (error, stdout, stderr) => {
      resolve({ code: error ? 1 : 0, stdout, stderr })
    })
  })
}

/** @returns 自有仓库文件夹与单任务写入能力；每项的状态、依赖直接保存在任务文件中。 */
async function fixture(): Promise<{ root: string, task: (id: string, status: string, dependencies?: string, conclusion?: string, requirement?: string) => Promise<void> }> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-task-status-'))
  const directory = join(root, '.scratch/agent-browser')
  await mkdir(join(directory, 'issues'), { recursive: true })
  await writeFile(join(directory, 'README.md'), '# 任务索引\n\n<!-- task-status:begin -->\n<!-- task-status:end -->\n')
  return { root, task: async (id, status, dependencies = '无', conclusion, requirement) => {
    await writeFile(join(directory, `issues/${id}-task.md`), `# ${id}：验收任务\n\n**阻塞依赖：** ${dependencies}\n\n**状态：** ${status}\n${conclusion ? `\n**可行性结论：** ${conclusion}\n` : ''}${requirement ? `\n**所需结论：** ${requirement}\n` : ''}`)
  } }
}

it('任务文件决定完成与可推进项，依赖未完成的任务保留阻塞', async () => {
  const f = await fixture()
  try {
    await f.task('01', 'done（限定切片）')
    await f.task('04', 'ready-for-agent', '[01](01-task.md)')
    await f.task('05', 'ready-for-agent', '[04](04-task.md)')
    await f.task('15', 'ready-for-agent', '[01](01-task.md)')
    const result = await invoke(f.root, ['--write'])
    expect(result.code, result.stderr).toBe(0)
    expect(JSON.parse(result.stdout)).toMatchObject({ completed: ['01'], ready: ['04', '15'] })
    const index = await readFile(join(f.root, '.scratch/agent-browser/README.md'), 'utf8')
    expect(index).toContain('当前可推进：04、15')
    expect(index).toContain('等待04')
    expect((await invoke(f.root)).code).toBe(0)
  }
  finally {
    await rm(f.root, { recursive: true, force: true })
  }
})

it('完成可行性调查而结论为负面时，依赖正面结论的任务仍阻塞', async () => {
  const f = await fixture()
  try {
    await f.task('02', 'completed', '无', 'blocked')
    await f.task('05', 'done')
    await f.task('13', 'ready-for-agent', '[02](02-task.md)、[05](05-task.md)', undefined, '02=feasible')
    const blocked = await invoke(f.root, ['--write'])
    expect(blocked.code, blocked.stderr).toBe(0)
    expect(JSON.parse(blocked.stdout)).toMatchObject({ completed: ['02', '05'], ready: [] })
    await f.task('02', 'done', '无', 'feasible')
    const ready = await invoke(f.root, ['--write'])
    expect(ready.code, ready.stderr).toBe(0)
    expect(JSON.parse(ready.stdout).ready).toEqual(['13'])
  }
  finally {
    await rm(f.root, { recursive: true, force: true })
  }
})

it('默认检查拒绝过期索引且不写文件，显式更新后恢复通过', async () => {
  const f = await fixture()
  try {
    await f.task('01', 'done')
    await f.task('04', 'ready-for-agent', '[01](01-task.md)')
    expect((await invoke(f.root, ['--write'])).code).toBe(0)
    const file = join(f.root, '.scratch/agent-browser/README.md')
    const before = await readFile(file, 'utf8')
    await f.task('01', 'in-progress')
    const stale = await invoke(f.root)
    expect(stale.code).toBe(1)
    expect(stale.stderr).toContain('索引已过期')
    expect(await readFile(file, 'utf8')).toBe(before)
    const update = await invoke(f.root, ['--write'])
    expect(update.code, update.stderr).toBe(0)
    expect(JSON.parse(update.stdout).ready).toEqual([])
  }
  finally {
    await rm(f.root, { recursive: true, force: true })
  }
})

it('依赖循环会失败，不能生成没有解释的空可推进列表', async () => {
  const f = await fixture()
  try {
    await f.task('01', 'ready-for-agent', '[02](02-task.md)')
    await f.task('02', 'ready-for-agent', '[01](01-task.md)')
    const result = await invoke(f.root, ['--write'])
    expect(result.code).toBe(1)
    expect(result.stderr).toContain('循环')
  }
  finally {
    await rm(f.root, { recursive: true, force: true })
  }
})

it('规格中重新手写当前可推进列表时失败，防止第二份状态来源', async () => {
  const f = await fixture()
  try {
    await f.task('01', 'done')
    expect((await invoke(f.root, ['--write'])).code).toBe(0)
    await mkdir(join(f.root, 'plugins/agent-browser/docs'), { recursive: true })
    await writeFile(join(f.root, 'plugins/agent-browser/docs/implementation-spec.md'), '当前可推进项为01、04、15。\n')
    const result = await invoke(f.root)
    expect(result.code).toBe(1)
    expect(result.stderr).toContain('重复维护')
  }
  finally {
    await rm(f.root, { recursive: true, force: true })
  }
})

it('混合有效与越出任务目录的依赖链接时失败，不静默丢掉后者', async () => {
  const f = await fixture()
  try {
    await f.task('01', 'done')
    await f.task('02', 'done')
    await f.task('04', 'ready-for-agent', '[01](01-task.md)、[02](../02-task.md)')
    const result = await invoke(f.root, ['--write'])
    expect(result.code).toBe(1)
    expect(result.stderr).toContain('依赖文件')
  }
  finally {
    await rm(f.root, { recursive: true, force: true })
  }
})

it.each(['[01](01-task.md)、02', '无、[02](02-task.md)'])('拒绝不完整的依赖声明：%s', async (dependencies) => {
  const f = await fixture()
  try {
    await f.task('01', 'done')
    await f.task('02', 'ready-for-agent')
    await f.task('03', 'ready-for-agent', dependencies)
    const result = await invoke(f.root, ['--write'])
    expect(result.code).toBe(1)
    expect(result.stderr).toContain('依赖')
  }
  finally {
    await rm(f.root, { recursive: true, force: true })
  }
})
