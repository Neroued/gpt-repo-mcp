import { describe, expect, test } from "vitest";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { PathSandbox } from "../src/services/path-sandbox.js";
import { SearchService } from "../src/services/search-service.js";
import { createRepoFixture } from "./fixtures/repo-fixture.js";

describe("SearchService", () => {
  test("finds literal matches with context", async () => {
    const fixture = await createRepoFixture();
    const result = await new SearchService(fixture.root, new PathSandbox(fixture.root)).search({
      query: "/api/users",
      context_lines: 1
    });

    expect(result.returned_count).toBe(1);
    expect(result.results[0]).toMatchObject({
      path: "src/app.ts",
      line: 2,
      text: "  return fetch('/api/users');",
      before: ["export function rawFetch() {"],
      after: ["}"]
    });
  });

  test("skips secret candidates, default excludes, binary files, and nested repo contents", async () => {
    const fixture = await createRepoFixture();
    const service = new SearchService(fixture.root, new PathSandbox(fixture.root));

    expect((await service.search({ query: "super-secret" })).returned_count).toBe(0);
    expect((await service.search({ query: "ignored" })).returned_count).toBe(0);
    expect((await service.search({ query: "nested" })).returned_count).toBe(0);
  });

  test("supports regex mode", async () => {
    const fixture = await createRepoFixture();
    const result = await new SearchService(fixture.root, new PathSandbox(fixture.root)).search({
      query: "fetch\\('/api/users'\\)",
      mode: "regex"
    });

    expect(result.returned_count).toBe(1);
    expect(result.results[0]?.path).toBe("src/app.ts");
  });

  test("supports multi-query OR search and matched_query metadata", async () => {
    const fixture = await createRepoFixture();
    await writeFile(join(fixture.root, "src", "todo.ts"), "// TODO: handle fallback\n");

    const result = await new SearchService(fixture.root, new PathSandbox(fixture.root)).search({
      queries: ["NotYetImplemented", "TODO", "FIXME"],
      combine: "OR"
    });

    expect(result.returned_count).toBe(1);
    expect(result.results[0]).toMatchObject({
      path: "src/todo.ts",
      matched_query: "TODO"
    });
  });

  test("supports include and exclude globs", async () => {
    const fixture = await createRepoFixture();
    const result = await new SearchService(fixture.root, new PathSandbox(fixture.root)).search({
      query: "true",
      include_globs: ["src/**/*.controller.ts"],
      exclude_globs: ["src/admin.*"]
    });

    expect(result.results.map((match) => match.path)).toEqual(["src/users.controller.ts"]);
    expect(result.matched_count).toBe(1);
    expect(result.returned_count).toBe(1);
  });

  test("paginates deterministic results with cursor", async () => {
    const fixture = await createRepoFixture();
    const service = new SearchService(fixture.root, new PathSandbox(fixture.root));

    const first = await service.search({
      query: "export",
      include_globs: ["src/**/*.ts"],
      max_results: 2
    });

    expect(first.results.map((match) => match.path)).toEqual(["src/admin.controller.ts", "src/app.ts"]);
    expect(first.truncated).toBe(true);
    expect(first.next_cursor).toBe("2");

    const second = await service.search({
      query: "export",
      include_globs: ["src/**/*.ts"],
      max_results: 2,
      cursor: first.next_cursor
    });

    expect(second.results.map((match) => match.path)).toEqual(["src/controllers.ts", "src/controllers.ts"]);
    expect(second.truncated).toBe(true);
    expect(second.next_cursor).toBe("4");
  });

  test("searches beyond the first tree page", async () => {
    const fixture = await createRepoFixture();
    await mkdir(join(fixture.root, "many"), { recursive: true });
    for (let index = 0; index < 2_005; index += 1) {
      await writeFile(join(fixture.root, "many", `file-${index}.ts`), `export const value${index} = ${index};\n`);
    }
    await writeFile(join(fixture.root, "many", "file-2004.ts"), "export const needle = 'MATCH_AFTER_FIRST_PAGE';\n");

    const result = await new SearchService(fixture.root, new PathSandbox(fixture.root)).search({
      query: "MATCH_AFTER_FIRST_PAGE"
    });

    expect(result.returned_count).toBe(1);
    expect(result.results[0]?.path).toBe("many/file-2004.ts");
  });

  test("redacts secret-looking search snippets", async () => {
    const fixture = await createRepoFixture();
    await writeFile(join(fixture.root, "src", "key.ts"), "export const key = 'sk-realSecretValue123';\n");

    const result = await new SearchService(fixture.root, new PathSandbox(fixture.root)).search({
      query: "sk-realSecretValue123"
    });

    expect(result.returned_count).toBe(1);
    expect(result.results[0]?.text).toContain("[REDACTED_SECRET]");
    expect(result.results[0]?.text).not.toContain("sk-realSecretValue123");
  });

  test("rejects invalid regex with a stable policy error", async () => {
    const fixture = await createRepoFixture();
    const service = new SearchService(fixture.root, new PathSandbox(fixture.root));

    await expect(service.search({ query: "(", mode: "regex" })).rejects.toMatchObject({
      code: "VALIDATION_ERROR"
    });
  });
});
