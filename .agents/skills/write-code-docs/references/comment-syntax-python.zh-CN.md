# Python 注释和 docstring 示例

使用模块 docstring 作为文件头部，为字段使用 attribute docstring，并用 `Args`/`Returns`/`Raises` 章节记录可调用签名。

Python 没有 `/** ... */` 形式。attribute docstring——赋值语句下一行紧跟的字符串字面量——是工具能读取的字段形式；行尾 `#` 注释不会出现在编辑器悬停中。ruff 的 B018 显式豁免字符串字面量，因此这种写法不会触发无副作用表达式告警。Pylance 会为字段本身读取 attribute docstring，但尚未把它传播到生成的 `__init__` 参数上，因此悬停 dataclass 构造器时可能仍看不到说明。

双语模式下，下面每条注释或 docstring 都包含完整英语块、一个空行和完整本地化块。「单语模式」一节展示同样形态的单语写法：该模式下简单的 docstring 保持一行。

形式取决于职责。模块、类或函数 docstring 记录该对象，attribute docstring 记录字段。函数体内的代码说明使用 `#` 注释；下面函数体内的说明都用这种形式。

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

`RetryConfig` 有四个字段和四条 attribute docstring。类上的 docstring 描述的是容器，不算作任何单个字段的说明。

## 枚举与常量成员

同样的规则适用于封闭集合中的每个具名成员，而不只是类型字段：

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

## 查找表

dict 字面量没有文档注释位置，因此条目上的注释是唯一可用的形式；每个键仍然要有说明，并写明这张表以什么为键。

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

## 单语模式

`AGENTS.md` 未说明时只写一种语言。简单字段的 docstring 保持一行，但每个字段仍然要有自己的说明：

```python
@dataclass(frozen=True)
class RetryConfig:
    """Retry limits shared by every delivery in one queue."""

    max_attempts: int
    """Maximum attempts per item, including the first."""

    jitter_ratio: float
    """Fraction of the delay that is randomized, so clients do not retry in lockstep."""
```

## 不要这样写

只写了第一个字段，第二个没有覆盖：

```python
max_attempts: int
"""Maximum attempts per item, including the first."""
jitter_ratio: float
```

函数体内的 `#` 说明是正确的形式，但字段行尾的 `#` 不会出现在 Pylance 提示里：

```python
max_attempts: int  # includes the first attempt
```

注释只复述了签名：

```python
def name(self) -> str:
    """Returns the name."""
```

注释显然的控制流只会增加噪音，不提供信息：

```python
index = index + 1  # increment index
```
