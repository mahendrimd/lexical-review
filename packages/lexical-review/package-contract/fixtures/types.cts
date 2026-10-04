import review = require("lexical-review");
import lexical = require("lexical");
import extensions = require("@lexical/extension");

const nodeClass: typeof review.ReviewInsertionNode = review.ReviewInsertionNode;
const editor = lexical.createEditor({
  nodes: [review.ReviewInsertionNode, review.ReviewDeletionNode],
  onError: (error) => void error,
});
const opened: review.ValidationResult<review.ReviewSession> =
  review.openReviewSession(editor, {
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

void nodeClass;
void opened;

function routedSuccess(
  outcome: review.ReviewRoutedOutcome,
): number | string | null {
  if (outcome.status !== "changed" && outcome.status !== "unchanged")
    return null;
  const value = outcome.value;
  if (!value) return null;
  if ("projectedLength" in value) {
    const mode: "all-accepted" | "accepted-state" = value.mode;
    void mode;
    return value.projectedLength;
  }
  const flattened: readonly string[] = value.flattened;
  const lost: readonly string[] = value.lost;
  const softBreakConverted: boolean = value.softBreakConverted;
  void flattened;
  void lost;
  void softBreakConverted;
  return value.source;
}

// Compile host integration against published declarations, without executing it.
const options: review.ReviewSessionRegistrationOptions = {
  copyProjection: "accepted-state",
  proposalIdFactory: () => "consumer-proposal",
  onOutcome: (outcome, operation) => {
    const result: review.ReviewRoutedOutcome = outcome;
    const attemptedOperation: review.ReviewRoutedOperation = operation;
    void attemptedOperation;
    void routedSuccess(result);
  },
};
// Outcome-only callbacks remain valid; specialized callbacks are removed.
const outcomeOnly: review.ReviewSessionRegistrationOptions = {
  onOutcome: routedSuccess,
};
const removedInsertion: review.ReviewSessionRegistrationOptions = {
  // @ts-expect-error Use onOutcome with its operation argument instead.
  onInsertionOutcome: routedSuccess,
};
const removedDeletion: review.ReviewSessionRegistrationOptions = {
  // @ts-expect-error Use onOutcome with its operation argument instead.
  onDeletionOutcome: routedSuccess,
};
void outcomeOnly;
void removedInsertion;
void removedDeletion;
const config: review.ReviewExtensionConfig = { initialDocument: null, options };
const extension = lexical.configExtension(review.ReviewExtension, config);
const extensionEditor = extensions.buildEditorFromExtensions(extension);
const output = extensions.getExtensionDependencyFromEditor(
  extensionEditor,
  review.ReviewExtension,
).output;
const publicOutput: review.ReviewExtensionOutput = output;
const session: review.ReviewSession | null = output.session.value;
const openResult: review.ValidationResult<review.ReviewSession> =
  output.openDocument({});
const saved: review.ValidationResult<review.ReviewDocumentV3> | undefined =
  output.session.value?.exportDocument();
output.options.value = options;
const closed: void = output.closeSession();

// @ts-expect-error The session signal is read-only for consumers.
output.session.value = null;
// @ts-expect-error Only supported clipboard projection modes are accepted.
output.options.value = { copyProjection: "unknown" };

const fragment: review.ReviewFragment = [
  { runs: [{ text: "consumer", format: 0 }] },
];
const resolution: review.ReviewResolutionRoutePayload = {
  ids: ["consumer-proposal"],
  action: "accept",
};
extensionEditor.dispatchCommand(
  review.INSERT_REVIEW_FRAGMENT_COMMAND,
  fragment,
);
extensionEditor.dispatchCommand(
  review.RESOLVE_REVIEW_PROPOSALS_COMMAND,
  resolution,
);
extensionEditor.dispatchCommand(
  review.INSERT_REVIEW_FRAGMENT_COMMAND,
  // @ts-expect-error Fragment commands require paragraph content.
  "text",
);
const invalidResolution = { ids: [], action: "unknown" } as const;
extensionEditor.dispatchCommand(
  review.RESOLVE_REVIEW_PROPOSALS_COMMAND,
  // @ts-expect-error Resolution actions are restricted to accept, reject, or remove.
  invalidResolution,
);

const register: (
  editor: lexical.LexicalEditor,
  session: review.ReviewSession,
  options?: review.ReviewSessionRegistrationOptions,
) => () => void = review.registerReviewSession;
if (openResult.status === "valid") {
  const cleanup: () => void = review.registerReviewSession(
    extensionEditor,
    openResult.value,
    options,
  );
  void cleanup;
}
void publicOutput;
void session;
void saved;
void closed;
void register;

// Host consumers can use compact proposal records and detached snapshots.
function proposalSummary(): string | null {
  const result = editor.read(() => review.$inspectReviewProposal("consumer"));
  if (result.status !== "unchanged" && result.status !== "changed") return null;
  const inspected: review.InspectedReviewProposal = result.value;
  switch (inspected.kind) {
    case "insertion": {
      const proposal: review.ReviewInsertionProposal = inspected.proposal;
      return proposal.text;
    }
    case "deletion": {
      const proposal: review.ReviewDeletionProposal = inspected.proposal;
      return proposal.text;
    }
    case "replacement": {
      const proposal: review.ReviewReplacementProposal = inspected.proposal;
      return proposal.oldText + proposal.newText;
    }
    case "formatting": {
      const proposal: review.ReviewFormattingProposal = inspected.proposal;
      return proposal.current.map((run) => run.text).join("");
    }
    case "structure": {
      const proposal: review.ReviewStructuralProposal = inspected.proposal;
      return proposal.kind;
    }
    case "fragment": {
      const proposal: review.ReviewFragmentProposal = inspected.proposal;
      return proposal.paragraphs
        .map((paragraph) => paragraph.runs.map((run) => run.text).join(""))
        .join("\n");
    }
    default: {
      const exhaustive: never = inspected;
      return exhaustive;
    }
  }
}

function selectedProposal(): review.ReviewProposalSnapshot | null {
  const ids = editor.read(review.$listReviewProposals);
  const next: string | null = review.getNextProposal(ids, null);
  const previous: string | null = review.getPrevProposal(ids, next);
  void previous;
  if (next === null) return null;
  const inspected = editor.read(() =>
    review.$inspectReviewProposalSnapshot(next),
  );
  return inspected.status === "ready" ? inspected.value : null;
}

function pasteForHost(event: unknown): review.ReviewMultilinePasteOutcome {
  return review.$pasteReviewSelection(event);
}

const mergeCompatibility: (
  left: review.ReviewElementNode,
  right: review.ReviewElementNode,
) => boolean = review.$canReviewElementNodesBeMerged;
void proposalSummary;
void selectedProposal;
void pasteForHost;
void mergeCompatibility;
