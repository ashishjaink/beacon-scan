/**
 * Default engine config, hardcoded as a literal mirror of the root
 * `beacon.config.json` (kept in sync manually — see docs/decisions-during-build.md
 * if this ever needs to change). Hardcoded rather than imported: engine/ is pure,
 * no I/O, and reading the JSON file at runtime would be a file read. The CLI
 * (src/index.ts / collector) is free to load the real file and pass it in as
 * `config` — analyse() merges whatever partial config it's given over these
 * defaults so it always has a complete, valid BeaconConfig to compute with.
 */
import type { BeaconConfig } from "../types.js";

export const DEFAULT_CONFIG: BeaconConfig = {
  weights: { inMerch: 0.35, position: 0.25, breadth: 0.15, recency: 0.15, discounted: 0.1, velocity: 0.2 },
  merchCollectionRegex: "best|top|trending|featured|popular|new|most-loved|favou?rites?",
  thresholds: {
    orphanPct: [5, 15],
    soldOutTopN: 8,
    soldOutInTopCount: [1, 3],
    lowImagePct: [10, 25],
    shortDescPct: [10, 25],
    coreSizeOutPct: [10, 25],
    noCapturePct: [20, 50],
  },
  http: {
    rps: 2,
    concurrency: 2,
    maxRetries: 4,
    timeoutMs: 15000,
    userAgent: "beacon-scan/0.1 (+https://github.com/ashishkothari/beacon-scan)",
  },
  limits: { maxProducts: 800, pdpSample: 20 },
};

/** Merges a partial config over DEFAULT_CONFIG, one level deep per section. */
export function mergeConfig(partial?: Partial<BeaconConfig>): BeaconConfig {
  if (!partial) return DEFAULT_CONFIG;
  return {
    weights: { ...DEFAULT_CONFIG.weights, ...(partial.weights ?? {}) },
    merchCollectionRegex: partial.merchCollectionRegex ?? DEFAULT_CONFIG.merchCollectionRegex,
    thresholds: { ...DEFAULT_CONFIG.thresholds, ...(partial.thresholds ?? {}) },
    http: { ...DEFAULT_CONFIG.http, ...(partial.http ?? {}) },
    limits: { ...DEFAULT_CONFIG.limits, ...(partial.limits ?? {}) },
  };
}
