# HTML / XML 注释示例（`<!-- ... -->`）

HTML 和 XML 通常没有传统意义上的签名，而且标记语言无法把注释挂到单个属性上。在文件顶部放置文件注释，在元素旁说明位置和用途，并把每个属性各自的说明写进所属的 JSON Schema、OpenAPI 或 XSD 文档——按成员覆盖的要求在那里满足。

标记语言没有文档注释形式，编辑器悬停也不会展示 `<!-- ... -->`，因此这些注释是写给源码读者的；保持简短、只写事实。

双语模式下，下面每条注释都包含完整英语文本、一个空行和完整本地化文本。schema 的 `description` 是单个字符串，因此那是唯一让两种语言共处一个值的位置，用破折号分隔。

```html
<!-- Owns the request form and its submission state; network calls live in request-client.js.

     负责请求表单及其提交状态；网络请求位于 request-client.js。
-->
<form data-state="idle" aria-live="polite">
  <!-- data-state transitions: idle -> submitting -> (done | error).
       Only `submitting` disables submit; `error` keeps the last input so the user can retry.
       Unknown values are treated as `error`.

       data-state 的转换：idle -> submitting ->（done | error）。
       只有 `submitting` 会禁用提交；`error` 保留上次输入以便重试。
       未知值按 `error` 处理。 -->
  <button type="submit">Send</button>
</form>
```

```xml
<!-- Request configuration consumed by the worker; see request.schema.json for every attribute.

     定义 worker 使用的请求配置；每个属性的说明见 request.schema.json。
-->
<request timeoutMs="1000" retries="0" jitterRatio="0.2" />
```

属性本身在能够逐条说明的地方记录。三个属性，三条说明：

```json
{
  "$id": "request.schema.json",
  "type": "object",
  "properties": {
    "timeoutMs": {
      "type": "integer",
      "minimum": 0,
      "description": "Positive integer in milliseconds; 0 means no timeout. — 以毫秒为单位的正整数；0 表示不超时。"
    },
    "retries": {
      "type": "integer",
      "minimum": 0,
      "default": 0,
      "description": "Retries after the first failure. — 首次失败后的重试次数。"
    },
    "jitterRatio": {
      "type": "number",
      "minimum": 0,
      "maximum": 1,
      "description": "Fraction of the delay that is randomized. — 延迟中被随机化的比例。"
    }
  }
}
```

## 单语模式

`AGENTS.md` 未说明时只写一种语言：

```html
<!-- Owns the request form and its submission state. -->
<form data-state="idle">
  <!-- data-state transitions: idle -> submitting -> (done | error). -->
  <button type="submit">Send</button>
</form>
```

```json
{
  "properties": {
    "timeoutMs": { "type": "integer", "description": "Positive integer in milliseconds; 0 means no timeout." },
    "retries": { "type": "integer", "default": 0, "description": "Retries after the first failure." }
  }
}
```

## 不要这样写

元素名称已经说明了这一点，注释没有增加信息：

```html
<!-- Header -->
<header>
```

一条注释无法覆盖三个属性，也没有写出任何约束；请改在 schema 中逐个说明：

```xml
<!-- Request configuration. -->
<request timeoutMs="1000" retries="0" jitterRatio="0.2" />
```
