import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    passWithNoTests: true,
    // A couple of collector tests exercise real setTimeout/AbortController timing
    // (http.ts's backoff delay isn't clock-injectable by design — see the "Burst of
    // 429s" test). Vitest's 5s default test timeout is fine on an idle machine but
    // has been observed to trip under real system load, causing spurious
    // AbortController fires and doubled retry counts on otherwise-correct
    // mocked-fetch tests. A generous global timeout gives headroom without slowing
    // down a normal run (tests still complete in well under a second each).
    testTimeout: 20000,
    // Running all 5 test files concurrently (vitest's default) means up to 5 worker
    // threads compete for CPU at once on the developer's own machine — that
    // contention is exactly what was tripping the real-timer tests above, even with
    // the generous testTimeout. Running files sequentially removes that contention
    // entirely; the whole suite is still fast (a few seconds), just not parallel.
    fileParallelism: false,
  },
});
