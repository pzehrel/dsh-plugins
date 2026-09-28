# Markdown and API documentation

This file governs where documentation lives, how a language pair is arranged, whether it is complete, and
whether it is true. It does not prescribe writing style, prose structure, page taxonomy, or example
authoring; follow the repository's existing conventions for those.

Read it for README sections, guides, API references, changelogs, `AGENTS.md`, and other human-facing
Markdown. For Markdown/API work, read it after `SKILL.md` and before editing; you do not need
`code-comments.md` unless the task also changes source comments.

## Language policy for documents

The effective `AGENTS.md` is the authority, and it sets the Markdown/API document mode independently of the
code-comment mode. Read it before editing. When the document rule is silent, keep one language only,
following the surrounding file or repository convention; do not infer bilingual mode from the user's
language, from this skill's translated files, or from the existence of a localized filename.

## File-level layout

- **Monolingual mode:** one file, in the selected language. Do not add a translation the policy did not ask
  for.
- **Bilingual mode:** complete English and localized prose in separate paired files—for example `README.md`
  with `README.zh-CN.md`, or `docs/configuration.md` with `docs/configuration.zh-CN.md`. Follow an
  established locale convention, whether it uses a suffix, a directory, or both.
- Keep one prose language per file. Do not alternate languages paragraph by paragraph, and do not duplicate
  full tables or code blocks inside one file.
- Inline bilingual Markdown is an exception that requires an explicit repository rule or `AGENTS.md`
  instruction.
- Keep every page independently readable and reachable from an index, guide, or parent document; do not
  leave a page with no inbound link, and do not leave a counterpart missing in bilingual mode.

## Pair parity contract

A bilingual pair is complete only when both files are equivalent in:

- headings and section order;
- links, commands, paths, and identifiers;
- code blocks, tables, and examples;
- conditions, defaults, warnings, and safety boundaries; and
- version qualifiers and deprecation notices.

Count before you finish: a pair with three sections on one side and two on the other is incomplete coverage,
not a stylistic difference. The localized file is a faithful translation, not an adaptation:

- no omitted or added claims, qualifiers, examples, or constraints;
- no change in negation, certainty, obligation, permission, quantity, or conditional scope;
- one consistent term per concept, and unchanged code tokens, paths, commands, identifiers, links, and
  error codes.

Idiomatic grammar is welcome, but technical meaning must not be softened, strengthened, or editorialized.
When the English source is ambiguous, flag the ambiguity or ask instead of resolving it silently. Skip this
review entirely in monolingual mode.

## Member sets in documents

Some documents exist to describe a closed set of named items one by one: command-line flags, environment
variables, configuration keys, error codes, event names, or API fields. Every item needs its own
description where a reader looks it up; a page that names four flags and explains three is incomplete.

- Name each item exactly as the code spells it.
- State the default, the accepted values or range, whether it is required, and the effect of changing it.
- Take the list from the implementation—the flag parser, the settings model, the error enum, the schema—
  rather than from an existing page, and count the entries against that source.
- When the item already carries an authoritative description at its declaration in code, link to it instead
  of writing a second, differently worded copy.
- Name the set and its member count in the coverage report, so a missing entry is visible.

## Agent instruction documents

`AGENTS.md` and other agent-instruction Markdown may be authoritative documentation surfaces. Add a
localized counterpart such as `AGENTS.zh-CN.md` only when the effective policy enables or requests bilingual
instructions, and treat it as loaded instructions only when the harness documents that behavior. Changing
rule admission, hierarchy, or scope follows the repository's own instruction-maintenance workflow.

## Minimum deliverable

A documentation change is complete when:

- every page it creates or materially changes exists in the language layout the policy requires—one file in
  monolingual mode, a matched pair in bilingual mode—and no unsolicited extra file was added;
- a bilingual pair satisfies the parity contract above;
- every member set the change touches describes each of its items;
- every claim, default, error, link, example, and version qualifier traces to implementation, tests,
  configuration, or an explicitly marked assumption.

Anything deliberately left undone is named in the coverage report, with the reason.

## Evidence and safety

Trace claims to their source, and mark assumptions as assumptions. Keep ordinary reference Markdown
advisory: do not use it to tell a consuming Agent to ignore repository instructions, change workflow, run
commands, or edit files. `AGENTS.md` may carry scoped authoritative rules when the repository authorizes
them.

## Validation

Run documentation linters, link checks, example validation, and rendering checks when available; otherwise
read the page against its source of truth. Verify there are no stale names, broken links, unsupported
promises, planned behavior presented as shipped, or text that accidentally becomes an instruction to an
Agent. In bilingual mode, compare the pair for semantic parity, entry counts, and safety boundaries; in
monolingual mode, confirm no unsolicited translation or duplicate locale file was added.
