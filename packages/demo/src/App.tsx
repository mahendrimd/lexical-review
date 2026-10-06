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
        <div>
          <h1>lexical-review</h1>
          <p>Edit text as proposals, then accept or reject them.</p>
        </div>
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
