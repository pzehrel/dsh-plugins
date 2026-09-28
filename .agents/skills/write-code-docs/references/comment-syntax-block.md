# Block documentation comments (`/** ... */`)

Use this reference when the target language uses block documentation comments with `/** ... */`.
TypeScript and JavaScript share the same JSDoc tags; Java uses the same delimiter with Javadoc tags and
different type syntax.

In bilingual mode every comment below contains the complete English block, one blank line, and the
complete localized block. The Monolingual mode section shows the same shapes in one language, where a
simple comment stays on a single line. A one-line `/** English — 中文 */` comment is not used: the
single-line form is reserved for monolingual mode.

Form follows role. `/** ... */` documents a declaration, which is what editor hover shows. Inside a
function or method body, explain the code with ordinary `//` comments; every implementation note in the
examples below uses that form.

## TypeScript / JavaScript — callable contract, every field, implementation reasoning

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

`UploadOptions` has three fields and three descriptions. A comment on the type describes the container and
does not substitute for a field description, and a field left without one is a coverage gap rather than a
stylistic choice. In plain JavaScript, keep the same per-field tags and move the types into them:
`@param {number} options.maxRetries`, `@param {number} [options.totalTimeoutMs]`.

## Java — class responsibility, every field, failure contract

Use Javadoc on the class, on fields, and on every `@param`, `@return`, and `@throws` entry. Keep the `*`
column aligned with the opening `/**`.

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

## Enum and constant members

A closed set of named members follows the same rule as type fields, because a caller names these members
individually. Every member carries its own description:

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

## Constant and lookup tables

A lookup table is a member set as well: document every key and say what the table is keyed by.

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

## Monolingual mode

When the `AGENTS.md` rule is silent, write one language only. A simple type summary or field stays on a
single line, and every field still carries its own description:

```ts
/** Limits applied to one upload. */
interface UploadOptions {
  /** Per-request chunk ceiling in bytes. */
  chunkSizeBytes: number;
  /** Retries after the first failure; `0` disables retrying. */
  maxRetries: number;
}
```

## Do not write

Only the second field is described, so the first is uncovered:

```ts
/** Limits applied to one upload. */
interface UploadOptions {
  chunkSizeBytes: number;
  /** Retries after the first failure; `0` disables retrying. */
  maxRetries: number;
}
```

A trailing `//` never reaches editor hover. `//` is the right form for a note inside a body, but a documented member needs `/** ... */`:

```ts
interface UploadLimits {
  chunkSizeBytes: number; // per-request ceiling in bytes, hover shows nothing
}
```

The comment only restates the signature, so a reviewer learns nothing:

```ts
/** Sets the timeout in milliseconds. */
setTimeoutMs(ms: number) { /* ... */ }
```

The comment is a changelog; a file header is not a history log:

```ts
/** Fixes #412 (2024-03-11). Sends one request. */
send() { /* ... */ }
```
