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

import "../src/index.css";
import ScenarioRailDemo from "../src/ScenarioRailDemo";

const editorExtension = defineExtension({
  name: "scenario-rail-browser",
  namespace: "scenario-rail-browser",
  dependencies: [ReviewExtension],
});

export function ScenarioRailFixture() {
  const editorRef = useRef<LexicalEditor | null>(null);
  const handleEditor = useCallback((editor: LexicalEditor) => {
    editorRef.current = editor;
  }, []);

  useEffect(() => {
    const readDomText = (testId: string): string | null => {
      const element = document.querySelector(`[data-testid="${testId}"]`);
      return element === null ? null : (element.textContent ?? "");
    };
    window.__scenarios = {
      snapshot() {
        const editor = editorRef.current;
        if (editor === null) throw new Error("Scenario editor not ready.");
        const state = editor.read(() => {
          const selection = $getSelection();
          return {
            proposals: $listReviewProposals(),
            text: $getRoot().getTextContent(),
            paragraphs: $getRoot()
              .getChildren()
              .map((child) => child.getTextContent()),
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
        const activeScenario = document.querySelector(
          '[data-testid="scenario-item"][aria-pressed="true"]',
        );
        return {
          ...state,
          scenario: activeScenario?.getAttribute("data-scenario") ?? null,
          outcome: readDomText("outcome-pane"),
          normalization: readDomText("normalization-report"),
          evidenceStatus:
            document
              .querySelector('[data-testid="document-previews"]')
              ?.getAttribute("data-preview-status") ?? null,
        };
      },
    };
    return () => {
      delete window.__scenarios;
    };
  }, []);

  return (
    // No overflow clipping here: the responsive test must observe the demo's
    // own page-level overflow behavior.
    <div style={{ maxWidth: "100%" }}>
      <LexicalExtensionComposer
        extension={editorExtension}
        contentEditable={null}
      >
        <ScenarioRailDemo onEditorReady={handleEditor} />
      </LexicalExtensionComposer>
    </div>
  );
}

declare global {
  interface Window {
    __scenarios?: {
      snapshot(): {
        proposals: readonly string[];
        text: string;
        paragraphs: readonly string[];
        selection: {
          anchor: { key: string; offset: number; type: string };
          focus: { key: string; offset: number; type: string };
        } | null;
        document: unknown;
        scenario: string | null;
        outcome: string | null;
        normalization: string | null;
        evidenceStatus: string | null;
      };
    };
  }
}
