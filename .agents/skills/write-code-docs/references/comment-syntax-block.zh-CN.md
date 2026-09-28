# 块文档注释（`/** ... */`）

目标语言使用 `/** ... */` 块文档注释时阅读本文件。TypeScript 和 JavaScript 共用同一套 JSDoc 标签；Java 使用相同定界符，但标签与类型语法不同。

双语模式下，下面每条注释都包含完整英语块、一个空行和完整本地化块。「单语模式」一节展示同样形态的单语写法：该模式下简单的注释保持一行。`/** English — 中文 */` 这种单行双语注释不使用，单行形式只留给单语模式。

形式取决于职责。`/** ... */` 用于声明文档，也就是编辑器悬停展示的内容。函数或方法体内的代码说明使用普通 `//` 注释；下面示例中的实现说明都用这种形式。

## TypeScript / JavaScript——可调用契约、每个字段与实现原因

```ts
/**
 * Uploads one artifact, retrying transient failures up to 3 times.
 *
 * Retries reuse the caller's `AbortSignal`, so aborting the upload also cancels every attempt
 * still waiting in backoff.
 *
 * @param artifact Already validated by `validateArtifact`; this function re-checks only the checksum.
 * @param options Upload limits; every field is described on `UploadOptions`.
 * @returns Stored artifact id, stable across retries.
 * @throws ArtifactRejectedError when the checksum does not match; that case is not retried.
 *
 * 上传一个产物，瞬时失败最多重试 3 次。
 *
 * 重试复用调用方的 `AbortSignal`，因此中止上传会同时取消仍在退避等待中的每一次尝试。
 *
 * 参数：
 * - `artifact`：已由 `validateArtifact` 校验；本函数只重新校验校验和。
 * - `options`：上传限制；每个字段都在 `UploadOptions` 上有说明。
 * 返回：存储后的产物 id，多次重试之间保持稳定。
 * 异常：校验和不匹配时抛出 ArtifactRejectedError，该情况不重试。
 */
export async function upload(artifact: Artifact, options: UploadOptions): Promise<string> {
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    // Back off only *between* attempts: the first attempt must stay synchronous with the
    // caller's request, otherwise the UI shows a spinner for a no-op.
    //
    // 只在两次尝试之间退避：首次尝试必须与调用方请求同步，否则界面会为一次空操作显示加载态。
    if (attempt > 0) await sleep(options.baseDelayMs * 2 ** (attempt - 1));
    // ...
  }
}

/**
 * Limits applied to one upload.
 *
 * 单次上传的限制。
 */
interface UploadOptions {
  /**
   * Per-request chunk ceiling in bytes.
   *
   * 单次请求的分块上限（字节）。
   */
  chunkSizeBytes: number;
  /**
   * Backoff unit in milliseconds; attempt n waits this value times 2^(n-1).
   *
   * 退避基数（毫秒）；第 n 次等待该值乘以 2^(n-1)。
   */
  baseDelayMs: number;
  /**
   * Retries after the first failure; `0` disables retrying.
   *
   * 首次失败后的重试次数；`0` 表示不重试。
   */
  maxRetries: number;
}
```

`UploadOptions` 有三个字段和三条说明。类型上的注释描述的是容器，不能替代任何字段说明；字段没有说明就是覆盖缺口，不是风格选择。纯 JavaScript 使用同一套标签，并把类型写进标签里：`@param {number} options.maxRetries`、`@param {number} [options.totalTimeoutMs]`。

## Java——类职责、每个字段与失败契约

为类、字段以及每个 `@param`、`@return`、`@throws` 条目使用 Javadoc。`*` 列要与起始 `/**` 对齐。

```java
/**
 * Owns the retry policy for outbound artifact uploads; it performs no I/O itself.
 *
 * 负责出站产物上传的重试策略；本类自身不执行 I/O。
 */
final class RetryPolicy {
    /**
     * Maximum attempts per upload, including the first.
     *
     * 每次上传的最大尝试次数（含首次）。
     */
    private final int maxAttempts;

    /**
     * Backoff unit in milliseconds; attempt n waits this value times 2^(n-1).
     *
     * 退避基数（毫秒）；第 n 次等待该值乘以 2^(n-1)。
     */
    private final long baseDelayMs;

    /**
     * Fraction of the delay that is randomized, so replicas do not retry in lockstep.
     *
     * 延迟中被随机化的比例，避免各副本同步重试。
     */
    private final double jitterRatio;

    /**
     * Decides whether another attempt is allowed and how long to wait before it.
     *
     * @param attempt 1-based index of the attempt that just failed.
     * @param cause failure observed on that attempt; never null.
     * @return wait duration, or empty when the policy gives up.
     * @throws IllegalArgumentException if {@code attempt} is less than 1.
     *
     * 判断是否允许再试一次，以及再试前需要等待多久。
     *
     * 参数：
     * - `attempt`：刚刚失败的尝试序号，从 1 开始。
     * - `cause`：该次尝试观察到的失败；不会为 null。
     * 返回：等待时长；策略放弃时返回 empty。
     * 异常：`attempt` 小于 1 时抛出 IllegalArgumentException。
     */
    Optional<Duration> nextDelay(int attempt, Throwable cause) {
        // A rejected payload is permanent: retrying it would spend the caller's quota on an
        // outcome that cannot change.
        //
        // 载荷被拒绝属于永久失败：重试只会为不可能改变的结果消耗调用方配额。
        if (cause instanceof RejectedException) {
            return Optional.empty();
        }
        // ...
    }
}
```

## 枚举与常量成员

具名成员构成的封闭集合适用与类型字段相同的规则，因为调用方会逐个点名这些成员。每个成员都要有自己的说明：

```ts
/**
 * Lifecycle of one upload.
 *
 * 单次上传的生命周期。
 */
enum UploadState {
  /**
   * No request in flight; submit stays enabled.
   *
   * 没有进行中的请求；提交保持可用。
   */
  Idle = "idle",
  /**
   * Request in flight; submit is disabled until this clears.
   *
   * 请求进行中；在结束前禁用提交。
   */
  Submitting = "submitting",
  /**
   * Terminal failure; the last input is preserved so the user can retry.
   *
   * 终态失败；保留上次输入以便重试。
   */
  Failed = "failed",
}
```

```java
/**
 * Outcome the retry policy returns.
 *
 * 重试策略返回的结果。
 */
enum RetryDecision {
    /**
     * Another attempt is allowed; wait for the returned duration.
     *
     * 允许再试一次；等待返回的时长。
     */
    RETRY,
    /**
     * The failure is permanent and must reach the caller unchanged.
     *
     * 失败是永久的，必须按原样上报调用方。
     */
    GIVE_UP,
}
```

## 常量与查找表

查找表同样是成员集合：每个键都要有说明，并写明这张表以什么为键。

```ts
/**
 * User-facing copy per error code; keys match the codes the client emits.
 *
 * 每个错误码对应的用户可见文案；键与客户端发出的错误码一致。
 */
const ERROR_MESSAGE: Record<string, string> = {
  /**
   * The endpoint rejected the payload; not retried.
   *
   * 端点拒绝了载荷；不重试。
   */
  rejected: "The server rejected this upload.",
  /**
   * The endpoint was temporarily unavailable; safe to retry.
   *
   * 端点暂时不可用；可以安全重试。
   */
  unavailable: "The server is busy; try again.",
  /**
   * The checksum did not match; a retry needs a new artifact.
   *
   * 校验和不匹配；重试需要新的产物。
   */
  checksum_mismatch: "The file changed during upload.",
};
```

## 单语模式

`AGENTS.md` 规则未说明时只写一种语言。简单的类型摘要或字段注释保持一行，但每个字段仍然要有自己的说明：

```ts
/** Limits applied to one upload. */
interface UploadOptions {
  /** Per-request chunk ceiling in bytes. */
  chunkSizeBytes: number;
  /** Retries after the first failure; `0` disables retrying. */
  maxRetries: number;
}
```

## 不要这样写

只写了第二个字段，第一个没有覆盖：

```ts
/** Limits applied to one upload. */
interface UploadOptions {
  chunkSizeBytes: number;
  /** Retries after the first failure; `0` disables retrying. */
  maxRetries: number;
}
```

行尾 `//` 不会出现在编辑器提示里。函数体内的说明用 `//` 是对的，但要被提示的成员需要 `/** ... */`：

```ts
interface UploadLimits {
  chunkSizeBytes: number; // per-request ceiling in bytes, hover shows nothing
}
```

注释只复述了签名，审查者得不到任何信息：

```ts
/** Sets the timeout in milliseconds. */
setTimeoutMs(ms: number) { /* ... */ }
```

这是把变更日志写进文档注释；文件头部不是历史记录：

```ts
/** Fixes #412 (2024-03-11). Sends one request. */
send() { /* ... */ }
```
