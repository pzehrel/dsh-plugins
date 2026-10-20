/** 经根包公开安装入口验证 Host 与 Client 都装配官方浏览器增强，避免误装旧实验面板。 */
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { expect, it } from 'vitest'

it('直接安装插件目录时加载官方浏览器增强，而非旧实验', async () => {
  const directory = new URL('../', import.meta.url)
  const manifest = JSON.parse(readFileSync(new URL('package.json', directory), 'utf8'))
  expect(manifest.dsh.bundle?.patch, '官方安装器需要组合包声明').toBeDefined()
  expect(readFileSync(new URL(manifest.dsh.bundle.patch, directory), 'utf8')).toContain(`name: ${manifest.name}\n`)
  const host = await import(new URL(manifest.main, directory).href)
  expect(host.name).toBe('agent-browser')
  expect(host.inject).toEqual(['tools', 'connection'])

  const artifact = JSON.parse(readFileSync(new URL('dist/enhanced/package.json', directory), 'utf8'))
  const modules = new Map<string, { factory: (require: (id: string) => unknown) => unknown }>()
  // 替换外部模块加载器的登记边界；官方 factory 仍由真实构建提供，不执行渲染替身。
  runInNewContext(readFileSync(new URL(manifest.exports['./client'], directory), 'utf8'), {
    window: { __ModuleLoader__: { load: (definition: { id: string, factory: (require: (id: string) => unknown) => unknown }) => modules.set(definition.id, definition) } },
  })
  expect(modules.has(artifact.name)).toBe(true)
  const entry = modules.get(manifest.name)
  expect(entry, '默认插件名必须能解析到已登记的官方增强模块').toBeDefined()
  const resolved: string[] = []
  const enhanced = { apply: Symbol('官方增强入口') }
  expect(entry!.factory((id) => {
    resolved.push(id)
    return enhanced
  })).toBe(enhanced)
  expect(resolved).toEqual([artifact.name])
})
