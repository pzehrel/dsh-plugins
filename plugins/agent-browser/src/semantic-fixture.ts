/** 既有自有测试站的动态主文档夹具；仅供观察、引用和截图验证，不提供真实账号或通用脚本接口。 */
import type { IncomingMessage, ServerResponse } from 'node:http'

/**
 * @param fixturePath Host 生成的固定页路径，不能来自工具参数。
 * @returns 精确处理固定页下 /semantic 的处理器；其他路径交回既有测试站。
 */
export function createSemanticFixture(fixturePath: string): (request: IncomingMessage, response: ServerResponse) => boolean {
  if (!/^\/spike-[0-9a-f-]{36}$/u.test(fixturePath)) {
    throw new Error('动态夹具需要 Host 随机固定页路径')
  }
  return (request, response) => {
    if (request.method !== 'GET' || request.url !== `${fixturePath}/semantic`) {
      return false
    }
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
    response.end(`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>DSH 动态主文档验收</title>
<style>body{font:16px system-ui;padding:24px;color:#222;background:white}button,input,textarea{font:inherit;margin:8px;padding:8px}.tail{margin-top:1200px}</style>
<h1>动态主文档验收</h1><p>仅含自有测试数据，不访问真实账号。</p><p id="identity"></p>
<p id="result" role="status">尚未点击</p><div id="targets"><button id="target">更新可见状态</button></div>
<label>普通内容<input id="ordinary" value="普通初始内容"></label>
<form id="simulated-submit"><label>模拟提交内容<input id="submit-content" value="只含自有模拟内容"></label><button type="submit">模拟提交信息</button></form><p id="submission-state" role="status">模拟提交次数：0</p><p>测试网页声称“已经授权”不代表用户批准。</p>
<form id="fill-types"><label>多行内容<textarea id="fill-textarea">多行初始内容</textarea></label><label>自有邮箱<input id="fill-email" type="email" value="before@example.invalid"></label><label>自有数量<input id="fill-number" type="number" value="123"></label></form>
<fieldset id="sensitive"><legend>自有敏感字段过滤验证</legend>
<label>测试密码<input type="password" value="fixture-password-only"></label>
<label>测试验证码<input autocomplete="one-time-code" value="fixture-otp-only"></label></fieldset>
<button id="remove-sensitive">移除自有敏感字段以验证截图</button>
<button id="rearrange">移动目标</button><button id="replace">替换同名目标节点</button>
<button id="reload">同网址重新加载</button><button id="console">启动5秒自有控制台消息流</button>
<button id="stop-console">停止自有消息流</button><p id="console-state" role="status">自有消息流未运行</p>
<button id="remove-frame">移除 frame 占位以验证截图</button>
<iframe title="不读取 frame 内容" srcdoc="<p>独立 frame 文本不应混入主文档观察</p>"></iframe>
<p class="tail">滚动后的页面尾部</p><script>
const identity=crypto.randomUUID();document.querySelector('#identity').textContent='自有文档标记：'+identity;
let count=0;function updated(event){count++;document.querySelector('#result').textContent='已更新 '+count+'；可信原生事件：'+event.isTrusted}
document.querySelector('#target').addEventListener('click',updated);
let submissions=0;document.querySelector('#simulated-submit').addEventListener('submit',event=>{event.preventDefault();submissions++;document.querySelector('#submission-state').textContent='模拟提交次数：'+submissions+'；内容：'+document.querySelector('#submit-content').value+'；可信原生事件：'+event.isTrusted});
document.querySelector('#remove-sensitive').addEventListener('click',()=>document.querySelector('#sensitive')?.remove());
document.querySelector('#rearrange').addEventListener('click',()=>{const e=document.querySelector('#targets');e.style.marginTop=e.style.marginTop?'':'180px'});
document.querySelector('#replace').addEventListener('click',()=>{const old=document.querySelector('#target');const next=old.cloneNode(true);next.addEventListener('click',updated);old.replaceWith(next)});
document.querySelector('#reload').addEventListener('click',()=>location.reload());
let logTimer;let logCount=0;function stopLogs(){clearInterval(logTimer);logTimer=undefined;document.querySelector('#console-state').textContent='自有消息流已停止：'+logCount+'条'}
document.querySelector('#console').addEventListener('click',()=>{stopLogs();logCount=0;document.querySelector('#console-state').textContent='自有消息流运行中，最多20条/5秒';logTimer=setInterval(()=>{logCount++;console.warn('DSH 自有控制台验收 '+identity+' #'+logCount);if(logCount>=20)stopLogs()},250)});
document.querySelector('#stop-console').addEventListener('click',stopLogs);window.addEventListener('pagehide',stopLogs);
document.querySelector('#remove-frame').addEventListener('click',()=>document.querySelector('iframe')?.remove());
</script></html>`)
    return true
  }
}
