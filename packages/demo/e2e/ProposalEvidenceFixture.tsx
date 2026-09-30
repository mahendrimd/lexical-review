import { useCallback, useEffect, useRef } from "react";
import { LexicalExtensionComposer } from "@lexical/react/LexicalExtensionComposer";
import {
  ReviewExtension,
  $listReviewProposals,
  exportReviewDocument,
} from "lexical-review";
import {
  defineExtension,
  $getRoot,
  $getSelection,
  $isRangeSelection,
  type LexicalEditor,
} from "lexical";

import ProposalEvidenceDemo from "../src/ProposalEvidenceDemo";

const editorExtension = defineExtension({
  name: "proposal-evidence-browser",
  namespace: "proposal-evidence-browser",
  dependencies: [ReviewExtension],
});

export function ProposalEvidenceFixture() {
  const editorRef = useRef<LexicalEditor | null>(null);
  const handleEditor = useCallback((editor: LexicalEditor) => {
    editorRef.current = editor;
  }, []);

  useEffect(() => {
    const editor = editorRef.current;
    if (editor === null) return;
    window.__proposalEvidence = {
      selectAccepted() {
        editor.update(
          () => {
            $getRoot().getAllTextNodes()[0]?.select(1, 1);
          },
          { discrete: true },
        );
      },
      snapshot() {
        return editor.read(() => {
          const selection = $getSelection();
          return {
            proposals: $listReviewProposals(),
            text: $getRoot().getTextContent(),
            selection:
              selection !== null && $isRangeSelection(selection)
                ? {
                    anchor: {
                      key: selection.anchor.key,
                      offset: selection.anchor.offset,
                      type: selection.anchor.type,
                    },
                    focus: {
                      key: selection.focus.key,
                      offset: selection.focus.offset,
                      type: selection.focus.type,
                    },
                  }
                : null,
            document: exportReviewDocument(editor.getEditorState()),
          };
        });
      },
      compositionStart() {
        editor.getRootElement()?.dispatchEvent(
          new CompositionEvent("compositionstart", {
            bubbles: true,
            cancelable: true,
          }),
        );
      },
      compositionEnd() {
        editor.getRootElement()?.dispatchEvent(
          new CompositionEvent("compositionend", {
            bubbles: true,
            cancelable: true,
          }),
        );
      },
    };
    return () => {
      delete window.__proposalEvidence;
    };
  }, []);

  return (
    <div style={{ maxWidth: "100%", overflowX: "hidden" }}>
      <LexicalExtensionComposer
        extension={editorExtension}
        contentEditable={null}
      >
        <ProposalEvidenceDemo onEditorReady={handleEditor} />
      </LexicalExtensionComposer>
    </div>
  );
}

declare global {
  interface Window {
    __proposalEvidence?: {
      selectAccepted(): void;
      snapshot(): {
        proposals: readonly string[];
        text: string;
        selection: {
          anchor: { key: string; offset: number; type: string };
          focus: { key: string; offset: number; type: string };
        } | null;
        document: unknown;
      };
      compositionStart(): void;
      compositionEnd(): void;
    };
  }
}
