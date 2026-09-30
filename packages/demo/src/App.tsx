import { LexicalExtensionComposer } from "@lexical/react/LexicalExtensionComposer";
import { defineExtension } from "lexical";
import { ReviewExtension } from "lexical-review";
import "./index.css";
import ScenarioRailDemo from "./ScenarioRailDemo";

const AUTHORING_DOCS_URL =
  "https://github.com/mahendrimd/lexical-review/blob/main/packages/lexical-review/README.md";

const editorExtension = defineExtension({
  name: "scenario-rail-demo",
  namespace: "scenario-rail-demo",
  dependencies: [ReviewExtension],
  theme: {
    ins: "review-insertion",
    del: "review-deletion",
    text: {
      bold: "font-bold",
      italic: "italic",
      underline: "underline",
      strikethrough: "line-through",
    },
  },
});

function App() {
  return (
    <div className="demo-app">
      <header className="site-header">
        <a className="wordmark" href="#">
          lexical-review
        </a>
        <nav aria-label="Resources">
          <a
            href={AUTHORING_DOCS_URL}
            target="_blank"
            rel="noopener noreferrer"
            data-testid="read-the-docs"
          >
            Documentation ↗
          </a>
          <a
            href="https://github.com/mahendrimd/lexical-review"
            target="_blank"
            rel="noopener noreferrer"
          >
            GitHub ↗
          </a>
        </nav>
      </header>
      <div className="intro">
        <p className="eyebrow">An interactive introduction</p>
        <h1>Make edits. Keep the decision open.</h1>
        <p>
          lexical-review turns edits in a Lexical editor into proposals you can
          accept, reject, or keep refining. Try a change below and see how it
          affects the document.
        </p>
        <a className="start-link" href="#try-it-live">
          Start with a text suggestion ↓
        </a>
      </div>
      <LexicalExtensionComposer
        extension={editorExtension}
        contentEditable={null}
      >
        <ScenarioRailDemo />
      </LexicalExtensionComposer>
      <footer className="site-footer">
        demo for lexical-review · built by Mahendri Dwicahyo
      </footer>
    </div>
  );
}

export default App;
