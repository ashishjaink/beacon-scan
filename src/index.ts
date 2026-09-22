import { collect, collectOffline } from "./collector/index.js";
import { samplePdpMarkers } from "./collector/pdp-markers.js";
import { analyse } from "./engine/index.js";
import { diff } from "./engine/diff.js";
import { renderHtml } from "./report/html.js";
import { toCsv } from "./report/csv.js";
import { toTerminal } from "./report/terminal.js";
import type { AvailabilityDelta, BeaconConfig, Findings, PdpMarkers, StoreSnapshot } from "./types.js";

export type ScanOptions = {
  maxProducts?: number;
  pdpSample?: number;
  cacheDir?: string;
  noCache?: boolean;
  offlineFixturesDir?: string;
  config?: Partial<BeaconConfig>;
  now?: () => Date;
  onProgress?: (phase: string, detail?: string) => void;
};

export type ScanResult = { snapshot: StoreSnapshot; markers: PdpMarkers; findings: Findings };

/**
 * Scans a Shopify storefront (or replays fixtures via `offlineFixturesDir`) and returns
 * the normalised snapshot, sampled PDP markers, and the computed Findings. No I/O side
 * effects beyond the network fetches themselves — never prints, never writes files.
 */
export async function scanStore(storeUrl: string, opts: ScanOptions = {}): Promise<ScanResult> {
  const snapshot = opts.offlineFixturesDir
    ? await collectOffline(opts.offlineFixturesDir, {
        onProgress: opts.onProgress,
        now: opts.now,
        config: opts.config,
      })
    : await collect(storeUrl, {
        maxProducts: opts.maxProducts,
        cacheDir: opts.cacheDir,
        noCache: opts.noCache,
        config: opts.config,
        onProgress: opts.onProgress,
        now: opts.now,
      });

  const markers = await samplePdpMarkers(snapshot, {
    pdpSample: opts.pdpSample,
    offlineFixturesDir: opts.offlineFixturesDir,
    cacheDir: opts.cacheDir,
    noCache: opts.noCache,
    onProgress: opts.onProgress,
  });

  const findings = analyse(snapshot, markers, opts.config, undefined, opts.now);

  return { snapshot, markers, findings };
}

/** Pure: recompute Findings from an already-collected snapshot + markers. */
export function analyseSnapshot(
  snapshot: StoreSnapshot,
  markers: PdpMarkers,
  config?: Partial<BeaconConfig>,
  delta?: AvailabilityDelta,
): Findings {
  return analyse(snapshot, markers, config, delta);
}

/** Pure: compare two snapshots and report availability flips (P1). */
export function diffSnapshots(a: StoreSnapshot, b: StoreSnapshot): AvailabilityDelta {
  return diff(a, b);
}

/** Pure: render Findings into the three output formats as strings (no file writes). */
export function renderReport(findings: Findings): { html: string; csv: string; terminal: string } {
  return { html: renderHtml(findings), csv: toCsv(findings), terminal: toTerminal(findings) };
}

export * from "./types.js";
