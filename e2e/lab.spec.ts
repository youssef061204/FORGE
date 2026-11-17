import { test, expect } from "@playwright/test";
test("Lab performs voice-bound admission, measured narration, paired arena and authority-free checkpoint restoration", async ({
  page,
  request,
}) => {
  test.setTimeout(240000);
  // This scenario proves admission of a new mission. A deployment left by a
  // different scenario would silently turn it into a slower extension contest.
  const freshCity = await request.post("/api/environment", {
    data: { action: "map", name: "northbank" },
  });
  expect(freshCity.ok()).toBe(true);
  await page.setViewportSize({ width: 1440, height: 900 });
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.addInitScript(() => {
    let active: Recognition;
    class Recognition {
      lang = "";
      continuous = false;
      interimResults = true;
      maxAlternatives = 1;
      onstart: (() => void) | null = null;
      onresult:
        | ((event: {
            results: { isFinal: boolean; 0: { transcript: string } }[];
          }) => void)
        | null = null;
      onerror = null;
      onend: (() => void) | null = null;
      constructor() {
        // The harness retains the browser-recognizer instance for speech events.
        // eslint-disable-next-line @typescript-eslint/no-this-alias
        active = this;
      }
      start() {
        this.onstart?.();
      }
      stop() {
        this.onend?.();
      }
      abort() {
        this.onend?.();
      }
    }
    Object.defineProperty(window, "SpeechRecognition", {
      configurable: true,
      value: Recognition,
    });
    Object.defineProperty(navigator.mediaDevices, "getUserMedia", {
      configurable: true,
      value: async () => ({ getTracks: () => [{ stop() {} }] }),
    });
    const harness = {
      narrated: "",
      emit(text: string, final: boolean) {
        active.onresult?.({
          results: [{ isFinal: final, 0: { transcript: text } }],
        });
      },
    };
    Object.defineProperty(window, "labVoice", { value: harness });
    Object.defineProperty(window, "speechSynthesis", {
      value: {
        cancel() {},
        speak(utterance: SpeechSynthesisUtterance) {
          harness.narrated = utterance.text;
        },
      },
    });
  });
  await page.goto("/twin");
  await expect(page.getByText("Connected", { exact: true })).toBeVisible();
  await page
    .getByRole("textbox", { name: "Ask FORGE" })
    .fill("Fixture voice mission for measured City admission");
  await page.getByRole("button", { name: "Submit goal", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Approve & run", exact: true }),
  ).toBeVisible({ timeout: 180000 });
  await page.goto("/lab");
  await expect(
    page.getByRole("heading", { name: "Program tests" }),
  ).toBeVisible();
  await expect(
    page.getByText("Fixture voice mission for measured City admission", {
      exact: true,
    }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Arm spoken approval", exact: true })
    .click();
  const code = (await page.locator(".approval-code strong").textContent())!;
  await page
    .getByRole("button", { name: "Speak approval", exact: true })
    .click();
  await expect(
    page.getByText("Listening. Speak your goal, then press Stop.", {
      exact: true,
    }),
  ).toBeVisible();
  await page.evaluate(
    (code) =>
      (
        window as typeof window & {
          labVoice: { emit(text: string, final: boolean): void };
        }
      ).labVoice.emit("confirm " + code, false),
    code,
  );
  expect(
    (await (await request.get("/api/environment")).json()).contests.at(-1)
      .status,
  ).toBe("review");
  await page.evaluate(
    (code) =>
      (
        window as typeof window & {
          labVoice: { emit(text: string, final: boolean): void };
        }
      ).labVoice.emit(
        "confirm " +
          [...code]
            .map(
              (d) =>
                [
                  "zero",
                  "one",
                  "two",
                  "three",
                  "four",
                  "five",
                  "six",
                  "seven",
                  "eight",
                  "nine",
                ][Number(d)],
            )
            .join(" "),
        true,
      ),
    code,
  );
  await expect(
    page.getByText(
      "Exact artifact approved and invoked. The challenge is consumed.",
      { exact: true },
    ),
  ).toBeVisible();
  const replay = await request.post("/api/lab", {
    data: { action: "confirm", code },
  });
  expect(replay.status()).toBe(400);
  await page
    .getByRole("button", { name: "Narrate current briefing", exact: true })
    .click();
  await expect(page.locator("blockquote")).toContainText(
    "95 percent Wilson upper bound",
  );
  expect(
    await page.evaluate(
      () =>
        (window as typeof window & { labVoice: { narrated: string } }).labVoice
          .narrated,
    ),
  ).toContain("Digital twin briefing");
  await page.getByRole("button", { name: "Evidence", exact: true }).click();
  const measured = (
    await (await request.get("/api/environment")).json()
  ).contests
    .at(-1)
    .candidates.filter(
      (c: { rollouts: unknown[] }) => c.rollouts.length === 20,
    );
  await expect(page.locator(".uncertainty-row")).toHaveCount(measured.length);
  await expect(page.locator(".uncertainty-row").first()).toContainText("16.1%");
  await page.getByRole("button", { name: "Arena", exact: true }).click();
  await expect(page.locator(".arena-canvas canvas")).toHaveCount(2);
  const sides = page.locator(".arena-side");
  expect(await sides.nth(0).getAttribute("data-seed")).toBe(
    await sides.nth(1).getAttribute("data-seed"),
  );
  await page.getByRole("slider", { name: "Arena recorded time" }).fill("3");
  expect(await sides.nth(0).getAttribute("data-seconds")).toBe(
    await sides.nth(1).getAttribute("data-seconds"),
  );
  await page.screenshot({ path: "artifacts/lab-browser-arena.png" });
  await page.getByRole("button", { name: "Time", exact: true }).click();
  await page
    .getByRole("button", { name: "Save City checkpoint", exact: true })
    .click();
  await expect(
    page.getByText("Before the storm", { exact: true }),
  ).toBeVisible();
  await request.post("/api/environment", {
    data: {
      action: "control",
      change: { operation: "weather.set", rain: 0.95, wind: 0.95 },
    },
  });
  await page
    .locator(".lab-report")
    .filter({ has: page.getByText("Before the storm", { exact: true }) })
    .getByRole("button", {
      name: "Restore & revoke City authority",
      exact: true,
    })
    .click();
  await expect(
    page.getByText(
      "Checkpoint restored. All City authority revoked; simulation paused. External services untouched.",
      { exact: true },
    ),
  ).toBeVisible();
  const state = await (await request.get("/api/environment")).json();
  expect(state.city.paused).toBe(true);
  expect(state.city.deployment).toBeUndefined();
  expect(errors).toEqual([]);
});
