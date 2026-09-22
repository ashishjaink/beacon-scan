import { describe, expect, it } from "vitest";
import { scanStore } from "../src/index.js";

const FIXTURES_DIR = "tests/fixtures/bluetokaicoffee.com";

describe("End-to-end: offline scan (task I.1)", () => {
  it("produces a schema-valid Findings via scanStore({ offlineFixturesDir }), deterministic apart from generatedAt", async () => {
    const now = () => new Date("2026-09-22T12:00:00.000Z");

    const first = await scanStore("https://bluetokaicoffee.com", { offlineFixturesDir: FIXTURES_DIR, now });
    const second = await scanStore("https://bluetokaicoffee.com", { offlineFixturesDir: FIXTURES_DIR, now });

    expect(first.snapshot.products.length).toBe(190);
    expect(first.findings.schemaVersion).toBe(1);
    expect(first.findings.store.host).toBe("bluetokaicoffee.com");
    expect(first.findings.scorecard.length).toBe(8);
    expect(first.findings.restock.length).toBeGreaterThan(0);
    expect(first.findings.headline.variantsSoldOut).toBeGreaterThan(0);

    const { generatedAt: g1, ...rest1 } = first.findings;
    const { generatedAt: g2, ...rest2 } = second.findings;
    expect(g1).toBe(g2); // same fixed `now`, so even generatedAt matches here
    expect(rest1).toEqual(rest2);

    expect(rest1).toMatchSnapshot();
  });
});
