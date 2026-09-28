# HTML / XML comment examples (`<!-- ... -->`)

HTML and XML have no signatures, and markup cannot attach a comment to a single attribute. Put a file
comment at the top, describe placement and purpose next to the element, and give every attribute its own
description in the owning JSON Schema, OpenAPI, or XSD document—that is where per-member coverage happens.

Markup has no doc-comment form and editor hover does not surface `<!-- ... -->`, so these comments are
written for readers of the source; keep them short and factual.

In bilingual mode every comment below holds the complete English text, one blank line, and the complete
localized text. A schema `description` is a single string, so that is the one place where both languages
share one value, separated by an em dash.

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

The attributes themselves are documented where they can be described one by one. Three attributes, three
descriptions:

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

## Monolingual mode

When `AGENTS.md` is silent, write one language only:

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

## Do not write

The element name already says this, so the comment adds nothing:

```html
<!-- Header -->
<header>
```

One comment cannot cover three attributes, and it names none of their constraints; document them one by
one in the schema instead:

```xml
<!-- Request configuration. -->
<request timeoutMs="1000" retries="0" jitterRatio="0.2" />
```
