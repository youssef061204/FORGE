import { expect, test, type Page } from "@playwright/test";

async function hold(page: Page, name: RegExp) {
  const seal = page.getByRole("button", { name });
  await seal.scrollIntoViewIfNeeded();
  const box = (await seal.boundingBox())!;
  await page.mouse.move(box.x + 40, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(1500);
  await page.mouse.up();
}

test("a first-time visitor walks the whole tour, then runs a tool on their own file", async ({ page }) => {
  await page.goto("/");
  // Hydrated once the status pill renders (scripted locally, Showcase in the showcase build).
  await expect(page.getByText(/^(Scripted model|Showcase|No model)$/).first()).toBeVisible({ timeout: 90_000 });
  await expect(page.getByRole("heading", { level: 1 })).toContainText("AI assistants can only use the tools");
  await page.getByRole("link", { name: "Watch a tool get built" }).click();
  await expect(page).toHaveURL(/\/tour/);
  await expect(page.getByText("RECORDED").first()).toBeVisible();

  // 1-2: the MCP side.
  await expect(page.getByRole("heading", { name: "The assistant is missing a tool" })).toBeVisible();
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await expect(page.getByText("tools/call forge_build")).toBeVisible();
  await page.getByRole("button", { name: "Next", exact: true }).click();

  // 3-5: the recorded build plays to each milestone.
  await expect(page.getByRole("heading", { name: "FORGE reads the file" })).toBeVisible();
  await expect(page.getByText("orders.csv").first()).toBeVisible();
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await expect(page.getByText(/drafts? agrees?/).first()).toBeVisible({ timeout: 60_000 });
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await expect(page.getByText("Recipe", { exact: true })).toBeVisible({ timeout: 60_000 });
  // Tap a result row: the input rows behind it light up.
  await page.locator("table").nth(1).locator("tbody tr").first().click();
  await expect(page.getByText(/rows? lit/)).toBeVisible();
  await page.getByRole("button", { name: "Next", exact: true }).click();

  // 6: press and hold to approve.
  await expect(page.getByText("Permission passport")).toBeVisible();
  await hold(page, /Hold to approve/);
  await expect(page.getByText(/Sealed to program/)).toBeVisible();
  await page.getByRole("button", { name: "Next", exact: true }).click();

  // 7: the tool answers in the browser; revoke; the next call is refused.
  await expect(page.getByText(/returned totals.json/)).toBeVisible({ timeout: 30_000 });
  await page.getByRole("button", { name: /^Revoke / }).click();
  await expect(page.getByText(/Refused: .* was revoked/)).toBeVisible();
  await page.getByRole("button", { name: "Finish" }).click();

  await expect(page.getByRole("heading", { name: /Now try it with your own file/ })).toBeVisible();
  await page.getByRole("link", { name: "Run a tool on my own file" }).click();
  await expect(page).toHaveURL(/\/try\/contacts-1/);
  await page.locator('input[type="file"]').setInputFiles({
    name: "my-contacts.csv",
    mimeType: "text/csv",
    buffer: Buffer.from("name,email,phone,company\nAna,ANA@x.test ,1,Acme\nAna B,ana@x.test,2,Acme\nBo,bo@x.test,3,Zeta\n"),
  });
  await expect(page.getByText("my-contacts.csv")).toBeVisible();
  await expect(page.getByRole("button", { name: /Download/ })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(/2 rows/).first()).toBeVisible();
});
