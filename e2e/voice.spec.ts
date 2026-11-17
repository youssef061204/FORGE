import { test, expect, type Page } from "@playwright/test";

// Browser-boundary tests inject only microphone/speech events. The React UI,
// request composer and MCP build call remain real. These do not claim live STT.
type VoiceHarness = {
  starts: number;
  stops: number;
  aborts: number;
  tracksStopped: number;
  constructions: number;
  emit(texts: string[]): void;
  error(code: string): void;
  end(): void;
  grantPending(): void;
};
type HarnessWindow = Window & { voiceHarness: VoiceHarness };
async function installSpeech(
  page: Page,
  mode: "success" | "denied" | "throw" | "pending" = "success",
) {
  await page.addInitScript((mode) => {
    let active: FakeRecognition;
    let resolvePermission: (stream: MediaStream) => void;
    const harness: VoiceHarness = {
      starts: 0,
      stops: 0,
      aborts: 0,
      tracksStopped: 0,
      constructions: 0,
      emit(texts) {
        active.onresult?.({
          results: texts.map((transcript) => ({
            isFinal: true,
            0: { transcript },
          })),
        });
      },
      error(code) {
        active.onerror?.({ error: code });
      },
      end() {
        active.onend?.();
      },
      grantPending() {
        resolvePermission(stream);
      },
    };
    const stream = {
      getTracks: () => [{ stop: () => harness.tracksStopped++ }],
    } as unknown as MediaStream;
    class FakeRecognition {
      lang = "";
      continuous = false;
      interimResults = false;
      maxAlternatives = 1;
      onstart: (() => void) | null = null;
      onresult:
        | ((event: {
            results: Array<{ isFinal: boolean; 0: { transcript: string } }>;
          }) => void)
        | null = null;
      onerror: ((event: { error: string }) => void) | null = null;
      onend: (() => void) | null = null;
      constructor() {
        // The harness intentionally retains the browser-recognizer instance.
        // eslint-disable-next-line @typescript-eslint/no-this-alias
        active = this;
        harness.constructions++;
      }
      start() {
        harness.starts++;
        if (mode === "throw")
          throw new DOMException("Speech startup failed", "InvalidStateError");
        this.onstart?.();
      }
      stop() {
        harness.stops++;
        this.onend?.();
      }
      abort() {
        harness.aborts++;
        this.onend?.();
      }
    }
    Object.defineProperty(window, "SpeechRecognition", {
      configurable: true,
      value: FakeRecognition,
    });
    Object.defineProperty(window, "webkitSpeechRecognition", {
      configurable: true,
      value: FakeRecognition,
    });
    Object.defineProperty(navigator.mediaDevices, "getUserMedia", {
      configurable: true,
      value: () => {
        if (mode === "denied")
          return Promise.reject(new DOMException("Denied", "NotAllowedError"));
        if (mode === "pending")
          return new Promise<MediaStream>((resolve) => {
            resolvePermission = resolve;
          });
        return Promise.resolve(stream);
      },
    });
    (window as unknown as HarnessWindow).voiceHarness = harness;
  }, mode);
}

test("dictation updates the request across results, stops, and builds via MCP", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await installSpeech(page);
  await page.goto("/studio");
  await expect(page.getByText("MCP connected", { exact: true })).toBeVisible();
  const input = page.getByRole("textbox", { name: "Program request" });
  await input.fill("Transform text");
  await page.getByRole("button", { name: "Use voice input" }).click();
  await expect(page.getByRole("status")).toContainText("Listening");
  await page.evaluate(() =>
    (window as unknown as HarnessWindow).voiceHarness.emit(["to upper"]),
  );
  await expect(input).toHaveValue("Transform text to upper");
  await page.evaluate(() =>
    (window as unknown as HarnessWindow).voiceHarness.emit([
      "to uppercase.",
      "Keep it concise.",
    ]),
  );
  await expect(input).toHaveValue(
    "Transform text to uppercase. Keep it concise.",
  );
  await expect(
    page.getByRole("button", { name: "Build program", exact: true }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "Stop voice input" }).click();
  await expect(page.getByRole("status")).toContainText("Voice captured");
  expect(
    await page.evaluate(() => {
      const h = (window as unknown as HarnessWindow).voiceHarness;
      return {
        starts: h.starts,
        stops: h.stops,
        constructions: h.constructions,
        tracksStopped: h.tracksStopped,
      };
    }),
  ).toEqual({ starts: 1, stops: 1, constructions: 1, tracksStopped: 1 });
  await page
    .getByRole("button", { name: "Build program", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Approve & install" }),
  ).toBeEnabled();
  expect(errors).toEqual([]);
});

test("microphone denial explains permissions and preserves the typed draft", async ({
  page,
}) => {
  await installSpeech(page, "denied");
  await page.goto("/studio");
  const input = page.getByRole("textbox", { name: "Program request" });
  await input.fill("My existing draft");
  await page.getByRole("button", { name: "Use voice input" }).click();
  await expect(page.getByRole("status")).toContainText(
    "Allow microphone access",
  );
  await expect(page.getByRole("status")).toContainText("Windows");
  await expect(input).toHaveValue("My existing draft");
  await expect(input).toBeEnabled();
  expect(
    await page.evaluate(
      () => (window as unknown as HarnessWindow).voiceHarness.constructions,
    ),
  ).toBe(0);
});

test("speech service failure resets voice and allows a fresh session", async ({
  page,
}) => {
  await installSpeech(page);
  await page.goto("/studio");
  await page.getByRole("button", { name: "Use voice input" }).click();
  await page.evaluate(() =>
    (window as unknown as HarnessWindow).voiceHarness.error("network"),
  );
  await expect(page.getByRole("status")).toContainText(
    "speech service could not connect",
  );
  await page.getByRole("button", { name: "Use voice input" }).click();
  await expect(page.getByRole("status")).toContainText("Listening");
  expect(
    await page.evaluate(
      () => (window as unknown as HarnessWindow).voiceHarness.starts,
    ),
  ).toBe(2);
});

test("synchronous recognizer failure leaves no stuck listening state", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await installSpeech(page, "throw");
  await page.goto("/studio");
  await page.getByRole("button", { name: "Use voice input" }).click();
  await expect(page.getByRole("status")).toContainText("InvalidStateError");
  await expect(
    page.getByRole("button", { name: "Use voice input" }),
  ).toBeEnabled();
  await expect(
    page.getByRole("textbox", { name: "Program request" }),
  ).toBeEnabled();
  expect(errors).toEqual([]);
});

test("unsupported preview gives a direct browser link without pretending to listen", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, "SpeechRecognition", {
      configurable: true,
      value: undefined,
    });
    Object.defineProperty(window, "webkitSpeechRecognition", {
      configurable: true,
      value: undefined,
    });
  });
  await page.goto("/studio");
  await page.getByRole("button", { name: "Use voice input" }).click();
  await expect(page.getByRole("status")).toContainText(
    "Voice input is unavailable",
  );
  await expect(
    page.getByRole("link", { name: "Open FORGE in a browser" }),
  ).toHaveAttribute("target", "_blank");
  await expect(
    page.getByRole("button", { name: "Use voice input" }),
  ).toBeEnabled();
});

test("cancelling a pending microphone prompt releases late media without starting speech", async ({
  page,
}) => {
  await installSpeech(page, "pending");
  await page.goto("/studio");
  await page.getByRole("button", { name: "Use voice input" }).click();
  await page.getByRole("button", { name: "Stop voice input" }).click();
  await page.evaluate(() =>
    (window as unknown as HarnessWindow).voiceHarness.grantPending(),
  );
  await expect(page.getByRole("status")).toContainText("cancelled");
  expect(
    await page.evaluate(() => {
      const h = (window as unknown as HarnessWindow).voiceHarness;
      return { starts: h.starts, tracksStopped: h.tracksStopped };
    }),
  ).toEqual({ starts: 0, tracksStopped: 1 });
});

test("leaving Studio aborts microphone capture and ignores subsequent speech", async ({
  page,
}) => {
  await installSpeech(page);
  await page.goto("/studio");
  await page.getByRole("button", { name: "Use voice input" }).click();
  await page.getByRole("button", { name: "Architecture", exact: true }).click();
  await page.evaluate(() =>
    (window as unknown as HarnessWindow).voiceHarness.emit(["late transcript"]),
  );
  await page.getByRole("button", { name: "Studio", exact: true }).click();
  await expect(
    page.getByRole("textbox", { name: "Program request" }),
  ).toHaveValue("");
  expect(
    await page.evaluate(
      () => (window as unknown as HarnessWindow).voiceHarness.aborts,
    ),
  ).toBe(1);
});
