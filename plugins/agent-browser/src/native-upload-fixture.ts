/** 既有loopback测试站的标准上传夹具；只接收本次显式选择的有界文件并回显摘要，不读取宿主路径或真实账号。 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import { Buffer } from 'node:buffer'
import { createHash, randomUUID } from 'node:crypto'

/** 接收端独立确认的实际字节事实，不保存文件内容。 */
interface UploadReceipt {
  /** 每次成功接收独立生成，区分重复提交。 */
  receipt: string
  /** multipart提供的basename，只作为测试数据展示。 */
  name: string
  /** 实际收到的文件字节数，最多16MiB。 */
  size: number
  /** 实际收到字节的SHA256，不由页面或工具提供。 */
  sha256: string
  /** 同一次表单的自有普通字段，最多200字符。 */
  note: string
}
/** @param text 自有结果摘要。@returns HTML文本节点安全值，不允许文件名插入可执行标记。 */
function escaped(text: string): string {
  return text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
}
/**
 * @param fixturePath Host为本次测试站生成的/spike-UUID前缀，不接受模型地址或路径。
 * @returns 标准单文件表单、接收和status路由；仅16MiB文件、64KiB封装、最多20个receipt。接收只算测试站事实，不宣称产品已完成原生验收。
 */
export function createUploadFixture(fixturePath: string): (request: IncomingMessage, response: ServerResponse) => boolean {
  if (!/^\/spike-[a-f0-9-]{36}$/u.test(fixturePath)) {
    throw new Error('上传夹具需要Host随机固定页前缀')
  }
  const path = `${fixturePath}/upload`
  const receipts: UploadReceipt[] = []
  let requests = 0
  /** @param request 本次有界multipart。@param response 同一请求结果页。@returns 接收后才产生独立receipt，解析/大小错误不生成成功记录。 */
  async function receive(request: IncomingMessage, response: ServerResponse): Promise<void> {
    requests++
    const chunks: Buffer[] = []
    let bytes = 0
    for await (const raw of request) {
      const chunk = Buffer.isBuffer(raw) ? raw : Buffer.from(raw)
      bytes += chunk.byteLength
      if (bytes > 16 * 1024 * 1024 + 65536) {
        response.writeHead(413).end('自有上传接收上限16MiB文件加64KiB封装')
        return
      }
      chunks.push(chunk)
    }
    const type = request.headers['content-type']
    if (typeof type !== 'string' || !type.startsWith('multipart/form-data;')) {
      response.writeHead(415).end('仅接受标准multipart表单')
      return
    }
    const form = await new Response(new Uint8Array(Buffer.concat(chunks)), { headers: { 'content-type': type } }).formData()
    const files = form.getAll('file')
    const file = files[0]
    const note = form.get('note')
    if (files.length !== 1 || !file || typeof file === 'string' || file.size > 16 * 1024 * 1024 || typeof note !== 'string' || note.length > 200 || [...form.keys()].some(key => !['file', 'note'].includes(key))) {
      response.writeHead(400).end('只接受一个有界自有文件及普通字段')
      return
    }
    const data = new Uint8Array(await file.arrayBuffer())
    const receipt = { receipt: randomUUID(), name: file.name, size: data.byteLength, sha256: createHash('sha256').update(data).digest('hex'), note }
    receipts.push(receipt)
    if (receipts.length > 20) {
      receipts.shift()
    }
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
    response.end(`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>自有文件接收结果</title><h1>接收端实际收到文件</h1><pre id="receipt">${escaped(JSON.stringify(receipt, null, 2))}</pre><p>本结果由接收端按真实字节生成，不代表其他网站或所有竞态已经通过。</p></html>`)
  }
  return (request, response) => {
    if (request.method === 'GET' && request.url === path) {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
      response.end(`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>自有原生上传验收</title><style>body{font:16px system-ui;padding:24px;color:#222;background:white}input,button{font:inherit;margin:10px;padding:8px}</style><h1>自有原生上传验收</h1><p>仅选择本次获准合成文件；选择即允许本网站读取，选择本身不是上传成功。本表单只由提交按钮触发原生multipart上传。</p><form method="post" enctype="multipart/form-data" action="${path}/receive"><label>自有文件<input id="file" name="file" type="file"></label><label>普通字段<input id="note" name="note" value="自有普通内容"></label><button id="submit" type="submit">上传获准自有文件</button></form><p id="document"></p><script>document.querySelector('#document').textContent='自有文档标记：'+crypto.randomUUID()</script></html>`)
      return true
    }
    if (request.method === 'GET' && request.url === `${path}/status`) {
      response.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }).end(JSON.stringify({ requests, receipts }))
      return true
    }
    if (request.method === 'POST' && request.url === `${path}/receive`) {
      void receive(request, response).catch(() => {
        if (!response.headersSent) {
          response.writeHead(400)
        }
        response.end('自有上传解析或读取失败；未生成成功receipt')
      })
      return true
    }
    return false
  }
}
