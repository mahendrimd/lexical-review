import {
  InitialStateExtension,
  effect,
  signal,
  type ReadonlySignal,
  type Signal,
} from "@lexical/extension";
import { defineExtension, safeCast } from "lexical";
import { ReviewBoundaryNode } from "./ReviewBoundaryNode";
import {
  ReviewDeletionNode,
  ReviewFormattingNode,
  ReviewFragmentNode,
  ReviewInsertionNode,
} from "./ReviewNodes";
import { openReviewSession, type ReviewSession } from "./ReviewSession";
import type { ValidationResult } from "./ReviewDocument";
import {
  registerReviewSession,
  type ReviewSessionRegistrationOptions,
} from "./registerReviewSession";

export interface ReviewExtensionConfig {
  /** A native review document to open after editor initialization; null waits for openDocument. */
  initialDocument: unknown;
  options: ReviewSessionRegistrationOptions;
}

export interface ReviewExtensionOutput {
  /** The current session, or null when review input routing is inactive. */
  session: ReadonlySignal<ReviewSession | null>;
  /** Replace this value to update routing options without reopening the document. */
  options: Signal<ReviewSessionRegistrationOptions>;
  /** Validate and open a document in this editor. Invalid input preserves the current session. */
  openDocument(input: unknown): ValidationResult<ReviewSession>;
  /** Stop review input routing while preserving the editor's current state. */
  closeSession(): void;
}

/** Framework-independent review nodes, authoring sessions, and browser input routing. */
export const ReviewExtension = defineExtension({
  name: "lexical-review/Review",
  dependencies: [InitialStateExtension],
  nodes: [
    ReviewInsertionNode,
    ReviewDeletionNode,
    ReviewFormattingNode,
    ReviewFragmentNode,
    ReviewBoundaryNode,
  ],
  config: safeCast<ReviewExtensionConfig>({
    initialDocument: null,
    options: {},
  }),
  init: () => ({ ready: false }),
  build(editor, config, state): ReviewExtensionOutput {
    const lifecycle = state.getInitResult();
    const session = signal<ReviewSession | null>(null);
    return {
      session,
      options: signal(config.options),
      openDocument(input) {
        if (!lifecycle.ready) {
          throw new Error(
            "ReviewExtension documents can only be opened after editor initialization and before disposal.",
          );
        }
        const opened = openReviewSession(editor, input);
        if (opened.status === "valid") session.value = opened.value;
        return opened;
      },
      closeSession() {
        session.value = null;
      },
    };
  },
  afterRegistration(editor, config, state) {
    const lifecycle = state.getInitResult();
    const output = state.getOutput();
    lifecycle.ready = true;
    // Lexical's initial state has been installed at this point. Opening in
    // build/register would let that initialization overwrite the review document.
    if (config.initialDocument !== null) {
      const opened = output.openDocument(config.initialDocument);
      if (opened.status !== "valid") {
        lifecycle.ready = false;
        throw new Error(
          opened.status === "unsupported"
            ? opened.reason.message
            : (opened.issues[0]?.message ?? "Invalid review document."),
        );
      }
    }
    const unregister = effect(() => {
      const session = output.session.value;
      const options = output.options.value;
      if (session !== null)
        return registerReviewSession(editor, session, options);
    });
    return () => {
      unregister();
      output.closeSession();
      lifecycle.ready = false;
    };
  },
});
