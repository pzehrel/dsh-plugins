/** 复用官方标签标题的紧凑工具状态；不显示网页内容；接管仅使用当前框架绑定页的统一控制屏障。 */
import type { ToolStatus, ToolStatusSource } from './fixed-page-client.js'
import { useSyncExternalStore } from 'react'

const labels: Record<ToolStatus, string> = {
  /** 当前登记可接收页面工具请求。 */
  'idle': '工具就绪',
  /** 含后台执行；切换视图不抢焦点。 */
  'running': 'Agent 执行中',
  /** 已发出点击可能生效，禁止自动重试。 */
  'uncertain': '结果不明，请核对',
  /** 旧目标已停止；连接恢复后须显式重新打开。 */
  'offline': '连接已断开，请重新打开',
  /** Host 与 Client 不属于同一构建，反复重新打开不能解决。 */
  'incompatible': '工具版本不匹配，请重新安装',
  /** 页面或插件生命周期已结束。 */
  'closed': '工具已停止',
  /** 屏障已阻止本地新采集，仍在等待 Host 撤销和原生结算。 */
  'pausing': '暂停正在生效，请稍候',
  /** Host 已撤销旧代次且已开始操作均已结算。 */
  'paused': '已接管，Agent 已暂停',
  /** 仍保持本地屏障，等待 Host 交回确认。 */
  'resuming': '正在交回 Agent',
  /** 屏障未获完整确认，不能提示用户已安全接管。 */
  'takeover-failed': '接管失败，尚未确认暂停，请重试',
  /** 本地继续暂停；不因交回失败重放旧请求。 */
  'resume-failed': '交回失败，Agent 仍暂停',
}
/**
 * @param props 正式标题的状态来源。
 * @param props.source 当前框架绑定页面的状态，不包含网页观察。
 * @param props.takeover 显式暂停回调，完成前不提示已接管。
 * @param props.resume 显式交回回调，旧请求不重放；未提供控制回调时只显示状态。
 * @returns 标题内状态及必要接管按钮；普通手动浏览不触发回调。
 */
export function ToolStatusView(props: { source: ToolStatusSource, takeover?: () => Promise<void>, resume?: () => Promise<void> }): React.ReactNode {
  const { source } = props
  const status = useSyncExternalStore(source.subscribe, source.getSnapshot)
  const paused = status === 'paused' || status === 'resume-failed'
  const unavailable = status === 'closed' || status === 'offline' || status === 'incompatible' || status === 'pausing' || status === 'resuming'
  return (
    <span style={{ fontSize: 11, marginLeft: 6, color: 'var(--dsw-alias-label-tertiary)' }}>
      <span role="status" aria-live="polite">{labels[status]}</span>
      {props.takeover && props.resume && (
        <button
          type="button"
          disabled={unavailable}
          title="暂停此页感知、输入、截图、控制台和导航；Agent不能选择或关闭接管页。无法撤回已发送内容或逆转已发生操作。交回后须先重新读取。"
          onPointerDown={(event) => {
            // 官方可拖动 Tab 会捕获 pointer；只隔离按钮按下，保留默认聚焦及鼠标、键盘 click。
            event.stopPropagation()
          }}
          onClick={(event) => {
            event.stopPropagation()
            void (paused ? props.resume!() : props.takeover!()).catch(() => {})
          }}
        >
          {paused ? '交回 Agent' : status === 'takeover-failed' ? '重试接管' : '人工接管'}
        </button>
      )}
    </span>
  )
}
