import fsp from "node:fs/promises";
import { afterEach, describe, expect, it, vi } from "vitest";
import { analyseSnapshot, diffSnapshots, renderReport, scanStore } from "../src/index.js";

const FIXTURES_DIR = "tests/fixtures/bluetokaicoffee.com";

describe("Library seam (task I.1a): src/index.ts has no I/O side effects", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("scanStore({ offlineFixturesDir }) prints nothing and writes no files", async () => {
    const consoleLog = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const stdoutWrite = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const stderrWrite = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const fsWriteFile = vi.spyOn(fsp, "writeFile");
    const fsMkdir = vi.spyOn(fsp, "mkdir");
    const fsAppendFile = vi.spyOn(fsp, "appendFile");

    const result = await scanStore("https://bluetokaicoffee.com", { offlineFixturesDir: FIXTURES_DIR });

    expect(result.snapshot).toBeDefined();
    expect(result.markers).toBeDefined();
    expect(result.findings).toBeDefined();

    expect(consoleLog).not.toHaveBeenCalled();
    expect(consoleError).not.toHaveBeenCalled();
    expect(consoleWarn).not.toHaveBeenCalled();
    expect(stdoutWrite).not.toHaveBeenCalled();
    expect(stderrWrite).not.toHaveBeenCalled();
    expect(fsWriteFile).not.toHaveBeenCalled();
    expect(fsMkdir).not.toHaveBeenCalled();
    expect(fsAppendFile).not.toHaveBeenCalled();
  });

  it("exports exactly the design.md §10 public surface as functions", () => {
    expect(typeof scanStore).toBe("function");
    expect(typeof analyseSnapshot).toBe("function");
    expect(typeof diffSnapshots).toBe("function");
    expect(typeof renderReport).toBe("function");
  });

  it("renderReport(findings) returns pure strings with no side effects", async () => {
    const consoleLog = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const fsWriteFile = vi.spyOn(fsp, "writeFile");

    const { findings } = await scanStore("https://bluetokaicoffee.com", { offlineFixturesDir: FIXTURES_DIR });
    const rendered = renderReport(findings);

    expect(typeof rendered.html).toBe("string");
    expect(typeof rendered.csv).toBe("string");
    expect(typeof rendered.terminal).toBe("string");
    expect(rendered.html.length).toBeGreaterThan(0);
    expect(consoleLog).not.toHaveBeenCalled();
    expect(fsWriteFile).not.toHaveBeenCalled();
  });
});
