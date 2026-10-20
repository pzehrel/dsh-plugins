/** 固定官方创建身份与资源入口的契约回归；内存框架结果不代表 Desktop 或任务05通过。 */
import { expect, it } from 'vitest'
import { officialSidebar } from './support/official-sidebar.js'

it('官方 browser 创建独立 sidebar 内容身份，资源入口拒绝原地址且保留各会话标签', () => {
  const h = officialSidebar()
  try {
    const a = h.adopt('A')
    const b = h.adopt('B')
    h.sidebar.openTabIn(a, 'browser')
    h.sidebar.openTabIn(a, 'browser')
    h.sidebar.openTabIn(b, 'browser')
    const beforeA = h.sidebar.tabsIn(a)
    const beforeB = h.sidebar.tabsIn(b)
    expect(beforeA).toHaveLength(2)
    expect(beforeB).toHaveLength(1)
    expect(new Set([...beforeA, ...beforeB].map(tab => tab.contentId)).size).toBe(3)
    for (const tab of [...beforeA, ...beforeB]) {
      expect(tab.contentId).toMatch(/^sidebar:\/\/browser\/[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/u)
    }
    const original = beforeA[0]!
    expect(() => h.sidebar.openResourceIn(a, original.contentId, { kind: 'browser', revealIfOpened: true }))
      .toThrow(`sidebarRight: no registered tab type claims "${original.contentId}"`)
    expect(h.sidebar.tabsIn(a)).toEqual(beforeA)
    expect(h.sidebar.tabsIn(b)).toEqual(beforeB)
  }
  finally {
    h.dispose()
  }
})

it('合法资源协议可按显式 browser kind 打开及揭示，但保留独立于原 browser 页的身份', () => {
  const h = officialSidebar()
  try {
    const a = h.adopt('A')
    h.sidebar.openTabIn(a, 'browser')
    const original = h.sidebar.tabsIn(a)[0]!
    // 正向对照只验证真实入口可工作，不把资源新建伪装成原标签选择。
    const resource = 'dsh-resource://file/contract.txt'
    h.sidebar.openResourceIn(a, resource, { kind: 'browser', revealIfOpened: true })
    const opened = h.sidebar.tabsIn(a)
    expect(opened).toHaveLength(2)
    expect(opened).toContainEqual(original)
    const resourceTab = opened.find(tab => tab.contentId === resource)
    expect(resourceTab).toMatchObject({ kind: 'browser', contentId: resource })
    expect(resourceTab?.id).not.toBe(original.id)
    h.sidebar.openResourceIn(a, resource, { kind: 'browser', revealIfOpened: true })
    expect(h.sidebar.tabsIn(a)).toEqual(opened)
  }
  finally {
    h.dispose()
  }
})
