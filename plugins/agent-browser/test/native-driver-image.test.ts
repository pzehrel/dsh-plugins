/** 验收驱动只从本次成功工具输出读取正式图片；外部附件服务替身不代表原生像素已验收。 */
import type { ImageAttachmentRef, StoredImageAttachment } from '@deepseek-ai/dsh-attachment'
import { Buffer } from 'node:buffer'
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it, vi } from 'vitest'
import { createNativeDriver } from '../../../tools/enhanced-native-driver.js'

/** @param read 可选的外部正式存储消费面；省略模拟无服务。@returns 自有临时HTTP驱动，始终清理，不读取用户目录。 */
async function setup(read?: (ref: ImageAttachmentRef, signal?: AbortSignal) => Promise<StoredImageAttachment>) {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-driver-image-'))
  const controlFile = join(directory, 'control.json')
  const cleanups: (() => Promise<unknown>)[] = []
  const data = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jxioAAAAASUVORK5CYII=', 'base64')
  const ref = { attachmentId: 'a'.repeat(64), mediaType: 'image/png', width: 1, height: 1, bytes: data.length } as ImageAttachmentRef
  const effect = (setup: () => () => Promise<unknown>) => cleanups.push(setup())
  const execute = vi.fn(async () => ({ isError: false, value: { kind: 'screenshot', attachment: ref }, content: [{ type: 'image', attachment: ref }] }))
  const context = {
    agents: { list: () => [{ session: { header: { id: 'session-image-test' } } }] },
    tools: { get: () => undefined, execute },
    effect,
    inject: (_services: string[], callback: (scope: object) => void) => {
      if (read) {
        callback({ attachments: { readImage: read }, effect })
      }
    },
  }
  createNativeDriver(context as unknown as Parameters<typeof createNativeDriver>[0], { sessionId: 'session-image-test', controlFile, lifecycle: false, actions: ['screenshot'], artifactDirectory: directory })
  let control: { port: number, secret: string } | undefined
  await vi.waitFor(async () => {
    control = JSON.parse(await readFile(controlFile, 'utf8'))
  })
  const call = (body: object) => fetch(`http://127.0.0.1:${control!.port}/call`, { method: 'POST', headers: { 'authorization': `Bearer ${control!.secret}`, 'content-type': 'application/json' }, body: JSON.stringify(body) })
  const dispose = async () => {
    for (const cleanup of [...cleanups].reverse()) {
      await cleanup()
    }
  }
  return { directory, call, data, ref, execute, dispose, close: async () => {
    await dispose()
    await rm(directory, { recursive: true, force: true })
  } }
}

it('只导出本次成功image块关联的正式图片，拒绝请求提供附件或路径', async () => {
  let image: StoredImageAttachment | undefined
  const reading = vi.fn(async () => {
    if (!image) {
      throw new Error('外部存储夹具尚未准备')
    }
    return image
  })
  const scenario = await setup(reading)
  image = { ref: scenario.ref, data: scenario.data }
  try {
    expect((await scenario.call({ action: 'screenshot', attachmentId: 'other', path: '/arbitrary' })).status).toBe(400)
    expect(scenario.execute).not.toHaveBeenCalled()
    const result = await (await scenario.call({ action: 'screenshot' })).json()
    expect(result).toMatchObject({ isError: false, imageRef: scenario.ref, bytes: scenario.data.length, imageBlock: { type: 'image', attachment: scenario.ref } })
    expect(result.artifactFile).toMatch(/\.png$/u)
    expect(await readFile(result.artifactFile)).toEqual(scenario.data)
    expect(reading).toHaveBeenCalledOnce()
  }
  finally {
    await scenario.close()
  }
})

it('正式图片服务缺失时明确拒绝导出，不返回虚构artifactFile', async () => {
  const scenario = await setup()
  try {
    const response = await scenario.call({ action: 'screenshot' })
    expect(response.status).toBe(500)
    const result = await response.json()
    expect(result.error).toContain('[native-driver/image-export]')
    expect(result).not.toHaveProperty('artifactFile')
  }
  finally {
    await scenario.close()
  }
})

it('驱动卸载等待已经开始的readImage，迟到返回不再写出文件', async () => {
  let finish: (value: StoredImageAttachment) => void = () => {}
  let signal: AbortSignal | undefined
  const scenario = await setup(async (_ref, received) => {
    signal = received
    return new Promise((resolve) => {
      finish = resolve
    })
  })
  try {
    const pending = scenario.call({ action: 'screenshot' }).catch(() => undefined)
    await vi.waitFor(() => expect(signal).toBeDefined())
    let settled = false
    const disposing = scenario.dispose().then(() => {
      settled = true
    })
    expect(signal!.aborted).toBe(true)
    expect(settled).toBe(false)
    finish({ ref: scenario.ref, data: scenario.data })
    await disposing
    await pending
    expect((await readdir(scenario.directory)).some(file => file.endsWith('.png'))).toBe(false)
  }
  finally {
    finish({ ref: scenario.ref, data: scenario.data })
    await scenario.close()
  }
})
