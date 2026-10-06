import { expect, test, type Page } from "@playwright/test";

const API_OUTPUT_LABEL = "API output";

test.beforeEach(async ({ page }) => {
  await page.goto("/?scenarios");
  await page.waitForFunction(() => window.__scenarios !== undefined);
  await expect(page.getByTestId("scenario-editor")).toBeVisible();
});

async function snapshot(page: Page) {
  return page.evaluate(() => window.__scenarios!.snapshot());
}

async function selectScenario(page: Page, id: string) {
  await page
    .locator(`[data-testid="scenario-item"][data-scenario="${id}"]`)
    .click();
}

test("R1 insertion continuation keeps one identity via native typing", async ({
  page,
}) => {
  await selectScenario(page, "r1");
  await page.getByTestId("reset-scenario").click();
  await page.getByTestId("scenario-editor").focus();
  await page.keyboard.type("x");
  await page.keyboard.type("y");

  await expect(page.getByRole("status")).toContainText("pending proposal");
  await expect(page.getByTestId("proposal-item")).toHaveCount(1);
  await page.getByTestId("proposal-item").click();
  await expect(page.getByTestId("selected-details")).toBeVisible();

  await page.getByTestId("generate-evidence").click();
  await expect(page.getByText(API_OUTPUT_LABEL, { exact: true })).toBeVisible();
  await expect(page.getByTestId("selected-details")).toBeVisible();
  await expect(page.getByTestId("outcome-pane")).toContainText("changed");
  await expect(page.getByTestId("selected-details")).toContainText("insertion");
  await expect(page.getByTestId("selected-details")).toContainText("xy");

  await expect(page.getByTestId("document-previews")).toHaveAttribute(
    "data-preview-status",
    "current",
  );
  await expect(page.getByTestId("accepted-preview")).toHaveText("AB");
  await expect(page.getByTestId("all-accepted-preview")).toHaveText("AxyB");
  await page.getByTestId("capture-document").click();
  const native = await page.getByTestId("native-export").textContent();
  expect(native).toContain("review-insertion");
  expect(native).toContain("scenario-1");
  expect(native).not.toContain("terminal");
});

test("generated evidence follows the freshness lifecycle", async ({ page }) => {
  await selectScenario(page, "r1");
  await page.getByTestId("reset-scenario").click();
  await expect(page.getByTestId("document-previews")).toHaveAttribute(
    "data-preview-status",
    "not-generated",
  );
  await expect(page.getByTestId("evidence-status")).toHaveCount(0);
  await expect(page.getByTestId("preview-feedback")).toHaveCount(0);

  await page.getByTestId("act-insert-x").click();
  await expect(page.getByTestId("document-previews")).toHaveAttribute(
    "data-preview-status",
    "not-generated",
  );

  await page.getByTestId("generate-evidence").click();
  await expect(page.getByTestId("document-previews")).toHaveAttribute(
    "data-preview-status",
    "current",
  );
  await expect(page.getByTestId("preview-feedback")).toHaveCount(0);

  // Selecting a proposal never marks generated evidence stale.
  await page.getByTestId("proposal-item").click();
  await expect(page.getByTestId("document-previews")).toHaveAttribute(
    "data-preview-status",
    "current",
  );

  await page.getByTestId("act-insert-y").click();
  await expect(page.getByTestId("document-previews")).toHaveAttribute(
    "data-preview-status",
    "stale",
  );
  await expect(page.getByTestId("preview-feedback")).toHaveText(
    "These previews are out of date. Update them to include your latest changes.",
  );

  await page.getByTestId("generate-evidence").click();
  await expect(page.getByTestId("document-previews")).toHaveAttribute(
    "data-preview-status",
    "current",
  );
  await expect(page.getByTestId("all-accepted-preview")).toHaveText("AxyB");
  await expect(page.getByTestId("preview-feedback")).toHaveCount(0);
});

test("R1 action buttons produce the same single proposal", async ({ page }) => {
  await selectScenario(page, "r1");
  await page.getByTestId("reset-scenario").click();
  await expect(page.getByTestId("act-insert-y")).toBeDisabled();
  await page.getByTestId("act-insert-x").click();
  await expect(page.getByTestId("act-insert-y")).toBeEnabled();
  await page.getByTestId("act-insert-y").click();

  await expect(page.getByRole("status")).toContainText("pending proposal");
  await expect(page.getByTestId("proposal-item")).toHaveCount(1);
  expect((await snapshot(page)).text).toBe("AxyB");
  await expect(page.getByTestId("proposal-item")).toContainText("Insert “xy”");
});

test("global formatting controls create a formatting proposal", async ({
  page,
}) => {
  await selectScenario(page, "r1");
  await page.getByTestId("reset-scenario").click();
  await page.getByTestId("scenario-editor").focus();
  await page.keyboard.press("Shift+ArrowLeft");
  await page.getByTestId("format-bold").click();
  await page.getByTestId("format-italic").click();

  await expect(page.getByTestId("format-bold")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(page.getByTestId("format-italic")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(page.getByRole("status")).toContainText("pending proposal");
  await expect(page.getByTestId("proposal-item")).toContainText("formatting");

  await page.getByTestId("reset-scenario").click();
  await expect(page.getByTestId("proposal-item")).toHaveCount(0);
  await expect(page.getByTestId("format-bold")).toHaveAttribute(
    "aria-pressed",
    "false",
  );
  await expect(page.getByTestId("format-italic")).toHaveAttribute(
    "aria-pressed",
    "false",
  );
});

test("R2 correction keeps identity then direct removal empties the list", async ({
  page,
}) => {
  await selectScenario(page, "r2");
  const loaded = await snapshot(page);
  expect(loaded.proposals).toHaveLength(1);
  await expect(page.getByRole("status")).toHaveText(
    "1 pending proposal is ready to edit or review.",
  );
  await page.getByTestId("scenario-editor").focus();
  await page.keyboard.type("z");

  await expect(page.getByRole("status")).toContainText("pending proposal");
  await expect(page.getByTestId("proposal-item")).toHaveCount(1);
  const corrected = await snapshot(page);
  expect(corrected.text).toBe("AxzyB");
  // Correction continues the pending proposal under the same identity.
  expect(corrected.proposals).toEqual(loaded.proposals);
  await expect(page.getByTestId("proposal-item")).toContainText("Insert “xzy”");
  await page.getByTestId("proposal-item").click();
  await expect(page.getByTestId("selected-details")).toBeVisible();

  await page.getByTestId("generate-evidence").click();
  await expect(page.getByTestId("outcome-pane")).toContainText("changed");
  await expect(page.getByTestId("selected-details")).toContainText("xzy");
  await expect(page.getByTestId("accepted-preview")).toHaveText("AB");
  await expect(page.getByTestId("all-accepted-preview")).toHaveText("AxzyB");

  await page.getByTestId("remove-proposal").click();
  await expect(page.getByTestId("proposal-item")).toHaveCount(0);
  await expect(page.getByRole("status")).toHaveText(
    "Change removed. No pending proposals remain.",
  );
  await expect(page.getByTestId("act-correct-z")).toBeDisabled();
  await expect(page.getByTestId("proposal-list")).toHaveText(
    "No pending proposals.",
  );
  await expect(page.getByTestId("outcome-pane")).toContainText("changed");
  expect((await snapshot(page)).text).toBe("AB");
  await expect(page.getByTestId("selected-details")).toContainText(
    "Select a proposal row",
  );

  await page.getByTestId("generate-evidence").click();
  await expect(page.getByTestId("accepted-preview")).toHaveText("AB");
  await expect(page.getByTestId("all-accepted-preview")).toHaveText("AB");
});

test("R3 accepted-side deletion shrinks the insertion neighbor (#86 row 2)", async ({
  page,
}) => {
  await selectScenario(page, "r3");
  const before = await snapshot(page);
  expect(before.proposals).toHaveLength(1);

  await page.getByTestId("act-delete-forward").click();

  await expect(page.getByRole("status")).toContainText("pending proposal");
  const after = await snapshot(page);
  expect(after.text).toBe("AB");
  expect(after.proposals).toHaveLength(0);
  await expect(page.getByRole("status")).toContainText(
    "The pending text was deleted and its proposal removed. The accepted document is unchanged.",
  );

  await page.getByTestId("generate-evidence").click();
  await expect(page.getByTestId("outcome-pane")).toContainText("changed");
  await expect(page.getByTestId("accepted-preview")).toHaveText("AB");
  await expect(page.getByTestId("all-accepted-preview")).toHaveText("AB");
});

test("N1 atomic replacement carries one shared identity", async ({ page }) => {
  await selectScenario(page, "n1");
  await page.getByTestId("act-replace").click();

  await expect(page.getByRole("status")).toContainText("pending proposal");
  await expect(page.getByTestId("proposal-item")).toHaveCount(1);
  await expect(page.getByTestId("proposal-item")).toContainText(
    "Replace “c” with “b”",
  );
  await page.getByTestId("proposal-item").click();
  await expect(page.getByTestId("selected-details")).toBeVisible();

  await page.getByTestId("generate-evidence").click();
  await expect(page.getByTestId("outcome-pane")).toContainText("changed");
  await expect(page.getByTestId("selected-details")).toContainText(
    "replacement",
  );
  await expect(page.getByTestId("selected-details")).toContainText("oldText");
  await expect(page.getByTestId("selected-details")).toContainText("newText");

  await expect(page.getByTestId("accepted-preview")).toHaveText("cat");
  await expect(page.getByTestId("all-accepted-preview")).toHaveText("bat");
});

test("N2 paragraph split via native Enter keeps accepted and all-accepted in sync", async ({
  page,
}) => {
  await selectScenario(page, "n2");
  await page.getByTestId("scenario-editor").focus();
  await page.keyboard.press("Enter");

  await expect(page.getByRole("status")).toContainText("pending proposal");
  await expect(page.getByTestId("proposal-item")).toHaveCount(1);
  await expect(page.getByTestId("proposal-item")).toContainText(
    "Split before paragraph 2",
  );
  await page.getByTestId("proposal-item").click();
  await expect(page.getByTestId("selected-details")).toBeVisible();

  await page.getByTestId("generate-evidence").click();
  await expect(page.getByTestId("outcome-pane")).toContainText("changed");
  await expect(page.getByTestId("selected-details")).toContainText("split");

  await expect(page.getByTestId("document-previews")).toHaveAttribute(
    "data-preview-status",
    "current",
  );
  await expect(page.getByTestId("accepted-preview")).toHaveText("AB");
  const allAccepted = await page
    .getByTestId("all-accepted-preview")
    .textContent();
  expect(allAccepted).toContain("A");
  expect(allAccepted).toContain("B");
  expect((await snapshot(page)).paragraphs).toEqual(["A", "B"]);
});

test("merge paragraph creates a structural proposal that can be rejected", async ({
  page,
}) => {
  await selectScenario(page, "m1");
  expect((await snapshot(page)).paragraphs).toEqual(["A", "B"]);

  await page.getByTestId("act-merge").click();
  await expect(page.getByRole("status")).toContainText("pending proposal");
  await expect(page.getByTestId("proposal-item")).toContainText(
    "Merge into paragraph 1",
  );
  expect((await snapshot(page)).paragraphs).toEqual(["AB"]);

  await page.getByTestId("generate-evidence").click();
  await page.getByTestId("proposal-item").click();
  await expect(page.getByTestId("selected-details")).toContainText("merge");
  await page.getByTestId("reject-proposal").click();

  await expect(page.getByTestId("proposal-item")).toHaveCount(0);
  expect((await snapshot(page)).paragraphs).toEqual(["A", "B"]);
});

test("N3 simulated paste normalizes text/plain into one fragment", async ({
  page,
}) => {
  await selectScenario(page, "n3");
  await page.getByTestId("act-paste").click();

  await expect(page.getByRole("status")).toContainText("pending proposal");
  await expect(page.getByTestId("proposal-item")).toHaveCount(1);
  await page.getByTestId("proposal-item").click();
  await expect(page.getByTestId("selected-details")).toBeVisible();

  await page.getByTestId("generate-evidence").click();
  await expect(page.getByTestId("outcome-pane")).toContainText("changed");
  await expect(page.getByTestId("normalization-report")).toContainText(
    "text/plain",
  );
  await expect(page.getByTestId("selected-details")).toContainText("fragment");
  await expect(page.getByTestId("proposal-item")).toContainText(
    "Insert 2 paragraphs: “x ↵ y”",
  );

  await expect(page.getByTestId("document-previews")).toHaveAttribute(
    "data-preview-status",
    "current",
  );
  await expect(page.getByTestId("accepted-preview")).toHaveText("AB");
  const allAccepted = await page
    .getByTestId("all-accepted-preview")
    .textContent();
  expect(allAccepted).toContain("Ax");
  expect(allAccepted).toContain("yB");
  expect((await snapshot(page)).paragraphs).toEqual(["Ax", "yB"]);
  await page.getByTestId("capture-document").click();
  const native = await page.getByTestId("native-export").textContent();
  expect(native).toContain("review-fragment");
  expect(native).toContain("scenario-1");
  expect(native).not.toContain("terminal");
});

test("N4 simulated composition commit yields one insertion", async ({
  page,
}) => {
  await selectScenario(page, "n4");
  await page.getByTestId("act-compose").click();

  await expect(page.getByRole("status")).toContainText("pending proposal", {
    timeout: 10_000,
  });
  await expect(page.getByTestId("proposal-item")).toHaveCount(1);
  await page.getByTestId("proposal-item").click();
  await expect(page.getByTestId("selected-details")).toBeVisible();

  await page.getByTestId("generate-evidence").click();
  await expect(page.getByTestId("outcome-pane")).toContainText("changed");
  await expect(page.getByTestId("selected-details")).toContainText("insertion");
  await expect(page.getByTestId("selected-details")).toContainText("あ");

  await expect(page.getByTestId("accepted-preview")).toHaveText("AB");
  await expect(page.getByTestId("all-accepted-preview")).toHaveText("AあB");
});

test("switching scenarios resets edits without reporting an outcome", async ({
  page,
}) => {
  await selectScenario(page, "r1");
  await page.getByTestId("reset-scenario").click();
  await page.getByTestId("act-insert-x").click();
  await expect(page.getByTestId("proposal-item")).toHaveCount(1);
  await page.getByTestId("proposal-item").click();
  await expect(page.getByTestId("selected-details")).toBeVisible();
  await page.getByTestId("generate-evidence").click();
  await expect(page.getByTestId("selected-details")).toContainText(
    "scenario-1",
  );
  await expect(page.getByTestId("document-previews")).toHaveAttribute(
    "data-preview-status",
    "current",
  );
  await expect(page.getByTestId("evidence-pane")).toBeVisible();

  await selectScenario(page, "n1");

  // Selection, inspection, outcome, and generated evidence are discarded.
  await expect(page.getByTestId("proposal-item")).toHaveCount(0);
  await expect(page.getByText(API_OUTPUT_LABEL, { exact: true })).toBeVisible();
  await expect(page.getByTestId("outcome-pane")).toContainText(
    "No operation reported yet.",
  );
  await expect(page.getByTestId("document-previews")).toHaveAttribute(
    "data-preview-status",
    "not-generated",
  );
  await expect(page.getByTestId("evidence-pane")).toHaveCount(0);
  await expect(page.getByTestId("normalization-report")).toHaveCount(0);
  await expect(page.getByTestId("selected-details")).toBeVisible();
  expect((await snapshot(page)).text).toBe("cat");

  // Re-activating the already-selected rail item does not reset edits.
  await page.getByTestId("act-replace").click();
  await expect(page.getByTestId("proposal-item")).toHaveCount(1);
  await selectScenario(page, "n1");
  await expect(page.getByTestId("proposal-item")).toHaveCount(1);
  expect((await snapshot(page)).text).toBe("cbat");

  await page.getByTestId("reset-scenario").click();
  await expect(page.getByTestId("proposal-item")).toHaveCount(0);
  expect((await snapshot(page)).text).toBe("cat");
  await expect(page.getByTestId("outcome-pane")).toContainText(
    "No operation reported yet.",
  );
});

test("accept settles a proposal and updates the accepted preview", async ({
  page,
}) => {
  await selectScenario(page, "n3");
  await page.getByTestId("act-paste").click();
  await page.getByTestId("proposal-item").click();
  await page.getByTestId("accept-proposal").click();

  await expect(page.getByRole("status")).toContainText(
    "No pending proposals remain",
  );
  await expect(page.getByRole("status")).toContainText("Change accepted.");
  await page.getByTestId("generate-evidence").click();
  await expect(page.getByTestId("outcome-pane")).toContainText("changed");
  await expect(page.getByTestId("document-previews")).toHaveAttribute(
    "data-preview-status",
    "current",
  );
  const accepted = await page.getByTestId("accepted-preview").textContent();
  expect(accepted).toContain("Ax");
  expect(accepted).toContain("yB");
});

test("API output is always visible and JSON snapshots are independent of previews", async ({
  page,
}) => {
  await expect(
    page.getByRole("region", { name: "API output", exact: true }),
  ).toBeVisible();
  await expect(page.getByTestId("selected-details")).toContainText(
    "Select a proposal row",
  );
  await expect(page.getByTestId("outcome-pane")).toContainText(
    "No operation reported yet.",
  );
  const previews = page.getByRole("region", { name: "Document previews" });
  await expect(
    previews.getByText(API_OUTPUT_LABEL, { exact: true }),
  ).toHaveCount(0);
  await page.getByTestId("act-insert-x").click();
  await page.getByTestId("proposal-item").click();
  await expect(page.getByTestId("selected-details")).toContainText("insertion");
  await page.getByTestId("capture-document").click();
  await expect(page.getByTestId("native-export")).toContainText(
    "review-insertion",
  );
  await expect(previews).toHaveAttribute(
    "data-preview-status",
    "not-generated",
  );
  await page.getByTestId("generate-evidence").click();
  await page.getByTestId("act-insert-y").click();
  await expect(page.getByTestId("snapshot-feedback")).toBeVisible();
  await expect(previews).toHaveAttribute("data-preview-status", "stale");
  await page.getByTestId("capture-document").click();
  await expect(page.getByTestId("native-export")).toContainText('"text": "xy"');
  await expect(page.getByTestId("snapshot-feedback")).toHaveCount(0);
  await expect(previews).toHaveAttribute("data-preview-status", "stale");
  await expect(page.getByTestId("all-accepted-preview")).toHaveText("AxB");
  await page.getByTestId("generate-evidence").click();
  await expect(page.getByTestId("all-accepted-preview")).toHaveText("AxyB");
  expect((await snapshot(page)).proposals).toHaveLength(1);
});

test("narrow widths keep examples and decisions usable without page overflow", async ({
  page,
}) => {
  // Generate the widest content (native export JSON) before measuring.
  await selectScenario(page, "r1");
  await page.getByTestId("reset-scenario").click();
  await page.getByTestId("act-insert-x").click();
  await page.getByTestId("generate-evidence").click();
  await expect(page.getByTestId("evidence-pane")).toBeVisible();

  await page.getByTestId("capture-document").click();
  await page.setViewportSize({ width: 320, height: 800 });
  await expect(page.getByTestId("scenario-rail")).toBeVisible();
  await expect(page.getByTestId("scenario-item")).toHaveCount(8);
  await expect(page.getByTestId("scenario-editor")).toBeVisible();
  for (const action of ["accept", "reject", "remove"] as const) {
    const button = page.getByTestId(`${action}-proposal`);
    await expect(button).toHaveText(new RegExp(action, "i"));
    expect(
      await button.evaluate(
        (element) => element.getBoundingClientRect().height,
      ),
    ).toBeGreaterThanOrEqual(44);
  }
  const overflow = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth);
});

test("desktop aligns document and separate preview and review panels below actions", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await expect(page.getByTestId("scenario-item")).toHaveCount(8);
  for (const button of await page.getByTestId("scenario-item").all()) {
    await expect(button).toBeInViewport();
  }
  const document = await page
    .getByRole("region", { name: "Document", exact: true })
    .boundingBox();
  const review = await page
    .getByRole("region", { name: "Review proposals" })
    .boundingBox();
  const previewPanel = page.getByRole("region", { name: "Document previews" });
  const previews = await previewPanel.boundingBox();
  const actions = await page
    .getByRole("region", { name: "Example actions" })
    .boundingBox();
  const railBox = await page
    .getByRole("navigation", { name: "Capabilities" })
    .boundingBox();
  expect(document).not.toBeNull();
  expect(review).not.toBeNull();
  expect(previews).not.toBeNull();
  expect(actions).not.toBeNull();
  expect(railBox).not.toBeNull();
  expect(railBox!.x + railBox!.width).toBeLessThan(document!.x);
  expect(review!.x).toBeGreaterThan(document!.x + document!.width);
  expect(Math.abs(previews!.y - document!.y)).toBeLessThan(1);
  expect(Math.abs(review!.x - previews!.x)).toBeLessThan(1);
  expect(review!.y).toBeGreaterThan(previews!.y + previews!.height);
  expect(actions!.y + actions!.height).toBeLessThanOrEqual(document!.y);
  await expect(page.getByTestId("scenario-editor")).toBeInViewport();
  await expect(previewPanel.getByTestId("generate-evidence")).toBeInViewport();
  await expect(
    page
      .getByRole("region", { name: "Review proposals" })
      .getByTestId("generate-evidence"),
  ).toHaveCount(0);
});

test("long proposal lists scroll independently while previews and editor stay visible", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.getByTestId("reset-scenario").click();
  const editor = page.getByTestId("scenario-editor");
  await editor.focus();
  await page.keyboard.type("abcdefgh");
  await page.getByTestId("accept-proposal").click();
  for (let index = 0; index < 8; index++) {
    await editor.focus();
    await page.keyboard.press("Control+Home");
    for (let offset = 0; offset < index * 2 + 1; offset++) {
      await page.keyboard.press("ArrowRight");
    }
    await page.keyboard.type("x");
  }
  await expect(page.getByTestId("proposal-item")).toHaveCount(8);
  await page.getByTestId("generate-evidence").click();
  const reviewSidebar = page.getByTestId("review-sidebar");
  const list = page.getByTestId("proposal-list");
  const initial = await reviewSidebar.boundingBox();
  expect(initial!.height).toBeLessThanOrEqual(560);
  const summary = await page.getByTestId("proposal-item").first().boundingBox();
  const decision = await page
    .getByTestId("accept-proposal")
    .first()
    .boundingBox();
  expect(Math.abs(summary!.y - decision!.y)).toBeLessThan(10);
  expect(decision!.x).toBeGreaterThan(summary!.x + summary!.width - 1);
  expect(
    await list.evaluate(
      (element) => element.scrollHeight > element.clientHeight,
    ),
  ).toBe(true);
  // Keyboard navigation reaches the last decision inside the bounded list.
  await page.getByTestId("accept-proposal").last().focus();
  await expect(page.getByTestId("accept-proposal").last()).toBeInViewport();
  expect(await list.evaluate((element) => element.scrollTop)).toBeGreaterThan(
    0,
  );
  await expect(editor).toBeInViewport();
  await expect(page.getByTestId("accepted-preview")).toBeInViewport();
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("proposal-item")).toHaveCount(7);
  await expect(page.getByTestId("document-previews")).toHaveAttribute(
    "data-preview-status",
    "stale",
  );
  const after = await reviewSidebar.boundingBox();
  expect(after!.height).toBeLessThanOrEqual(560);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await list.evaluate((element) => element.scrollHeight),
  ).toBeLessThanOrEqual(await list.evaluate((element) => element.clientHeight));
  await expect(page.getByTestId("accept-proposal").last()).toBeVisible();
});

test("guided path reviews a change and advances to a fresh example", async ({
  page,
}) => {
  await expect(page.getByText(API_OUTPUT_LABEL, { exact: true })).toBeVisible();
  await page.getByTestId("act-insert-x").click();
  await page.getByTestId("act-insert-y").click();
  expect(
    await page.getByRole("heading", { level: 3 }).allTextContents(),
  ).toEqual([
    "Document",
    "Document previews",
    "Review proposals",
    "API output",
  ]);
  await page.getByTestId("generate-evidence").click();
  await expect(page.getByTestId("accepted-preview")).toHaveText("AB");
  await expect(page.getByTestId("all-accepted-preview")).toHaveText("AxyB");
  // A decision does not require selecting the proposal row first.
  await page.getByTestId("reject-proposal").click();
  await expect(page.getByTestId("scenario-editor")).toHaveText("AB");
  await expect(page.getByRole("status")).toContainText(
    "No pending proposals remain",
  );
  await expect(page.getByRole("status")).toContainText("Change rejected.");
  await selectScenario(page, "r2");
  await expect(
    page.getByRole("heading", { name: "Revise a suggestion", exact: true }),
  ).toBeVisible();
  await expect(page.getByTestId("scenario-editor")).toHaveText("AxyB");
  await expect(page.getByRole("status")).toHaveText(
    "1 pending proposal is ready to edit or review.",
  );
  await expect(page.getByText(API_OUTPUT_LABEL, { exact: true })).toBeVisible();
  await expect(page.getByTestId("outcome-pane")).toContainText(
    "No operation reported yet.",
  );
});
