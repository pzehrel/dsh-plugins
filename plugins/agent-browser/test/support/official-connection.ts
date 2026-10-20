/** 离线执行固定新版 Connection 发布包；依赖沿用锁定 SDK，完整宿主兼容性另由原生实验验证。 */
import type { Context } from '@deepseek-ai/cordis'
import type { HostConnectionHandle } from '@deepseek-ai/dsh-client-connection'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { runInThisContext } from 'node:vm'
import ts from 'typescript'

/** 实际官方 Peer 的测试消费面，不自行构造认证对象。 */
interface Peer {
  /** 由官方作用域释放时撤销。 */
  signal: AbortSignal
  /** 等待官方作用域完成清理。 */
  dispose: () => Promise<void>
}

/** 固定新包运行面；可省略参数仅为验证旧调用的实际错误。 */
interface Connection extends Pick<HostConnectionHandle, 'fetch'> {
  /**
   * @param options 仅在内存使用的测试配置。
   * @param options.principal 交给官方工厂创建的主体声明。
   * @param options.principal.kind owner 正例或权限拒绝负例。
   * @param options.interactions 禁止离线回归发起用户交互。
   * @returns 须由调用方释放的真实 Peer。
   */
  createPeer: (options: {
    /** 交给官方工厂创建的主体声明。 */
    principal: {
      /** owner 为正例，其他字符串仅为权限拒绝负例。 */
      kind: string
    }
    /** 离线回归不发起用户交互。 */
    interactions: 'none'
  }) => Peer
  /** @param channel 固定正式 API 通道。@returns 不替换 principal 检查的原始分派句柄。 */
  createSharedFetchHandler: (channel: '/api') => {
    /** @param request 自有路由请求。@param peer 官方 Peer；省略仅复现旧调用错误。@returns 正式路由响应。 */
    fetch: (request: Request, peer?: Peer) => Promise<Response>
  }
}

/** @param ctx 官方 Cordis 作用域。@returns 未修改的新版本 Connection；不访问认证或网络服务。 */
export function officialConnection(ctx: Context): Connection {
  const archive = fileURLToPath(new URL('../../upstream/published-connection-0.2.1-rc.2.tgz', import.meta.url))
  if (createHash('sha256').update(readFileSync(archive)).digest('hex') !== '91160ce92e92026ef91c8c7b88f7f4083601bab7086188acfb79c91111bffe99') {
    throw new Error('官方 Connection 归档摘要不匹配')
  }
  const source = spawnSync('tar', ['-xOf', archive, 'package/lib/index.js'], { encoding: 'utf8' })
  if (source.status !== 0 || createHash('sha256').update(source.stdout).digest('hex') !== '0ebcca7583e082716f79b0b55bc1749d48269cc8db2989b043b321b57abd3684') {
    throw new Error('官方 Connection 入口摘要不匹配')
  }
  const require = createRequire(import.meta.url)
  const dependencies = createRequire(require.resolve('@deepseek-ai/dsh-client-connection'))
  const module = { exports: {} as { HostConnectionService: new (ctx: Context, hosts: string[], auth: object) => Connection } }
  // 仅编译模块格式；路由、Peer 创建及权限检查均执行原包代码，外部依赖不模拟。
  const code = ts.transpileModule(source.stdout, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText
  runInThisContext(`(function(require,module,exports){${code}\n})`)(dependencies, module, module.exports)
  return new module.exports.HostConnectionService(ctx, [], {})
}
