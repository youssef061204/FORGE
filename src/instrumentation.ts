export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { getService } = await import("./forge/server");
  if (process.env.NEXT_PHASE !== "phase-production-build") {
    const { getProduct } = await import("./forge/product/server");
    await getProduct();
  }
  const state = globalThis as typeof globalThis & {
    forgePoller?: ReturnType<typeof setInterval>;
    forgeCityPoller?: ReturnType<typeof setInterval>;
  };
  if (!state.forgeCityPoller) {
    state.forgeCityPoller = setInterval(() => {
      void getService()
        .city.tick()
        .catch(() => {
          /* No private runtime details enter logs. */
        });
    }, 1000);
    state.forgeCityPoller.unref();
  }
  if (!state.forgePoller) {
    let running = false;
    state.forgePoller = setInterval(async () => {
      if (running) return;
      running = true;
      try {
        await getService().tick();
      } catch {
        /* No raw data/errors enter logs. Schedule status is persisted by the service. */
      } finally {
        running = false;
      }
    }, 15000);
    state.forgePoller.unref();
  }
}
