# Rustdoc comment examples (`//!` and `///`)

Use `//!` for a crate or module header and `///` for items and fields, including private ones that carry
an invariant. Describe parameters in `# Arguments`, failures in `# Errors`, and panics in `# Panics` when
the function can panic.

`///` is the form rustdoc and editor hover read; a `//` comment is not surfaced by either.

In bilingual mode every comment below holds the complete English block, one blank line, and the complete
localized block. The Monolingual mode section shows the same shapes in one language, where a simple
comment stays on a single line.

Form follows role. `///` documents an item, and rustdoc plus editor hover read it. Inside a function body
it documents nothing: rustc reports `unused doc comment` for `///` on a statement and suggests `//`, which
is the form every in-body note below uses.

```rust
//! Persists delivery receipts together with the retry state that produced them.
//!
//! 持久化投递回执，以及产生这些回执的重试状态。

use std::time::Duration;

/// Retry limits applied to one queue.
///
/// 应用于单个队列的重试限制。
pub struct RetryConfig {
    /// Maximum attempts per item, including the first.
    ///
    /// 每个条目的最大尝试次数（含首次）。
    pub max_attempts: u8,
    /// Backoff unit; attempt `n` waits `base * 2^(n-1)` before running.
    ///
    /// 退避基数；第 `n` 次尝试开始前等待 `base * 2^(n-1)`。
    pub base_delay: Duration,
    /// Fraction of the delay that is randomized, so replicas do not retry in lockstep.
    ///
    /// 延迟中被随机化的比例，避免各副本同步重试。
    pub jitter_ratio: f32,
    /// Status codes that are retried; every other failure is returned unchanged.
    ///
    /// 需要重试的状态码；其他失败按原样返回。
    pub retry_on: Vec<u16>,
}

/// Stores one receipt and returns the row id assigned by the database.
///
/// # Arguments
/// * `receipt` — Written verbatim; redaction is the caller's responsibility.
/// * `config` — Attempt limit consulted before the insert, not after a failure.
///
/// # Errors
/// Returns [`StoreError::Conflict`] when the receipt id already exists; that case is not retried.
/// Returns [`StoreError::Unavailable`] for a transient connection failure, which the caller may retry.
///
/// 存储一条回执，并返回数据库分配的行 id。
///
/// 参数：
/// * `receipt`：按原样写入；脱敏由调用方负责。
/// * `config`：在插入前查询的尝试上限，而不是失败之后再查询。
///
/// 错误：回执 id 已存在时返回 [`StoreError::Conflict`]，该情况不重试；
/// 瞬时连接失败返回 [`StoreError::Unavailable`]，调用方可以重试。
pub fn store(receipt: &Receipt, config: &RetryConfig) -> Result<RowId, StoreError> {
    // Truncate before hashing: the id must stay stable when producers differ in trailing
    // newlines, otherwise the same receipt is stored twice.
    //
    // 先截断再哈希：不同生产者的结尾换行不同时 id 必须保持稳定，
    // 否则同一条回执会被存储两次。
    let normalized = receipt.body.trim_end();
    // ...
}
```

`RetryConfig` has four fields and four `///` comments. The struct comment describes the container and does
not cover any individual field.

## Enum and constant members

Every variant of a consumer-visible enum carries its own `///`, for the same reason a struct field does:

```rust
/// Outcome the retry policy returns.
///
/// 重试策略返回的结果。
pub enum RetryDecision {
    /// Another attempt is allowed; wait for the returned duration before running it.
    ///
    /// 允许再试一次；运行前等待返回的时长。
    Retry,
    /// The failure is permanent and must reach the caller unchanged.
    ///
    /// 失败是永久的，必须按原样上报调用方。
    GiveUp,
}
```

## Monolingual mode

When `AGENTS.md` is silent, write one language only; every field still gets its own comment, and a simple
one stays on a single line:

```rust
/// Retry limits applied to one queue.
pub struct RetryConfig {
    /// Maximum attempts per item, including the first.
    pub max_attempts: u8,
    /// Fraction of the delay that is randomized, so replicas do not retry in lockstep.
    pub jitter_ratio: f32,
}
```

## Do not write

Only the first field is described, so the second is uncovered:

```rust
/// Retry limits applied to one queue.
pub struct RetryConfig {
    /// Maximum attempts per item, including the first.
    pub max_attempts: u8,
    pub jitter_ratio: f32,
}
```

A `//` note inside a body is the correct form, but a documented field needs `///`; `//` on a field reaches neither rustdoc nor editor hover:

```rust
pub struct UploadLimits {
    // per-request ceiling in bytes
    pub chunk_size_bytes: u64,
}
```

The comment only restates the signature, so a reviewer learns nothing:

```rust
/// Returns the id.
pub fn id(&self) -> RowId { self.id }
```

The comment is a changelog; the file header is not a history log:

```rust
/// v1.2.0 (2024-03-11): switched to exponential backoff.
pub fn store(receipt: &Receipt) -> Result<RowId, StoreError> { /* ... */ }
```
