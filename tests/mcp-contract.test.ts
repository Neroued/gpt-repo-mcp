import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, test } from "vitest";
import { SERVER_INSTRUCTIONS, createMcpServer } from "../src/register.js";
import { RootRegistry } from "../src/services/root-registry.js";
import { readOnlyAnnotations, writeAnnotations } from "../src/tools/annotations.js";
import { DEFAULT_VISIBLE_TOOL_NAMES, toolCatalog } from "../src/tools/catalog.js";
import { isMutatingToolName } from "../src/tools/mutating-tools.js";

const execFileAsync = promisify(execFile);

const HIDDEN_TOOLS = [
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
];

describe("MCP contract", () => {
  test("initialize exposes docs-writer instructions and tool capability", async () => {
    const { client, close } = await connectFixtureServer();
    try {
      expect(client.getServerVersion()).toMatchObject({ name: "gpt-repo-mcp", version: "0.1.0" });
      expect(client.getServerCapabilities()).toMatchObject({ tools: {} });
      expect(client.getInstructions()).toBe(SERVER_INSTRUCTIONS);
      expect(SERVER_INSTRUCTIONS).toContain("repository reading and restricted documentation writing");
      expect(SERVER_INSTRUCTIONS).toContain("docs/** or README.md");
      expect(SERVER_INSTRUCTIONS).toContain("repo_git_status and repo_git_diff");
      for (const hiddenName of [
        "repo_write_stage_commit",
        "repo_write_recover",
        "repo_write_handoff",
        "repo_write_codex_task",
        "repo_next_action"
      ]) {
        expect(SERVER_INSTRUCTIONS).not.toContain(hiddenName);
      }
    } finally {
      await close();
    }
  });

  test("tools/list exposes only the default docs-writer surface", async () => {
    const { client, close } = await connectFixtureServer();
    try {
      const listed = await client.listTools();
      const names = listed.tools.map((tool) => tool.name);

      expect(names).toEqual([...DEFAULT_VISIBLE_TOOL_NAMES]);
      expect(listed.tools).toHaveLength(20);
      for (const hiddenName of HIDDEN_TOOLS) {
        expect(names).not.toContain(hiddenName);
      }

      for (const tool of listed.tools) {
        expect(tool.title).toEqual(expect.any(String));
        expect(tool.description).toEqual(expect.stringMatching(/^Use this when/));
        expect(tool.inputSchema).toBeDefined();
        expect(tool.outputSchema).toBeDefined();
        if (isMutatingToolName(tool.name)) {
          expect(tool.annotations).toMatchObject(writeAnnotations);
        } else {
          expect(tool.annotations).toMatchObject(readOnlyAnnotations);
        }
      }
      expect(listed.tools.filter((tool) => isMutatingToolName(tool.name)).map((tool) => tool.name)).toEqual([
        "repo_write_file",
        "repo_write_changes"
      ]);
    } finally {
      await close();
    }
  });

  test("hidden tools are not callable through MCP", async () => {
    const { client, close } = await connectFixtureServer();
    try {
      const result = await client.callTool({
        name: "repo_git_review",
        arguments: { repo_id: "fixture" }
      });

      expect(result.isError).toBe(true);
      expect(result.content).toEqual([
        expect.objectContaining({ type: "text", text: expect.stringContaining("Tool repo_git_review not found") })
      ]);
    } finally {
      await close();
    }
  });

  test("representative visible calls match their output schemas", async () => {
    const { client, close } = await connectFixtureServer();
    try {
      const calls: Array<[string, Record<string, unknown>]> = [
        ["repo_list_roots", {}],
        ["repo_project_brief", { repo_id: "fixture" }],
        ["repo_index_summary", { repo_id: "fixture" }],
        ["repo_tree", { repo_id: "fixture", path: ".", max_depth: 2, page_size: 10 }],
        ["repo_read_many", { repo_id: "fixture", paths: ["README.md", "src/app.ts"], max_files: 2 }],
        ["repo_fetch_file", { repo_id: "fixture", path: "README.md", start_line: 1, max_lines: 5 }],
        ["repo_fetch_region", { repo_id: "fixture", path: "src/app.ts", region: "around_line", line: 1, max_lines: 5 }],
        ["repo_outline_file", { repo_id: "fixture", path: "src/app.ts" }],
        ["repo_search", { repo_id: "fixture", query: "fixture", max_results: 5 }],
        ["repo_search_symbol", { repo_id: "fixture", name: "fixture" }],
        ["repo_symbols", { repo_id: "fixture", max_results: 5 }],
        ["repo_task_inventory", { repo_id: "fixture", max_results: 5 }],
        ["repo_decision_memory", { repo_id: "fixture" }],
        ["repo_git_status", { repo_id: "fixture" }],
        ["repo_git_diff", { repo_id: "fixture" }],
        ["repo_last_write", { repo_id: "fixture" }],
        ["repo_write_file", { repo_id: "fixture", path: "docs/write-file-dry-run.md", content: "planned\n", dry_run: true }],
        ["repo_write_changes", {
          repo_id: "fixture",
          changes: [
            { type: "write", path: "docs/write-changes-dry-run.md", content: "planned\n" },
            {
              type: "edit",
              path: "docs/ARCHITECTURE.md",
              edits: [
                { type: "replace", find: "Decision: keep tools read-only.", replace: "Decision: keep tools safe by default." },
                { type: "insert_after", find: "Convention: use contracts first.", content: "\nConvention: review grouped edits through git." }
              ]
            }
          ],
          dry_run: true
        }],
        ["repo_policy_explain", { repo_id: "fixture", path: "docs/plan.md", operation: "write" }]
      ];

      const summary = await client.callTool({ name: "repo_index_summary", arguments: { repo_id: "fixture" } });
      const indexId = (summary.structuredContent as { index_id: string }).index_id;
      calls.splice(12, 0, ["repo_changed_since", { repo_id: "fixture", index_id: indexId }]);

      for (const [name, args] of calls) {
        const result = await client.callTool({ name, arguments: args });
        expect(result.isError, name).toBeUndefined();
        expect(result.structuredContent, name).toBeDefined();

        const definition = toolCatalog.find((tool) => tool.name === name);
        expect(definition, name).toBeDefined();
        const parsed = definition!.outputSchema.safeParse(result.structuredContent);
        expect(parsed.error?.issues, name).toBeUndefined();
        expect(result.content, name).toEqual([
          expect.objectContaining({ type: "text", text: expect.any(String) })
        ]);
      }
    } finally {
      await close();
    }
  });
});

async function connectFixtureServer() {
  const root = await createRepoRoot();
  const registry = await RootRegistry.fromConfig({
    repos: [{
      repo_id: "fixture",
      display_name: "Fixture Repo",
      root,
      writes: { enabled: true },
      operations: { enabled: false }
    }],
    limits: {}
  });
  const server = createMcpServer({ registry });
  const client = new Client({ name: "contract-test-client", version: "0.1.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

  await Promise.all([
    server.connect(serverTransport),
    client.connect(clientTransport)
  ]);

  return {
    client,
    close: async () => {
      await client.close();
      await server.close();
    }
  };
}

async function createRepoRoot() {
  const root = await mkdtemp(join(tmpdir(), "gpt-repo-mcp-contract-"));
  await mkdir(join(root, "src"), { recursive: true });
  await mkdir(join(root, "docs"), { recursive: true });
  await writeFile(join(root, "README.md"), "# Fixture\n");
  await writeFile(join(root, "docs", "ARCHITECTURE.md"), "# Architecture\nDecision: keep tools read-only.\nConvention: use contracts first.\n");
  await writeFile(join(root, "TODO.md"), "- [ ] Wire repo_task_inventory\n");
  await writeFile(join(root, "package.json"), JSON.stringify({
    type: "module",
    scripts: {
      build: "tsc",
      test: "vitest"
    },
    dependencies: {
      "@modelcontextprotocol/sdk": "^1.0.0"
    }
  }, null, 2));
  await writeFile(join(root, "src", "app.ts"), [
    "export const fixture = true;",
    "export function rawFetch() {",
    "  return fetch('/api/users');",
    "}",
    ""
  ].join("\n"));
  await execFileAsync("git", ["init"], { cwd: root, env: { PATH: process.env.PATH ?? "" } });
  await execFileAsync("git", ["config", "user.email", "test@example.com"], { cwd: root, env: { PATH: process.env.PATH ?? "" } });
  await execFileAsync("git", ["config", "user.name", "Test User"], { cwd: root, env: { PATH: process.env.PATH ?? "" } });
  await execFileAsync("git", ["add", "--", "README.md", "docs/ARCHITECTURE.md", "TODO.md", "package.json", "src/app.ts"], { cwd: root, env: { PATH: process.env.PATH ?? "" } });
  await execFileAsync("git", ["commit", "-m", "initial"], { cwd: root, env: { PATH: process.env.PATH ?? "" } });
  await writeFile(join(root, "docs", "staged.md"), "staged\n");
  await execFileAsync("git", ["add", "--", "docs/staged.md"], { cwd: root, env: { PATH: process.env.PATH ?? "" } });
  return root;
}
