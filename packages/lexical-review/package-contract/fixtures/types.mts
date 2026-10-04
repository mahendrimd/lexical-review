import * as review from "lexical-review";
import {
  openReviewSession,
  type ReviewDocumentV3,
  ReviewFormattingNode,
  $setReviewFormatting,
  $inspectReviewProposal,
  ReviewDeletionNode,
  ReviewInsertionNode,
  type ValidationResult,
  ReviewExtension,
  registerReviewSession,
  type ReviewSession,
  type ReviewExtensionConfig,
  type ReviewExtensionOutput,
  type ReviewSessionRegistrationOptions,
  type ReviewResolutionRoutePayload,
  type ReviewRoutedOutcome,
  type ReviewFragment,
  INSERT_REVIEW_FRAGMENT_COMMAND,
  RESOLVE_REVIEW_PROPOSALS_COMMAND,
} from "lexical-review";
import { configExtension, createEditor } from "lexical";
import {
  buildEditorFromExtensions,
  getExtensionDependencyFromEditor,
} from "@lexical/extension";

const nodeClass: typeof ReviewInsertionNode = ReviewInsertionNode;

function validationStatus(result: ValidationResult<unknown>): string {
  switch (result.status) {
    case "valid":
      return result.status;
    case "invalid":
      return `${result.status}:${result.issues[0]?.code}`;
    case "unsupported":
      return `${result.status}:${result.reason.code}`;
    default: {
      const exhaustive: never = result;
      return exhaustive;
    }
  }
}

const editor = createEditor({
  nodes: [ReviewInsertionNode, ReviewDeletionNode, ReviewFormattingNode],
  onError: (error) => void error,
});
const opened = openReviewSession(editor, {
  root: {
    $: { "lexical-review": { extensions: [], version: 3 } },
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
  },
});

if (opened.status === "valid") {
  const outcome: ValidationResult<ReviewDocumentV3> =
    opened.value.exportDocument();
  void validationStatus(outcome);
}

void nodeClass;

editor.update(() => {
  void $setReviewFormatting({ bold: true, underline: true });
  void $inspectReviewProposal("pending-format");
});

function routedSuccess(outcome: ReviewRoutedOutcome): number | string | null {
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
const options: ReviewSessionRegistrationOptions = {
  copyProjection: "accepted-state",
  proposalIdFactory: () => "consumer-proposal",
  onOutcome: (outcome) => {
    const result: ReviewRoutedOutcome = outcome;
    void routedSuccess(result);
  },
  onInsertionOutcome: routedSuccess,
  onDeletionOutcome: routedSuccess,
};
const config: ReviewExtensionConfig = { initialDocument: null, options };
const extension = configExtension(ReviewExtension, config);
const extensionEditor = buildEditorFromExtensions(extension);
const output = getExtensionDependencyFromEditor(
  extensionEditor,
  ReviewExtension,
).output;
const publicOutput: ReviewExtensionOutput = output;
const session: ReviewSession | null = output.session.value;
const openResult: ValidationResult<ReviewSession> = output.openDocument({});
const saved: ValidationResult<ReviewDocumentV3> | undefined =
  output.session.value?.exportDocument();
output.options.value = options;
const closed: void = output.closeSession();

// @ts-expect-error The session signal is read-only for consumers.
output.session.value = null;
// @ts-expect-error Only supported clipboard projection modes are accepted.
output.options.value = { copyProjection: "unknown" };

const fragment: ReviewFragment = [{ runs: [{ text: "consumer", format: 0 }] }];
const resolution: ReviewResolutionRoutePayload = {
  ids: ["consumer-proposal"],
  action: "accept",
};
extensionEditor.dispatchCommand(INSERT_REVIEW_FRAGMENT_COMMAND, fragment);
extensionEditor.dispatchCommand(RESOLVE_REVIEW_PROPOSALS_COMMAND, resolution);
extensionEditor.dispatchCommand(
  INSERT_REVIEW_FRAGMENT_COMMAND,
  // @ts-expect-error Fragment commands require paragraph content.
  "text",
);
const invalidResolution = { ids: [], action: "unknown" } as const;
extensionEditor.dispatchCommand(
  RESOLVE_REVIEW_PROPOSALS_COMMAND,
  // @ts-expect-error Resolution actions are restricted to accept, reject, or remove.
  invalidResolution,
);

const register: (
  editor: import("lexical").LexicalEditor,
  session: ReviewSession,
  options?: ReviewSessionRegistrationOptions,
) => () => void = registerReviewSession;
if (openResult.status === "valid") {
  const cleanup: () => void = registerReviewSession(
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
