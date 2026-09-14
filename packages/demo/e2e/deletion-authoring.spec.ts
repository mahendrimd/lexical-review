import { expect, test } from "@playwright/test";
import type {} from "./DeletionFixture";

test.beforeEach(async ({ page }) => {
  await page.goto("/?deletions");
  await page.waitForFunction(() => window.__deletionFixture !== undefined);
});

for (const backward of [false, true]) {
  test(`native ${backward ? "Backspace" : "Delete"} continues one identity with formatting nested inside del`, async ({
    page,
  }) => {
    await page.evaluate(
      (backward) => window.__deletionFixture!.select(0, backward ? 13 : 0),
      backward,
    );
    const key = backward ? "Backspace" : "Delete";
    await page.keyboard.press(key);
    await page.keyboard.press(key);
    const marker = page.getByTestId("deletion-editor").locator("del");
    await expect(marker).toHaveCount(1);
    await expect(marker).toHaveText(backward ? "ee" : "on");
    await expect(marker.locator("strong")).toHaveText(backward ? "ee" : "on");
    await page.keyboard.press(`Control+${key}`);
    await expect(marker).toHaveText(backward ? "three" : "one");
    expect(
      await page.evaluate(() => window.__deletionFixture!.snapshot()),
    ).toMatchObject({
      proposal: {
        value: {
          kind: "deletion",
          proposal: {
            proposalId: "deletion-1",
            text: backward ? "three" : "one",
          },
        },
      },
      document: { status: "valid" },
    });
  });
}

for (const action of ["accept", "reject", "remove"] as const) {
  test(`${action} resolves a current range deletion without terminal metadata`, async ({
    page,
  }) => {
    await page.evaluate(() => {
      window.__deletionFixture!.select(0, 4, 7);
      window.__deletionFixture!.delete(false, "range");
    });
    await expect(page.locator("del")).toHaveText("two");
    await page.evaluate(
      (action) => window.__deletionFixture!.resolve(action),
      action,
    );
    await expect(page.locator("del")).toHaveCount(0);
    await expect(
      page.getByTestId("deletion-editor").locator("p").first(),
    ).toHaveText(action === "accept" ? "one  three" : "one two three");
    const snapshot = await page.evaluate(() =>
      window.__deletionFixture!.snapshot(),
    );
    expect(snapshot).toMatchObject({
      document: { status: "valid" },
      proposal: { status: "refused" },
    });
    expect(JSON.stringify(snapshot)).not.toContain('"proposalId":"deletion-1"');
  });
}

test("accepted-side adjacency restores deletion; proposal-local nonempty also restores", async ({
  page,
}) => {
  await page.evaluate(() => {
    window.__deletionFixture!.select(0, 4, 7);
    window.__deletionFixture!.delete(false, "range");
    window.__deletionFixture!.select(2, 0);
  });
  // #86 row 4: accepted caret facing a deletion neighbor whole-restores it.
  await page.keyboard.press("Backspace");
  await expect(page.locator("del")).toHaveCount(0);
  await expect(
    page.getByTestId("deletion-editor").locator("p").first(),
  ).toHaveText("one two three");
  // Re-create the deletion, then a nonempty proposal-local range restores it.
  await page.evaluate(() => {
    window.__deletionFixture!.select(0, 4, 7);
    window.__deletionFixture!.delete(false, "range");
    window.__deletionFixture!.select(1, 1, 2);
  });
  await page.keyboard.press("Delete");
  await expect(page.locator("del")).toHaveCount(0);
  await expect(
    page.getByTestId("deletion-editor").locator("p").first(),
  ).toHaveText("one two three");
});

test("native Backspace at a deletion boundary extends the deletion", async ({
  page,
}) => {
  await page.evaluate(() => {
    window.__deletionFixture!.select(0, 4, 7);
    window.__deletionFixture!.delete(false, "range");
    // Caret at offset 0 of the deletion text: Backspace points at the
    // accepted space before it and prepends under the same identity.
    window.__deletionFixture!.select(1, 0);
  });
  await page.keyboard.press("Backspace");
  expect(
    await page.evaluate(() => window.__deletionFixture!.snapshot()),
  ).toMatchObject({
    proposal: {
      value: {
        kind: "deletion",
        proposal: { proposalId: "deletion-1", text: " two" },
      },
    },
    document: { status: "valid" },
  });
});

test("native Delete at a deletion boundary extends the deletion", async ({
  page,
}) => {
  await page.evaluate(() => {
    window.__deletionFixture!.select(0, 4, 7);
    window.__deletionFixture!.delete(false, "range");
    // Caret at the end of the deletion text: Delete points at the accepted
    // space after it and appends under the same identity.
    window.__deletionFixture!.select(1, 3);
  });
  await page.keyboard.press("Delete");
  expect(
    await page.evaluate(() => window.__deletionFixture!.snapshot()),
  ).toMatchObject({
    proposal: {
      value: {
        kind: "deletion",
        proposal: { proposalId: "deletion-1", text: "two " },
      },
    },
    document: { status: "valid" },
  });
});

test("accepting a deletion then pressing Backspace proposes a new deletion", async ({
  page,
}) => {
  await page.evaluate(() => {
    window.__deletionFixture!.select(0, 4, 7);
    window.__deletionFixture!.delete(false, "range");
    // Caret inside the deletion so accepting it restores the caret beside
    // the remaining accepted text, which merges into one node.
    window.__deletionFixture!.select(1, 1);
    window.__deletionFixture!.resolve("accept");
  });
  expect(
    await page.evaluate(() => window.__deletionFixture!.snapshot()),
  ).toMatchObject({ lastOutcome: "changed" });
  // Deleting resumes without refusal at the merged text end: the final
  // character becomes a fresh deletion.
  await page.keyboard.press("Backspace");
  expect(
    await page.evaluate(() => window.__deletionFixture!.snapshot()),
  ).toMatchObject({ document: { status: "valid" }, lastOutcome: "changed" });
  await expect(page.getByTestId("deletion-editor").locator("del")).toHaveCount(
    1,
  );
  expect(
    await page.evaluate(
      () =>
        document.querySelector('[data-testid="deletion-editor"] del')
          ?.textContent,
    ),
  ).toBe("e");
});

test("cross-paragraph refusal preserves the document and selection", async ({
  page,
}) => {
  await page.evaluate(() => window.__deletionFixture!.crossParagraph());
  const before = await page.evaluate(() =>
    window.__deletionFixture!.snapshot(),
  );
  await page.keyboard.press("Delete");
  expect(
    await page.evaluate(() => window.__deletionFixture!.snapshot()),
  ).toEqual({ ...(before as object), lastOutcome: "refused" });
});
