# Code comments and docstrings

Read this file for source-code comments, module/file headers, docstrings, JSDoc/TSDoc, and
language-specific callable or field comments. Apply the code-comment language setting from the effective
`AGENTS.md` independently of the Markdown/API document setting: when explicitly enabled, write English
plus exactly one localized language; when silent, write one language only. Read it when the task changes
source code: after `SKILL.md` and before editing, then read the one comment-syntax example file that
matches the current source language.

## Minimum deliverable

A code change under this skill is not complete until each item below either has a comment or a stated
reason to skip it:

- every callable you added or changed that a consumer can reach: parameters, return value, and failure behavior
- every member you added or changed in a consumer-visible set: type or class fields, enum members, map keys,
  destructured parameters, schema columns, configuration keys, error codes
- every implementation block whose reason is not visible from the code: retry and backoff bounds, cleanup
  ordering, invariants, error translation, non-obvious constants, compatibility shims, security or
  performance constraints
- the file header, when you created the file or materially changed its responsibility

A comment that only restates the declaration does not satisfy this; see Comment layout.

## Comment layout

- Keep every explanatory comment or docstring in one complete block in the selected language.
- Match the form to the reader. Use the doc-comment form for what a consumer reads from editor hover or
  generated docs—`/** ... */` for TypeScript/JavaScript/Java, `///` for Rust, an attribute docstring for
  Python. Use the ordinary line-comment form for implementation reasoning inside a function or method
  body—`//` for TypeScript/JavaScript/Java/Rust, `#` for Python. A doc comment inside a body documents
  nothing: rustc reports `unused doc comment` for `///` on a statement and suggests `//`.
- In bilingual mode, put the complete English block first—including the summary and all structured
  signature tags—then one blank line, then the complete localized block inside the same comment/docstring.
  Do not interleave languages or split them across adjacent comments. Do not duplicate structured tags
  merely to translate them; use a complete localized prose/list block after the English tags when the
  tool cannot represent two descriptions for one tag.
- Do not write a comment that only restates the declaration—its name, type, or parameter list.
  `/** Sets the timeout. */ setTimeout(ms: number)` tells a reader nothing the signature does not, and a
  reviewer learns nothing from it. Replace it with what the signature cannot express—units, defaults,
  accepted range, failure behavior, ordering—or delete it.
- Keep comments attached to the declaration or smallest implementation block they explain. Prefer one
  authoritative comment and link to deeper documentation when the explanation is large.
- Treat translation as a fidelity check only in bilingual mode; compare claims, modality, conditions,
  examples, terminology, and identifiers.

## File-level headers

When creating or materially changing a source, executable script, configuration, or schema file, add one
concise header in the selected language at the top of the file, before imports or declarations and after
required shebang, encoding, or license lines. In bilingual mode keep both language blocks in that same
header. State the file's responsibility, scope boundary, and—when not obvious—its main inputs, outputs,
integrations, side effects, or invariants. Keep the header stable and durable; it is not a changelog,
symbol index, or duplicate API reference. Skip generated/vendor files and files whose repository convention
forbids headers.

## Callable signature coverage

For every consumer-visible function, method, constructor, callback, command handler, or other callable,
document each parameter and the return value at the declaration. A summary, parameter name, or type
annotation alone is insufficient. For each parameter, explain its role, accepted shape or constraints,
optionality/nullability, default, units, ownership/mutability, and cancellation/timing behavior when
applicable. Explain the return value's meaning and shape, identity/ownership, sync/async behavior, side
effects, ordering, and failure or rejected-input behavior. Cover overload-specific differences, generic
relationships, and non-obvious private callables.

When structured tags are supported, use one unique entry per parameter, return value, and thrown error.
Write descriptions in the selected language. In bilingual mode, keep the complete English signature
section (including all tags) before the complete localized signature section; keep each parameter,
return, and error covered without interleaving languages or duplicating tags. For languages without tags, use the established docstring
`Args`/`Returns`/`Raises` sections or nearest equivalent.

Keep every comment attached to the declaration or usage it explains. JSDoc `@typedef` blocks are a
deliberate exception because the block itself declares a reusable type; use them only for types that are
actually referenced. For an object used by one callable, prefer nested parameter-property tags so each
field is visibly attached to the function signature.

## Member-set coverage

Some declarations are containers: a consumer reaches them through named members rather than through the
container itself. Treat every member as a separate documentation target and describe it at its own
declaration. This applies to any consumer-visible set, including:

- fields, properties, and members of an interface, type, record, dataclass, struct, or class
- enum members, string-literal union members, and the keys of an object-literal map or constant table
- parameters, including destructured or unpacked option objects
- columns of a database table or migration, and fields of a serialized payload
- attributes and elements declared by a schema
- command-line flags, environment variables, and configuration keys (documented in Markdown, not at a declaration; see [markdown-docs.md](markdown-docs.md))
- error codes, status codes, and event or message names

A container comment, a descriptive name, or a type annotation does not replace a member description, and a
member without one is uncovered. Cover each member's semantic role, optionality/nullability, defaults,
units/ranges, ownership/mutability, serialization/omission, lifecycle, compatibility, and relationships
with sibling members when applicable. Repeat the pass recursively for nested consumer-visible members.

Count before you finish: a set with four members and three descriptions has incomplete coverage—this is a
missing item, not a style choice. Document an optional member as optional, state the default when the
declaration does not carry it, and state the unit whenever the type alone does not: a bare `number`,
`int`, or `string` member is not self-explanatory. In markup, a comment cannot be attached to a single
attribute, so put one description per attribute in the owning JSON Schema, OpenAPI, or XSD document; that
is where the per-member requirement is satisfied.

Use the form the editor can read. Document a field or member with the language's doc-comment form rather
than a trailing line comment, because only the doc-comment form reaches editor hover: `/** ... */` for
TypeScript/JavaScript/Java, `///` for Rust, and an attribute docstring—a string literal on the line after
the assignment—for Python. A trailing `//`, `#`, or inline type comment is invisible to hover and does not
satisfy this coverage.

Keep a comment on one line only in monolingual mode, when the explanation is simple—for example
`/** Per-request chunk ceiling in bytes. */`. In bilingual mode always use the complete English block, one
blank line, and the complete localized block inside the same comment; do not compress both languages onto
one line with a separator. Expand to a longer block when constraints, defaults, relationships, or other
details do not fit. In markup,
`<!-- ... -->` beside the element is the only available form, and editor hover does not surface it; when a
schema owns the constraint, document it in the schema instead.

## Private and implementation coverage

Review private and internal code as well as exported symbols. Annotate an implementation block when its
reason is not visible from the code. Judge that against a reference reader: someone who knows the language
and the domain but not this code's history. Any one of these tests is enough to require a comment:

- **Reason test** — could that reader answer “why is it written this way?” from the code, its types, and
  the repository's public documents alone? If not, write it.
- **Change test** — if the line were replaced with a plausible equivalent, would behavior change
  silently, with no error and no failing test? If so, write it.
- **Expectation test** — does the block differ from the naive approach, by being more indirect, more
  conservative, or longer than it looks like it needs to be? If so, write why.

Do not use size as the criterion. Line count, nesting depth, and cyclomatic complexity both over-fire—a
long, linear lookup table needs nothing—and under-fire, because one unexplained constant can be the
riskiest line in the file. A single-line backoff constant and a bounded retry loop with cleanup are the
same case here.

Situations that pass these tests most often, and what the comment has to state:

- a tuned threshold or magic number — why this value, and what breaks at another value
- an ordering that cannot be rearranged — what happens if it is
- a workaround for an upstream behavior or defect — what it works around
- code that looks simplifiable but is not — why the simpler form fails
- an error that is swallowed, translated, or retried — what that means for the caller
- concurrency, retry, cancellation, or cleanup — the bound, the ordering, and the state it protects

Skip trivial wrappers, direct assignments, and obvious control flow. Perform an exported/private coverage
pass, then a reason pass over implementation bodies.

## Choosing the syntax example

After this file, read only the syntax example needed for the source file:

- [Block docs (`/** ... */`)](comment-syntax-block.md) for TypeScript, JavaScript, or Java
- [Rustdoc (`//!`/`///`)](comment-syntax-rustdoc.md) for Rust
- [Python docstrings/comments](comment-syntax-python.md) for Python
- [Markup comments (`<!-- ... -->`)](comment-syntax-markup.md) for HTML or XML

For mixed-language or unsupported formats, use the nearest language/tool syntax and preserve the same
semantic coverage and `AGENTS.md` policy.

## Validation

Verify every comment claim against implementation, types, tests, configuration, or an explicit assumption.
Confirm every consumer-visible callable has parameter/return/failure coverage and every consumer-visible
member set describes each of its members. In bilingual mode, check both language blocks for semantic parity;
otherwise ensure no unsolicited translation was added. Run language formatters, linters, type checks, or
documentation tooling when available.

## Report coverage

Close the change with one or two lines naming what you documented and what you deliberately skipped, with
the reason—for example: “Documented: `upload` contract, `UploadOptions.chunkSizeBytes` units, retry
backoff. Skipped: `normalizeName` (trivial passthrough).” Report this in your response, not as a comment
in the source. It keeps the coverage decision visible to a reviewer instead of hidden in the diff.
