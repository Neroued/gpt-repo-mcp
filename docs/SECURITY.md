# Security

GPT Repo MCP is scoped to approved local repositories. ChatGPT supplies a `repo_id`; the server resolves it to a configured root and validates every repo-relative path through sandbox, exclude, secret, read, and write policy checks.

## Tool Surface

Default visible tools are limited to repository reading, search, symbol inspection, read-only git status/diff, last-write metadata, policy explanation, and docs-only writing.

Read tools use read-only annotations:

- `readOnlyHint: true`
- `destructiveHint: false`
- `openWorldHint: false`
- `idempotentHint: true`

Only `repo_write_file` and `repo_write_changes` are mutating in the default surface. They use write annotations:

- `readOnlyHint: false`
- `destructiveHint: true`
- `openWorldHint: false`
- `idempotentHint: false`

No shell execution tools, arbitrary command runners, stage/commit/restore/recover/cleanup tools, push/pull/reset/checkout/switch/rebase/merge/stash tools, external-agent task tools, or resume-note tools are registered by default.

## Transport

The default OSS connection path is `npm run connect`. It starts the local MCP server and starts or reuses ngrok as a convenience HTTPS tunnel. The printed ChatGPT URL ends in `/t/<random-token>/mcp`.

That random path token is guess-resistance only, not authentication. Anyone with the full URL can reach the MCP endpoint while the public tunnel is running, so stop it when done.

OpenAI Secure MCP Tunnel keeps the local MCP endpoint private at `/mcp`; `tunnel-client` opens an outbound connection to OpenAI and forwards MCP requests back to the local server. Store the tunnel runtime API key in `.env` or another local secret store, never in committed files.

Network exposure does not bypass repository policy. Approved roots, default excludes, path sandboxing, secret checks, write policy, and schemas still apply.

## Approved Roots And Paths

All repository access is scoped by `repo_id`. Unknown repos are rejected.

All model-supplied paths must be repo-relative POSIX paths. `PathSandbox` rejects absolute paths, traversal, symlink escapes, device files, sockets, and named pipes.

Nested Git repositories and submodules are separate trust boundaries. Register them as their own `repo_id` before reading them.

## Default Excludes And Secrets

Default excludes apply to tree, search, bounded reads, project briefing, task inventory, and decision memory. Common excluded areas include Git internals, dependency directories, generated output/cache directories, coverage, virtual environments, and generated test artifacts.

Secret-looking paths are blocked by default. Sensitive examples include `.env`, private keys, certificate bundles, identity key files, and directories exactly named `secrets` or `credentials`.

Public environment templates are the narrow exception for reads: `.env.example`, `.env.sample`, `.env.template`, and `example.env` can be read when their contents pass secret scanning. Real environment files remain blocked.

Tool outputs, errors, and logs must not include file contents from blocked secret candidates, tokens, credentials, environment variables, private keys, raw tool outputs, or raw errors. Except for configured roots returned by `repo_list_roots`, tools should prefer `repo_id` and repo-relative paths over absolute paths.

## Write Policy

Writes are disabled unless a repo opts in with `writes.enabled: true`.

When enabled, the default write policy allows only:

```text
docs/**
README.md
```

Default denied write globs include Git internals, env files, private key files, source directories, test directories, tool/script directories, build/output directories, profiles, cache directories, CMake files, C/C++/CUDA files, Python files, JavaScript/TypeScript files, dependency directories, coverage, and other generated artifacts. Denied globs and hard secret-candidate checks win over allowed globs.

`repo_write_file` and `repo_write_changes` also enforce repo-relative paths, no traversal, no absolute paths, no symlink escapes, no device files, no sockets, no named pipes, `max_bytes_per_write`, UTF-8 text targets for edits, exact-match anchors for targeted edits, and secret scanning of resulting content. `dry_run: true` validates policy, path, size, and content checks without writing.

The CLI permission modes are:

- `read`: writes disabled.
- `write`: docs-only writes enabled; local operations disabled.

`ship` mode has been removed. Local git operations should be run manually outside MCP.

## Audit Logging

Audit logs may include tool name, `repo_id`, safe repo-relative paths or globs, counts, truncation state, warning codes, request id, safe MCP method and tool name, HTTP status code, duration, and MCP session presence.

Audit logs must not include request bodies, tool arguments, full MCP session ids, headers, returned file text, file content, secret-looking values, raw structured outputs, raw errors, environment variables, tokens, credentials, SSH keys, private keys, or unredacted absolute paths.
