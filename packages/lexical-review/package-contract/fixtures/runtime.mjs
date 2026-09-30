import assert from "node:assert/strict";
import { configExtension, createEditor } from "lexical";

const review = await import("lexical-review");

// Check the public runtime surface without duplicating operation behavior tests.
for (const name of [
  "ReviewBoundaryNode",
  "ReviewDeletionNode",
  "ReviewElementNode",
  "ReviewFormattingNode",
  "ReviewFragmentNode",
  "ReviewInsertionNode",
  "$applyPasteRuns",
  "$canReviewElementNodesBeMerged",
  "$copyReviewSelection",
  "$createReviewBoundaryNode",
  "$createReviewDeletionNode",
  "$createReviewFormattingNode",
  "$createReviewFragmentNode",
  "$createReviewInsertionNode",
  "$cutReviewSelection",
  "$deleteReviewText",
  "$deriveClipboardProjection",
  "$dropReviewSelection",
  "$insertReviewFragment",
  "$insertReviewText",
  "$inspectReviewProposal",
  "$inspectReviewProposalSnapshot",
  "$isReviewBoundaryNode",
  "$isReviewDeletionNode",
  "$isReviewFormattingNode",
  "$isReviewFragmentNode",
  "$isReviewInsertionNode",
  "$listReviewProposals",
  "$mergeReviewParagraph",
  "$pasteReviewSelection",
  "$previewAcceptedState",
  "$previewAllAccepted",
  "$replaceReviewText",
  "$resolveReviewProposal",
  "$resolveReviewProposals",
  "$setReviewFormatting",
  "$splitReviewParagraph",
  "$toggleReviewFormatting",
  "createReviewPreview",
  "exportReviewDocument",
  "getNextProposal",
  "getPrevProposal",
  "importReviewDocument",
  "isReviewElementNode",
  "normalizeUntrustedClipboardContent",
  "normalizeUntrustedMultilineClipboardContent",
  "openReviewSession",
  "registerReviewSession",
  "validateReviewDocument",
]) {
  assert.equal(typeof review[name], "function", name);
}
assert.equal(typeof review.CLIPBOARD_WRITE_FAILED, "string");
assert.equal(typeof review.CUT_MUTATION_FAILED_AFTER_COPY, "string");

const editor = createEditor({
  nodes: [
    review.ReviewInsertionNode,
    review.ReviewDeletionNode,
    review.ReviewFormattingNode,
    review.ReviewBoundaryNode,
    review.ReviewFragmentNode,
  ],
  onError: (error) => {
    throw error;
  },
});
const document = {
  root: {
    children: [
      {
        children: [
          {
            detail: 0,
            format: 0,
            mode: "normal",
            style: "",
            text: "package consumer",
            type: "text",
            version: 1,
          },
        ],
        direction: null,
        format: "",
        indent: 0,
        textFormat: 0,
        textStyle: "",
        type: "paragraph",
        version: 1,
      },
    ],
    direction: null,
    format: "",
    indent: 0,
    type: "root",
    version: 1,
    $: { "lexical-review": { extensions: [], version: 3 } },
  },
};
const opened = review.openReviewSession(editor, document);
assert.equal(opened.status, "valid");
const directSaved = opened.value.exportDocument();
assert.equal(directSaved.status, "valid");
assert.equal(
  directSaved.value.root.children[0].children[0].text,
  "package consumer",
);
const cleanup = review.registerReviewSession(editor, opened.value, {
  copyProjection: "accepted-state",
});
assert.equal(typeof cleanup, "function");
cleanup();

assert.equal(review.ReviewExtension.name, "lexical-review/Review");
assert.equal(typeof review.INSERT_REVIEW_FRAGMENT_COMMAND, "object");
assert.equal(typeof review.RESOLVE_REVIEW_PROPOSALS_COMMAND, "object");
assert.equal(typeof globalThis.document, "undefined");
assert.equal(typeof globalThis.window, "undefined");
const { buildEditorFromExtensions, getExtensionDependencyFromEditor } =
  await import("@lexical/extension");
const extensionEditor = buildEditorFromExtensions(review.ReviewExtension);
try {
  const output = getExtensionDependencyFromEditor(
    extensionEditor,
    review.ReviewExtension,
  ).output;
  assert.equal(output.session.value, null);
  assert.equal(output.openDocument({ root: {} }).status, "invalid");
  const opened = output.openDocument(document);
  assert.equal(opened.status, "valid");
  assert.equal(output.session.value, opened.value);
  const saved = output.session.value.exportDocument();
  assert.equal(saved.status, "valid");
  assert.equal(
    saved.value.root.children[0].children[0].text,
    "package consumer",
  );
  output.options.value = { copyProjection: "accepted-state" };
  output.closeSession();
  assert.equal(output.session.value, null);
} finally {
  extensionEditor.dispose();
}

const initializedEditor = buildEditorFromExtensions(
  configExtension(review.ReviewExtension, { initialDocument: document }),
);
const initializedOutput = getExtensionDependencyFromEditor(
  initializedEditor,
  review.ReviewExtension,
).output;
try {
  const saved = initializedOutput.session.value.exportDocument();
  assert.equal(saved.status, "valid");
  assert.equal(
    saved.value.root.children[0].children[0].text,
    "package consumer",
  );
} finally {
  initializedEditor.dispose();
}
assert.equal(initializedOutput.session.value, null);

console.log(
  "ESM package imports and extension lifecycle passed without React or DOM globals",
);
