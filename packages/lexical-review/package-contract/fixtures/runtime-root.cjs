const assert = require("node:assert/strict");
const { createEditor } = require("lexical");

const root = require("lexical-review");

assert.equal(typeof root.ReviewInsertionNode, "function");
assert.equal(typeof root.ReviewDeletionNode, "function");
assert.equal(typeof root.openReviewSession, "function");
for (const name of [
  "$deleteReviewText",
  "$insertReviewText",
  "$replaceReviewText",
  "$inspectReviewProposal",
  "$resolveReviewProposal",
  "$resolveReviewProposals",
]) {
  assert.equal(typeof root[name], "function");
}
assert.equal(typeof root.validateReviewDocument, "function");

const editor = createEditor({
  nodes: [root.ReviewInsertionNode, root.ReviewDeletionNode],
  onError: (error) => void error,
});
const opened = root.openReviewSession(editor, {
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

assert.equal(root.ReviewExtension.name, "lexical-review/Review");
assert.equal(typeof root.registerReviewSession, "function");
assert.equal(typeof root.INSERT_REVIEW_FRAGMENT_COMMAND, "object");
assert.equal(typeof root.RESOLVE_REVIEW_PROPOSALS_COMMAND, "object");
assert.equal(typeof globalThis.document, "undefined");
assert.equal(typeof globalThis.window, "undefined");
const {
  buildEditorFromExtensions,
  getExtensionDependencyFromEditor,
} = require("@lexical/extension");
const extensionEditor = buildEditorFromExtensions(root.ReviewExtension);
try {
  const review = getExtensionDependencyFromEditor(
    extensionEditor,
    root.ReviewExtension,
  ).output;
  assert.equal(review.session.value, null);
  assert.equal(review.openDocument({ root: {} }).status, "invalid");
} finally {
  extensionEditor.dispose();
}

console.log(
  "CommonJS package imports and extension lifecycle passed without React or DOM globals",
);
