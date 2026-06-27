# GPT Repo MCP

Give ChatGPT a focused local workspace assistant for repository reading, code search, read-only git inspection, and restricted documentation writes.

![Node >=20](https://img.shields.io/badge/node-%3E%3D20-brightgreen)
![MCP server](https://img.shields.io/badge/MCP-server-blue)
![TypeScript](https://img.shields.io/badge/TypeScript-ready-3178c6)
![Docs writes](https://img.shields.io/badge/docs--writes-opt--in-orange)

GPT Repo MCP is a TypeScript MCP server for approved local repositories. The default visible tool surface is intentionally narrow: ChatGPT can understand a repo, search and read precise code regions, inspect git status and diffs, write durable documentation under `docs/**` or `README.md` when enabled, and explain policy decisions.

This project is not affiliated with OpenAI, ChatGPT, Anthropic, or the Model Context Protocol maintainers.

## What You Can Do

- Ask ChatGPT to understand repo structure, languages, likely entrypoints, TODOs, decisions, and architecture.
- Search code with literal, regex, multi-query, symbol, outline, and region-level tools.
- Read files in bounded pages instead of pulling large files by default.
- Inspect local git status and diffs through read-only tools.
- Let ChatGPT write durable documentation under `docs/**` or `README.md` after docs-only write mode is enabled.
- Ask why a path is allowed or blocked with `repo_policy_explain`.

## Core Workflow

1. ChatGPT lists approved repos with `repo_list_roots`.
2. ChatGPT builds context with `repo_project_brief`, `repo_index_summary`, and `repo_tree` using `tree_mode: "source_only"`.
3. ChatGPT uses `repo_search`, `repo_search_symbol`, `repo_outline_file`, and `repo_fetch_region` for precise code context.
4. ChatGPT writes only durable docs with `repo_write_file` or `repo_write_changes` when docs-only writes are enabled.
5. ChatGPT reviews the result with `repo_git_status` and `repo_git_diff`.

## Quickstart

### 1. Install

```bash
git clone https://github.com/CAHN91/gpt-repo-mcp.git
cd gpt-repo-mcp
npm install
npm run build
cp config.example.json config.local.json
```

### 2. Add Your Repo

```bash
npm run add -- /path/to/your/repo
```

The copied starter config is valid and empty. This command adds the first approved repository.

Interactive terminals prompt for a permission mode: `read` or `write`. Non-interactive runs default to `read`.

For predictable setup in scripts:

```bash
npm run add -- /path/to/your/repo --mode read
npm run add -- /path/to/your/repo --mode write
```

`write` means docs-only writes: `docs/**` and `README.md`. `ship` mode has been removed.

### 3. Connect ChatGPT

```bash
npm run connect
```

Copy the printed URL:

```text
ChatGPT MCP URL: https://<ngrok-host>/t/<random-token>/mcp
```

Paste it into ChatGPT Developer Mode connector settings, start a new chat, select the connector, and ask:

```text
Use GPT Repo MCP. Which repositories can you access?
```

Need help choosing **Server URL** vs **Tunnel ID**? See [ChatGPT connector setup](docs/CHATGPT_CONNECT.md#server-url-or-tunnel).

New to ngrok? See [Install ngrok from zero](docs/SETUP.md#install-ngrok-from-zero).

## Permission Modes

| Mode | Best For | What ChatGPT Can Do |
| --- | --- | --- |
| `read` | First install, project review, cautious exploration | Inspect repo structure, search/read files, inspect git status and diffs, and explain policy. |
| `write` | Documentation drafting and durable notes | Everything in `read`, plus docs-only writes to `docs/**` and `README.md` guarded by deny rules, secret checks, path sandboxing, and size limits. |

No mode enables source edits, staging, commits, restore, cleanup, push, pull, reset, checkout, switch, rebase, merge, stash, force, branch deletion, shell execution, or arbitrary command execution.

## Default Visible Tools

The default MCP surface exposes these 20 tools:

```text
repo_list_roots
repo_project_brief
repo_index_summary
repo_tree
repo_read_many
repo_fetch_file
repo_fetch_region
repo_outline_file
repo_search
repo_search_symbol
repo_symbols
repo_task_inventory
repo_changed_since
repo_decision_memory
repo_git_status
repo_git_diff
repo_last_write
repo_write_file
repo_write_changes
repo_policy_explain
```

See [docs/TOOL_SURFACE.md](docs/TOOL_SURFACE.md) for the full surface, hidden legacy tools, and recommended call order.

## Example ChatGPT Prompts

```text
What repositories can you access through GPT Repo MCP?
```

```text
Give me a project brief for <repo_id>. Then show the source tree at max_depth 3.
```

```text
Find the CUDA launch path in <repo_id>. Use symbol search and fetch only the relevant function region.
```

```text
Read README.md and docs/SETUP.md in <repo_id>, then update docs/research/setup-notes.md with durable findings.
```

```text
Review the current git status and documentation diff in <repo_id>.
```

```text
Can you write to src/app.ts in <repo_id>? Explain which policy allows or blocks it.
```

## Boundaries

GPT Repo MCP is intentionally not a shell runner and not a code-writing agent surface.

- ChatGPT works through named repository ids and repo-relative paths.
- Default writes are disabled until a repo opts in.
- Enabled writes are docs-only by default: `docs/**` and `README.md`.
- Deny rules block source-like paths, secret-like paths, generated/cache/build outputs, and `.git/**`.
- Git tools are read-only by default: status and diff.
- Error recovery is manual through local git tools.

Read the full model in [docs/SECURITY.md](docs/SECURITY.md).

## Common Commands

| Command | Purpose |
| --- | --- |
| `npm run build` | Build the MCP server and CLI. |
| `npm run doctor` | Check config, scripts, tunnel state, port use, and git status. |
| `npm run connect` | Start the MCP server and try to use or reuse an ngrok HTTPS tunnel. |
| `npm run connect:secure` | Start the MCP server and OpenAI Secure MCP Tunnel. |
| `npm run mcp` | Start only the local MCP server with `config.local.json`. |
| `npm run tunnel` | Start only an ngrok tunnel to local port `8787`. |
| `npm run list` | List approved repositories. |
| `npm run add -- <path>` | Add an approved repository root. |
| `npm run add -- <path> --mode <mode>` | Add a repository root with explicit `read` or `write` mode. |
| `npm run remove -- <repo_id>` | Remove an approved repository root. |
| `npm run check:config` | Validate local config. |
| `npm test -- tests/tool-contracts.test.ts tests/mcp-contract.test.ts` | Run focused MCP contract checks. |

## Requirements

- Node.js 20 or newer
- npm
- git
- ngrok for the built-in `npm run connect` convenience tunnel, or another HTTPS tunnel for manual setup
- ChatGPT account with Developer Mode access

## Documentation

- [Setup](docs/SETUP.md)
- [ChatGPT connector steps](docs/CHATGPT_CONNECT.md)
- [Connection options](docs/CONNECTION_OPTIONS.md)
- [Tool surface](docs/TOOL_SURFACE.md)
- [Write workflows](docs/WRITE_WORKFLOWS.md)
- [Security model](docs/SECURITY.md)
- [Secure MCP Tunnel runbook](docs/SECURE_TUNNEL_RUNBOOK.md)
- [Release checklist](docs/RELEASE_CHECKLIST.md)

## Troubleshooting

- Unknown `repo_id`: run `npm run list`.
- Connector URL changed: restart `npm run connect` and update ChatGPT Developer Mode with the new printed URL.
- Secure tunnel metadata stale: restart the service, then refresh ChatGPT connector metadata.
- Write blocked: ask ChatGPT to run `repo_policy_explain` for the repo id and path.
- Schema mismatch: refresh ChatGPT Developer Mode and run `npm test -- tests/mcp-contract.test.ts tests/tool-contracts.test.ts`.
- Tunnel 502: confirm the local server is running, check `/health`, then restart the tunnel.

## License

MIT. See [LICENSE](LICENSE).
