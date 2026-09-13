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

| Revision proposal | Proposed change | Accept | Reject or remove |
| --- | --- | --- | --- |
| Insertion | Add text | Keep current proposed text as accepted content | Remove proposed text |
| Deletion | Remove accepted text | Remove the targeted text | Restore the targeted text as accepted content |
| Replacement | Replace old text with new text under one ID | Keep the new side and remove the old side | Restore the old side and remove the new side |
| Formatting | Change formatting on existing text | Keep current proposed formatting | Restore accepted formatting |
| Paragraph split | Introduce a paragraph boundary | Keep the split | Rejoin current content across that boundary |
| Paragraph merge | Remove a paragraph boundary | Keep the joined paragraph | Separate current content at the marked boundary |
| Atomic document-fragment insertion | Insert ordered text and paragraph boundaries as one proposal | Keep the whole current fragment | Remove the whole current fragment, preserving surrounding accepted content |

Reject expresses a reviewer setting aside a proposal; remove expresses its author
setting it aside. Their document effects match, but their intents differ. Split
and merge inspect as `structure` with a split/merge subtype.

[Batch resolution tests](../packages/lexical-review/src/ReviewResolution.spec.ts)
cover preflight, current-content resolution, preservation of unrelated work,
and the absence of resolution history.

## Authoring and editing proposals

### Interaction targets

The same input can create a revision proposal or correct the targeted pending
revision proposal (preserving its ID) depending on its interaction target.
For example, deleting accepted text can create a deletion proposal, while
deleting text within a pending insertion corrects that insertion.

At proposal boundaries, continuation follows accepted-side or proposal-side
association, not visual adjacency. A paragraph element boundary can be
ambiguous even when a nearby text-node endpoint is supported. The rules below
assume valid proposal structure and an unambiguous supported interaction target.

### Typing and inline formatting

An insertion can contain text with different inline formatting under one
proposal ID. The formatting belongs to the inserted content; it does not create
a separate formatting proposal. Accepting the insertion keeps its current text
and formatting together.

Newly typed text uses the active input formatting. Toggling formatting at a
collapsed caret changes future input without changing existing content or
creating a proposal. Moving the caret recomputes input formatting from its new
location.

For example, typing within a pending insertion, turning on bold, and typing
more text keeps both the plain and bold text in the same proposal.

| Typing target | Expected behavior |
| --- | --- |
| Within an insertion, including a boundary with proposal-side association | Correct that proposal under its ID, even when input formatting changes |
| Within a replacement's new side | Correct the new side; preserve the replacement ID |
| Over a replacement's old side | Refuse without mutation |
| Accepted text boundary adjacent to an insertion, with accepted-side association and matching formatting | Continue the adjacent insertion under its ID |
| Accepted text boundary adjacent to an insertion, with accepted-side association and different formatting | Create a separate insertion with the active input formatting |

Evidence: [text insertion tests](../packages/lexical-review/src/ReviewText.spec.ts)
and [formatting tests](../packages/lexical-review/src/ReviewFormatting.spec.ts).

### Text replacement and deletion

| Target and interaction | Expected behavior |
| --- | --- |
| Replace text entirely inside an insertion | Correct that proposal; preserve its ID |
| Delete part of an insertion | Remove targeted proposed text; preserve the remaining proposal's ID |
| Delete all of an insertion | Remove the proposal |
| Delete adjacent accepted text in a supported continuation direction | Extend the existing deletion under its ID: backward deletion prepends, forward deletion appends |
| Delete a nonempty range within a deletion | Restore the whole deletion's accepted text and remove the proposal |
| Replace text entirely within a replacement's new side | Correct the new side; preserve the replacement ID |
| Delete the replacement's last new text, or perform supported deletion against its old side | Cancel the whole replacement and restore its old text |
| Replace text on a replacement's old side or edit across both sides | Refuse without mutation |

Evidence: [text insertion tests](../packages/lexical-review/src/ReviewText.spec.ts),
[insertion/session tests](../packages/lexical-review/src/ReviewSession.client.spec.ts),
[deletion tests](../packages/lexical-review/src/ReviewDeletion.spec.ts),
[replacement tests](../packages/lexical-review/src/ReviewReplacement.spec.ts), and
[dispatch tests](../packages/lexical-review/src/ReviewIntentDispatch.spec.ts).

### Formatting existing content

Supported properties are bold, italic, underline, and strikethrough. Ordinary
formatting refuses ranges across accepted/proposal sides, independent IDs, or
paragraphs. A selection contained in one atomic fragment can span its paragraphs.

| Target and interaction | Expected behavior |
| --- | --- |
| Change supported formatting within one formatting proposal | Update that proposal; preserve its ID |
| Return the entire formatting target to accepted formatting | Remove the proposal |
| Format insertion text or a replacement's new side | Update that existing proposal; create no separate formatting proposal |
| Insert or delete text within a formatting proposal | Refuse; resolve the formatting proposal first |
| Format deletion text or a replacement's old side | Refuse without mutation |
| Apply explicit formatting already present | Return unchanged without splitting text or allocating identity |

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

Accepted-side edits outside a fragment can create independent proposals. Edits
mixing accepted and fragment content are refused without mutation.

Evidence: [fragment tests](../packages/lexical-review/src/ReviewFragment.spec.ts).

## Refusal and failure

A no-mutation refusal preserves accepted content, pending revision proposals,
the review projection, and logical selection. An interaction can also be a
supported no-op. Neither outcome should manufacture a revision proposal.
Unexpected failures are distinct from refusals; see the
[outcome contract](../ARCHITECTURE.md#preparation-effects-and-outcomes).

## Maintaining this contract

When behavior changes, update this contract and its existing tests together.
If prose and tests disagree, surface the discrepancy and resolve the intended
behavior before changing it. Internal abstractions must simplify an owner or
caller; these rules do not require a class, strategy, or module for each row.
