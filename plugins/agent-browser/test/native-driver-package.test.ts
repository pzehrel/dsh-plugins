/** 验证真实准备CLI的生成包；仅在子进程文件系统边界替换四个profile读取，不读真实配置或启用插件。 */
import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { expect, it } from 'vitest'

it('真实准备CLI沿仓库祖先依赖生成可import包，不调用apply、不依赖宿主热更新解析表', async () => {
  const fixture = await mkdtemp(join(tmpdir(), 'dsh-driver-package-test-'))
  let generated: string | undefined
  let generatedPluginRoot: string | undefined
  try {
    const preload = join(fixture, 'profile-boundary.mjs')
    // 只替换prepare需要的外部profile读取；工具源码、TypeScript和实际生成文件均按真实文件执行。
    await writeFile(preload, `import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { join } from 'node:path';
const originals = new Set(['cordis.yml','cordis.patch.yml','package.json','gro.ngilp-hsd-versions.json'].map(name => join(process.env.HOME, '.dsh/profiles/desktop', name)));
const read = fs.readFileSync;
fs.readFileSync = (file, ...args) => originals.has(String(file)) ? Buffer.from('self-owned-profile-fixture') : read(file, ...args);
syncBuiltinESMExports();
`)
    const script = fileURLToPath(new URL('../../../tools/prepare-enhanced-native-probe.ts', import.meta.url))
    const result = await new Promise<{ code: number, stdout: string, stderr: string }>((done) => {
      execFile(process.execPath, ['--import', preload, script, 'session-00000000-0000-4000-8000-000000000000', '--approval-probe', '--actions=observe,click-element'], {
        encoding: 'utf8',
        timeout: 15000,
      }, (error, stdout, stderr) => done({ code: error ? 1 : 0, stdout, stderr }))
    })
    expect(result.code, result.stderr).toBe(0)
    const output = JSON.parse(result.stdout) as { directory: string, plugin: string, controlFile: string }
    expect(resolve(dirname(output.directory))).toBe(resolve(tmpdir()))
    expect(basename(output.directory)).toMatch(/^dsh-enhanced-native-/u)
    generated = output.directory
    const packageRoot = dirname(output.plugin)
    expect(dirname(packageRoot)).toBe(fileURLToPath(new URL('../../../dist/native-probes', import.meta.url)))
    expect(basename(packageRoot)).toMatch(/^[a-f0-9]{32}$/u)
    expect(basename(output.plugin)).toBe('driver')
    generatedPluginRoot = packageRoot
    const manifest = JSON.parse(await readFile(join(output.plugin, 'package.json'), 'utf8'))
    expect(manifest.dependencies).toEqual({ '@deepseek-ai/dsh-llm': '0.2.0-rc.2' })
    expect(manifest.peerDependencies).toBeUndefined()
    expect(manifest.dsh.bundle.patch).toBe('./cordis.patch.yml')
    const source = await readFile(join(output.plugin, 'index.js'), 'utf8')
    expect(source).toContain('from \'@deepseek-ai/dsh-llm/message\'')
    // 实际裸Node沿祖先node_modules解析整个模块；只检查导出，不调用apply或产生Agent任务。
    const imported = await new Promise<{ code: number, stdout: string, stderr: string }>((done) => {
      execFile(process.execPath, ['--input-type=module', '-e', 'const m=await import(process.argv[1]);console.log(typeof m.apply)', pathToFileURL(join(output.plugin, 'index.js')).href], {
        encoding: 'utf8',
        timeout: 15000,
      }, (error, stdout, stderr) => done({ code: error ? 1 : 0, stdout, stderr }))
    })
    expect(imported.code, imported.stderr).toBe(0)
    expect(imported.stdout.trim()).toBe('function')
    await expect(readFile(output.controlFile)).rejects.toMatchObject({ code: 'ENOENT' })
    const config = JSON.parse(await readFile(join(output.plugin, 'driver-config.json'), 'utf8'))
    expect(config.approvalProbe).toBe(true)
    expect(config.sessionId).toBe('session-00000000-0000-4000-8000-000000000000')
    for (const name of ['cordis.yml', 'cordis.patch.yml', 'package.json', 'gro.ngilp-hsd-versions.json']) {
      expect(await readFile(join(generated, 'profile-before', name), 'utf8')).toBe('self-owned-profile-fixture')
    }
  }
  finally {
    if (generatedPluginRoot) {
      await rm(generatedPluginRoot, { recursive: true, force: true })
    }
    if (generated) {
      await rm(generated, { recursive: true, force: true })
    }
    await rm(fixture, { recursive: true, force: true })
  }
})
