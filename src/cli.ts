#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { Command } from "commander";
import { BeaconError } from "./errors.js";
import { analyseSnapshot, diffSnapshots, renderReport, scanStore } from "./index.js";
import { Findings, PdpMarkers, StoreSnapshot } from "./types.js";

/** Writes one progress line to stderr, in the `phase detail` shape design.md §3 specifies. */
function progress(phase: string, detail?: string): void {
  process.stderr.write(`[beacon] ${phase}${detail ? ` ${detail}` : ""}\n`);
}

/** Derives the storage host from a store URL, tolerating a missing scheme. */
function hostOf(storeUrl: string): string {
  try {
    return new URL(storeUrl).hostname;
  } catch {
    try {
      return new URL(`https://${storeUrl}`).hostname;
    } catch {
      throw new BeaconError(
        "INVALID_INPUT",
        `Invalid store URL: "${storeUrl}"`,
        "Pass a full URL, e.g. https://example.com",
      );
    }
  }
}

/** ISO-ish timestamp, safe as a directory component across macOS/Linux. */
function runTimestamp(now: Date = new Date()): string {
  return now.toISOString().replace(/:/g, "-");
}

async function writeJson(filePath: string, data: unknown): Promise<void> {
  await writeFile(filePath, JSON.stringify(data, null, 2) + "\n", "utf8");
}

async function writeRunArtefacts(
  runDir: string,
  snapshot: StoreSnapshot | undefined,
  markers: PdpMarkers | undefined,
  findings: Findings,
): Promise<void> {
  await mkdir(runDir, { recursive: true });
  if (snapshot) await writeJson(path.join(runDir, "snapshot.json"), snapshot);
  if (markers) await writeJson(path.join(runDir, "pdp-markers.json"), markers);
  await writeJson(path.join(runDir, "findings.json"), findings);

  progress("report");
  const { html, csv, terminal } = renderReport(findings);
  await writeFile(path.join(runDir, "restock_priority.csv"), csv, "utf8");
  await writeFile(path.join(runDir, "report.html"), html, "utf8");

  process.stdout.write(terminal);
  process.stdout.write(`\nReport written to ${path.join(runDir, "report.html")}\n`);
}

async function readJson<T>(filePath: string, code: BeaconError["code"] = "FIXTURE_MISSING"): Promise<T> {
  let raw: string;
  try {
    raw = await readFile(filePath, "utf8");
  } catch {
    throw new BeaconError(code, `Could not read ${filePath}`, `Make sure ${filePath} exists and is readable.`);
  }
  try {
    return JSON.parse(raw) as T;
  } catch {
    throw new BeaconError(code, `Could not parse ${filePath} as JSON`, `${filePath} is not valid JSON — was the run interrupted?`);
  }
}

function fail(err: unknown): never {
  if (err instanceof BeaconError) {
    process.stderr.write(`Error [${err.code}]: ${err.message}\n`);
    process.stderr.write(`Hint: ${err.hint}\n`);
  } else {
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(`Unexpected error: ${message}\n`);
  }
  process.exit(1);
}

const program = new Command();
program
  .name("beacon")
  .description("Beacon Friction Scanner — Shopify storefront restock priority + journey scorecard")
  .version("0.1.0");

program
  .command("scan")
  .description("Scan a Shopify storefront and write a full run to out/<host>/<timestamp>/")
  .argument("<storeUrl>", "Store URL, e.g. https://bluetokaicoffee.com")
  .option("--max-products <n>", "Maximum products to scan", (v) => Number.parseInt(v, 10), 800)
  .option("--pdp-sample <n>", "Number of sold-out PDPs to sample for capture markers", (v) => Number.parseInt(v, 10), 20)
  .option("--out <dir>", "Output base directory", "out")
  .option("--no-cache", "Disable the on-disk HTTP cache")
  .option("--offline", "Replay recorded fixtures instead of hitting the network")
  .option("--fixtures <dir>", "Fixtures directory (required with --offline)")
  .action(async (storeUrl: string, opts) => {
    try {
      if (opts.offline && !opts.fixtures) {
        throw new BeaconError(
          "INVALID_INPUT",
          "--offline requires --fixtures <dir>",
          "Pass --fixtures tests/fixtures/<host> alongside --offline.",
        );
      }

      const host = hostOf(storeUrl);
      const runDir = path.join(opts.out, host, runTimestamp());

      const { snapshot, markers, findings } = await scanStore(storeUrl, {
        maxProducts: opts.maxProducts,
        pdpSample: opts.pdpSample,
        noCache: opts.cache === false,
        offlineFixturesDir: opts.offline ? opts.fixtures : undefined,
        onProgress: progress,
      });
      progress("analyse");

      await writeRunArtefacts(runDir, snapshot, markers, findings);
      process.exit(0);
    } catch (err) {
      fail(err);
    }
  });

program
  .command("report")
  .description("Regenerate csv/html/terminal outputs from an existing run's findings.json")
  .argument("<runDir>", "Path to an existing out/<host>/<timestamp> run directory")
  .action(async (runDir: string) => {
    try {
      const findings = await readJson<Findings>(path.join(runDir, "findings.json"));
      const parsed = Findings.parse(findings);
      await writeRunArtefacts(runDir, undefined, undefined, parsed);
      process.exit(0);
    } catch (err) {
      fail(err);
    }
  });

program
  .command("diff")
  .description("(P1) Compare two run directories' snapshots and re-render runDirB with velocity")
  .argument("<runDirA>", "Earlier run directory")
  .argument("<runDirB>", "Later run directory")
  .action(async (runDirA: string, runDirB: string) => {
    try {
      const snapshotA = StoreSnapshot.parse(await readJson<StoreSnapshot>(path.join(runDirA, "snapshot.json")));
      const snapshotB = StoreSnapshot.parse(await readJson<StoreSnapshot>(path.join(runDirB, "snapshot.json")));
      const markersB = PdpMarkers.parse(await readJson<PdpMarkers>(path.join(runDirB, "pdp-markers.json")));

      progress("diff");
      const delta = diffSnapshots(snapshotA, snapshotB);

      process.stdout.write(
        `Sold through: ${delta.soldThrough.length} · Restocked: ${delta.restocked.length} · ` +
          `New products: ${delta.newProducts.length} · Removed products: ${delta.removedProducts.length}\n`,
      );

      await writeJson(path.join(runDirB, "delta.json"), delta);

      progress("analyse");
      const findings = analyseSnapshot(snapshotB, markersB, undefined, delta);

      await writeRunArtefacts(runDirB, undefined, undefined, findings);
      process.exit(0);
    } catch (err) {
      fail(err);
    }
  });

program.parseAsync(process.argv).catch(fail);
