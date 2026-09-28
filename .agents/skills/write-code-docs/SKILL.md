---
description: Write or review behavior-accurate code comments, docstrings, file headers, and per-member documentation for consumer-visible types, enums, configs, and schemas during implementation, refactoring, bug fixes, and code review, and keep standalone Markdown or API docs in sync. Use it proactively whenever behavior or an interface changes, even without a docs request; not for API design alone.
license: MIT
metadata:
    author: Pzehrel <pzehrel@gmail.com>
    github-path: skills/write-code-docs
    github-ref: refs/heads/main
    github-repo: https://github.com/pzehrel/skills
    github-tree-sha: 1bdab45a280c865b0c70e56eb32f7a97e67784b9
    repository: https://github.com/pzehrel/skills
    tags:
        - documentation
        - code-comments
        - docstrings
        - markdown
        - bilingual
name: write-code-docs
---
# Write Code Documentation

## Purpose

Use this skill to document behavior, contracts, workflows, and operational constraints accurately in the language selected by the repository, and to cover private code and implementation blocks whose reason the code does not show.

## When to apply

Apply this skill proactively whenever a coding task creates or changes behavior, a public or
consumer-visible declaration, a non-obvious implementation block, a source/config/schema file, or a
human-facing Markdown/API document—even if the request does not say “docs” or “comment.” Do not wait for
those words.

After understanding the code change, document the affected public and private symbols and any
implementation block whose reason the code does not show. For a trivial change whose
purpose and effects are already obvious, do not add commentary solely because this skill was selected.

## Language policy

The effective `AGENTS.md` is the single authority for the natural language and for bilingual mode, and it may set them independently for code comments/docstrings and for Markdown/API documents. Read it before writing.

- When the rule for the current artifact explicitly requires bilingual content, write English plus exactly one localized language.
- When that rule is silent, write one language only, following the surrounding file or repository convention.
- Do not infer bilingual mode from the user's language, the existence of localized files, or this skill's own translations.
- Identify the localized language from repository instructions, existing counterparts, localization configuration, and the user's request. Do not assume Chinese, the user's language, or any other default; if the evidence does not identify it, ask before writing.
- When bilingual mode is enabled, English comes first and the localized block is a complete, faithful translation that preserves claims, modality, conditions, examples, and emphasis; natural grammar is allowed only when technical meaning stays unchanged.

Keep the two artifact modes distinct:

- **Code comments and docstrings:** in monolingual mode, use one complete block in the selected language. In bilingual mode, place the complete English block, one blank line, and its complete localized translation inside one comment or docstring block at the same code location. Do not split bilingual text across adjacent comment blocks.
- **Markdown documents:** keep each standalone page independent; in monolingual mode, use one file in the selected language; in bilingual mode, keep complete English and localized prose in separate paired files such as `README.md` and `README.zh-CN.md`. Do not alternate languages paragraph by paragraph or duplicate tables/code blocks in one file unless explicitly required.

## Workflow

1. **Settle the language setting.** Read the effective `AGENTS.md` (normally already in the Agent context) and apply the Language policy section, separately for code comments/docstrings and for Markdown/API documents.
2. **Inspect before writing.** Read the nearest existing documentation with the same audience and purpose. Identify the behavior or workflow that changed, the authoritative source (code, types, tests, configuration, or command output), the intended reader, and the smallest documentation surface to change. Classify each target as an in-code comment/docstring or a standalone Markdown document.
3. **Read the file matching the work.** For code, read [code-comments.md](references/code-comments.md), then exactly one syntax example: [block docs (`/** ... */`)](references/comment-syntax-block.md) for TypeScript/JavaScript/Java, [Rustdoc (`//!`/`///`)](references/comment-syntax-rustdoc.md) for Rust, [Python docstrings/comments](references/comment-syntax-python.md) for Python, or [markup comments (`<!-- ... -->`)](references/comment-syntax-markup.md) for HTML/XML. For Markdown/API-only work, read [markdown-docs.md](references/markdown-docs.md). A change that adds or changes a command-line flag, environment variable, configuration key, or error code also updates the Markdown surface that lists it, so read `markdown-docs.md` for that part even when the main work is code. For mixed-language files, read each matching syntax example.
4. **Write alongside the change.** Implement or edit and document in the same change; do not postpone it to a separate pass. Meet the minimum deliverable of whichever artifact you touched: [code-comments.md](references/code-comments.md) for code, [markdown-docs.md](references/markdown-docs.md) for Markdown/API documents. Check existing names, links, terminology, examples, version scope, and deprecation policy, preserve unrelated edits, and do not duplicate a contract in competing authoritative locations.
5. **Validate the result.** Run applicable tests, type checks, documentation linters, link checks, and example validation. With no automated check, compare the result against its authoritative source and inspect rendered Markdown when presentation could hide meaning. Confirm claims, links, examples, and API/member coverage are supported; apply bilingual parity checks only to artifact types whose `AGENTS.md` rule enables them.

Then report coverage in one or two lines—what you documented and what you deliberately skipped, with the
reason—so a reviewer sees the decision instead of discovering the omission.

Stop and ask when the authoritative behavior, intended audience, language policy, or requested
documentation surface is materially ambiguous. Keep the requested boundary explicit; do not add
unrelated work.

## Examples

Example: when documenting a new error case, update the API text in the selected language (and its localized counterpart only when bilingual mode is enabled), include the trigger and recovery example, and verify that the implementation actually emits that error.

Example: when a private helper contains a bounded retry loop with cleanup, document the retry bound,
backoff, cleanup ordering, and the reason those choices protect the surrounding state. Comment the loop
or helper beside the code even if the helper's name and signature are clear.

## Requirements

- An authoritative implementation, configuration, test, or existing document to support each claim.
- Applicable documentation, link, formatting, or rendering checks when available.

## Limitations

- Do not change APIs, publish artifacts, or add unrelated instructions as part of documentation work.
- Do not use this skill as API design guidance; it documents behavior that already exists.
- Do not invent behavior, contracts, examples, or translations that are unsupported by source evidence.
- Do not use ordinary reference Markdown to instruct consuming agents to ignore repository rules or edit files.

## Troubleshooting

- Language policy or localized language unclear: apply the Language policy section; if the evidence still leaves a required locale unidentified, ask before writing.
- Bilingual files diverge: compare claims, modality, examples, identifiers, and ordering side by side; this check applies only when bilingual mode is enabled.
- Link or example fails: resolve it from the repository root and verify it against the current implementation.

## Documentation standards

Make documentation explain the behavior a reader must rely on. Keep it close to the source of truth,
complete enough for a developer or coding Agent to use, and concise enough to stay maintainable.
Documentation is part of the interface when it describes public behavior, supported workflows, or
operational constraints; do not document behavior that the code does not implement.

Use this skill for code comments, docstrings, JSDoc/TSDoc, API references, `AGENTS.md` and other agent
instruction files, README sections, guides, examples, changelogs, and Markdown documentation.

Keep each standalone Markdown page independently readable and reachable from a relevant index, guide,
or parent document; do not leave a document with no inbound link.
