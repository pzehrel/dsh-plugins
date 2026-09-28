# Rustdoc 注释示例（`//!` 和 `///`）

使用 `//!` 作为 crate 或模块头部，使用 `///` 记录项目和字段，包括带有不变量的私有项。用 `# Arguments` 说明参数，用 `# Errors` 说明失败行为，函数可能 panic 时用 `# Panics`。

`///` 是 rustdoc 和编辑器悬停能读取的形式；`//` 注释两者都不会展示。

双语模式下，下面每条注释都包含完整英语块、一个空行和完整本地化块。「单语模式」一节展示同样形态的单语写法：该模式下简单的注释保持一行。

形式取决于职责。`///` 用于项目文档，rustdoc 与编辑器悬停都会读取它。放进函数体则什么也不记录：对语句使用 `///` 时 rustc 会报 `unused doc comment` 并建议改用 `//`，下面所有函数体内的说明都用这种形式。

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

`RetryConfig` 有四个字段和四条 `///` 注释。结构体上的注释描述的是容器，不覆盖任何单个字段。

## 枚举与常量成员

消费者可见枚举的每个变体都要有自己的 `///`，理由与结构体字段相同：

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

## 单语模式

`AGENTS.md` 未说明时只写一种语言；每个字段仍然要有自己的注释，简单的注释保持一行：

```rust
/// Retry limits applied to one queue.
pub struct RetryConfig {
    /// Maximum attempts per item, including the first.
    pub max_attempts: u8,
    /// Fraction of the delay that is randomized, so replicas do not retry in lockstep.
    pub jitter_ratio: f32,
}
```

## 不要这样写

只写了第一个字段，第二个没有覆盖：

```rust
/// Retry limits applied to one queue.
pub struct RetryConfig {
    /// Maximum attempts per item, including the first.
    pub max_attempts: u8,
    pub jitter_ratio: f32,
}
```

函数体内的 `//` 说明是正确的形式，但要被记录的字段需要 `///`；字段上的 `//` 既进不了 rustdoc 也进不了悬停：

```rust
pub struct UploadLimits {
    // per-request ceiling in bytes
    pub chunk_size_bytes: u64,
}
```

注释只复述了签名，审查者得不到任何信息：

```rust
/// Returns the id.
pub fn id(&self) -> RowId { self.id }
```

这是把变更日志写进文档注释；文件头部不是历史记录：

```rust
/// v1.2.0 (2024-03-11): switched to exponential backoff.
pub fn store(receipt: &Receipt) -> Result<RowId, StoreError> { /* ... */ }
```
