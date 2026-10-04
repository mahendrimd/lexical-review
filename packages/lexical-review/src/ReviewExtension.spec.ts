import {
  buildEditorFromExtensions,
  getExtensionDependencyFromEditor,
} from "@lexical/extension";
import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  CONTROLLED_TEXT_INSERTION_COMMAND,
  COPY_COMMAND,
  configExtension,
  type LexicalEditor,
} from "lexical";
import { ReviewExtension } from "./ReviewExtension";
import {
  ReviewBoundaryNode,
  ReviewDeletionNode,
  ReviewFormattingNode,
  ReviewFragmentNode,
  ReviewInsertionNode,
} from "./index";
import type { ReviewRoutedOutcome } from "./registerReviewSession";
import {
  paragraph,
  reviewDocument,
  reviewNode,
  text,
} from "./ReviewDocument.test-fixtures";

const baseline = () => reviewDocument([paragraph([text("AB")])]);

function select(editor: LexicalEditor, offset = 1) {
  editor.update(() => $getRoot().getAllTextNodes()[0]!.select(offset, offset), {
    discrete: true,
  });
}

function insert(editor: LexicalEditor, value: string) {
  let handled = false;
  editor.update(
    () => {
      handled = editor.dispatchCommand(
        CONTROLLED_TEXT_INSERTION_COMMAND,
        value,
      );
    },
    { discrete: true },
  );
  return handled;
}

describe("ReviewExtension lifecycle", () => {
  it("registers every review node and opens its document after Lexical initialization", async () => {
    const outcomes: ReviewRoutedOutcome[] = [];
    const report = vi.fn();
    const editor = buildEditorFromExtensions({
      name: "review-extension-initialization",
      $initialEditorState: () => {
        $getRoot().append(
          $createParagraphNode().append($createTextNode("other")),
        );
      },
      dependencies: [
        configExtension(ReviewExtension, {
          initialDocument: baseline(),
          options: {
            onOutcome: (outcome, operation) => {
              outcomes.push(outcome);
              report(outcome, operation);
            },
            proposalIdFactory: () => "ext-1",
          },
        }),
      ],
    });
    try {
      await Promise.resolve();
      expect(
        editor.hasNodes([
          ReviewBoundaryNode,
          ReviewDeletionNode,
          ReviewFormattingNode,
          ReviewFragmentNode,
          ReviewInsertionNode,
        ]),
      ).toBe(true);
      const review = getExtensionDependencyFromEditor(
        editor,
        ReviewExtension,
      ).output;
      expect(review.session.value?.exportDocument()).toEqual({
        status: "valid",
        value: baseline(),
      });
      select(editor);
      expect(insert(editor, "X")).toBe(true);
      expect(outcomes).toHaveLength(1);
      expect(report).toHaveBeenCalledExactlyOnceWith(
        outcomes[0],
        "insert-text",
      );
      expect(review.session.value?.exportDocument()).toMatchObject({
        status: "valid",
        value: {
          root: {
            children: [
              {
                children: [
                  { text: "A" },
                  {
                    type: "review-insertion",
                    proposalId: "ext-1",
                    children: [{ text: "X" }],
                  },
                  { text: "B" },
                ],
              },
            ],
          },
        },
      });
    } finally {
      editor.dispose();
    }
  });

  it("waits for a validated document and preserves the active session on invalid input", () => {
    const editor = buildEditorFromExtensions(ReviewExtension);
    const review = getExtensionDependencyFromEditor(
      editor,
      ReviewExtension,
    ).output;
    try {
      expect(review.session.value).toBeNull();
      expect(insert(editor, "X")).toBe(false);
      expect(review.openDocument(baseline()).status).toBe("valid");
      select(editor);
      const session = review.session.value;
      const state = editor.getEditorState();
      expect(review.openDocument({ root: {} }).status).toBe("invalid");
      const unsupported = baseline();
      unsupported.root.$["lexical-review"].version = 2;
      expect(review.openDocument(unsupported).status).toBe("unsupported");
      expect(review.session.value).toBe(session);
      expect(editor.getEditorState()).toBe(state);
      expect(insert(editor, "X")).toBe(true);
    } finally {
      editor.dispose();
    }
  });

  it("rejects invalid and unsupported configured initial documents", () => {
    expect(() =>
      buildEditorFromExtensions(
        configExtension(ReviewExtension, {
          initialDocument: { root: {} },
        }),
      ),
    ).toThrow("The root node must contain only version 3 core fields.");
    const unsupported = baseline();
    unsupported.root.$["lexical-review"].version = 2;
    expect(() =>
      buildEditorFromExtensions(
        configExtension(ReviewExtension, {
          initialDocument: unsupported,
        }),
      ),
    ).toThrow("Only native review-document version 3 is supported.");
  });

  it("detaches, reopens, and disposes routing without duplicate registrations", () => {
    const outcomes: ReviewRoutedOutcome[] = [];
    const editor = buildEditorFromExtensions(
      configExtension(ReviewExtension, {
        initialDocument: baseline(),
        options: { onOutcome: (outcome) => outcomes.push(outcome) },
      }),
    );
    const review = getExtensionDependencyFromEditor(
      editor,
      ReviewExtension,
    ).output;
    try {
      select(editor);
      expect(insert(editor, "X")).toBe(true);
      const state = editor.getEditorState();
      review.closeSession();
      expect(review.session.value).toBeNull();
      expect(editor.getEditorState()).toBe(state);
      expect(insert(editor, "Y")).toBe(false);
      expect(review.openDocument(baseline()).status).toBe("valid");
      select(editor);
      expect(insert(editor, "Z")).toBe(true);
      expect(outcomes).toHaveLength(2);
    } finally {
      editor.dispose();
    }
    expect(review.session.value).toBeNull();
    expect(insert(editor, "Q")).toBe(false);
    expect(() => review.openDocument(baseline())).toThrow("before disposal");
  });

  it("updates routing options without reopening the document", () => {
    const oldOutcomes: ReviewRoutedOutcome[] = [];
    const newOutcomes: ReviewRoutedOutcome[] = [];
    const editor = buildEditorFromExtensions(
      configExtension(ReviewExtension, {
        initialDocument: reviewDocument([
          paragraph([reviewNode("review-insertion", "ins-1", [text("X")])]),
        ]),
        options: { onOutcome: (outcome) => oldOutcomes.push(outcome) },
      }),
    );
    const review = getExtensionDependencyFromEditor(
      editor,
      ReviewExtension,
    ).output;
    const clipboard = () =>
      ({
        preventDefault: vi.fn(),
        clipboardData: { setData: vi.fn() },
      }) as unknown as ClipboardEvent;
    try {
      editor.update(() => $getRoot().getAllTextNodes()[0]!.select(0, 1), {
        discrete: true,
      });
      expect(editor.dispatchCommand(COPY_COMMAND, clipboard())).toBe(true);
      expect(oldOutcomes).toMatchObject([{ status: "changed" }]);
      const session = review.session.value;
      const state = editor.getEditorState();
      review.options.value = {
        copyProjection: "accepted-state",
        onOutcome: (outcome) => newOutcomes.push(outcome),
      };
      expect(editor.dispatchCommand(COPY_COMMAND, clipboard())).toBe(true);
      expect(newOutcomes).toMatchObject([
        { status: "refused", code: "empty-projection" },
      ]);
      expect(oldOutcomes).toHaveLength(1);
      expect(review.session.value).toBe(session);
      expect(editor.getEditorState()).toBe(state);
    } finally {
      editor.dispose();
    }
  });

  it("keeps editor-scoped sessions and options independent", () => {
    const first = buildEditorFromExtensions(
      configExtension(ReviewExtension, { initialDocument: baseline() }),
    );
    const second = buildEditorFromExtensions(
      configExtension(ReviewExtension, {
        initialDocument: reviewDocument([
          paragraph([reviewNode("review-insertion", "ins-1", [text("X")])]),
        ]),
      }),
    );
    try {
      const firstReview = getExtensionDependencyFromEditor(
        first,
        ReviewExtension,
      ).output;
      const secondReview = getExtensionDependencyFromEditor(
        second,
        ReviewExtension,
      ).output;
      expect(firstReview.options).not.toBe(secondReview.options);
      firstReview.options.value = { copyProjection: "accepted-state" };
      expect(secondReview.options.value).toEqual({});
      firstReview.closeSession();
      expect(secondReview.session.value).not.toBeNull();
      expect(second.dispatchCommand(COPY_COMMAND, null)).toBe(true);
    } finally {
      first.dispose();
      second.dispose();
    }
  });
});
