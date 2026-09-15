import {
  $getRoot,
  $getSelection,
  $isElementNode,
  $isRangeSelection,
  KEY_ARROW_LEFT_COMMAND,
  KEY_ARROW_RIGHT_COMMAND,
  createEditor,
  type LexicalNode,
  type TextNode,
} from "lexical";
import {
  $deleteReviewText,
  $insertReviewText,
  $inspectReviewProposal,
  $insertReviewFragment,
  $splitReviewParagraph,
  $setReviewFormatting,
  $isReviewInsertionNode,
  $isReviewFormattingNode,
  ReviewFragmentNode,
  ReviewInsertionNode,
  ReviewDeletionNode,
  ReviewFormattingNode,
  ReviewBoundaryNode,
  openReviewSession,
} from "./index";
import { registerReviewSession } from "./client";
import {
  paragraph,
  reviewDocument,
  text,
} from "./ReviewDocument.test-fixtures";

/**
 * Precedence pins for the intent-dispatch collapse.
 *
 * Each test arranges review state through public intents, then probes a
 * position where two or more kind modules could claim the selection. The
 * asserted winner documents today's implicit call order, so the refactor
 * can make that order explicit without changing it. These tests must pass
 * unchanged before and after.
 */
function setup(values = ["AB"]) {
  const editor = createEditor({
    namespace: "intent-dispatch",
    nodes: [
      ReviewFragmentNode,
      ReviewInsertionNode,
      ReviewDeletionNode,
      ReviewFormattingNode,
      ReviewBoundaryNode,
    ],
    onError(error) {
      throw error;
    },
  });
  const opened = openReviewSession(
    editor,
    reviewDocument(values.map((value) => paragraph([text(value)]))),
  );
  if (opened.status !== "valid") throw new Error("Invalid fixture");
  const update = (fn: () => void) => editor.update(fn, { discrete: true });
  return { editor, session: opened.value, update };
}

const id = (value: string) => ({ proposalIdFactory: () => value });

function acceptedText(index = 0) {
  return $getRoot().getAllTextNodes()[index]!;
}

function childWrappers() {
  return $getRoot()
    .getChildren()
    .filter($isElementNode)
    .flatMap((p) => p.getChildren());
}

function insertionText() {
  const wrapper = childWrappers().find($isReviewInsertionNode)!;
  return wrapper.getChildren()[0] as TextNode;
}

function deletionText() {
  const wrapper = childWrappers().find((n) => n instanceof ReviewDeletionNode)!;
  return wrapper.getChildren()[0] as TextNode;
}

function formattingText() {
  const wrapper = childWrappers().find($isReviewFormattingNode)!;
  return wrapper.getChildren()[0] as TextNode;
}

function fragmentWrappers() {
  return childWrappers().filter((n) => n instanceof ReviewFragmentNode);
}

function fragmentText(wrapperIndex = 0, childIndex = 0) {
  const wrapper = fragmentWrappers()[wrapperIndex]!;
  return wrapper.getChildren()[childIndex] as TextNode;
}

function acceptedByText(value: string) {
  return $getRoot()
    .getAllTextNodes()
    .find(
      (n) =>
        n.getTextContent() === value &&
        $isElementNode(n.getParent()) &&
        n.getParent()!.getType() === "paragraph",
    )!;
}

function paragraphText(index: number) {
  const child = $getRoot().getChildren()[index]!;
  if (!$isElementNode(child)) throw new Error("Expected a paragraph.");
  return child.getTextContent();
}

/**
 * Reviewer-ergonomics caret: visual offset within the paragraph plus the
 * host side. The offset is what a reviewer sees; the side (proposal vs
 * accepted) drives the next keypress (typing continuation), so a bare
 * offset would under-specify the outcome. Node keys and splits are
 * Lexical internals and stay out of the assertion.
 */
function visualCaret(): {
  offset: number;
  side: "accepted" | "proposal" | "element";
} {
  const selection = $getSelection();
  if (!$isRangeSelection(selection) || !selection.isCollapsed())
    throw new Error("Expected a collapsed caret.");
  const anchor = selection.anchor;
  if (anchor.type === "element") {
    const node = anchor.getNode();
    if (!$isElementNode(node)) throw new Error("Expected an element caret.");
    // Visual offset of the element point within its paragraph; the side
    // names the paragraph-level host (element only for the paragraph
    // itself, e.g. the lone-removal contract).
    let offset = 0;
    for (const child of node.getChildren().slice(0, anchor.offset))
      offset += child.getTextContent().length;
    let top: LexicalNode = node;
    let current: LexicalNode | null = node;
    while (
      current !== null &&
      $isElementNode(current) &&
      current.getType() !== "paragraph"
    ) {
      for (const sibling of current.getPreviousSiblings())
        offset += sibling.getTextContent().length;
      top = current;
      current = current.getParent();
    }
    if (top === node && node.getType() === "paragraph")
      return { offset, side: "element" };
    return {
      offset,
      side:
        $isElementNode(top) && top.getType() !== "paragraph"
          ? "proposal"
          : "accepted",
    };
  }
  const node = anchor.getNode();
  const parent = node.getParent();
  const side =
    parent !== null &&
    $isElementNode(parent) &&
    parent.getType() === "paragraph"
      ? "accepted"
      : "proposal";
  let offset = anchor.offset;
  let current: LexicalNode | null = node;
  while (current !== null) {
    for (const sibling of current.getPreviousSiblings())
      offset += sibling.getTextContent().length;
    current = current.getParent();
    if (
      current !== null &&
      $isElementNode(current) &&
      current.getType() === "paragraph"
    )
      break;
  }
  return { offset, side };
}

const twoParaFragment = () =>
  $insertReviewFragment(
    [
      { runs: [{ text: "X", format: 0 }] },
      { runs: [{ text: "Y", format: 0 }] },
    ],
    id("frag"),
  );

it("deletion inside a pending insertion shrinks the insertion", () => {
  const { editor, update } = setup();
  update(() => {
    acceptedText().select(1, 1);
    expect($insertReviewText("xy", id("ins")).status).toBe("changed");
    insertionText().select(1, 1);
    expect($deleteReviewText(true).status).toBe("changed");
  });
  const inspected = editor
    .getEditorState()
    .read(() => $inspectReviewProposal("ins"));
  expect(inspected).toEqual({
    status: "unchanged",
    value: { kind: "insertion", proposal: { proposalId: "ins", text: "y" } },
  });
});

it("backward deletion at the start of a pending insertion deletes accepted text", () => {
  const { editor, update } = setup();
  update(() => {
    acceptedText().select(1, 1);
    expect($insertReviewText("x", id("ins")).status).toBe("changed");
    insertionText().select(0, 0);
    expect($deleteReviewText(true, id("del")).status).toBe("changed");
  });
  const inspected = editor
    .getEditorState()
    .read(() => $inspectReviewProposal("del"));
  expect(inspected).toEqual({
    status: "unchanged",
    value: { kind: "deletion", proposal: { proposalId: "del", text: "A" } },
  });
  const insertion = editor
    .getEditorState()
    .read(() => $inspectReviewProposal("ins"));
  expect(insertion).toEqual({
    status: "unchanged",
    value: { kind: "insertion", proposal: { proposalId: "ins", text: "x" } },
  });
});

it("deletion inside a pending deletion resolves it instead of nesting", () => {
  const { editor, update } = setup(["ABC"]);
  update(() => {
    acceptedText().select(3, 3);
    expect($deleteReviewText(true, id("del")).status).toBe("changed");
    deletionText().select(1, 1);
    expect($deleteReviewText(true).status).toBe("changed");
  });
  expect(editor.getEditorState().read(() => $getRoot().getTextContent())).toBe(
    "ABC",
  );
});

it("deletion of accepted text continues an adjacent deletion under one identity", () => {
  const { editor, update } = setup(["ABC"]);
  const factory = () => "del";
  update(() => {
    acceptedText().select(3, 3);
    expect($deleteReviewText(true, { proposalIdFactory: factory }).status).toBe(
      "changed",
    );
    // The caret lands at the end of the surviving accepted text.
    expect($deleteReviewText(true, { proposalIdFactory: factory }).status).toBe(
      "changed",
    );
  });
  const inspected = editor
    .getEditorState()
    .read(() => $inspectReviewProposal("del"));
  expect(inspected).toEqual({
    status: "unchanged",
    value: { kind: "deletion", proposal: { proposalId: "del", text: "BC" } },
  });
});

it("backward deletion at a paragraph start proposes a merge", () => {
  const { editor, update } = setup(["AB", "CD"]);
  update(() => {
    $getRoot().getAllTextNodes()[1]!.select(0, 0);
    expect($deleteReviewText(true, id("merge")).status).toBe("changed");
  });
  const inspected = editor
    .getEditorState()
    .read(() => $inspectReviewProposal("merge"));
  expect(inspected.status).toBe("unchanged");
  if (inspected.status === "unchanged")
    expect(inspected.value.kind).toBe("structure");
});

it("word deletion at a paragraph start skips the structural claim", () => {
  const { update } = setup(["AB", "CD"]);
  update(() => {
    $getRoot().getAllTextNodes()[1]!.select(0, 0);
    const outcome = $deleteReviewText(true, { granularity: "word" });
    expect(outcome.status).toBe("refused");
    if (outcome.status === "refused")
      expect(outcome.code).toBe("deletion-target-unavailable");
  });
});

it("deletion inside a fragment edits the fragment without a new identity", () => {
  const { editor, update } = setup(["AB"]);
  const factory = () => "frag";
  update(() => {
    acceptedText().select(1, 1);
    expect(
      $insertReviewFragment(
        [
          { runs: [{ text: "X", format: 0 }] },
          { runs: [{ text: "Y", format: 0 }] },
        ],
        { proposalIdFactory: factory },
      ).status,
    ).toBe("changed");
    fragmentText(0).select(1, 1);
    expect($deleteReviewText(true, { proposalIdFactory: factory }).status).toBe(
      "changed",
    );
  });
  const inspected = editor
    .getEditorState()
    .read(() => $inspectReviewProposal("frag"));
  expect(inspected.status).toBe("unchanged");
  if (inspected.status === "unchanged")
    expect(inspected.value.kind).toBe("fragment");
});

it("backward deletion at a fragment edge targets the accepted neighbor (#86 row 8 outward)", () => {
  const { editor, update } = setup(["AB"]);
  update(() => {
    acceptedText().select(1, 1);
    expect(twoParaFragment().status).toBe("changed");
    fragmentText(0).select(0, 0);
    expect($deleteReviewText(true, id("other")).status).toBe("changed");
  });
  const other = editor
    .getEditorState()
    .read(() => $inspectReviewProposal("other"));
  expect(other).toEqual({
    status: "unchanged",
    value: { kind: "deletion", proposal: { proposalId: "other", text: "A" } },
  });
  const frag = editor
    .getEditorState()
    .read(() => $inspectReviewProposal("frag"));
  expect(frag.status).toBe("unchanged");
});

it("deletion inside a formatting target is refused", () => {
  const { update } = setup(["ABC"]);
  update(() => {
    acceptedText().select(0, 3);
    expect($setReviewFormatting({ bold: true }, id("fmt")).status).toBe(
      "changed",
    );
    formattingText().select(1, 1);
    const outcome = $deleteReviewText(true);
    expect(outcome.status).toBe("refused");
    if (outcome.status === "refused")
      expect(outcome.code).toBe("unsupported-proposal-edit");
  });
});

it("forward deletion at the end of a pending insertion deletes accepted text", () => {
  const { editor, update } = setup();
  update(() => {
    acceptedText().select(1, 1);
    expect($insertReviewText("xy", id("ins")).status).toBe("changed");
    insertionText().select(2, 2);
    expect($deleteReviewText(false, id("del")).status).toBe("changed");
  });
  const inspected = editor
    .getEditorState()
    .read(() => $inspectReviewProposal("del"));
  expect(inspected).toEqual({
    status: "unchanged",
    value: { kind: "deletion", proposal: { proposalId: "del", text: "B" } },
  });
  const insertion = editor
    .getEditorState()
    .read(() => $inspectReviewProposal("ins"));
  expect(insertion).toEqual({
    status: "unchanged",
    value: { kind: "insertion", proposal: { proposalId: "ins", text: "xy" } },
  });
});

it("backward deletion from an element caret with accepted text to the left deletes one character", () => {
  const { editor, update } = setup();
  update(() => {
    acceptedText().select(1, 1);
    expect($insertReviewText("x", id("ins")).status).toBe("changed");
    // Paragraph holds [A, insertion(X), B]; the element caret sits between
    // the accepted text and the insertion wrapper.
    const paragraph = $getRoot().getChildren()[0];
    if (!$isElementNode(paragraph)) throw new Error("Expected a paragraph.");
    paragraph.select(1, 1);
    expect($deleteReviewText(true, id("del")).status).toBe("changed");
  });
  const inspected = editor
    .getEditorState()
    .read(() => $inspectReviewProposal("del"));
  expect(inspected).toEqual({
    status: "unchanged",
    value: { kind: "deletion", proposal: { proposalId: "del", text: "A" } },
  });
  const insertion = editor
    .getEditorState()
    .read(() => $inspectReviewProposal("ins"));
  expect(insertion).toEqual({
    status: "unchanged",
    value: { kind: "insertion", proposal: { proposalId: "ins", text: "x" } },
  });
});

it("a second backward deletion re-applies to the proposal neighbor (#86 row 11)", () => {
  const { editor, update } = setup(["B"]);
  update(() => {
    acceptedText().select(0, 0);
    expect($insertReviewText("x", id("ins")).status).toBe("changed");
    // Paragraph holds [insertion(X), B]; deleting B lands an element caret
    // before the new deletion because its previous sibling is a wrapper.
    acceptedText(1).select(1, 1);
    expect($deleteReviewText(true, id("del")).status).toBe("changed");
    const selection = $getSelection();
    if (!$isRangeSelection(selection))
      throw new Error("Expected a range selection.");
    expect(selection.anchor.type).toBe("element");
    expect(selection.anchor.offset).toBe(1);
    // The caret points at the insertion wrapper: re-apply shrinks it (#86
    // row 2), removing the single-character wrapper.
    expect($deleteReviewText(true, id("other")).status).toBe("changed");
  });
  expect(
    editor.getEditorState().read(() => $inspectReviewProposal("ins").status),
  ).toBe("refused");
  expect(
    editor.getEditorState().read(() => $inspectReviewProposal("del")),
  ).toEqual({
    status: "unchanged",
    value: { kind: "deletion", proposal: { proposalId: "del", text: "B" } },
  });
});

it("forward deletion into an insertion neighbor shrinks it proposal-side (#86 row 2)", () => {
  const { editor, update } = setup();
  update(() => {
    acceptedText().select(1, 1);
    expect($insertReviewText("xy", id("ins")).status).toBe("changed");
    acceptedByText("A").selectEnd();
    expect($deleteReviewText(false, id("other")).status).toBe("changed");
  });
  expect(
    editor.getEditorState().read(() => $inspectReviewProposal("ins")),
  ).toMatchObject({ value: { proposal: { text: "y" } } });
  expect(
    editor.getEditorState().read(() => $inspectReviewProposal("other").status),
  ).toBe("refused");
  expect(editor.getEditorState().read(() => visualCaret())).toEqual({
    offset: 1,
    side: "proposal",
  });
});

it("backward deletion into an insertion neighbor shrinks it proposal-side (#86 row 2)", () => {
  const { editor, update } = setup();
  update(() => {
    acceptedText().select(1, 1);
    expect($insertReviewText("xy", id("ins")).status).toBe("changed");
    acceptedByText("B").selectStart();
    expect($deleteReviewText(true).status).toBe("changed");
  });
  expect(
    editor.getEditorState().read(() => $inspectReviewProposal("ins")),
  ).toMatchObject({ value: { proposal: { text: "x" } } });
  expect(editor.getEditorState().read(() => visualCaret())).toEqual({
    offset: 2,
    side: "proposal",
  });
});

it("word deletion into an insertion neighbor stays bounded inside it (#86 row 2)", () => {
  const { editor, update } = setup(["EF"]);
  update(() => {
    acceptedText().select(0, 0);
    expect($insertReviewText("ab cd", id("ins")).status).toBe("changed");
    const para = $getRoot().getChildren()[0]!;
    if (!$isElementNode(para)) throw new Error("Expected paragraph");
    para.select(0, 0);
    expect($deleteReviewText(false, { granularity: "word" }).status).toBe(
      "changed",
    );
  });
  const ins = editor.getEditorState().read(() => $inspectReviewProposal("ins"));
  expect(ins.status).toBe("unchanged");
  if (ins.status === "unchanged" && ins.value.kind === "insertion")
    expect(ins.value.proposal.text).toBe(" cd");
  expect(editor.getEditorState().read(() => $getRoot().getTextContent())).toBe(
    " cdEF",
  );
  expect(editor.getEditorState().read(() => visualCaret())).toEqual({
    offset: 0,
    side: "proposal",
  });
});

it("emptying an insertion neighbor removes its wrapper (#86 row 2)", () => {
  const { editor, update } = setup();
  update(() => {
    acceptedText().select(1, 1);
    expect($insertReviewText("x", id("ins")).status).toBe("changed");
    acceptedByText("A").selectEnd();
    expect($deleteReviewText(false).status).toBe("changed");
  });
  expect(
    editor.getEditorState().read(() => $inspectReviewProposal("ins").status),
  ).toBe("refused");
  expect(editor.getEditorState().read(() => visualCaret())).toEqual({
    offset: 1,
    side: "accepted",
  });
});

it("forward deletion into a deletion neighbor restores it with caret at the end (#86 row 4)", () => {
  const { editor, update } = setup(["ABCD"]);
  update(() => {
    acceptedText().select(1, 3);
    expect($deleteReviewText(false, id("del")).status).toBe("changed");
  });
  // Forward from before: A|<del>BC</del> + Del → A|BC passes through to ABC|D.
  update(() => {
    acceptedByText("A").selectEnd();
    expect($deleteReviewText(false).status).toBe("changed");
  });
  expect(editor.getEditorState().read(() => $getRoot().getTextContent())).toBe(
    "ABCD",
  );
  expect(
    editor.getEditorState().read(() => $inspectReviewProposal("del").status),
  ).toBe("refused");
  // Whole-restore lands at the end of restored text for every origin.
  expect(editor.getEditorState().read(() => visualCaret())).toEqual({
    offset: 3,
    side: "accepted",
  });
});

it("backward deletion into a deletion neighbor lands at the end of restored text (#86 row 4)", () => {
  const { editor, update } = setup(["ABCD"]);
  update(() => {
    acceptedText().select(1, 2);
    expect($deleteReviewText(false, id("del")).status).toBe("changed");
    acceptedByText("CD").selectStart();
    expect($deleteReviewText(true).status).toBe("changed");
  });
  expect(editor.getEditorState().read(() => $getRoot().getTextContent())).toBe(
    "ABCD",
  );
  // End of restored text: merged ABCD offset 2 == B|CD.
  expect(editor.getEditorState().read(() => visualCaret())).toEqual({
    offset: 2,
    side: "accepted",
  });
});

it("forward deletion into a replacement old side whole-cancels, including word (#86 row 5)", () => {
  for (const granularity of ["character", "word"] as const) {
    const { editor, update } = setup(["QAB"]);
    update(() => {
      acceptedText().select(1, 3);
      expect($insertReviewText("xy", id("r")).status).toBe("changed");
      acceptedByText("Q").selectEnd();
      expect($deleteReviewText(false, { granularity }).status).toBe("changed");
    });
    expect(
      editor.getEditorState().read(() => $getRoot().getTextContent()),
    ).toBe("QAB");
    expect(
      editor.getEditorState().read(() => $inspectReviewProposal("r").status),
    ).toBe("refused");
    // Whole-cancel lands at the end of restored old text, like restore.
    expect(editor.getEditorState().read(() => visualCaret())).toEqual({
      offset: 3,
      side: "accepted",
    });
  }
});

it("terminal deletion inside a replacement new side cancels to AB| both directions (#86 row 3)", () => {
  for (const [select, backward] of [
    ["end", true],
    ["start", false],
  ] as const) {
    const { editor, update } = setup(["AB"]);
    update(() => {
      acceptedText().select(0, 2);
      expect($insertReviewText("x", id("r")).status).toBe("changed");
      const node = insertionText();
      if (select === "end") node.selectEnd();
      else node.selectStart();
      expect($deleteReviewText(backward).status).toBe("changed");
    });
    expect(
      editor.getEditorState().read(() => $getRoot().getTextContent()),
    ).toBe("AB");
    expect(
      editor.getEditorState().read(() => $inspectReviewProposal("r").status),
    ).toBe("refused");
    expect(editor.getEditorState().read(() => visualCaret())).toEqual({
      offset: 2,
      side: "accepted",
    });
  }
});

it("nonterminal deletion inside a replacement new side shrinks and keeps it (#86 row 3)", () => {
  const { editor, update } = setup(["AB"]);
  update(() => {
    acceptedText().select(0, 2);
    expect($insertReviewText("xy", id("r")).status).toBe("changed");
    insertionText().selectEnd();
    expect($deleteReviewText(true).status).toBe("changed");
  });
  expect(
    editor.getEditorState().read(() => $inspectReviewProposal("r")),
  ).toMatchObject({ value: { proposal: { oldText: "AB", newText: "x" } } });
  expect(editor.getEditorState().read(() => visualCaret())).toEqual({
    offset: 3,
    side: "proposal",
  });
});

it("replacement seam is asymmetric: backward cancels, forward shrinks (#86 row 6)", () => {
  const { editor, update } = setup(["AB"]);
  update(() => {
    acceptedText().select(0, 2);
    expect($insertReviewText("xy", id("r")).status).toBe("changed");
    insertionText().selectStart();
    expect($deleteReviewText(true).status).toBe("changed");
  });
  expect(editor.getEditorState().read(() => $getRoot().getTextContent())).toBe(
    "AB",
  );
  expect(editor.getEditorState().read(() => visualCaret())).toEqual({
    offset: 2,
    side: "accepted",
  });

  const second = setup(["AB"]);
  second.update(() => {
    acceptedText().select(0, 2);
    expect($insertReviewText("xy", id("r")).status).toBe("changed");
    deletionText().selectEnd();
    expect($deleteReviewText(false).status).toBe("changed");
  });
  expect(
    second.editor.getEditorState().read(() => $inspectReviewProposal("r")),
  ).toMatchObject({ value: { proposal: { oldText: "AB", newText: "y" } } });
  expect(second.editor.getEditorState().read(() => visualCaret())).toEqual({
    offset: 2,
    side: "proposal",
  });
});

it("word deletion at a replacement seam shrinks instead of cancelling (#86 row 6)", () => {
  const { editor, update } = setup(["AB"]);
  update(() => {
    acceptedText().select(0, 2);
    expect($insertReviewText("xy zz", id("r")).status).toBe("changed");
    deletionText().selectEnd();
    expect($deleteReviewText(false, { granularity: "word" }).status).toBe(
      "changed",
    );
  });
  const inspected = editor
    .getEditorState()
    .read(() => $inspectReviewProposal("r"));
  expect(inspected.status).toBe("unchanged");
  if (
    inspected.status === "unchanged" &&
    inspected.value.kind === "replacement"
  ) {
    expect(inspected.value.proposal.oldText).toBe("AB");
    expect(inspected.value.proposal.newText).toBe(" zz");
    expect(editor.getEditorState().read(() => visualCaret())).toEqual({
      offset: 2,
      side: "proposal",
    });
  }
});

it("outside-to-format refuses while inside-format deletes the accepted neighbor (#86 row 7)", () => {
  const { editor, update } = setup(["ABCD"]);
  update(() => {
    acceptedText().select(1, 3);
    expect($setReviewFormatting({ bold: true }, id("fmt")).status).toBe(
      "changed",
    );
    acceptedByText("A").selectEnd();
    const outcome = $deleteReviewText(false);
    expect(outcome.status).toBe("refused");
    if (outcome.status === "refused")
      expect(outcome.code).toBe("unsupported-proposal-edit");
  });
  expect(
    editor.getEditorState().read(() => $inspectReviewProposal("fmt").status),
  ).toBe("unchanged");

  const second = setup(["ABCD"]);
  second.update(() => {
    acceptedText().select(1, 3);
    expect($setReviewFormatting({ bold: true }, id("fmt")).status).toBe(
      "changed",
    );
    formattingText().selectEnd();
    // Inside-format end forward into accepted D creates a fresh deletion.
    expect($deleteReviewText(false, id("del")).status).toBe("changed");
  });
  expect(
    second.editor.getEditorState().read(() => $inspectReviewProposal("del")),
  ).toMatchObject({ value: { proposal: { text: "D" } } });
  expect(
    second.editor
      .getEditorState()
      .read(() => $inspectReviewProposal("fmt").status),
  ).toBe("unchanged");
  expect(second.editor.getEditorState().read(() => visualCaret())).toEqual({
    offset: 4,
    side: "element",
  });
});

it("structural deletion wins at a paragraph boundary over a proposal edge (#86 row 9)", () => {
  const { editor, update } = setup(["AB", "CD"]);
  update(() => {
    acceptedText(1).select(0, 0);
    expect($insertReviewText("x", id("ins")).status).toBe("changed");
    insertionText().select(0, 0);
    expect($deleteReviewText(true, id("merge")).status).toBe("changed");
  });
  const merge = editor
    .getEditorState()
    .read(() => $inspectReviewProposal("merge"));
  expect(merge.status).toBe("unchanged");
  if (merge.status === "unchanged") expect(merge.value.kind).toBe("structure");
  expect(
    editor.getEditorState().read(() => $inspectReviewProposal("ins").status),
  ).toBe("unchanged");
  expect(editor.getEditorState().read(() => visualCaret())).toEqual({
    offset: 2,
    side: "element",
  });
});

it("forward deletion from accepted text corrects into the faced fragment (#86 row 8 inward)", () => {
  const { editor, update } = setup(["A", "B"]);
  update(() => {
    acceptedText(0).selectEnd();
    expect(
      $insertReviewFragment(
        [
          { runs: [{ text: "XY", format: 0 }] },
          { runs: [{ text: "Z", format: 0 }] },
        ],
        id("frag"),
      ).status,
    ).toBe("changed");
    // Paragraph 1 is now [A, frag(XY)]; paragraph 2 [frag(Z)].
    acceptedByText("A").selectEnd();
    expect($deleteReviewText(false).status).toBe("changed");
  });
  // Only X removed; the fragment keeps its ID with ["Y", "Z"].
  expect(
    editor.getEditorState().read(() => $inspectReviewProposal("frag")),
  ).toMatchObject({
    value: {
      kind: "fragment",
      proposal: {
        paragraphs: [{ runs: [{ text: "Y" }] }, { runs: [{ text: "Z" }] }],
      },
    },
  });
  expect(editor.getEditorState().read(() => paragraphText(0))).toBe("AY");
  expect(editor.getEditorState().read(() => paragraphText(1))).toBe("Z");
  expect(editor.getEditorState().read(() => visualCaret())).toEqual({
    offset: 1,
    side: "proposal",
  });
});

it("backward deletion from accepted text corrects into the faced fragment (#86 row 8 inward)", () => {
  const { editor, update } = setup(["A", "B"]);
  update(() => {
    acceptedText(0).select(0, 0);
    expect(
      $insertReviewFragment(
        [
          { runs: [{ text: "XY", format: 0 }] },
          { runs: [{ text: "Z", format: 0 }] },
        ],
        id("frag"),
      ).status,
    ).toBe("changed");
    // Paragraph 1 is now [frag(XY)]; paragraph 2 [frag(Z), A].
    acceptedByText("A").selectStart();
    expect($deleteReviewText(true).status).toBe("changed");
  });
  expect(
    editor.getEditorState().read(() => $inspectReviewProposal("frag")),
  ).toMatchObject({
    value: {
      kind: "fragment",
      proposal: { paragraphs: [{ runs: [{ text: "XY" }] }, { runs: [] }] },
    },
  });
  expect(editor.getEditorState().read(() => paragraphText(0))).toBe("XY");
  expect(editor.getEditorState().read(() => paragraphText(1))).toBe("A");
  expect(editor.getEditorState().read(() => visualCaret())).toEqual({
    offset: 0,
    side: "proposal",
  });
});

it("word deletion into a fragment eats one run within it (#86 row 8 inward)", () => {
  const { editor, update } = setup(["A", "B"]);
  update(() => {
    acceptedText(0).selectEnd();
    expect(
      $insertReviewFragment(
        [
          { runs: [{ text: "XY", format: 0 }] },
          { runs: [{ text: "Z", format: 0 }] },
        ],
        id("frag"),
      ).status,
    ).toBe("changed");
    acceptedByText("A").selectEnd();
    expect($deleteReviewText(false, { granularity: "word" }).status).toBe(
      "changed",
    );
  });
  expect(
    editor.getEditorState().read(() => $inspectReviewProposal("frag")),
  ).toMatchObject({
    value: {
      kind: "fragment",
      proposal: { paragraphs: [{ runs: [] }, { runs: [{ text: "Z" }] }] },
    },
  });
  expect(editor.getEditorState().read(() => paragraphText(0))).toBe("A");
  expect(editor.getEditorState().read(() => paragraphText(1))).toBe("Z");
  expect(editor.getEditorState().read(() => visualCaret())).toEqual({
    offset: 1,
    side: "proposal",
  });
});

it("element caret into a fragment corrects identically to text entry (#86 row 8 inward, row 10)", () => {
  const { editor, update } = setup(["A", "B"]);
  update(() => {
    acceptedText(0).selectEnd();
    expect(
      $insertReviewFragment(
        [
          { runs: [{ text: "XY", format: 0 }] },
          { runs: [{ text: "Z", format: 0 }] },
        ],
        id("frag"),
      ).status,
    ).toBe("changed");
    const para = $getRoot().getChildren()[0]!;
    if (!$isElementNode(para)) throw new Error("Expected paragraph");
    para.select(1, 1);
    expect($deleteReviewText(false).status).toBe("changed");
  });
  expect(
    editor.getEditorState().read(() => $inspectReviewProposal("frag")),
  ).toMatchObject({
    value: {
      kind: "fragment",
      proposal: {
        paragraphs: [{ runs: [{ text: "Y" }] }, { runs: [{ text: "Z" }] }],
      },
    },
  });
  expect(editor.getEditorState().read(() => paragraphText(0))).toBe("AY");
  expect(editor.getEditorState().read(() => visualCaret())).toEqual({
    offset: 1,
    side: "proposal",
  });
});

it("proposal-side caret into a fragment corrects identically, leaving its proposal untouched (#86 row 8 inward, row 10)", () => {
  const { editor, update } = setup(["B"]);
  update(() => {
    acceptedText().select(0, 0);
    expect($insertReviewText("A", id("ins")).status).toBe("changed");
    // Paragraph 1 is now [ins(A), B].
    acceptedByText("B").selectStart();
    expect(
      $insertReviewFragment(
        [
          { runs: [{ text: "XY", format: 0 }] },
          { runs: [{ text: "Z", format: 0 }] },
        ],
        id("frag"),
      ).status,
    ).toBe("changed");
    // Paragraph 1 is now [ins(A), frag(XY)]; paragraph 2 [frag(Z), B].
    // The caret stays attached to A: same gap as the element entry.
    insertionText().selectEnd();
    expect($deleteReviewText(false).status).toBe("changed");
  });
  expect(
    editor.getEditorState().read(() => $inspectReviewProposal("frag")),
  ).toMatchObject({
    value: {
      kind: "fragment",
      proposal: {
        paragraphs: [{ runs: [{ text: "Y" }] }, { runs: [{ text: "Z" }] }],
      },
    },
  });
  expect(
    editor.getEditorState().read(() => $inspectReviewProposal("ins")),
  ).toMatchObject({ value: { proposal: { text: "A" } } });
  expect(editor.getEditorState().read(() => paragraphText(0))).toBe("AY");
  expect(editor.getEditorState().read(() => visualCaret())).toEqual({
    offset: 1,
    side: "proposal",
  });
});

it("element caret backward into a fragment matches text entry (#86 row 8 inward, row 10)", () => {
  const { editor, update } = setup(["A", "B"]);
  update(() => {
    acceptedText(0).select(0, 0);
    expect(
      $insertReviewFragment(
        [
          { runs: [{ text: "XY", format: 0 }] },
          { runs: [{ text: "Z", format: 0 }] },
        ],
        id("frag"),
      ).status,
    ).toBe("changed");
    // Paragraph 1 is now [frag(XY)]; paragraph 2 [frag(Z), A].
    const para = $getRoot().getChildren()[1]!;
    if (!$isElementNode(para)) throw new Error("Expected paragraph");
    para.select(1, 1);
    expect($deleteReviewText(true).status).toBe("changed");
  });
  expect(
    editor.getEditorState().read(() => $inspectReviewProposal("frag")),
  ).toMatchObject({
    value: {
      kind: "fragment",
      proposal: { paragraphs: [{ runs: [{ text: "XY" }] }, { runs: [] }] },
    },
  });
  expect(editor.getEditorState().read(() => paragraphText(0))).toBe("XY");
  expect(editor.getEditorState().read(() => paragraphText(1))).toBe("A");
  expect(editor.getEditorState().read(() => visualCaret())).toEqual({
    offset: 0,
    side: "proposal",
  });
});

it("paragraph-boundary deletion facing a later fragment stays refused (#86 rows 9+12)", () => {
  const { editor, update } = setup(["A", "B", "C"]);
  update(() => {
    acceptedText(1).select(0, 0);
    expect(
      $insertReviewFragment(
        [
          { runs: [{ text: "X", format: 0 }] },
          { runs: [{ text: "Y", format: 0 }] },
        ],
        id("frag"),
      ).status,
    ).toBe("changed");
    // Paragraphs: [A], [frag(X)], [frag(Y), B], [C]; A-end faces a
    // paragraph boundary, not same-paragraph fragment content, so the
    // structural owner keeps its existing refusal (row 12).
    acceptedByText("A").selectEnd();
    expect($deleteReviewText(false, id("merge")).status).toBe("refused");
  });
  expect(
    editor.getEditorState().read(() => $inspectReviewProposal("merge").status),
  ).toBe("refused");
  expect(
    editor.getEditorState().read(() => $inspectReviewProposal("frag").status),
  ).toBe("unchanged");
  expect(editor.getEditorState().read(() => paragraphText(0))).toBe("A");
  expect(editor.getEditorState().read(() => paragraphText(1))).toBe("X");
  expect(editor.getEditorState().read(() => paragraphText(2))).toBe("YB");
  expect(editor.getEditorState().read(() => paragraphText(3))).toBe("C");
});

it("forward deletion from an element caret into insertion shrinks it (#86 row 10)", () => {
  const { editor, update } = setup();
  update(() => {
    acceptedText().select(1, 1);
    expect($insertReviewText("xy", id("ins")).status).toBe("changed");
    const para = $getRoot().getChildren()[0]!;
    if (!$isElementNode(para)) throw new Error("Expected paragraph");
    para.select(1, 1);
    expect($deleteReviewText(false).status).toBe("changed");
  });
  expect(
    editor.getEditorState().read(() => $inspectReviewProposal("ins")),
  ).toMatchObject({ value: { proposal: { text: "y" } } });
  expect(editor.getEditorState().read(() => visualCaret())).toEqual({
    offset: 1,
    side: "proposal",
  });
});

it("repeat deletion from an element caret chains until the neighbor is gone (#86 row 11)", () => {
  const { editor, update } = setup(["B"]);
  update(() => {
    acceptedText().select(0, 0);
    expect($insertReviewText("xy", id("ins")).status).toBe("changed");
    const para = $getRoot().getChildren()[0]!;
    if (!$isElementNode(para)) throw new Error("Expected paragraph");
    para.select(0, 0);
    expect($deleteReviewText(false).status).toBe("changed");
    expect($deleteReviewText(false).status).toBe("changed");
  });
  expect(
    editor.getEditorState().read(() => $inspectReviewProposal("ins").status),
  ).toBe("refused");
  expect(editor.getEditorState().read(() => $getRoot().getTextContent())).toBe(
    "B",
  );
  expect(editor.getEditorState().read(() => visualCaret())).toEqual({
    offset: 0,
    side: "accepted",
  });
});

it("a range from fragment content into accepted text is refused up front", () => {
  const { update } = setup(["AB"]);
  update(() => {
    acceptedText().select(1, 1);
    expect(twoParaFragment().status).toBe("changed");
    const inside = fragmentText(0);
    const outside = $getRoot()
      .getAllTextNodes()
      .find((n) => n.getTextContent() === "B")!;
    inside.select(1, 1);
    const selection = $getSelection();
    if ($isRangeSelection(selection))
      selection.focus.set(outside.getKey(), 0, "text");
    const outcome = $deleteReviewText(true);
    expect(outcome.status).toBe("refused");
    if (outcome.status === "refused")
      expect(outcome.code).toBe("unsafe-proposal-intersection");
  });
});

it("typing inside a pending insertion extends it under one identity", () => {
  const { editor, update } = setup();
  const factory = () => "ins";
  update(() => {
    acceptedText().select(1, 1);
    expect($insertReviewText("x", { proposalIdFactory: factory }).status).toBe(
      "changed",
    );
    insertionText().select(1, 1);
    expect($insertReviewText("y", { proposalIdFactory: factory }).status).toBe(
      "changed",
    );
  });
  const inspected = editor
    .getEditorState()
    .read(() => $inspectReviewProposal("ins"));
  expect(inspected).toEqual({
    status: "unchanged",
    value: { kind: "insertion", proposal: { proposalId: "ins", text: "xy" } },
  });
});

it("typing inside a pending deletion is refused", () => {
  const { update } = setup(["ABC"]);
  update(() => {
    acceptedText().select(3, 3);
    expect($deleteReviewText(true, id("del")).status).toBe("changed");
    deletionText().select(0, 0);
    const outcome = $insertReviewText("Z");
    expect(outcome.status).toBe("refused");
    if (outcome.status === "refused")
      expect(outcome.code).toBe("unsupported-proposal-edit");
  });
});

it("typing inside a fragment edits the fragment without a new identity", () => {
  const { editor, update } = setup(["AB"]);
  const factory = () => "other";
  update(() => {
    acceptedText().select(1, 1);
    expect(twoParaFragment().status).toBe("changed");
    fragmentText(0).select(1, 1);
    expect($insertReviewText("Z", { proposalIdFactory: factory }).status).toBe(
      "changed",
    );
  });
  expect(
    editor.getEditorState().read(() => $inspectReviewProposal("other").status),
  ).toBe("refused");
});

it("typing in accepted text continues an adjacent insertion", () => {
  const { editor, update } = setup();
  const factory = () => "ins";
  update(() => {
    acceptedText().select(1, 1);
    expect($insertReviewText("x", { proposalIdFactory: factory }).status).toBe(
      "changed",
    );
    // Caret back to the accepted side, directly after the insertion.
    // Live text order is A, x (insertion), B: index 2 is the accepted B.
    acceptedText(2).select(0, 0);
    expect($insertReviewText("y", { proposalIdFactory: factory }).status).toBe(
      "changed",
    );
  });
  const inspected = editor
    .getEditorState()
    .read(() => $inspectReviewProposal("ins"));
  expect(inspected).toEqual({
    status: "unchanged",
    value: { kind: "insertion", proposal: { proposalId: "ins", text: "xy" } },
  });
});

it("enter inside a fragment splits the fragment, not the paragraph", () => {
  const { editor, update } = setup(["AB"]);
  update(() => {
    acceptedText().select(1, 1);
    expect(twoParaFragment().status).toBe("changed");
    fragmentText(0).select(1, 1);
    expect($splitReviewParagraph(id("other")).status).toBe("changed");
  });
  const markers = editor
    .getEditorState()
    .read(() =>
      childWrappers().filter(
        (n) =>
          typeof (n as { getType?: () => string }).getType === "function" &&
          (n as { getType: () => string }).getType() === "review-boundary",
      ),
    );
  expect(markers).toHaveLength(0);
  expect(editor.getEditorState().read(() => fragmentWrappers().length)).toBe(3);
});

it("enter at an accepted caret proposes a paragraph split", () => {
  const { editor, update } = setup(["AB"]);
  update(() => {
    acceptedText().select(1, 1);
    expect($splitReviewParagraph(id("split")).status).toBe("changed");
  });
  const inspected = editor
    .getEditorState()
    .read(() => $inspectReviewProposal("split"));
  expect(inspected.status).toBe("unchanged");
  if (inspected.status === "unchanged")
    expect(inspected.value.kind).toBe("structure");
});

it("arrow keys enter a fragment from accepted text", () => {
  const { editor, session, update } = setup(["AB"]);
  const unregister = registerReviewSession(editor, session);
  const arrow = (backward: boolean) =>
    editor.dispatchCommand(
      backward ? KEY_ARROW_LEFT_COMMAND : KEY_ARROW_RIGHT_COMMAND,
      {
        preventDefault() {},
        shiftKey: false,
        altKey: false,
        ctrlKey: false,
        metaKey: false,
      } as unknown as KeyboardEvent,
    );
  update(() => {
    acceptedText().select(1, 1);
    expect(twoParaFragment().status).toBe("changed");
    // Accepted caret directly before the fragment: right arrow enters it.
    const head = $getRoot()
      .getAllTextNodes()
      .find((n) => n.getTextContent() === "A")!;
    head.select(1, 1);
    expect(arrow(false)).toBe(true);
  });
  unregister();
});

it("arrow keys ignore plain accepted text and range selections", () => {
  const { editor, session, update } = setup(["AB"]);
  const unregister = registerReviewSession(editor, session);
  const arrow = (backward: boolean) =>
    editor.dispatchCommand(
      backward ? KEY_ARROW_LEFT_COMMAND : KEY_ARROW_RIGHT_COMMAND,
      {
        preventDefault() {},
        shiftKey: false,
        altKey: false,
        ctrlKey: false,
        metaKey: false,
      } as unknown as KeyboardEvent,
    );
  update(() => {
    const head = $getRoot()
      .getAllTextNodes()
      .find((n) => n.getTextContent() === "AB")!;
    head.select(0, 0);
    expect(arrow(true)).toBe(false);
    head.select(0, 1);
    expect(arrow(false)).toBe(false);
  });
  unregister();
});

it("arrow keys cross a merge marker", () => {
  const { editor, session, update } = setup(["AB", "CD"]);
  const unregister = registerReviewSession(editor, session);
  const arrow = (backward: boolean) =>
    editor.dispatchCommand(
      backward ? KEY_ARROW_LEFT_COMMAND : KEY_ARROW_RIGHT_COMMAND,
      {
        preventDefault() {},
        shiftKey: false,
        altKey: false,
        ctrlKey: false,
        metaKey: false,
      } as unknown as KeyboardEvent,
    );
  update(() => {
    $getRoot().getAllTextNodes()[1]!.select(0, 0);
    expect($deleteReviewText(true, id("merge")).status).toBe("changed");
    // The merge leaves the caret after the marker: left arrow crosses it.
    expect(arrow(true)).toBe(true);
  });
  unregister();
});

it("multiline insertion is refused without touching fragment ownership", () => {
  const { update } = setup(["AB"]);
  update(() => {
    acceptedText().select(1, 1);
    const outcome = $insertReviewText("x\ny");
    expect(outcome.status).toBe("refused");
    if (outcome.status === "refused")
      expect(outcome.code).toBe("unsupported-input");
  });
});
