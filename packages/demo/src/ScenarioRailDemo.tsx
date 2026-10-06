import { useCallback, useEffect, useRef, useState } from "react";
import { getExtensionDependencyFromEditor } from "@lexical/extension";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { ContentEditable } from "@lexical/react/LexicalContentEditable";
import {
  $createParagraphNode,
  $createTextNode,
  $getSelection,
  $getRoot,
  $isRangeSelection,
  COMPOSITION_END_COMMAND,
  COMPOSITION_START_COMMAND,
  DELETE_CHARACTER_COMMAND,
  FORMAT_TEXT_COMMAND,
  INSERT_PARAGRAPH_COMMAND,
  PASTE_COMMAND,
  type LexicalEditor,
  type ParagraphNode,
} from "lexical";
import {
  $deleteReviewText,
  $insertReviewText,
  $isReviewInsertionNode,
  $replaceReviewText,
  exportReviewDocument,
  type ReviewProposalIdFactory,
  type ProposalResolutionAction,
  ReviewExtension,
  type ReviewRoutedOutcome,
  type ReviewRoutedOperation,
} from "lexical-review";
import { useProposalEvidence } from "./useProposalEvidence";

const SCENARIOS = [
  {
    id: "r1",
    label: "Suggest text",
    description:
      "Insert x between A and B, then continue with y. Both edits form one proposal. You can also type in the document.",
  },
  {
    id: "r2",
    label: "Revise a suggestion",
    description:
      "The suggestion xy is already pending. Add z to revise it, then decide whether to keep it.",
  },
  {
    id: "r3",
    label: "Edit beside pending work",
    description:
      "Delete the pending X beside accepted text AB. The suggestion disappears; AB stays intact.",
  },
  {
    id: "n1",
    label: "Replace text",
    description:
      "Change cat to bat. The deleted c and inserted b are reviewed together.",
  },
  {
    id: "n2",
    label: "Split a paragraph",
    description:
      "Split AB into two paragraphs. Accept keeps the split; reject rejoins the text.",
  },
  {
    id: "m1",
    label: "Merge paragraphs",
    description:
      "Join the two paragraphs. Accept keeps the merge; reject restores the paragraph break.",
  },
  {
    id: "n3",
    label: "Paste paragraphs",
    description:
      "Insert x and y as two paragraphs. This simulated paste creates one proposal for the whole fragment.",
  },
  {
    id: "n4",
    label: "Compose text",
    description:
      "Commit あ as one text suggestion. Use the simulated input or try your own input method in the document.",
  },
] as const;

type ScenarioId = (typeof SCENARIOS)[number]["id"];

interface ScenarioAction {
  testId: string;
  label: string;
  run: () => void;
  disabled?: boolean;
}

function describeOutcome(outcome: ReviewRoutedOutcome): string {
  switch (outcome.status) {
    case "changed":
      return "changed — the review state gained, extended, or settled a proposal";
    case "unchanged":
      return "unchanged — nothing to do (for example, empty input)";
    case "refused":
      return `refused / ${outcome.code} — no mutation, selection preserved: ${outcome.message}`;
    case "failed":
      return `failed / ${outcome.error.code}: ${outcome.error.message}`;
  }
}

function setPlainText(text: string, anchor: number, focus: number): void {
  $getRoot()
    .clear()
    .append($createParagraphNode().append($createTextNode(text)));
  $getRoot().getAllTextNodes()[0]?.select(anchor, focus);
}

function setParagraphs(
  texts: readonly string[],
  paragraphIndex: number,
  offset: number,
): void {
  const paragraphs = texts.map((text) =>
    $createParagraphNode().append($createTextNode(text)),
  );
  $getRoot()
    .clear()
    .append(...paragraphs);
  paragraphs[paragraphIndex]?.select(offset, offset);
}

function selectInsertionText(offset: number): boolean {
  for (const node of $getRoot().getAllTextNodes()) {
    const parent = node.getParent();
    if (parent !== null && $isReviewInsertionNode(parent)) {
      node.select(offset, offset);
      return true;
    }
  }
  return false;
}

/**
 * Pinned scenario start, run inside `editor.update`. Moves content and the
 * caret without reporting an outcome. Shared by scenario switching and
 * Reset so both restore exactly the same document.
 */
function setupScenarioDocument(
  id: ScenarioId,
  proposalIdFactory: ReviewProposalIdFactory,
): void {
  switch (id) {
    case "r1":
    case "n2":
    case "n3":
    case "n4":
      setPlainText("AB", 1, 1);
      break;
    case "m1":
      setParagraphs(["A", "B"], 1, 0);
      break;
    case "r2":
      setPlainText("AB", 1, 1);
      $insertReviewText("xy", { proposalIdFactory });
      selectInsertionText(1);
      break;
    case "r3":
      setPlainText("AB", 2, 2);
      $insertReviewText("X", { proposalIdFactory });
      $getRoot().getAllTextNodes()[0]?.select(2, 2);
      break;
    case "n1":
      setPlainText("cat", 0, 1);
      break;
  }
}

const DECISIONS = [
  {
    action: "accept",
    label: "Accept",
    description: "keeps the change",
  },
  {
    action: "reject",
    label: "Reject",
    description: "declines the change",
  },
  {
    action: "remove",
    label: "Remove",
    description: "lets its author withdraw it",
  },
] as const;

export default function ScenarioRailDemo({
  onEditorReady,
}: {
  onEditorReady?: (editor: LexicalEditor) => void;
}) {
  const [editor] = useLexicalComposerContext();
  const review = getExtensionDependencyFromEditor(
    editor,
    ReviewExtension,
  ).output;
  const [scenario, setScenario] = useState<ScenarioId>("r1");
  const [outcome, setOutcome] = useState<ReviewRoutedOutcome | null>(null);
  const [outcomeCount, setOutcomeCount] = useState(0);
  const [normalization, setNormalization] = useState<string | null>(null);
  const [textFormat, setTextFormat] = useState({ bold: false, italic: false });
  const [refusedFlash, setRefusedFlash] = useState(false);
  const [lastResolution, setLastResolution] =
    useState<ProposalResolutionAction | null>(null);
  const [lastOperation, setLastOperation] =
    useState<ReviewRoutedOperation | null>(null);
  const resolutionActionRef = useRef<ProposalResolutionAction | null>(null);
  const {
    docVersion,
    evidence,
    evidenceReason,
    evidenceStatus,
    generateEvidence,
    inspection,
    isComposing,
    proposals,
    resetEvidence,
    resolveProposal,
    selectedActive,
    selectedId,
    setSelectedId,
    summaries,
  } = useProposalEvidence(editor);

  const [documentSnapshot, setDocumentSnapshot] = useState<{
    version: number;
    json: string;
  } | null>(null);
  const [snapshotError, setSnapshotError] = useState<string | null>(null);
  const captureDocument = useCallback(() => {
    if (isComposing) return;
    const result = exportReviewDocument(editor.getEditorState());
    if (result.status === "valid") {
      setDocumentSnapshot({
        version: docVersion,
        json: JSON.stringify(result.value, null, 2),
      });
      setSnapshotError(null);
    } else {
      setSnapshotError(
        "The review document could not be captured. Reset the example and try again.",
      );
    }
  }, [editor, docVersion, isComposing]);

  const factoryCounter = useRef(0);
  const factory = useCallback(() => `scenario-${++factoryCounter.current}`, []);
  // Guard against re-activating the already-selected example without
  // performing editor work inside a React state updater (updaters must stay
  // pure; StrictMode double-invokes them).
  const scenarioRef = useRef<ScenarioId>("r1");

  const handleOutcome = useCallback(
    (next: ReviewRoutedOutcome, operation?: ReviewRoutedOperation) => {
      setOutcome(next);
      setLastOperation(operation ?? null);
      setLastResolution(
        next.status === "changed" ? resolutionActionRef.current : null,
      );
      setOutcomeCount((count) => count + 1);
      const value =
        next.status === "changed" || next.status === "unchanged"
          ? next.value
          : undefined;
      if (
        value !== null &&
        typeof value === "object" &&
        "source" in value &&
        "flattened" in value &&
        "softBreakConverted" in value
      ) {
        setNormalization(JSON.stringify(value));
      }
    },
    [],
  );

  const decideProposal = useCallback(
    (id: string, action: ProposalResolutionAction) => {
      // The command reports its outcome synchronously. Record the action only
      // when it succeeds, and discard it on the next edit or scenario reset.
      resolutionActionRef.current = action;
      try {
        resolveProposal(id, action);
      } finally {
        resolutionActionRef.current = null;
      }
    },
    [resolveProposal],
  );

  useEffect(() => {
    review.options.value = {
      proposalIdFactory: factory,
      onOutcome: handleOutcome,
    };
    editor.update(
      () => {
        setPlainText("AB", 1, 1);
      },
      { discrete: true },
    );
    const input = editor.getEditorState().toJSON();
    const opened = review.openDocument({
      root: {
        ...input.root,
        $: { "lexical-review": { version: 3, extensions: [] } },
      },
    });
    if (opened.status !== "valid")
      throw new Error("Invalid scenario-rail demo");
    return () => review.closeSession();
  }, [editor, review, factory, handleOutcome]);

  useEffect(() => {
    onEditorReady?.(editor);
  }, [editor, onEditorReady]);

  useEffect(() => {
    return editor.registerUpdateListener(({ editorState }) => {
      editorState.read(() => {
        const selection = $getSelection();
        const next = $isRangeSelection(selection)
          ? {
              bold: selection.hasFormat("bold"),
              italic: selection.hasFormat("italic"),
            }
          : { bold: false, italic: false };
        setTextFormat((current) =>
          current.bold === next.bold && current.italic === next.italic
            ? current
            : next,
        );
      });
    });
  }, [editor]);

  useEffect(() => {
    if (outcome?.status !== "refused") return;
    setRefusedFlash(true);
    const timer = window.setTimeout(() => setRefusedFlash(false), 2500);
    return () => window.clearTimeout(timer);
  }, [outcome, outcomeCount]);

  const clearScenarioState = useCallback(() => {
    factoryCounter.current = 0;
    setOutcome(null);
    setOutcomeCount(0);
    setNormalization(null);
    setRefusedFlash(false);
    setLastResolution(null);
    setLastOperation(null);
    setDocumentSnapshot(null);
    setSnapshotError(null);
    resetEvidence();
  }, [resetEvidence]);

  /**
   * Selecting a different scenario loads its pinned starting document and
   * discards selection, inspection, the previous outcome, and generated
   * evidence. Activating the already-selected example is a no-op and never
   * resets edits. Loading restores the pinned caret without reporting a
   * user-operation outcome.
   */
  const loadScenario = useCallback(
    (next: ScenarioId) => {
      if (scenarioRef.current === next) return;
      scenarioRef.current = next;
      setScenario(next);
      clearScenarioState();
      editor.update(
        () => {
          setupScenarioDocument(next, factory);
        },
        { discrete: true },
      );
    },
    [clearScenarioState, editor, factory],
  );

  /** Reset performs the same restore as loading the current scenario. */
  const resetScenario = useCallback(() => {
    const current = scenarioRef.current;
    clearScenarioState();
    editor.update(
      () => {
        setupScenarioDocument(current, factory);
      },
      { discrete: true },
    );
  }, [clearScenarioState, editor, factory]);

  const insertAtPinnedCaret = useCallback(
    (text: string) => {
      editor.update(
        () => {
          $getRoot().getAllTextNodes()[0]?.select(1, 1);
          handleOutcome(
            $insertReviewText(text, { proposalIdFactory: factory }),
          );
        },
        { discrete: true },
      );
    },
    [editor, factory, handleOutcome],
  );

  const continueInsertion = useCallback(
    (text: string) => {
      editor.update(
        () => {
          let continued = false;
          for (const node of $getRoot().getAllTextNodes()) {
            const parent = node.getParent();
            if (parent !== null && $isReviewInsertionNode(parent)) {
              node.selectEnd();
              continued = true;
              break;
            }
          }
          if (!continued) {
            $getRoot().getAllTextNodes()[0]?.select(1, 1);
          }
          handleOutcome(
            $insertReviewText(text, { proposalIdFactory: factory }),
          );
        },
        { discrete: true },
      );
    },
    [editor, factory, handleOutcome],
  );

  const correctInsertionAt = useCallback(
    (offset: number, text: string) => {
      editor.update(
        () => {
          for (const node of $getRoot().getAllTextNodes()) {
            const parent = node.getParent();
            if (parent !== null && $isReviewInsertionNode(parent)) {
              node.select(offset, offset);
              break;
            }
          }
          handleOutcome(
            $insertReviewText(text, { proposalIdFactory: factory }),
          );
        },
        { discrete: true },
      );
    },
    [editor, factory, handleOutcome],
  );

  const attemptAcceptedSideDeletion = useCallback(() => {
    editor.update(
      () => {
        $getRoot().getAllTextNodes()[0]?.select(2, 2);
        handleOutcome($deleteReviewText(false, {}), "delete-text");
      },
      { discrete: true },
    );
  }, [editor, handleOutcome]);

  const replaceAtPinnedRange = useCallback(() => {
    editor.update(
      () => {
        $getRoot().getAllTextNodes()[0]?.select(0, 1);
        handleOutcome($replaceReviewText("b", { proposalIdFactory: factory }));
      },
      { discrete: true },
    );
  }, [editor, factory, handleOutcome]);

  const splitAtPinnedCaret = useCallback(() => {
    editor.update(
      () => {
        $getRoot().getAllTextNodes()[0]?.select(1, 1);
      },
      { discrete: true },
    );
    editor.dispatchCommand(INSERT_PARAGRAPH_COMMAND, undefined);
  }, [editor]);

  const mergeAtPinnedBoundary = useCallback(() => {
    editor.update(
      () => {
        $getRoot().getChildren<ParagraphNode>()[1]?.select(0, 0);
      },
      { discrete: true },
    );
    editor.dispatchCommand(DELETE_CHARACTER_COMMAND, true);
  }, [editor]);

  const simulateMultilinePaste = useCallback(() => {
    editor.update(
      () => {
        $getRoot().getAllTextNodes()[0]?.select(1, 1);
      },
      { discrete: true },
    );
    const event = {
      preventDefault() {},
      clipboardData: {
        getData: (type: string) => (type === "text/html" ? "" : "x\ny"),
      },
    } as unknown as ClipboardEvent;
    editor.dispatchCommand(PASTE_COMMAND, event);
  }, [editor]);

  const simulateCompositionCommit = useCallback(() => {
    editor.update(
      () => {
        $getRoot().getAllTextNodes()[0]?.select(1, 1);
      },
      { discrete: true },
    );
    editor.dispatchCommand(
      COMPOSITION_START_COMMAND,
      new CompositionEvent("compositionstart", { bubbles: true }),
    );
    editor.dispatchCommand(
      COMPOSITION_END_COMMAND,
      new CompositionEvent("compositionend", {
        bubbles: true,
        cancelable: true,
        data: "あ",
      }),
    );
  }, [editor]);

  const toggleTextFormat = useCallback(
    (format: "bold" | "italic") => {
      editor.dispatchCommand(FORMAT_TEXT_COMMAND, format);
    },
    [editor],
  );

  const hasInsertion = summaries.some(
    (summary) => summary.kind === "insertion",
  );
  const activeScenario =
    SCENARIOS.find((entry) => entry.id === scenario) ?? SCENARIOS[0];

  const pendingFeedback = proposals.length
    ? `${proposals.length} pending proposal${proposals.length === 1 ? "" : "s"} remain${proposals.length === 1 ? "s" : ""}.`
    : "No pending proposals remain.";
  let feedbackText: string;
  if (outcome?.status === "refused") {
    feedbackText = `This edit was refused. ${outcome.message} Your existing work is preserved.`;
  } else if (outcome?.status === "failed") {
    feedbackText = `This edit could not be completed. ${outcome.error.message}`;
  } else if (lastResolution !== null) {
    const verb = { accept: "accepted", reject: "rejected", remove: "removed" }[
      lastResolution
    ];
    feedbackText = `Change ${verb}. ${pendingFeedback}`;
  } else if (outcome === null) {
    feedbackText = proposals.length
      ? `${proposals.length} pending proposal${proposals.length === 1 ? " is" : "s are"} ready to edit or review.`
      : "";
  } else if (proposals.length) {
    feedbackText = `${proposals.length} pending proposal${proposals.length === 1 ? "" : "s"}.`;
  } else if (
    scenario === "r3" &&
    outcome.status === "changed" &&
    lastOperation === "delete-text"
  ) {
    feedbackText =
      "The pending text was deleted and its proposal removed. The accepted document is unchanged. No pending proposals remain.";
  } else {
    feedbackText = pendingFeedback;
  }

  const scenarioActions: Record<ScenarioId, readonly ScenarioAction[]> = {
    r1: [
      {
        testId: "act-insert-x",
        label: "Insert “x” between A and B",
        run: () => insertAtPinnedCaret("x"),
      },
      {
        testId: "act-insert-y",
        label: "Continue with “y”",
        disabled: !hasInsertion,
        run: () => continueInsertion("y"),
      },
    ],
    r2: [
      {
        testId: "act-correct-z",
        label: "Add “z” to the suggestion",
        disabled: !hasInsertion,
        run: () => correctInsertionAt(1, "z"),
      },
    ],
    r3: [
      {
        testId: "act-delete-forward",
        label: "Delete the pending “X”",
        disabled: !hasInsertion,
        run: attemptAcceptedSideDeletion,
      },
    ],
    n1: [
      {
        testId: "act-replace",
        label: "Replace c with b",
        run: replaceAtPinnedRange,
      },
    ],
    n2: [
      {
        testId: "act-split",
        label: "Split paragraph (Enter)",
        run: splitAtPinnedCaret,
      },
    ],
    m1: [
      {
        testId: "act-merge",
        label: "Merge the paragraphs",
        run: mergeAtPinnedBoundary,
      },
    ],
    n3: [
      {
        testId: "act-paste",
        label: "Paste two paragraphs",
        run: simulateMultilinePaste,
      },
    ],
    n4: [
      {
        testId: "act-compose",
        label: "Commit “あ”",
        run: simulateCompositionCommit,
      },
    ],
  };

  return (
    <div className="demo-layout">
      <nav aria-label="Capabilities" className="capability-rail">
        <h2 className="rail-heading">Capabilities</h2>
        <div data-testid="scenario-rail" className="capability-list">
          {SCENARIOS.map((entry, position) => (
            <button
              key={entry.id}
              type="button"
              data-testid="scenario-item"
              data-scenario={entry.id}
              aria-pressed={entry.id === scenario}
              onClick={() => loadScenario(entry.id)}
            >
              <span className="capability-number" aria-hidden="true">
                {position + 1}
              </span>
              {entry.label}
            </button>
          ))}
        </div>
        <p className="nav-note">Switching examples resets edits.</p>
      </nav>
      <main key={scenario}>
        <header className="example-heading">
          <h2>{activeScenario.label}</h2>
          <p>{activeScenario.description}</p>
        </header>
        <section aria-label="Example actions" className="example-actions">
          {scenarioActions[scenario].map((action) => (
            <button
              key={action.testId}
              type="button"
              data-testid={action.testId}
              disabled={action.disabled}
              onClick={action.run}
            >
              {action.label}
            </button>
          ))}
        </section>
        <div className="workspace">
          <div className="edit-pane">
            <section
              aria-labelledby="scenario-editor-heading"
              className="editor-sheet"
            >
              <div className="editor-caption">
                <h3 id="scenario-editor-heading">Document</h3>
                <div className="editor-tools" aria-label="Editor tools">
                  <button
                    type="button"
                    data-testid="format-bold"
                    aria-label="Bold"
                    aria-pressed={textFormat.bold}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => toggleTextFormat("bold")}
                  >
                    <strong aria-hidden="true">B</strong>
                  </button>
                  <button
                    type="button"
                    data-testid="format-italic"
                    aria-label="Italic"
                    aria-pressed={textFormat.italic}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => toggleTextFormat("italic")}
                  >
                    <em aria-hidden="true">I</em>
                  </button>
                  <button
                    type="button"
                    data-testid="reset-scenario"
                    aria-label="Reset example"
                    title="Reset example"
                    onClick={resetScenario}
                  >
                    Reset
                  </button>
                </div>
              </div>
              <ContentEditable
                data-testid="scenario-editor"
                aria-label="Editable review document"
                className="review-editor"
              />
              {feedbackText && (
                <p
                  className={`editor-status${refusedFlash ? " is-error" : ""}`}
                  role="status"
                >
                  {feedbackText}
                </p>
              )}
            </section>
            <div className="editor-legend">
              <ins>Insertion</ins>
              <del>Deletion</del>
            </div>
          </div>
          <div className="review-sidebar" data-testid="review-sidebar">
            <section
              aria-labelledby="preview-heading"
              className="preview-section"
              data-testid="document-previews"
              data-preview-status={evidenceStatus}
            >
              <div className="section-toolbar">
                <h3 id="preview-heading">Document previews</h3>
                <button
                  type="button"
                  data-testid="generate-evidence"
                  disabled={isComposing}
                  onClick={generateEvidence}
                >
                  {evidence === null ? "Show previews" : "Update previews"}
                </button>
              </div>
              <p className="helper">Previews leave proposals unchanged.</p>
              {evidenceReason !== null && (
                <p
                  className="helper"
                  data-testid="evidence-reason"
                  aria-live="polite"
                >
                  {isComposing
                    ? "Finish composing text before showing previews."
                    : evidenceReason}
                </p>
              )}
              {evidenceStatus === "stale" && (
                <p
                  className="helper freshness-message"
                  data-testid="preview-feedback"
                  aria-live="polite"
                >
                  These previews are out of date. Update them to include your
                  latest changes.
                </p>
              )}
              {evidence !== null && (
                <div data-testid="evidence-pane" className="comparison">
                  <div>
                    <h4>Accepted document</h4>
                    <pre data-testid="accepted-preview">
                      {evidence.accepted.join("\n")}
                    </pre>
                  </div>
                  <div>
                    <h4>With all proposals accepted</h4>
                    <pre data-testid="all-accepted-preview">
                      {evidence.allAccepted.join("\n")}
                    </pre>
                  </div>
                </div>
              )}
            </section>
            <section
              aria-labelledby="review-heading"
              className="review-section"
            >
              <h3 id="review-heading">Review proposals</h3>
              <div data-testid="proposal-list" className="proposal-list">
                {proposals.length === 0 ? (
                  <p className="empty-state">
                    {outcome === null
                      ? "Make an edit to create a proposal."
                      : "No pending proposals."}
                  </p>
                ) : (
                  summaries.map((summary, position) => (
                    <div
                      key={summary.id}
                      className={
                        summary.id === selectedId
                          ? "proposal-row is-selected"
                          : "proposal-row"
                      }
                    >
                      <button
                        type="button"
                        data-testid="proposal-item"
                        data-proposal-id={summary.id}
                        aria-label={`Inspect proposal ${position + 1}: ${summary.title}`}
                        aria-pressed={summary.id === selectedId}
                        className="proposal-row-main"
                        onClick={() => setSelectedId(summary.id)}
                      >
                        <span className="proposal-row-index">
                          {position + 1}
                        </span>
                        <span className="proposal-row-title">
                          {summary.title}
                        </span>
                      </button>
                      <div
                        className="proposal-row-decisions"
                        role="group"
                        aria-label={`Decide change ${position + 1}: ${summary.title}`}
                      >
                        {DECISIONS.map(({ action, label, description }) => (
                          <button
                            key={action}
                            type="button"
                            title={`${label} — ${description}`}
                            aria-label={`${label} change ${position + 1}: ${summary.title}`}
                            data-testid={`${action}-proposal`}
                            className="decision-button"
                            onClick={() => decideProposal(summary.id, action)}
                          >
                            {label}
                          </button>
                        ))}
                      </div>
                    </div>
                  ))
                )}
              </div>
              {proposals.length > 0 && (
                <p className="helper">
                  Accept keeps the change. Reject declines it. Remove withdraws
                  your proposal.
                </p>
              )}
            </section>
          </div>
        </div>
        <section
          className="api-output"
          data-testid="api-output"
          aria-labelledby="api-output-heading"
        >
          <h3 id="api-output-heading">API output</h3>
          <p>
            Proposal data and operation results update as you edit. Document
            JSON is a captured snapshot.
          </p>
          <div className="inspection-grid">
            <section aria-label="Proposal inspection">
              <h4 className="api-output-toolbar">Selected proposal</h4>
              <div data-testid="selected-details">
                {!selectedActive || inspection === null ? (
                  <p>Select a proposal row to inspect its data.</p>
                ) : inspection.status === "ready" ? (
                  <pre>{JSON.stringify(inspection.value, null, 2)}</pre>
                ) : (
                  <p>
                    Inspection refused / {inspection.code}: {inspection.message}
                  </p>
                )}
              </div>
            </section>
            <section aria-labelledby="snapshot-heading">
              <div className="api-output-toolbar">
                <h4 id="snapshot-heading">Review document JSON</h4>
                <button
                  type="button"
                  data-testid="capture-document"
                  disabled={isComposing}
                  onClick={captureDocument}
                >
                  {documentSnapshot === null
                    ? "Capture snapshot"
                    : "Update snapshot"}
                </button>
              </div>
              {documentSnapshot === null && (
                <p>Capture accepted content and pending proposals as JSON.</p>
              )}
              {isComposing && (
                <p>Finish composing text before capturing the document.</p>
              )}
              {snapshotError !== null && <p role="alert">{snapshotError}</p>}
              {documentSnapshot !== null &&
                documentSnapshot.version !== docVersion && (
                  <p
                    className="freshness-message"
                    data-testid="snapshot-feedback"
                    aria-live="polite"
                  >
                    This snapshot is out of date. Update it to include your
                    latest changes.
                  </p>
                )}
              {documentSnapshot !== null && (
                <pre data-testid="native-export">{documentSnapshot.json}</pre>
              )}
            </section>
          </div>
          <section className="api-operation" aria-label="Operation result">
            <h4>Latest operation result</h4>
            <div data-testid="outcome-pane">
              <p>
                {outcome === null
                  ? "No operation reported yet. Make an edit or a decision."
                  : describeOutcome(outcome)}
              </p>
              <p>Operations reported in this example: {outcomeCount}</p>
              {normalization !== null && (
                <p data-testid="normalization-report">
                  Clipboard normalization: {normalization}
                </p>
              )}
            </div>
          </section>
        </section>
      </main>
    </div>
  );
}
