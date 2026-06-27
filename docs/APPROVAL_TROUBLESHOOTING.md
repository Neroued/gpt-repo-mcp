# Approval Troubleshooting

Use this checklist when a docs-write dry run succeeds but the actual `repo_write_file` or `repo_write_changes` call is blocked before the user sees an approval prompt.

## Checklist

- Verify `tools/list` includes exactly the default visible surface from [TOOL_SURFACE.md](TOOL_SURFACE.md).
- Verify the only visible mutating tools are `repo_write_file` and `repo_write_changes`.
- Verify connector metadata was refreshed after changing tool schemas, descriptions, or server instructions.
- Verify `src/instructions.ts` describes the app as a repository reader plus docs writer.
- Verify `config.local.json` enables docs-only writes for the target repo.
- Verify the target path is under `docs/**` or exactly `README.md`.
- Verify the dry-run call succeeds before the actual mutation.
- Verify the same operation works through MCP Inspector, API Playground, or a raw MCP client if available.

## How To Tell Where A Block Happened

Check the local server stderr audit logs. Each `/mcp` request that reaches the server emits `mcp_request_start` and `mcp_request_finish` with a `request_id`. Tool handlers emit their normal tool audit with the same `request_id`.

| Local logs | Meaning |
| --- | --- |
| ChatGPT says the call was blocked by OpenAI safety checks, with no `mcp_request_start` and no tool audit | The call was blocked before reaching the local MCP server. |
| `mcp_request_start` exists, but no tool audit exists for the same `request_id` | The request reached `/mcp`, but did not reach the tool handler. Inspect MCP session, transport, and routing. |
| `mcp_request_start` and a tool audit with a warning or error code exist for the same `request_id` | The server received the call and rejected it through validation, policy, or runtime handling. |
| `mcp_request_start` and a successful tool audit exist for the same `request_id` | Normal server path. |

For blocked-before-approval cases, the absence of any local `request_id` or audit entry is the key evidence. Request diagnostics include only safe metadata such as method, route, session presence, MCP method, and MCP tool name; they do not include tool arguments or request bodies.

For easier terminal scanning, start the connector with pretty audit logs:

```bash
GPT_REPO_LOG_FORMAT=pretty npm run connect
```

JSON audit logs remain the default. Pretty logs are compact one-line renderings of the same sanitized metadata.

## Server Policy Blocks

If the request reaches the server and is rejected, ask ChatGPT to call `repo_policy_explain` for the same repo id and path. Common docs-writer blocks are:

- writes are disabled for the repo
- the path is outside `docs/**` and `README.md`
- a denied glob wins over an allowed glob
- the path looks like a secret, key, source file, generated artifact, build output, or cache file
- an exact-match edit anchor is missing or appears more than once

After a successful docs write, inspect with `repo_git_status` and `repo_git_diff`. Recovery, commits, and other local git actions are manual outside MCP.
