# Python comment and docstring examples

Use a module docstring for the file header, an attribute docstring for fields, and
`Args`/`Returns`/`Raises` sections for callable signatures.

Python has no `/** ... */` form. An attribute docstring—a string literal on the line after the
assignment—is the field form that tooling can read; a trailing `#` comment is not surfaced by editor
hover. Ruff's B018 ignores string literals, so this form does not trip a useless-expression lint. Pylance
reads the attribute docstring for the field itself but does not yet propagate it to the parameters of a
generated `__init__`, so hovering the dataclass constructor may still show nothing.

In bilingual mode every comment or docstring below holds the complete English block, one blank line, and
the complete localized block. The Monolingual mode section shows the same shapes in one language, where a
simple docstring stays on a single line.

Form follows role. A module, class, or function docstring documents that object, and an attribute
docstring documents a field. Inside a function body, explain the code with `#` comments; every in-body
note below uses that form.

```python
"""Validates and normalizes inbound webhook payloads; it does not persist them.

校验并规范化入站 webhook 载荷；本模块不做持久化。
"""

import json
from dataclasses import dataclass
from typing import Any


@dataclass(frozen=True)
class RetryConfig:
    """Retry limits shared by every delivery in one queue.

    单个队列中每次投递共用的重试限制。
    """

    max_attempts: int
    """Maximum attempts per item, including the first.

    每个条目的最大尝试次数（含首次）。
    """

    base_delay_s: float
    """Backoff unit in seconds; attempt n waits ``base * 2**(n-1)``.

    退避基数（秒）；第 n 次等待 ``base * 2**(n-1)``。
    """

    jitter_ratio: float
    """Fraction of the delay that is randomized, so clients do not retry in lockstep.

    延迟中被随机化的比例，避免客户端同步重试。
    """

    retry_on: frozenset[int]
    """Status codes that are retried; every other failure surfaces immediately.

    需要重试的状态码；其他失败立即返回。
    """


def deliver(url: str, payload: dict[str, Any], config: RetryConfig) -> str:
    """Delivers one payload, retrying transient failures per ``config``.

    ``payload`` is serialized once and reused across attempts, so a retry never observes a
    partially updated mapping.

    Args:
        url: Already validated by the caller; redirects are not followed.
        payload: JSON-serializable body; nested values must stay unchanged for the whole call.
        config: Retry limits for this delivery; every field is documented on ``RetryConfig``.
    Returns:
        Delivery receipt id, stable across retries.
    Raises:
        DeliveryRejected: If the endpoint rejects the payload; that case is not retried.

    按 ``config`` 重试瞬时失败，投递一次载荷。

    ``payload`` 只序列化一次并在各次尝试间复用，因此重试不会看到被部分修改的映射。

    参数：
        url：已由调用方校验；不跟随重定向。
        payload：可 JSON 序列化的正文；整个调用期间嵌套值必须保持不变。
        config：本次投递的重试限制；每个字段都在 ``RetryConfig`` 上有说明。
    返回：投递回执 id，多次重试之间保持稳定。
    异常：端点拒绝载荷时抛出 DeliveryRejected，该情况不重试。
    """
    # Serialize once, before the loop: serializing per attempt would let a concurrent mutation
    # change the body mid-retry and produce a receipt for content that was never sent.
    #
    # 在循环前只序列化一次：每次尝试都重新序列化会让并发修改在重试中途改变正文，
    # 从而为从未发送过的内容生成回执。
    body = json.dumps(payload)
    for attempt in range(1, config.max_attempts + 1):
        ...
```

`RetryConfig` has four fields and four attribute docstrings. The class docstring describes the container;
it does not count as documentation for any individual field.

## Enum and constant members

The same rule applies to every named member of a closed set, not only to type fields:

```python
class DeliveryError(IntEnum):
    """Failure kinds returned to the caller; each member describes itself.

    返回给调用方的失败种类；每个成员各自说明。
    """

    REJECTED = 400
    """The endpoint rejected the payload; not retried.

    端点拒绝了载荷；不重试。
    """

    UNAVAILABLE = 503
    """The endpoint was temporarily unavailable; safe to retry.

    端点暂时不可用；可以安全重试。
    """
```

## Lookup tables

A dict literal has no doc-comment site, so a comment on the entry is the only form available; every key
still carries one, and the table states what it is keyed by.

```python
# User-facing copy per delivery failure, keyed by ``DeliveryError``.
#
# 每种投递失败对应的用户可见文案，以 ``DeliveryError`` 为键。
DELIVERY_MESSAGE: dict[DeliveryError, str] = {
    # The endpoint rejected the payload; not retried.
    #
    # 端点拒绝了载荷；不重试。
    DeliveryError.REJECTED: "The server rejected this delivery.",
    # The endpoint was temporarily unavailable; safe to retry.
    #
    # 端点暂时不可用；可以安全重试。
    DeliveryError.UNAVAILABLE: "The server is busy; try again.",
}
```

## Monolingual mode

When `AGENTS.md` is silent, write one language only. A simple field keeps its docstring on one line, and
every field still gets one:

```python
@dataclass(frozen=True)
class RetryConfig:
    """Retry limits shared by every delivery in one queue."""

    max_attempts: int
    """Maximum attempts per item, including the first."""

    jitter_ratio: float
    """Fraction of the delay that is randomized, so clients do not retry in lockstep."""
```

## Do not write

Only the first field is described, so the second is uncovered:

```python
max_attempts: int
"""Maximum attempts per item, including the first."""
jitter_ratio: float
```

A `#` note inside a body is the correct form, but a trailing `#` on a field is not surfaced by Pylance hover:

```python
max_attempts: int  # includes the first attempt
```

The comment only restates the signature:

```python
def name(self) -> str:
    """Returns the name."""
```

Commenting obvious control flow adds noise, not information:

```python
index = index + 1  # increment index
```
