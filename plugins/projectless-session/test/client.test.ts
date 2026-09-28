/**
 * 在隔离脚本上下文加载构建后的 dist/client.js，验证浏览器模块注册、真实会话接入和同步重入保护。
 * 用例依赖构建产物，先由各包 test 脚本执行 build 再运行。
 */
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { expect, it } from 'vitest'

it('浏览器按钮通过官方插槽接入宿主身份，不触碰普通新建入口', async () => {
  const calls: string[] = []
  let finishFetch: ((response: unknown) => void) | undefined
  let plugin: { id: string, factory: (require: (name: string) => unknown) => { apply: (ctx: unknown) => void } } | undefined
  let component: ((props: { wide: boolean }) => ElementLike) | undefined
  let injectionName = ''
  interface ElementLike {
    tag: string
    props: { onClick?: () => void, [key: string]: unknown }
    children: Array<ElementLike | string | null>
  }
  const React = {
    createElement: (tag: string, props: ElementLike['props'], ...children: ElementLike['children']): ElementLike => ({ tag, props, children }),
    useState: <T>(value: T): [T, (next: T) => void] => [value, () => {}],
    useRef: <T>(value: T): { current: T } => ({ current: value }),
  }
  const source = readFileSync(new URL('../dist/client.js', import.meta.url), 'utf8')
  runInNewContext(source, {
    window: { __ModuleLoader__: { load: (entry: typeof plugin) => {
      plugin = entry
    } } },
    document: { documentElement: { lang: 'zh-CN' } },
    fetch: async (path: string, options: { method: string }) => {
      calls.push(`${options.method} ${path}`)
      return new Promise((resolve) => {
        finishFetch = resolve
      })
    },
  })
  expect(plugin?.id).toBe('dsh-projectless-session')
  const entry = plugin!.factory((name) => {
    expect(name).toBe('react')
    return React
  })
  entry.apply({
    slots: {
      inject: (name: string, register: () => void) => {
        injectionName = name
        register()
      },
      register: (options: { id: string }, candidate: typeof component) => {
        expect(options.id).toBe('dsh-projectless-session')
        component = candidate
        return () => {}
      },
    },
    sessions: {
      create: async (request: { sessionId: string, workspaceId: string }) => {
        calls.push(`adopt ${request.sessionId} ${request.workspaceId}`)
        return request.sessionId
      },
    },
    uiWorkspace: { openSession: (id: string) => { calls.push(`open ${id}`) } },
  })
  expect(injectionName).toBe('sidebar.footer.action')
  const tree = component!({ wide: true })
  const button = tree.children[0] as ElementLike
  button.props.onClick?.()
  button.props.onClick?.()
  expect(calls).toEqual(['POST /api/dsh-projectless-session/create'])
  finishFetch?.({
    ok: true,
    json: async () => ({ ok: true, sessionId: 'session-one', workspaceId: 'workspace-one' }),
  })
  await new Promise(resolve => setImmediate(resolve))
  expect(calls).toEqual([
    'POST /api/dsh-projectless-session/create',
    'adopt session-one workspace-one',
    'open session-one',
  ])
})
