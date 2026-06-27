import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { LastWriteInputSchema, LastWriteResultSchema } from "../src/contracts/operation-receipt.contract.js";
import { PolicyExplainInputSchema, PolicyExplainResultSchema } from "../src/contracts/policy.contract.js";
import { WriteChangesInputSchema, WriteChangesResultSchema, WriteFileInputSchema, WriteFileResultSchema } from "../src/contracts/write.contract.js";
import { readOnlyAnnotations, writeAnnotations } from "../src/tools/annotations.js";
import { DEFAULT_VISIBLE_TOOL_NAMES, allToolCatalog, toolCatalog } from "../src/tools/catalog.js";
import { toolContracts, type ToolName } from "../src/tools/contracts.js";
import { MUTATING_TOOL_NAMES, isMutatingToolName } from "../src/tools/mutating-tools.js";

const HIDDEN_BY_DEFAULT = [
  "repo_git_review",
  "repo_git_stage",
  "repo_git_unstage",
  "repo_git_restore_paths",
  "repo_git_commit",
  "repo_write_stage",
  "repo_write_unstage",
  "repo_write_commit",
  "repo_write_stage_commit",
  "repo_write_recover",
  "repo_cleanup_paths",
  "repo_change_plan",
  "repo_next_action",
  "repo_plan_review",
  "repo_prepare_codex_task",
  "repo_write_codex_task",
  "repo_codex_review",
  "repo_write_handoff"
] as const satisfies readonly ToolName[];

function expectFieldDescriptions(fields: Array<[string, { description?: string }]>): void {
  for (const [field, schema] of fields) {
    expect(schema.description, `${field} should have a field description`).toBeTypeOf("string");
    expect(schema.description?.length, `${field} should have a non-empty field description`).toBeGreaterThan(10);
  }
}

describe("tool catalog contracts", () => {
  test("default visible tool surface is docs-writer focused", () => {
    expect(DEFAULT_VISIBLE_TOOL_NAMES).toEqual([
      "repo_list_roots",
      "repo_project_brief",
      "repo_index_summary",
      "repo_tree",
      "repo_read_many",
      "repo_fetch_file",
      "repo_fetch_region",
      "repo_outline_file",
      "repo_search",
      "repo_search_symbol",
      "repo_symbols",
      "repo_task_inventory",
      "repo_changed_since",
      "repo_decision_memory",
      "repo_git_status",
      "repo_git_diff",
      "repo_last_write",
      "repo_write_file",
      "repo_write_changes",
      "repo_policy_explain"
    ]);
    expect(toolCatalog.map((tool) => tool.name)).toEqual([...DEFAULT_VISIBLE_TOOL_NAMES]);
    expect(toolCatalog).toHaveLength(20);
    expect(toolCatalog.filter((tool) => isMutatingToolName(tool.name)).map((tool) => tool.name)).toEqual([
      "repo_write_file",
      "repo_write_changes"
    ]);
  });

  test("hidden tools remain in the full internal catalog but are not registered by default", () => {
    const visibleNames = new Set(toolCatalog.map((tool) => tool.name));
    const allNames = new Set(allToolCatalog.map((tool) => tool.name));

    for (const name of HIDDEN_BY_DEFAULT) {
      expect(allNames.has(name), `${name} should remain available internally`).toBe(true);
      expect(visibleNames.has(name), `${name} should be hidden from default tools/list`).toBe(false);
      expect(toolContracts[name]).toBeDefined();
    }
  });

  test("visible tools have required metadata and appropriate annotations", () => {
    for (const tool of toolCatalog) {
      expect(tool.title.length).toBeGreaterThan(0);
      expect(tool.description.startsWith("Use this when")).toBe(true);
      expect(tool.inputSchema).toBeDefined();
      expect(tool.outputSchema).toBeDefined();
      expect(tool.handler).toBeTypeOf("function");
      if (isMutatingToolName(tool.name)) {
        expect(tool.annotations).toEqual(writeAnnotations);
      } else {
        expect(tool.annotations).toEqual(readOnlyAnnotations);
      }
    }
  });

  test("visible docs-write and policy tools use central contracts", () => {
    const byName = new Map(toolCatalog.map((tool) => [tool.name, tool]));

    expect(byName.get("repo_policy_explain")?.inputSchema).toBe(PolicyExplainInputSchema);
    expect(byName.get("repo_policy_explain")?.outputSchema).toBe(PolicyExplainResultSchema);
    expect(byName.get("repo_last_write")?.inputSchema).toBe(LastWriteInputSchema);
    expect(byName.get("repo_last_write")?.outputSchema).toBe(LastWriteResultSchema);
    expect(byName.get("repo_write_file")?.inputSchema).toBe(WriteFileInputSchema);
    expect(byName.get("repo_write_file")?.outputSchema).toBe(WriteFileResultSchema);
    expect(byName.get("repo_write_changes")?.inputSchema).toBe(WriteChangesInputSchema);
    expect(byName.get("repo_write_changes")?.outputSchema).toBe(WriteChangesResultSchema);
    expect(byName.get("repo_write_file")?.description).toContain("documentation file");
    expect(byName.get("repo_write_changes")?.description).toContain("documentation edit pack");
    expect(byName.get("repo_write_file")?.description).not.toContain("code edits");
    expect(byName.get("repo_write_changes")?.description).not.toContain("source");
  });

  test("mutating tool registry still tracks all internal mutating tools", () => {
    expect(MUTATING_TOOL_NAMES).toEqual([
      "repo_write_file",
      "repo_write_changes",
      "repo_write_handoff",
      "repo_write_codex_task",
      "repo_git_stage",
      "repo_git_unstage",
      "repo_git_restore_paths",
      "repo_git_commit",
      "repo_write_stage",
      "repo_write_unstage",
      "repo_write_commit",
      "repo_write_stage_commit",
      "repo_write_recover",
      "repo_cleanup_paths"
    ]);
    expect(isMutatingToolName("repo_git_review")).toBe(false);
    expect(isMutatingToolName("repo_last_write")).toBe(false);
  });

  test("visible write schemas describe important input and output fields", () => {
    expectFieldDescriptions([
      ["repo_last_write.repo_id", LastWriteInputSchema.shape.repo_id],
      ["repo_last_write.next_tool_payloads", LastWriteResultSchema.shape.next_tool_payloads],
      ["repo_write_file.path", WriteFileInputSchema.shape.path],
      ["repo_write_file.action", WriteFileInputSchema.shape.action],
      ["repo_write_file.content", WriteFileInputSchema.shape.content],
      ["repo_write_file.operation_receipt", WriteFileResultSchema.shape.operation_receipt],
      ["repo_write_changes.changes", WriteChangesInputSchema.shape.changes],
      ["repo_write_changes.next_steps", WriteChangesResultSchema.shape.next_steps],
      ["repo_write_changes.operation_receipt", WriteChangesResultSchema.shape.operation_receipt]
    ]);
  });

  test("receipt files are ignored by git", () => {
    const gitignore = readFileSync(".gitignore", "utf8");

    expect(gitignore).toContain(".chatgpt/operations/*.json");
  });

  test("catalog does not define inline zod schemas", () => {
    const source = readFileSync("src/tools/catalog.ts", "utf8");

    expect(source).not.toMatch(/\binputSchema:\s*{/);
    expect(source).not.toMatch(/\boutputSchema:\s*{/);
    expect(source).not.toMatch(/\bz\.(object|string|number|boolean|array|enum|record|union|literal)\s*\(/);
    expect(source).not.toMatch(/\.shape\b/);
  });
});
