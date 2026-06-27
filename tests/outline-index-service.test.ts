import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { OutlineService } from "../src/services/outline-service.js";
import { PathSandbox } from "../src/services/path-sandbox.js";
import { RepoIndexService } from "../src/services/repo-index-service.js";
import { createRepoFixture } from "./fixtures/repo-fixture.js";

describe("OutlineService and RepoIndexService", () => {
  test("outlines C++/CUDA files and fetches a precise region", async () => {
    const fixture = await createRepoFixture();
    await mkdir(join(fixture.root, "include"), { recursive: true });
    await writeFile(join(fixture.root, "src", "engine.cu"), [
      "#include <cuda_runtime.h>",
      "",
      "class Engine {",
      "public:",
      "  void run() {}",
      "};",
      "",
      "__global__ void linear_q4_gemv_kernel(float* out) {",
      "  // TODO: optimize",
      "  out[0] = 1.0f;",
      "}",
      "",
      "void launch_state_passing() {",
      "  linear_q4_gemv_kernel<<<1, 1>>>(nullptr);",
      "}",
      ""
    ].join("\n"));

    const service = new OutlineService(new PathSandbox(fixture.root));
    const outline = await service.outline({ path: "src/engine.cu" });

    expect(outline.includes).toEqual([{ line: 1, value: "<cuda_runtime.h>" }]);
    expect(outline.classes.map((symbol) => symbol.name)).toContain("Engine");
    expect(outline.cuda_kernels.map((symbol) => symbol.name)).toContain("linear_q4_gemv_kernel");
    expect(outline.functions.map((symbol) => symbol.name)).toContain("launch_state_passing");
    expect(outline.todos).toEqual([
      expect.objectContaining({ start_line: 9, name: "TODO" })
    ]);

    const region = await service.fetchRegion({
      path: "src/engine.cu",
      region: "function",
      name: "launch_state_passing"
    });

    expect(region.text).toContain("void launch_state_passing()");
    expect(region.text).not.toContain("class Engine");
    expect(region.region.matched_symbol).toBe("launch_state_passing");
  });

  test("summarizes index, searches symbols, and reports changes since an index", async () => {
    const fixture = await createRepoFixture();
    await writeFile(join(fixture.root, "CMakeLists.txt"), [
      "cmake_minimum_required(VERSION 3.25)",
      "add_executable(qwen src/main.cpp src/kernel.cu)",
      ""
    ].join("\n"));
    await writeFile(join(fixture.root, "src", "kernel.cu"), [
      "__global__ void state_passing_gdn_kernel(float* x) {",
      "  x[0] = 0.0f;",
      "}",
      ""
    ].join("\n"));
    await writeFile(join(fixture.root, "src", "main.cpp"), "int main() { return 0; }\n");

    const service = new RepoIndexService(fixture.root, new PathSandbox(fixture.root));
    const summary = await service.summary({ force_refresh: true });

    expect(summary.language_stats.map((stat) => stat.language)).toEqual(expect.arrayContaining(["cpp", "cuda", "cmake"]));
    expect(summary.source_files_count).toBeGreaterThanOrEqual(3);
    expect(summary.kernel_files_count).toBeGreaterThanOrEqual(1);
    expect(summary.cmake_targets).toEqual([
      expect.objectContaining({ name: "qwen", kind: "add_executable" })
    ]);

    const symbols = await service.symbols({ name: "state_passing_gdn_kernel", kind: "kernel" });
    expect(symbols.returned_count).toBe(1);
    expect(symbols.symbols[0]).toMatchObject({
      path: "src/kernel.cu",
      kind: "kernel",
      name: "state_passing_gdn_kernel"
    });

    await writeFile(join(fixture.root, "src", "main.cpp"), "int main() { return 1; }\n");
    const changed = await service.changedSince(summary.index_id, { force_refresh: true });

    expect(changed.changed).toBe(true);
    expect(changed.modified).toContain("src/main.cpp");
  });
});
