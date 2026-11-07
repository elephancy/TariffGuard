import { expect, test } from "@playwright/test";

test("the production dashboard loads normally", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Session validation overview" })).toBeVisible();
});

test("an unavailable dashboard chunk offers a reload that recovers", async ({ page }) => {
  const chunk = /\/assets\/OverviewPage-[^/]+\.js$/;
  let failedRequests = 0;
  await page.route(chunk, async (route) => {
    failedRequests += 1;
    await route.fulfill({ status: 503, contentType: "text/plain", body: "Synthetic unavailable dashboard chunk" });
  });

  await page.goto("/");
  const failure = page.getByRole("alert");
  await expect(failure.getByRole("heading", { name: "Dashboard unavailable" })).toBeVisible();
  expect(failedRequests).toBe(1);

  await page.unroute(chunk);
  await Promise.all([
    page.waitForEvent("domcontentloaded"),
    failure.getByRole("button", { name: "Reload dashboard" }).click(),
  ]);
  await expect(page.getByRole("heading", { name: "Session validation overview" })).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);
});
