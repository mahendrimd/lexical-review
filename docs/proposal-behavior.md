# Revision proposal behavior

This contract uses the terms in [CONTEXT.md](../CONTEXT.md) to describe proposal
ownership, editing, and resolution. The [architecture](../ARCHITECTURE.md)
explains how the package implements these behaviors. Exact selection edge cases
remain in the linked tests; internal helpers may change while outcomes stay stable.
The [principles](../ARCHITECTURE.md#principles) guide how proposal behavior evolves.

## One proposal, one review decision

Every revision proposal has a required proposal ID that identifies one
independently reviewable pending change within a review document. It is assigned
when the proposal is created and preserved when the document is saved and
reopened. Callers use it to inspect or resolve the whole proposal.

A proposal can contain several parts: a replacement has old and new text, and
an atomic document-fragment insertion can span paragraphs. Those parts belong
to one proposal and resolve together.

Supported corrections preserve the proposal's ID while its content, formatting,
or supported placement evolves. Some edits can also change its kind, as
described under [atomic fragments](#atomic-fragments). The ID therefore
identifies the pending change throughout authoring, not a fixed version of its
content.

An ID identifies what is reviewed together; an interaction target determines
what a particular edit can change. For example, a replacement's old and new
text resolve together, but only its new side supports typing corrections.

## Proposal kinds and resolution

Resolution uses current proposal content and supported placement, preserving
unrelated pending work. It does not restore a creation-time document snapshot
or retain resolution history in the review document.

| Revision proposal                  | Proposed change                                              | Accept                                                    | Reject or remove                                                                                 |
| ---------------------------------- | ------------------------------------------------------------ | --------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Insertion                          | Add text                                                     | Keep current proposed text in the accepted document state | Remove proposed text                                                                             |
| Deletion                           | Remove text in the accepted document state                   | Remove the targeted text                                  | Restore the targeted text in the accepted document state                                         |
| Replacement                        | Replace old text with new text under one ID                  | Keep the new side and remove the old side                 | Restore the old side and remove the new side                                                     |
| Formatting                         | Change formatting on text in the accepted document state     | Keep current proposed formatting                          | Restore formatting from the accepted document state                                              |
| Paragraph split                    | Introduce a paragraph boundary                               | Keep the split                                            | Rejoin current content across that boundary                                                      |
| Paragraph merge                    | Remove a paragraph boundary                                  | Keep the joined paragraph                                 | Separate current content at the marked boundary                                                  |
| Atomic document-fragment insertion | Insert ordered text and paragraph boundaries as one proposal | Keep the whole current fragment                           | Remove the whole current fragment, preserving surrounding content in the accepted document state |

Reject expresses a reviewer setting aside a proposal; remove expresses its author
setting it aside. Their document effects match, but their intents differ. Split
and merge inspect as `structure` with a split/merge subtype.

[Batch resolution tests](../packages/lexical-review/src/ReviewResolution.spec.ts)
cover preflight, current-content resolution, preservation of unrelated work,
and the absence of resolution history.

## Authoring and editing proposals

### Interaction targets

The same input can create a revision proposal or correct the targeted pending
revision proposal (preserving its ID) depending on its interaction target. For
example, deleting text in the accepted document state can create a deletion
proposal, while deleting text within a pending insertion corrects that
insertion.

Collapsed Backspace/Delete also uses direction: at the edge of content,
the interaction target is the supported adjacent content in that direction. The rules below assume
valid proposal structure; unsupported targets are refused without mutation.

### Typing and inline formatting

An insertion can contain text with different inline formatting under one
proposal ID. The formatting belongs to the inserted content; it does not create
a separate formatting proposal. Accepting the insertion keeps its current text
and formatting together.

Typed text takes the caret's active input formatting. Toggling formatting at a
collapsed caret sets that formatting for text typed next, without changing
existing content or creating a proposal. Moving the caret sets it to the
formatting at the new location. The caret follows newly inserted or corrected
content.

For example, typing inside a pending insertion, turning on bold, and typing
more text keeps both the plain and bold text in the same proposal. The same
holds at its edge: typing next to a single pending insertion continues it under its ID
regardless of typed formatting. In this table, insertion covers a
replacement's new side, which shares the replacement's ID.

| Typing target                                                                 | Expected behavior                                                |
| ----------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| Inside a pending insertion                                                    | Correct that proposal under its ID, even when formatting changes |
| Inside a replacement's old side                                               | Refuse without mutation                                          |
| Next to a single pending insertion | Continue that proposal under its ID |
| Between two pending insertions with different IDs | Create a separate insertion; never merge IDs |
| In the accepted document state                                                | Create an insertion with the typed formatting                    |

Evidence: [text insertion tests](../packages/lexical-review/src/ReviewText.spec.ts),
[formatting tests](../packages/lexical-review/src/ReviewFormatting.spec.ts), and
[compatibility tests](../packages/lexical-review/src/ReviewCompatibility.spec.ts).

### Selected-range replacement and deletion

A nonempty selection supplies the explicit range. A range across proposal
boundaries is refused regardless of deletion direction.

| Target and interaction                                                        | Expected behavior                                                                      |
| ----------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Replace text entirely inside an insertion                                     | Correct that proposal; preserve its ID                                                 |
| Delete part of an insertion                                                   | Remove targeted proposed text; preserve the remaining proposal's ID                    |
| Delete all of an insertion                                                    | Remove the proposal                                                                    |
| Delete text in the accepted document state in one paragraph                   | Create a deletion, or extend a compatible adjacent deletion in the requested direction |
| Delete a nonempty range within a deletion                                     | Restore all text targeted by the deletion and remove the proposal                      |
| Replace text entirely within a replacement's new side                         | Correct the new side; preserve the replacement ID                                      |
| Delete the replacement's last new text, or delete a range within its old side | Cancel the whole replacement and restore its old text                                  |
| Replace text on a replacement's old side or select across both sides          | Refuse without mutation                                                                |

Ranges mixing content in the accepted document state with proposal-side content,
or crossing independent proposal IDs, are refused. Ordinary text ranges cannot cross
paragraphs; supported ranges within one [atomic fragment](#atomic-fragments) use
its own editing rules.

Evidence: [text insertion tests](../packages/lexical-review/src/ReviewText.spec.ts),
[insertion/session tests](../packages/lexical-review/src/ReviewSession.client.spec.ts),
[deletion tests](../packages/lexical-review/src/ReviewDeletion.spec.ts), and
[replacement tests](../packages/lexical-review/src/ReviewReplacement.spec.ts).

### Collapsed Backspace and Delete

Backspace addresses content before the caret; Delete addresses content after it.
Deletion edits the content the caret is in. At a boundary, the interaction
target is the adjacent content in the deletion direction. That content may
belong to another proposal; the edit then applies under that proposal's ID
without joining proposals.

| Content addressed                                             | Expected behavior                                                                                              |
| ------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Text in the accepted document state                           | Propose deletion; continue a compatible adjacent deletion when available                                       |
| Pending insertion                                             | Remove the targeted proposed text under its existing ID; remove the proposal if emptied                        |
| Replacement's new side                                        | Remove the targeted new text under the replacement ID; cancel the whole replacement if its new side is emptied |
| Pending deletion                                              | Restore all text targeted by the deletion and remove the proposal                                              |
| Replacement's old side                                        | Cancel the whole replacement and restore its old text                                                          |
| Formatting proposal                                           | Refuse without mutation                                                                                        |
| Fragment next to the caret in the deletion direction, in the same paragraph | Correct that fragment under its existing ID, as if targeting its proposal-side content |

Continuing a compatible deletion prepends for Backspace and appends for
Delete. At a boundary, direction instead selects the target: Backspace at
the start of a pending insertion proposes deletion of text in the accepted
document state on its left; Delete from that text's end shortens the
insertion instead.

At the seam between a replacement's old and new sides, Backspace addresses the
old side and cancels the replacement; Delete addresses the new side and
shortens it. A caret at the edge of a formatting proposal or fragment can
address adjacent content in the deletion direction without changing the source proposal. Refusing text
deletion within formatting content does not prevent deletion outward from its
edge.

These targeting rules apply to character and word deletion. Word deletion stays
within the addressed text in the accepted document state or proposal side; it
does not consume a second independent proposal. Addressing a deletion or a
replacement's old side restores the whole change for either granularity. Within
a fragment, an internal paragraph boundary is removed as one unit.

#### Caret placement and repeated deletion

Shortening proposed text leaves the caret at the edit in the surviving
proposal. Emptying an insertion leaves the caret at the gap where it was
removed. Restoring a deletion or cancelling a replacement places the caret
at the end of the restored text in the accepted document state, regardless
of deletion direction or whether the caret began in that proposal or in
adjacent content.

Each keypress re-resolves the interaction target from that resulting caret,
so consecutive keypresses can have different effects.

#### Paragraph boundaries and refusal

At a paragraph boundary, only character Backspace/Delete can author or cancel
a [structural proposal](#paragraph-boundaries); word deletion has no
structural step. Deletion enters a fragment only from adjacent content in
the same paragraph; it cannot cross a paragraph boundary to reach one. Any
other cross-paragraph target, malformed proposal, or unresolved ambiguous
target remains a no-mutation refusal.

Evidence: [dispatch and directional-targeting tests](../packages/lexical-review/src/ReviewIntentDispatch.spec.ts),
[shared target-edit tests](../packages/lexical-review/src/ReviewTargetEdit.spec.ts),
[client command tests](../packages/lexical-review/src/ReviewSession.client.spec.ts),
and [browser deletion tests](../packages/demo/e2e/deletion-authoring.spec.ts).

### Formatting existing content

Supported properties are bold, italic, underline, and strikethrough. A
formatting range must not mix content in the accepted document state with
proposal-side content, cross independent IDs, or cross paragraphs. Inside
one atomic fragment, a range can span that fragment's paragraphs.

| Target and interaction                                                               | Expected behavior                                                     |
| ------------------------------------------------------------------------------------ | --------------------------------------------------------------------- |
| Change supported formatting within one formatting proposal                           | Update that proposal; preserve its ID                                 |
| Return the entire formatting target to its formatting in the accepted document state | Remove the proposal                                                   |
| Format insertion text or a replacement's new side                                    | Update that existing proposal; create no separate formatting proposal |
| Insert or delete text within a formatting proposal                                   | Refuse; resolve the formatting proposal first                         |
| Format deletion text or a replacement's old side                                     | Refuse without mutation                                               |
| Apply explicit formatting already present                                            | Return unchanged without splitting text or allocating identity        |

Evidence: [formatting tests](../packages/lexical-review/src/ReviewFormatting.spec.ts)
and [fragment tests](../packages/lexical-review/src/ReviewFragment.spec.ts).

### Paragraph boundaries

A structural proposal owns a boundary change. Subsequent supported text edits
remain attached to the appropriate side; resolving the boundary preserves that
pending text work.

Backspace at a pending split's right-paragraph start, or Delete at its
left-paragraph end, cancels the split. Enter at either side of a pending merge
marker cancels the merge. These gestures remove the existing change rather than
creating its opposite.

Evidence: [structure tests](../packages/lexical-review/src/ReviewStructure.spec.ts).

### Atomic fragments

Within one atomic fragment, supported typing, formatting, replacement, deletion,
Enter, and further fragment insertion correct its payload under the same ID.
Deleting an internal boundary changes the fragment locally. Components remain
one independently reviewable revision proposal.

A fragment reduced to an inline insertion or a single boundary-only split
normalizes to that kind with the same ID. Multiple remaining boundaries stay
atomic. Deleting the entire payload and introduced boundaries removes the
proposal. Inspect the current kind after editing rather than assuming it is
fixed for the lifetime of an ID.

Typing in the accepted document state next to a fragment can create an independent
proposal. For collapsed deletion into or out of a fragment, see the [directional
rules](#collapsed-backspace-and-delete). Ranges mixing content in the accepted
document state and fragment content are refused without mutation.

Evidence: [fragment tests](../packages/lexical-review/src/ReviewFragment.spec.ts).

## Refusal and failure

A no-mutation refusal preserves accepted document state, pending revision
proposals, the review projection, and logical selection. An interaction can also
be a supported no-op. Neither outcome should manufacture a revision proposal.
Unexpected failures are distinct from refusals; see the [outcome
contract](../ARCHITECTURE.md#preparation-effects-and-outcomes).

## Maintaining this contract

When behavior changes, update this contract and its existing tests together.
If prose and tests disagree, surface the discrepancy and resolve the intended
behavior before changing it. Keep detailed editing and resolution rules here;
API guides and architecture sections should summarize and link to them.
