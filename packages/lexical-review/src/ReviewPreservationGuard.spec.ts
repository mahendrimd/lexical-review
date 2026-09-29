import { createEditor, type LexicalEditor } from "lexical";
import {
  importReviewDocument,
  openReviewSession,
  ReviewDeletionNode,
  ReviewInsertionNode,
  validateReviewDocument,
} from "./index";
import {
  paragraph,
  reviewDocument,
  reviewNode,
  text,
} from "./ReviewDocument.test-fixtures";

const EXTENSION_URI = "https://example.com/review-extensions/lexical-51/v1";

function rootWith(doc: unknown, fields: Record<string, unknown>): unknown {
  const clone = structuredClone(doc) as { root: Record<string, unknown> };
  Object.assign(clone.root, fields);
  return clone;
}

function wrapperWith(
  node: unknown,
  fields: Record<string, unknown>,
): Record<string, unknown> {
  return { ...(node as Record<string, unknown>), ...fields };
}

function docWithWrapper(wrapper: unknown): unknown {
  return reviewDocument([paragraph([wrapper])]);
}

function createInsertionEditor() {
  return createEditor({
    namespace: "lexical-51-fields",
    nodes: [ReviewInsertionNode, ReviewDeletionNode],
    onError: (error) => {
      throw error;
    },
  });
}

function envelopeWithValue(value: unknown) {
  return { required: false, uri: EXTENSION_URI, value };
}

describe("Lexical 0.51 ElementNode field spellings (#98)", () => {
  it("documents the measurement lens: undefined keys survive Object.keys but not JSON", () => {
    const doc = rootWith(reviewDocument([paragraph([text("Alpha")])]), {
      textFormat: undefined,
      textStyle: undefined,
    }) as { root: Record<string, unknown> };
    expect(Object.keys(doc.root)).toContain("textFormat");
    expect(JSON.parse(JSON.stringify(doc)).root).not.toHaveProperty(
      "textFormat",
    );
  });

  it.each([
    ["absent (pre-0.51)", (doc: unknown) => doc],
    [
      "present-undefined (0.51 in memory)",
      (doc: unknown) =>
        rootWith(doc, { textFormat: undefined, textStyle: undefined }),
    ],
    [
      "present-with-default",
      (doc: unknown) => rootWith(doc, { textFormat: 0, textStyle: "" }),
    ],
  ])("accepts root %s", (_name, spell) => {
    const input = spell(reviewDocument([paragraph([text("Alpha")])]));
    expect(validateReviewDocument(input).status).toBe("valid");
  });

  it.each([
    ["absent (pre-0.51)", (node: unknown) => node],
    [
      "present-undefined (0.51 in memory)",
      (node: unknown) =>
        wrapperWith(node, { textFormat: undefined, textStyle: undefined }),
    ],
    [
      "present-with-default",
      (node: unknown) => wrapperWith(node, { textFormat: 0, textStyle: "" }),
    ],
  ])("accepts wrapper %s", (_name, spell) => {
    const wrapper = spell(reviewNode("review-insertion", "a", [text("x")]));
    expect(validateReviewDocument(docWithWrapper(wrapper)).status).toBe(
      "valid",
    );
  });

  it.each([
    [
      "root textFormat",
      () =>
        rootWith(reviewDocument([paragraph([text("A")])]), {
          textFormat: 1,
          textStyle: "",
        }),
    ],
    [
      "wrapper textFormat",
      () =>
        docWithWrapper(
          wrapperWith(reviewNode("review-insertion", "a", [text("x")]), {
            textFormat: 1,
          }),
        ),
    ],
  ])("rejects nondefault %s as unsupported", (_name, build) => {
    expect(validateReviewDocument(build()).status).toBe("unsupported");
  });

  it("rejects nondefault textStyle spellings as unsupported", () => {
    const rootBad = rootWith(reviewDocument([paragraph([text("A")])]), {
      textStyle: "bold",
    });
    expect(validateReviewDocument(rootBad).status).toBe("unsupported");
    const wrapperBad = docWithWrapper(
      wrapperWith(reviewNode("review-insertion", "a", [text("x")]), {
        textStyle: "italic",
      }),
    );
    expect(validateReviewDocument(wrapperBad).status).toBe("unsupported");
  });

  it.each([
    ["absent", (doc: unknown) => doc],
    [
      "present-undefined",
      (doc: unknown) =>
        rootWith(doc, { textFormat: undefined, textStyle: undefined }),
    ],
    [
      "present-with-default",
      (doc: unknown) => rootWith(doc, { textFormat: 0, textStyle: "" }),
    ],
  ])(
    "opens and re-exports root %s without tripping the guard",
    (_name, spell) => {
      const editor = createInsertionEditor();
      const input = spell(
        docWithWrapper(reviewNode("review-insertion", "a", [text("x")])),
      );
      const opened = openReviewSession(editor, input);
      expect(opened.status).toBe("valid");
      if (opened.status !== "valid") {
        return;
      }
      const exported = opened.value.exportDocument();
      expect(exported.status).toBe("valid");
      if (exported.status === "valid") {
        expect(validateReviewDocument(exported.value).status).toBe("valid");
      }
    },
  );

  it.each([
    ["absent", (node: unknown) => node],
    [
      "present-undefined",
      (node: unknown) =>
        wrapperWith(node, { textFormat: undefined, textStyle: undefined }),
    ],
    [
      "present-with-default",
      (node: unknown) => wrapperWith(node, { textFormat: 0, textStyle: "" }),
    ],
  ])(
    "opens and re-exports %s wrappers without tripping the guard",
    (_name, spell) => {
      const editor = createInsertionEditor();
      const input = docWithWrapper(
        spell(reviewNode("review-insertion", "a", [text("x")])),
      );
      const opened = openReviewSession(editor, input);
      expect(opened.status).toBe("valid");
      if (opened.status !== "valid") {
        return;
      }
      expect(opened.value.exportDocument().status).toBe("valid");
    },
  );
});

describe("parse-preservation guard keeps opaque extension payloads exact", () => {
  function lossyEditor(reparsed: unknown): LexicalEditor {
    return {
      hasNode: () => true,
      parseEditorState: () => ({ toJSON: () => reparsed }),
    } as unknown as LexicalEditor;
  }

  function docWithNodeExtension(value: unknown): unknown {
    const wrapper = {
      ...reviewNode("review-insertion", "a", [text("x")]),
      extensions: [envelopeWithValue(value)],
    };
    return docWithWrapper(wrapper);
  }

  it.each([
    [
      "default textFormat",
      { marker: "kept", textFormat: 0 },
      { marker: "kept" },
    ],
    [
      "default textStyle",
      { marker: "kept", textStyle: "" },
      { marker: "kept" },
    ],
    [
      "node-like payload",
      { type: "review-insertion", textFormat: 0, textStyle: "" },
      { type: "review-insertion" },
    ],
  ])(
    "rejects extension loss of %s instead of normalizing it away",
    (_name, before, after) => {
      const input = docWithNodeExtension(before);
      expect(validateReviewDocument(input).status).toBe("valid");
      const reparsed = docWithNodeExtension(after);
      expect(validateReviewDocument(reparsed).status).toBe("valid");
      const result = importReviewDocument(lossyEditor(reparsed), input);
      expect(result).toMatchObject({ status: "invalid" });
    },
  );

  it("still accepts identical extension payloads through the guard", () => {
    const input = docWithNodeExtension({ textFormat: 0, marker: "kept" });
    const result = importReviewDocument(lossyEditor(input), input);
    expect(result.status).toBe("valid");
  });
});
