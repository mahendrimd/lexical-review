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
} from "lexical-review";
import { configExtension, createEditor } from "lexical";

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

const extension = configExtension(ReviewExtension, {
  initialDocument: { root: {} },
  options: {
    copyProjection: "accepted-state",
    onOutcome: (outcome) => void outcome.status,
  },
});
const register: (
  editor: import("lexical").LexicalEditor,
  session: ReviewSession,
) => () => void = registerReviewSession;
void extension;
void register;
