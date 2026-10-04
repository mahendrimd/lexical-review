# lexical-review

Track-changes review mode for [Lexical](https://lexical.dev/). Author pending revision proposals, then accept, reject, or remove them independently.

[Try the live demo](https://mahendrimd.github.io/lexical-review/) · [View the npm package](https://www.npmjs.com/package/lexical-review) · [Report an issue](https://github.com/mahendrimd/lexical-review/issues)

For supported editing behavior, see the
[proposal behavior contract](https://github.com/mahendrimd/lexical-review/blob/main/docs/proposal-behavior.md).

## Installation

```bash
npm install lexical-review \
  'lexical@>=0.47.0 <0.53.0' \
  '@lexical/clipboard@>=0.47.0 <0.53.0' \
  '@lexical/extension@>=0.47.0 <0.53.0' \
  '@lexical/utils@>=0.47.0 <0.53.0'
```

Install all four Lexical peers at the same version within the declared range.

## Quick start

Import public APIs from `lexical-review`. `ReviewExtension` registers all review
nodes and manages browser input and cleanup.

The package can be imported without DOM globals; rendering and browser input
require a DOM environment.

The example below opens a native v3 review document, resolves pending proposals,
and saves the resulting document. `input` is your document, `element` is the
editable DOM element, and `proposalId` / `ids` identify proposals to review.

```ts
import {
  buildEditorFromExtensions,
  getExtensionDependencyFromEditor,
} from "@lexical/extension";
import { configExtension } from "lexical";
import {
  $inspectReviewProposal,
  $resolveReviewProposal,
  $resolveReviewProposals,
  ReviewExtension,
} from "lexical-review";

const editor = buildEditorFromExtensions(
  configExtension(ReviewExtension, { initialDocument: input }),
);
editor.setRootElement(element);
const review = getExtensionDependencyFromEditor(editor, ReviewExtension).output;

editor.read(() => $inspectReviewProposal(proposalId));
editor.update(() => $resolveReviewProposal(proposalId, "accept"), {
  discrete: true,
});
editor.update(() => $resolveReviewProposals(ids, "reject"), { discrete: true }); // also "remove"

const saved = review.session.value?.exportDocument();
// Persist saved.value when saved?.status === "valid".
```

`exportDocument()` returns a validation result containing accepted content and
current pending proposals. Saving leaves the session active.

## Editor integration

The quick start uses `ReviewExtension` directly. You can also use that extension
from React or register review input on an existing editor.

### React

Define a stable extension outside the component and pass it to
`LexicalExtensionComposer`:

```tsx
import { LexicalExtensionComposer } from "@lexical/react/LexicalExtensionComposer";
import { ContentEditable } from "@lexical/react/LexicalContentEditable";
import { configExtension, defineExtension } from "lexical";
import { ReviewExtension } from "lexical-review";

const extension = defineExtension({
  name: "my-review-editor",
  dependencies: [configExtension(ReviewExtension, { initialDocument: input })],
});

function Editor() {
  return (
    <LexicalExtensionComposer extension={extension} contentEditable={null}>
      <ContentEditable />
    </LexicalExtensionComposer>
  );
}
```

Child components can get the editor through `useLexicalComposerContext` and
retrieve the same extension output with
`getExtensionDependencyFromEditor(editor, ReviewExtension).output`, then call
`openDocument(input)` to switch documents or open one loaded after initialization.

### Direct registration

For an editor created with `createEditor`, register `ReviewInsertionNode`,
`ReviewDeletionNode`, `ReviewFormattingNode`, `ReviewBoundaryNode`, and
`ReviewFragmentNode`, then open and register a session:

```ts
import { openReviewSession, registerReviewSession } from "lexical-review";

const opened = openReviewSession(editor, input);
if (opened.status === "valid") {
  const cleanup = registerReviewSession(editor, opened.value);
  // Call cleanup() when detaching review input.
}
```

Use the same editor for both calls. Choose either direct registration or
`ReviewExtension` for each active session to avoid duplicate input handlers.

## Session lifecycle

With `ReviewExtension`, open a native v3 review document at startup or after
editor creation. Both paths validate input before changing editor content and
starting review input:

| When                                                 | Use                                | Validation failure                                                              |
| ---------------------------------------------------- | ---------------------------------- | ------------------------------------------------------------------------------- |
| During editor creation                               | Configure `initialDocument: input` | Editor creation throws                                                          |
| After editor creation, including switching documents | Call `review.openDocument(input)`  | Returns `invalid` or `unsupported`, preserving the current document and session |

`initialDocument` defaults to `null`, so an editor created without document input
waits for `openDocument()`. That call returns a `ValidationResult<ReviewSession>`:
`valid` provides the session in `value`, `invalid` provides `issues`, and
`unsupported` provides a `reason`.

`review.closeSession()` stops review input without changing the editor content.
Opening a valid document starts input handling again. Dispose the editor when
finished to release its handlers.

## Configuration

Pass options through `configExtension(ReviewExtension, { options })` or the third
argument of `registerReviewSession`. To update an extension's options without
reopening its document, replace `review.options.value`:

```ts
review.options.value = {
  ...review.options.value,
  copyProjection: "accepted-state", // default: "all-accepted"
  onOutcome: (outcome) => console.log(outcome.status),
};
```

Avoid changing options during text composition.

### Outcome callbacks

`onOutcome` reports routed operation outcomes, including refusals.

`onOutcome`, `onInsertionOutcome`, and `onDeletionOutcome` receive
`ReviewRoutedOutcome`. Successful text, formatting, structural, and resolution
operations have no value; successful copy/cut includes `{ mode, projectedLength }`,
and successful paste/drop includes `{ source, flattened, lost, softBreakConverted }`.
Narrow by status and the value's properties before reading a payload:

```ts
import type { ReviewRoutedOutcome } from "lexical-review";

function onOutcome(outcome: ReviewRoutedOutcome) {
  if (outcome.status !== "changed") return;
  const value = outcome.value;
  if (!value) return;
  if ("projectedLength" in value) console.log(value.projectedLength);
  else console.log(value.source, value.flattened, value.lost);
}
```

Use `ReviewRoutedOutcome` for explicitly annotated routing callbacks and stored
routed results. For direct semantic calls, use the operation's declared return
type.

### Proposal IDs

Proposal IDs are generated by default. If your application supplies a
`proposalIdFactory`, use the same factory in registration options and direct
calls such as `$insertReviewText(text, { proposalIdFactory })`. Factories must
produce unique, valid IDs; failure to obtain one refuses the operation before
mutation.

## Authoring operations

Browser input uses these operations automatically. For programmatic edits at the
current selection, call them inside `editor.update()`.

| Operation                                                                       | Use                                                                                                 |
| ------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `$insertReviewText(text, options?)`                                             | Insert inline text or replace a selected range                                                      |
| `$replaceReviewText(text, options?)`                                            | Replace a selected range; an empty string deletes it                                                |
| `$deleteReviewText(backward, options?)`                                         | Delete backward (`true`) or forward (`false`); `granularity` is `"character"` (default) or `"word"` |
| `$setReviewFormatting(value)` / `$toggleReviewFormatting(property)`             | Propose `bold`, `italic`, `underline`, or `strikethrough`                                           |
| `$splitReviewParagraph(options?)` / `$mergeReviewParagraph(backward, options?)` | Propose a paragraph split or merge                                                                  |
| `$insertReviewFragment(paragraphs, options?)`                                   | Insert ordered text and paragraphs as one atomic proposal                                           |

```ts
import { $insertReviewText } from "lexical-review";

editor.update(() => {
  const outcome = $insertReviewText("new text");
  // Handle changed, unchanged, refused, or failed.
});
```

A `refused` outcome includes a code and message and preserves content, pending
proposals, and selection. See [operation outcomes](https://github.com/mahendrimd/lexical-review/blob/main/ARCHITECTURE.md#operation-outcomes)
for failure handling and guarantees.

### Atomic fragments

Fragment input uses `{ runs, emptyFormat? }` paragraphs. Each run contains text
and a format bitmask: bold `1`, italic `2`, strikethrough `4`, and underline `8`.

```ts
import { $insertReviewFragment } from "lexical-review";

editor.update(() => {
  $insertReviewFragment([
    { runs: [{ text: "first paragraph", format: 1 }] }, // bold
    { runs: [{ text: "second paragraph", format: 0 }] },
  ]);
});
```

`INSERT_REVIEW_FRAGMENT_COMMAND` accepts the same fragment content.

### Creating nodes directly

Use the authoring operations to create complete proposals. For integrations that
assemble Lexical nodes directly, call `$createReview*Node` factories inside
`editor.update()`. Creating a node alone does not validate the complete proposal.
Follow the
[proposal behavior contract](https://github.com/mahendrimd/lexical-review/blob/main/docs/proposal-behavior.md)
for shared proposal IDs, supported content, and placement.

## Clipboard

`ReviewExtension` and `registerReviewSession` handle ordinary copy, cut, paste,
and supported drop events. For application-specific input, use the paste/drop
operations or [custom clipboard transports](#custom-clipboard-transports) below.

### Copy and cut

Copy and cut export plain text and HTML without proposal identity. The default
`copyProjection` is `"all-accepted"`; use `"accepted-state"` for accepted content
only. See [clipboard projections](https://github.com/mahendrimd/lexical-review/blob/main/docs/proposal-behavior.md#clipboard-projections)
for what each mode includes. Pasting or dropping review-marked content does not
transfer its proposal IDs.

### Paste and drop

`$pasteReviewSelection(event, options?)` handles single-paragraph and multiline
clipboard content. Successful changes include a normalization report describing
clipboard conversion or loss. Empty clipboard content returns `unchanged`.

`$dropReviewSelection(event, options?)` accepts copy-style drops using
`event.dataTransfer.dropEffect === "copy"` at the live selection. Move and unknown
effects refuse without mutation. Hosts that position the drop caret must set
the selection before dispatching.

### Custom clipboard transports

Normalize untrusted HTML and plain text, then apply the prepared content inside
`editor.update()`:

| Content             | Normalize                                                  | Apply                                            |
| ------------------- | ---------------------------------------------------------- | ------------------------------------------------ |
| Single paragraph    | `normalizeUntrustedClipboardContent(html, plain)`          | `$applyPasteRuns(runs, normalization, options?)` |
| Multiple paragraphs | `normalizeUntrustedMultilineClipboardContent(html, plain)` | `$insertReviewFragment(fragment, options?)`      |

Both normalizers return `ready` with normalized content and a `normalization`
report, or `refused` with a code and message. Single-paragraph content is in
`value.runs`; multiline content is in `value.fragment`. Retain the report if your
application displays clipboard conversion or loss. `$applyPasteRuns` also returns
the report on a changed outcome.

Runs supplied to `$applyPasteRuns` must contain string text with no CR/LF and
integer formatting masks from `0` through `15`. Invalid input refuses before
mutation or proposal ID allocation; empty content returns `unchanged`.

## Reviewing proposals

Each pending proposal has an ID that identifies the whole change. Use that ID to
inspect or resolve a proposal; use the ordered ID list to navigate between them.

### Inspection

Both inspectors read pending proposals without changing content, selection,
focus, or scroll. Run them inside `editor.read()` or `editor.update()`.

| Inspector                            | Use                                      | Successful result                                                                                                   |
| ------------------------------------ | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `$inspectReviewProposal(id)`         | Read a proposal summary                  | `unchanged` with `value: { kind, proposal }`; split and merge use `kind: "structure"` and `proposal.kind`.          |
| `$inspectReviewProposalSnapshot(id)` | Display formatting and document position | `ready` with `value: { proposalId, kind, content, attachment }`; `attachment` contains paragraph and child indexes. |

The result types are `InspectedReviewProposal` and `ReviewProposalSnapshot`,
respectively. Snapshot kinds distinguish `split` and `merge` directly. Narrow the
result's status and kind before reading its content:

```ts
import { $inspectReviewProposalSnapshot } from "lexical-review";

const inspected = editor.read(() => $inspectReviewProposalSnapshot(proposalId));
if (inspected.status === "ready" && inspected.value.kind === "replacement") {
  console.log(inspected.value.content.oldText, inspected.value.content.newText);
}
```

Snapshot values remain unchanged after subsequent edits. Refresh inspection
after editor commits to display current content and placement. Unknown or
resolved IDs refuse with `unsupported-target`; malformed IDs refuse with
`invalid-proposal-id`. Inspection and listing remain available during composition.

### Navigation

`$listReviewProposals()` returns each pending ID once, in document order.
`getNextProposal(ids, currentId)` and `getPrevProposal(ids, currentId)` return
neighboring IDs from that list. A null current ID chooses the first or last ID,
respectively. An empty list, an unknown current ID, or reaching an edge returns
null. Refresh the list after commits so resolved IDs disappear. These helpers
leave focus and selection unchanged; your application chooses whether navigation
wraps or moves the editor caret.

### Resolution

Resolve proposals by ID inside `editor.update()`.
`$resolveReviewProposal(id, action)` resolves one proposal;
`$resolveReviewProposals(ids, action)` validates the whole batch before applying
the action. A refusal preserves content and selection.

| Action     | Meaning                                             |
| ---------- | --------------------------------------------------- |
| `"accept"` | Keep the proposed change.                           |
| `"reject"` | Set the proposed change aside as a review decision. |
| `"remove"` | Set the proposed change aside as author cleanup.    |

Resolution uses current proposal content, preserves unrelated pending proposals,
and leaves no resolution history. Refresh inspection and navigation after
resolving.

`RESOLVE_REVIEW_PROPOSALS_COMMAND` accepts `{ ids, action }` with the same actions.

### Previews

Previews show accepted document state or the outcome of accepting every pending
proposal without resolving any of them.

To preview the current editor, call these functions inside `editor.read()`:

| Preview        | Operation                 | Result                                                          |
| -------------- | ------------------------- | --------------------------------------------------------------- |
| Accepted state | `$previewAcceptedState()` | `ready` with `{ paragraphs }`, or `refused` when unavailable.   |
| All accepted   | `$previewAllAccepted()`   | `{ paragraphs }`; throws when the outcome cannot be determined. |

Live previews are unavailable during text composition.

`createReviewPreview(document, mode)` returns a validation result for a detached
review document. Use `"accepted-state"` to show accepted content or `"all-accepted"`
to show the outcome of accepting every pending proposal. Neither changes the
source document or live editor, and neither needs an `editor.update()` call.
An indeterminate all-accepted preview throws.

## Rendering

Inserted and deleted text use outermost `<ins>` and `<del>` markers, with Lexical
formatting nested inside: `<ins><strong>inserted text</strong></ins>`. A pending
paragraph merge displays `¶` inside `<del data-review-boundary="merge">`.

## Migrating from v2

V3 replaces the v2 text-node representation with proposal-bearing nodes and
native v3 review documents. There is no automatic v2 document conversion.
Replace `ReviewTextPlugin` or `registerReviewText` with the integration shown
above, then use proposal IDs for inspection and resolution.

## Interchange

For WER interchange support and limitations, see the separate
[`lexical-review-wer` package guide](https://github.com/mahendrimd/lexical-review/blob/main/packages/lexical-review-wer/README.md).
