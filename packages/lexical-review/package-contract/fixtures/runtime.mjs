import assert from "node:assert/strict";
import { createEditor } from "lexical";

const review = await import("lexical-review");

assert.equal(typeof review.ReviewInsertionNode, "function");
assert.equal(typeof review.ReviewDeletionNode, "function");
assert.equal(typeof review.openReviewSession, "function");
for (const name of [
  "$deleteReviewText",
  "$insertReviewText",
  "$replaceReviewText",
  "$inspectReviewProposal",
  "$resolveReviewProposal",
  "$resolveReviewProposals",
]) {
  assert.equal(typeof review[name], "function");
}
assert.equal(typeof review.validateReviewDocument, "function");

const editor = createEditor({
  nodes: [review.ReviewInsertionNode, review.ReviewDeletionNode],
  onError: (error) => void error,
});
const opened = review.openReviewSession(editor, {
  root: {
    children: [
      {
        children: [],
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
});
assert.equal(opened.status, "valid");
assert.equal(opened.value.exportDocument().status, "valid");

assert.equal(review.ReviewExtension.name, "lexical-review/Review");
assert.equal(typeof review.registerReviewSession, "function");
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
} finally {
  extensionEditor.dispose();
}

console.log(
  "ESM package imports and extension lifecycle passed without React or DOM globals",
);
