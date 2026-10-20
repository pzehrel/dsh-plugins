/** 独立HTTP接收端核验实际multipart字节；它不是浏览器原生上传或完整任务10通过证据。 */
import { once } from 'node:events'
import { createServer } from 'node:http'
import { expect, it } from 'vitest'
import { createUploadFixture } from '../src/native-upload-fixture.js'

it('自有接收端按实际收到的文件字节计算独立SHA256并在结果页显示receipt', async () => {
  const fixture = createUploadFixture('/spike-11111111-1111-4111-8111-111111111111')
  const server = createServer((request, response) => {
    if (!fixture(request, response)) {
      response.writeHead(404).end()
    }
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  try {
    const address = server.address()
    if (!address || typeof address === 'string') {
      throw new Error('测试接收端没有端口')
    }
    const origin = `http://127.0.0.1:${address.port}`
    const body = new FormData()
    body.append('file', new Blob(['abc']), 'fixture.txt')
    body.append('note', '自有字段')
    const response = await fetch(`${origin}/spike-11111111-1111-4111-8111-111111111111/upload/receive`, { method: 'POST', body })
    expect(response.status).toBe(200)
    const visible = await response.text()
    expect(visible).toContain('fixture.txt')
    expect(visible).toContain('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
    const status = await fetch(`${origin}/spike-11111111-1111-4111-8111-111111111111/upload/status`).then(response => response.json())
    expect(status).toMatchObject({ requests: 1, receipts: [{ name: 'fixture.txt', size: 3, sha256: 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad', note: '自有字段' }] })
  }
  finally {
    server.closeAllConnections()
    server.close()
    await once(server, 'close')
  }
})
