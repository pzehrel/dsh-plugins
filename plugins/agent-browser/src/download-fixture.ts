/** 自有固定测试站的下载夹具；只提供无敏感内容的同源附件与请求计数，不下载或保存文件。 */
import type { IncomingMessage, ServerResponse } from 'node:http'

/** 自有测试站的有限扩展，随既有 HTTP server 生命周期销毁。 */
export interface DownloadFixture {
  /** 拼接到固定页的人工链接、Agent 验证开关与本页下载尝试标记。 */
  html: string
  /** @param request 当前测试站请求。@param response 同一 HTTP 响应。@returns 是否已处理精确的自有附件或计数路径；其他请求不变。 */
  handle: (request: IncomingMessage, response: ServerResponse) => boolean
}

/**
 * @param fixturePath Host 随机生成的固定页绝对路径，只允许 /spike- 加 UUID；不能接收 Agent URL。
 * @returns 自有附件路由和页面片段；请求计数仅说明服务器收到请求，不证明文件已保存或被宿主拒绝。
 * @throws Error 路径不属于固定夹具命名空间。
 */
export function createDownloadFixture(fixturePath: string): DownloadFixture {
  if (!/^\/spike-[0-9a-f-]{36}$/u.test(fixturePath)) {
    throw new Error('下载夹具需要 Host 随机固定页路径')
  }
  const attachmentPath = `${fixturePath}/download.txt`
  const statusPath = `${fixturePath}/download-status`
  const filename = `dsh-agent-browser-${fixturePath.slice(7)}.txt`
  let attachmentRequests = 0
  return {
    html: `<fieldset><legend>自有下载限制验证</legend><p>当前官方 Desktop 不支持网页下载；未生成文件。不要通过其他浏览器或 Host 请求绕过。</p>
<label><input id="download-mode" type="checkbox">仅用于验收：让下一次增加计数同时触发下载</label>
<a id="manual-download" href="${attachmentPath}" download="${filename}">人工尝试下载自有测试文件</a>
<p id="download-feedback" role="status"></p></fieldset>
<script>document.body.dataset.spikeDownloadAttempts='0';
document.querySelector('#manual-download').addEventListener('click',()=>{document.body.dataset.spikeDownloadAttempts=String(Number(document.body.dataset.spikeDownloadAttempts)+1);document.querySelector('#download-feedback').textContent='当前官方 Desktop 不支持网页下载；未生成文件，请停止该步骤。'});
document.querySelector('#bump').addEventListener('click',()=>{if(document.querySelector('#download-mode').checked)document.querySelector('#manual-download').click()});</script>`,
    handle: (request, response) => {
      if (request.method !== 'GET') {
        return false
      }
      if (request.url === statusPath) {
        response.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
        response.end(JSON.stringify({ attachmentRequests }))
        return true
      }
      if (request.url !== attachmentPath) {
        return false
      }
      attachmentRequests++
      response.writeHead(200, { 'content-type': 'text/plain; charset=utf-8', 'content-disposition': `attachment; filename="${filename}"`, 'cache-control': 'no-store' })
      response.end('DSH 自有下载验证文件。\n')
      return true
    },
  }
}
