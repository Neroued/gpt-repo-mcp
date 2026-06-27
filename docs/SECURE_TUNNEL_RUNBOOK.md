# Secure MCP Tunnel Runbook

This runbook is for the local WSL deployment where ChatGPT Developer Mode reaches GPT Repo MCP through OpenAI Secure MCP Tunnel.

## Security Model

- Do not expose port `8787` to the public internet.
- The MCP server listens on `127.0.0.1` by default.
- The tunnel client opens an outbound HTTPS connection to OpenAI.
- ChatGPT connector authentication should be `No Authentication`.
- The runtime key belongs in `.env` as `CONTROL_PLANE_API_KEY`; never paste it into ChatGPT.
- Default repository setup is docs-writer mode: read/search/git-status/git-diff plus writes only to `docs/**` and `README.md`.
- Source edits, staging, commits, restore, cleanup, shell commands, and arbitrary git operations are outside the default MCP surface.

## Files

- Local env: `.env`
- MCP config: `config.local.json`
- Tunnel profile: `~/.config/tunnel-client/gpt-repo-local.yaml`
- Tunnel client binary: `~/.local/bin/tunnel-client`
- Runtime log: `logs/gpt-repo-mcp-secure.log`
- Runtime PID file: `run/gpt-repo-mcp-secure.pid`
- User systemd unit: `~/.config/systemd/user/gpt-repo-mcp-secure.service`

## One-Time Setup

Install dependencies and build the local CLI:

```bash
cd /home/neroued/gpt-repo-mcp
npm ci
npm run build
```

Install the pinned Linux x86_64 OpenAI tunnel client:

```bash
npm run secure:tunnel -- install-client
```

Create `.env` from `.env.example`, then fill only the key value:

```bash
cp .env.example .env
chmod 600 .env
```

Required `.env` value:

```bash
CONTROL_PLANE_API_KEY=sk-...
```

Configure one docs-writer repository and the Secure MCP Tunnel profile:

```bash
npm run secure:tunnel -- setup \
  --repo "/home/neroued/qwen3.6-ultraspeed" \
  --tunnel-id "tunnel_..."
```

The setup command writes a single repo entry to `config.local.json`, updates non-secret `.env` settings, and creates the local `gpt-repo-local` tunnel profile. The repo entry has `writes.enabled=true`, `allowed_globs=["docs/**","README.md"]`, expanded source/secret/generated deny globs, and `operations.enabled=false`.

## Daily Commands

Start:

```bash
npm run secure:start
```

Status:

```bash
npm run secure:status
```

Check setup and running health:

```bash
npm run secure:check
```

Logs:

```bash
npm run secure:logs
npm run secure:tunnel -- logs --follow
```

Restart:

```bash
npm run secure:restart
```

Stop:

```bash
npm run secure:stop
```

## Boot Autostart

Install and start the user-level systemd service:

```bash
npm run secure:install-service
```

This writes `~/.config/systemd/user/gpt-repo-mcp-secure.service`, enables linger for the current Linux user, enables the service, and starts it immediately. The service runs:

```bash
node scripts/secure-tunnel-ops.mjs run
```

Service status:

```bash
npm run secure:service-status
```

Disable and remove the service:

```bash
npm run secure:uninstall-service
```

If `loginctl enable-linger` is blocked by the host policy, rerun with:

```bash
npm run secure:tunnel -- install-service --skip-linger
```

Without linger, the service starts when the user systemd manager starts; with linger, it starts at WSL/system boot without an interactive login.

## Expected Healthy State

`npm run secure:status` should show:

- supervisor running
- MCP health returns `{"ok":true,"name":"gpt-repo-mcp"}`
- tunnel readyz returns `ready`
- last successful poll timestamp is present

The local endpoints are:

```text
http://127.0.0.1:8787/health
http://127.0.0.1:8080/readyz
http://127.0.0.1:8080/ui
```

## ChatGPT Connector

In ChatGPT connector settings:

```text
Connection: Tunnel
Authentication: No Authentication
```

Select the tunnel created in OpenAI Platform, then refresh metadata.

The default visible tools should be exactly:

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

Starter prompt:

```text
Use GPT Repo MCP only. You are my repository planner and documentation writer. First call repo_list_roots, then repo_project_brief, then repo_tree with tree_mode source_only and max_depth 3. Use repo_outline_file, repo_search_symbol, and repo_fetch_region before fetching large files. Write only durable docs under docs/** or README.md, then inspect with repo_git_status and repo_git_diff.
```

## Notes

`tunnel-client doctor` may report `oauth_metadata` as failed because this MCP server uses `No Authentication` and does not expose OAuth protected-resource metadata. The operational check is `readyz=ready` plus successful control-plane polling.

If `curl http://127.0.0.1:8787/health` returns a proxy error, use:

```bash
curl --noproxy '*' http://127.0.0.1:8787/health
```

If the tunnel does not appear in ChatGPT, verify that the tunnel is associated with the target ChatGPT workspace and that the operator has Tunnels `Read + Use`.
