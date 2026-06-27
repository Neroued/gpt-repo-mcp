# Architecture

GPT Repo MCP (`gpt-repo-mcp`) is a tool-only MCP server. There is no widget in v1. The server exposes a Streamable HTTP `/mcp` endpoint plus a local health route.

## Boundaries

- `src/server.ts` owns the HTTP server, `/mcp` transport, and `/health`.
- `src/instructions.ts` contains server-wide MCP instructions for cross-tool workflows.
- `src/register.ts` creates the MCP server and registers the default visible tool catalog.
- `src/contracts/*` contains Zod input and output contracts.
- `src/tools/contracts.ts` is the single tool-name to contract map.
- `src/tools/catalog.ts` contains all tool metadata plus `DEFAULT_VISIBLE_TOOL_NAMES`; hidden legacy tools stay wired internally but are not registered by default.
- `src/tools/define-tool.ts` converts contract objects to MCP SDK schemas and registers metadata.
- `src/tools/handlers.ts` contains thin adapters from tool input to services.
- `src/services/*` contains filesystem, git, search, tree, read, write, project, task, decision, and legacy advisory logic.
- `src/policies/*` contains shared limits, excludes, write defaults, and secret patterns.
- `src/runtime/*` contains context, structured errors, result envelopes, and audit logging.

## Tool Registration Flow

The intended flow is:

```text
contracts -> toolContracts -> allToolCatalog -> visible toolCatalog -> define-tool -> handlers -> services
```

Contracts define schemas. `toolContracts` assigns exactly one input and output contract to each tool. `allToolCatalog` keeps metadata and handlers for the full internal set. `toolCatalog` is the default registered surface derived from `DEFAULT_VISIBLE_TOOL_NAMES`. `define-tool` is the only layer that turns Zod objects into MCP SDK `inputSchema` and `outputSchema` shapes.

This keeps tool schemas contract-first, lets hidden legacy services remain testable, and prevents old workflow tools from appearing in `tools/list`.

## Default Surface

The default visible surface is a repository reader plus docs writer:

- repository roots, project brief, index summary, tree, many-file read, paginated file fetch, region fetch, outline, text search, symbol search, symbol listing, task inventory, changed-since, and decision memory
- read-only git status and diff
- last documentation write receipt
- docs-only writes through `repo_write_file` and `repo_write_changes`
- policy explanation

The default surface does not register local git mutation, recovery, cleanup, external-agent task, resume-note, or advisory planning workflow tools.

## Data Flow

ChatGPT calls a tool with `repo_id` and repo-relative POSIX paths or globs. The handler resolves `repo_id` through `RootRegistry`, creates the required services, and returns a result envelope.

Read filesystem access goes through shared safety layers:

```text
PathSandbox -> IgnoreEngine -> FileClassifier -> SecretScanner/FileReader
```

Write filesystem access stays separate from read services:

```text
PathSandbox -> WritePolicy -> FileWriter
                         \-> WriteChangesService -> FileWriter
write handlers -> OperationReceiptService
```

`repo_write_file` writes or exact-match edits one allowed documentation file. `repo_write_changes` applies an ordered documentation edit pack with the same policy and exact-anchor behavior. Both inherit repo-local path validation, write policy, symlink protection, unsupported file type checks, UTF-8 edit target checks, hard secret path blocking, resulting-content secret scanning, and atomic per-file write guardrails.

Default write policy is docs-only. `allowed_globs` defaults to `docs/**` and `README.md`; denied globs block source, tests, scripts, CMake, C/C++/CUDA, Python, JavaScript/TypeScript, secret-like paths, generated output, caches, profiles, and build artifacts. Denies win over allows.

`OperationReceiptService` writes lightweight local receipt metadata after successful actual changed documentation writes and reads it through `repo_last_write`. Receipts live at `.chatgpt/operations/last-write.json`, are ignored by Git, and contain only safe metadata such as repo-relative paths, counts, timestamps, best-effort HEAD SHAs, and summaries. They do not store contents, snippets, diffs, prompts, command output, secrets, or absolute paths.

`GitService` owns read-only status and diff operations in the default surface. If a documentation write is wrong, users inspect with `repo_git_status` and `repo_git_diff`, then recover manually with local git outside MCP.

## Adding a Tool

Add a new default-visible tool by following the contract-first path:

1. Add input and output Zod objects under `src/contracts/*`.
2. Add the tool entry to `src/tools/contracts.ts`.
3. Add a concise `Use this when...` description in `src/tools/descriptions.ts`.
4. Add metadata and the handler reference in `src/tools/catalog.ts`.
5. Add the name to `DEFAULT_VISIBLE_TOOL_NAMES` only when it belongs in the default reader/docs-writer surface.
6. Add a thin handler in `src/tools/handlers.ts`.
7. Put real logic in a service under `src/services/*`.
8. Add service tests, MCP contract coverage, tool contract discipline tests, and instruction/guidance checks when routing changes.

Do not duplicate path validation, ignore handling, secret scanning, schema definitions, or result envelope logic inside individual tools.

## Mutation Rules

Only `repo_write_file` and `repo_write_changes` are mutating in the default surface. They are documentation writers, not code writers.

Mutating tools must stay separate from read tools. Do not loosen read services to support mutation, do not add shell execution, and do not add broad git automation. Any future expansion should default to hidden until contracts, policy, guidance, and MCP surface tests prove it belongs in the visible surface.
