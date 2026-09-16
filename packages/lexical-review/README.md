# lexical-review

See the [proposal behavior contract](../../docs/proposal-behavior.md) for proposal
kinds, identity-preserving edits, cancellation, and resolution. This guide
provides API usage and integration details.

## Installation

```bash
npm install lexical-review \
  'lexical@>=0.47.0 <0.51.0' \
  '@lexical/react@>=0.47.0 <0.51.0' \
  '@lexical/clipboard@>=0.47.0 <0.51.0' \
  '@lexical/utils@>=0.47.0 <0.51.0' \
  react react-dom
```

## Compatibility

The package declares Lexical peer compatibility `>=0.47.0 <0.51.0`.
`lexical`, `@lexical/react`, `@lexical/clipboard`, and `@lexical/utils` must
be installed at the same version within that range.

The package declares React peer compatibility for React 18 and React 19, and
`react` and `react-dom` must use the same version. CI exercises the supported
Lexical minors and browser boundary scenarios in Chromium, Firefox, and
Playwright WebKit. Playwright WebKit results do not certify native Safari or
iOS Safari.

## Entrypoints

- React-free core entrypoint: `import { ReviewInsertionNode } from "lexical-review"`.
- Client/editor integration is available through the v3 session registration.

Core nodes, helpers, and types are exported only from the root entrypoint. The root entrypoint does not import React or `@lexical/react`, so it is suitable for server-side model and serialization code; DOM rendering and editor registration require a client environment.

### Version 3 review-session authoring

The React-free root validates and opens a native version 3 review document
against a Lexical editor. Opening validates before installing any state. The
session reads and updates the current Lexical `EditorState`; it does not keep a
parallel authoritative snapshot. Live pending proposals are represented
directly by proposal-bearing Lexical nodes and remain editable in place. There
is no identityless draft or proposal-finalization phase.

Native serialization preserves the current pending proposal-bearing nodes
directly. A serialized value is a snapshot, and a successor native document
contains pending proposals only; accepted or rejected proposals are not kept as
resolution history. Accepted-state targets and payloads are derived when a
serialized native document crosses the WER adapter boundary, not maintained as
live coordinates for ordinary editing.

The v3 client route registers the session against the live Lexical tree:

```tsx
import { ReviewSessionPlugin } from "lexical-review/client";

<ReviewSessionPlugin session={session} />;
```

It keeps accepted-side and proposal-side targeting distinct, edits compatible
pending insertion, deletion, replacement, and formatting proposals in place, and reports ambiguous, mixed, and
structurally unsafe targets as no-mutation refusals. The lower-level
`registerReviewSession` export is available for hosts that do not use React.
The session must be registered with the same Lexical editor that opened it.

### Pending insertion proposals

Use the same root operations as the client command route inside a Lexical
update. Identity is assigned on creation and remains stable while content is
continued or corrected:

```ts
import {
  $insertReviewText,
  $inspectReviewProposal,
  $resolveReviewProposal,
} from "lexical-review";

editor.update(() => {
  const outcome = $insertReviewText("new text", {
    proposalIdFactory: () => crypto.randomUUID(),
  });
  // Handle changed, unchanged, or refused outcomes.
});

editor.getEditorState().read(() => $inspectReviewProposal(proposalId));
// Returns { kind: "insertion", proposal: { proposalId, text } }.
editor.update(() => $resolveReviewProposal(proposalId, "accept"));
// Alternatively: "reject" or "remove", each inside editor.update().
```

Inspection and resolution share one interface across every proposal kind.
`$inspectReviewProposal(proposalId)` returns a kind-tagged proposal
(`insertion`, `deletion`, `replacement`, `formatting`, `structure`, or
`fragment`); `$resolveReviewProposal(proposalId, action)` settles one
identity; `$resolveReviewProposals(ids, action)` validates a batch before
mutation and resolves each identity once.

The identity factory is optional; the package generates identities by default.
Client hosts can pass the same `proposalIdFactory` to `registerReviewSession`
or `ReviewSessionPlugin`. Duplicate or invalid identities, factory failures,
and unsupported targets are refused before mutation. Unexpected implementation
errors propagate to Lexical's update error handling and rollback; do not catch
and swallow them inside the update callback.

Insertion content remains editable under its proposal ID. See the behavior
contract for [typing and formatting continuation](../../docs/proposal-behavior.md#typing-and-inline-formatting),
[selected-range corrections](../../docs/proposal-behavior.md#selected-range-replacement-and-deletion),
and [resolution effects](../../docs/proposal-behavior.md#proposal-kinds-and-resolution).
Resolution refuses missing, disconnected, or structurally unsupported identities.

## Pending deletion authoring

Inside `editor.update()`, call `$deleteReviewText(backward, options)` to delete
at the current selection. The optional `granularity` is `"character"` (default)
or `"word"`; a nonempty selection always supplies the explicit range. The client
registration handles Backspace, Delete, word deletion, and range removal through
the same operation. Word deletion consumes adjacent whitespace and one Unicode
letter/number/mark or punctuation run, bounded by accepted text or one proposal.

Deletion can create pending work or correct an existing proposal, depending on
the target. The behavior contract defines [selected-range deletion](../../docs/proposal-behavior.md#selected-range-replacement-and-deletion)
and [collapsed Backspace/Delete](../../docs/proposal-behavior.md#collapsed-backspace-and-delete),
including continuation, neighbor targeting, caret placement, and repeated keys.

`$inspectReviewProposal(proposalId)` reads current node content inside an editor
read/update, tagged with `kind: "deletion"`. Use `$resolveReviewProposal` for the
[standard resolution actions](../../docs/proposal-behavior.md#proposal-kinds-and-resolution).

## Pending replacement proposals

Selecting accepted text in one paragraph and calling `$insertReviewText("new")`
creates a replacement. `$replaceReviewText("new")` also supports this operation;
an empty string applies deletion semantics, and a collapsed selection with
nonempty text applies insertion semantics. Native typing and controlled
`insertReplacementText` input use the same authoring operations.

A replacement has a `review-deletion` side followed by a `review-insertion`
side with one shared `proposalId`. Each side contains nonempty text. Split
same-type wrappers can normalize within a side. Every occurrence of an identity
must form one contiguous group in one paragraph; accepted text, other proposals,
reversed sides, nested content, and fragments cannot divide the group.

The old and new sides form one review decision. See the behavior contract for
[selected-range corrections](../../docs/proposal-behavior.md#selected-range-replacement-and-deletion)
and [directional deletion at either side or their seam](../../docs/proposal-behavior.md#collapsed-backspace-and-delete).

`$inspectReviewProposal(proposalId)` returns `kind: "replacement"` with `oldText`
and `newText` from the live nodes. Resolve the whole replacement with
`$resolveReviewProposal`, or include its ID in `$resolveReviewProposals` for a
batch. See [resolution effects](../../docs/proposal-behavior.md#proposal-kinds-and-resolution).

Through a registered session, the same settlement is available as
`RESOLVE_REVIEW_PROPOSALS_COMMAND` from `lexical-review/client` with payload
`{ ids, action }`: it forwards to `$resolveReviewProposals` unchanged and
reports the outcome via `onOutcome`, adding routing and claiming only.

To reproduce in the browser fixture, open `/?insertions`, select `AB`, and type
`new`. The editor displays `<del>AB</del><ins>new</ins>`. Select all of `new` and
press Backspace: the editor restores `AB` without either review wrapper.

Please visit the [homepage](https://github.com/mahendrimd/lexical-review).

## Rendering contract

For inserted and deleted text, the review marker is always the outermost DOM
element. Lexical formatting and inline styles are nested inside the marker,
for example: `<ins><strong>inserted text</strong></ins>`.

### Pending formatting proposals

Register `ReviewFormattingNode` alongside `ReviewInsertionNode` and
`ReviewDeletionNode` to author and reopen pending formatting proposals.
Formatting accepted text creates one independently reviewable proposal. Its
wrapper retains the accepted formatting runs, while its text children carry the
current proposed formatting. The text itself remains unchanged.

```ts
import {
  $setReviewFormatting,
  $toggleReviewFormatting,
  $inspectReviewProposal,
  $resolveReviewProposal,
} from "lexical-review";

editor.update(() => {
  // Apply explicit values to the current selection in one proposal.
  const outcome = $setReviewFormatting({ bold: true, italic: false });
});
```

The supported properties are `bold`, `italic`, `underline`, and `strikethrough`.
`$toggleReviewFormatting(property)` removes the property when all selected text
has it, and applies it otherwise. Explicit values that already match are no-ops:
they do not split text or allocate identity. Creation preserves the selected
text endpoints and forward/backward orientation.

For edits to existing proposals and unsupported selections, see
[formatting existing content](../../docs/proposal-behavior.md#formatting-existing-content).
For collapsed toggles and formatting used by subsequent typing, see
[typing and inline formatting](../../docs/proposal-behavior.md#typing-and-inline-formatting).

`registerReviewSession` routes `FORMAT_TEXT_COMMAND`, `SET_TEXT_FORMAT_COMMAND`,
and the supported native formatting `beforeinput` intentions through the same
operations. Outcomes are delivered through `onOutcome`. Inspection reads the
current state, tagged with `kind: "formatting"`. The [rendering contract](#rendering-contract)
also applies to formatted text.

### Pending paragraph boundaries

Register `ReviewBoundaryNode` alongside the text proposal nodes to author and
reopen pending splits and merges. A boundary owns a structural change, not a
snapshot of its surrounding text. A split marker is the first child of its
right paragraph; a merge marker remains inline in the proposed joined
paragraph. Both serialize their stable proposal identity and empty-side
formatting defaults directly in the current tree.

Inside `editor.update()`, use `$splitReviewParagraph(options)` at a collapsed
caret or `$mergeReviewParagraph(backward, options)` at the beginning (`true`)
or end (`false`) of a paragraph. The client routes Enter and character
Backspace/Delete at paragraph boundaries through these operations. Shift+Enter,
Enter over a range, splits inside text proposals, and ambiguous targets are
no-mutation refusals. An unambiguous endpoint of a whole text proposal is a
supported split point; neither side of a replacement may be separated.

Use `$inspectReviewProposal(proposalId)` to read the current kind and identity
(`kind: "structure"`). `$resolveReviewProposal(proposalId, action)`
also runs inside an editor update. `$resolveReviewProposals` includes structural
identities in its batch preflight. Structural changes and resolution are refused
during composition. Unexpected implementation errors use Lexical's transaction
rollback, as with text authoring.

A pending merge displays `¶` inside `<del data-review-boundary="merge">`.
Typing before the marker belongs to the original left paragraph; typing after
it belongs to the original right paragraph. Unmodified left/right arrow keys
cross the marker explicitly, including between empty sides. Input formatting
comes from the corresponding adjacent content, falling back to that side's
saved paragraph formatting when empty. A local formatting toggle overrides it.
The behavior contract defines the [gestures that cancel pending boundaries](../../docs/proposal-behavior.md#paragraph-boundaries).

Repeated splits retain separate identities: splitting `abcdef` after `b` and
then `d` gives `ab | cd | ef`. Rejecting the first split leaves `abcd | ef`;
rejecting the second leaves `ab | cdef`. Empty paragraphs also represent real
boundary changes. Chained pending merges and split/merge combinations are
initially refused, except exact cancellation. Text ranges cannot cross a
pending merge marker, since that would lose their original-side attachment.

For a browser reproduction, run the E2E fixture server and open `/?structure`.
Split `Hello world` before `world`, type in the new paragraph, and reject the
split through the fixture's `settle` helper: the text proposal survives in the
rejoined paragraph. `/?structure&empty` exercises empty sides and formatting.

## Atomic document-fragment insertion

Register `ReviewFragmentNode`, `ReviewInsertionNode`, and `ReviewBoundaryNode`
alongside the other proposal nodes. Within a Lexical update,
`$insertReviewFragment(paragraphs, options)` inserts normalized content:

```ts
$insertReviewFragment([
  { runs: [{ text: "x", format: 1 }] },
  { runs: [{ text: "y", format: 0 }] },
]);
```

At the caret in `A|B`, this produces `Ax` / `yB`. At the end of paragraph `A`
before a separate paragraph `B`, it produces `Ax` / `y` / `B`. One proposal ID
owns the inserted text and introduced boundaries; accepted prefixes and suffixes
remain independent. Each `ReviewFragmentNode` is an inline, paragraph-local
component. The first has `startsParagraph: false`; each later component owns the
boundary before its paragraph with `startsParagraph: true`. Empty components are
meaningful. Import validates contiguous attachment and forbids mixed shared IDs,
intervening accepted content, and disconnected components.

Input is an ordered array of `{ runs, emptyFormat? }` paragraphs. Runs carry exact
text and the supported format bitmask (bold 1, italic 2, strikethrough 4,
underline 8). Embedded CR/LF characters are refused: callers supply boundaries
as array entries. Empty arrays of runs preserve empty paragraphs. An omitted
`emptyFormat` inherits the insertion caret's effective input format; an explicit
value overrides it. Within a nonempty component, text at the caret determines
inheritance, with an explicit local formatting choice taking precedence. An
accepted-side empty position falls back to its paragraph's text format when no
adjacent accepted text supplies a format.

Supported edits correct a fragment as one proposal. See the
[atomic fragment contract](../../docs/proposal-behavior.md#atomic-fragments) for
editing, normalization to another proposal kind, and removal, and the
[directional deletion rules](../../docs/proposal-behavior.md#collapsed-backspace-and-delete)
for its outer edges. Left/right arrows cross both outer associations explicitly,
including empty endpoints. After insertion, the caret is proposal-side
immediately after the new content.

Use `$inspectReviewProposal` or `$resolveReviewProposal` for whole-proposal
operations. Re-inspect after editing to read the current kind.

An independent split on accepted text may coexist with a fragment. For example,
split `ABCD` after `C`, then insert `x` / `y` after `A`: `Ax` / `yBC` / `D`.
Rejecting the split yields `Ax` / `yBCD` with the fragment intact. Rejecting the
fragment first yields `ABC` / `D` with the split intact. Paste at unresolved
structural markers and merge operations crossing fragment ownership are refused.

`createReviewPreview(document, "accepted-state" | "all-accepted")` resolves only
a detached copy and returns a validated content-only document. An indeterminate
all-accepted projection throws; the input and live editor remain unchanged.

The client exposes `INSERT_REVIEW_FRAGMENT_COMMAND` for already-normalized
content and routes ordinary typing, formatting, Enter, deletion, and endpoint
arrows through these same semantics. Ordinary copy/cut export content-only
`text/plain` and `text/html` projections without proposal identity
(`copyProjection: "all-accepted"` by default, `"accepted-state"` opt-in);
cut preflights its follow-up deletion before touching the clipboard.
Clipboard MIME parsing prefers usable rich content with fallback to plain
text, and HTML soft breaks normalize to paragraph boundaries with conversion
reported (#66/#67). Ordinary paste and copy-style drop route through that
normalization into single-paragraph or atomic-fragment semantics. Untrusted
clipboard markup never confers proposal identity.

The separate `lexical-review-wer` package implements the current fragment's
mutation-free `unsupported` export boundary. It does not decompose the fragment.
The general WER mapping and portable identity profile remain #82/#69.

### Browser reproduction

Run `pnpm dev` for the regular demo, or start the test fixture server with
`pnpm --dir packages/demo exec vite --config e2e/vite.config.js --port 5174`.
Open `http://localhost:5174/?fragment` and, in the browser console, call
`window.__fragmentFixture.insert("x\ny")`. Type, press Enter and Backspace, and
use arrows at the fragment endpoints. Calling
`window.__fragmentFixture.settle("reject")` restores `AB` while preserving any
separate accepted-side text proposals. `snapshot()` exposes the current native
document and logical association. The fixture is an executable capability check,
not a required host UI.
