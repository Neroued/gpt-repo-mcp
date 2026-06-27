# Write Workflows

The write surface is intentionally narrow: ChatGPT can write durable project documentation, not source code or local git state.

Default visible write tools:

- `repo_write_file`
- `repo_write_changes`

Writes are disabled unless a repository opts in with `writes.enabled: true`. When enabled, the default policy allows only `docs/**` and `README.md`. Source files, tests, scripts, CMake files, env files, private keys, build output, cache directories, and generated artifacts are denied.

## Enable Docs Writes

Copy the starter config, then add a repository:

```bash
cp config.example.json config.local.json
npm run add -- /path/to/repo --mode write
```

Mode behavior:

- `read`: reads only; writes and operations disabled.
- `write`: docs-only writes enabled for `docs/**` and `README.md`; local git operations disabled.

`ship` mode has been removed. Stage, commit, restore, cleanup, and other git operations should be run manually outside MCP.

Manual config remains supported:

```json
{
  "repos": [
    {
      "repo_id": "example-repo",
      "display_name": "Example Repo",
      "root": "/absolute/path/to/repo",
      "writes": {
        "enabled": true,
        "allowed_globs": ["docs/**", "README.md"],
        "denied_globs": [
          ".git/**",
          ".env",
          ".env.*",
          "**/*.pem",
          "**/*.key",
          "src/**",
          "include/**",
          "tests/**",
          "bench/**",
          "tools/**",
          "build/**",
          "out/**",
          "profiles/**",
          "CMakeLists.txt",
          "**/CMakeLists.txt",
          "**/*.cpp",
          "**/*.cu",
          "**/*.py",
          "**/*.ts",
          "**/*.js"
        ],
        "max_bytes_per_write": 1048576
      },
      "operations": { "enabled": false }
    }
  ],
  "limits": {
    "max_files": 50,
    "max_bytes_per_file": 128000,
    "max_total_bytes": 750000
  }
}
```

Use `repo_policy_explain` when a read or documentation-write path is unexpectedly blocked.

## Single-File Docs Writes

Use `repo_write_file` for one document:

```json
{
  "repo_id": "example-repo",
  "path": "docs/research/qwen3_6_dflash.md",
  "content": "# Qwen3.6 DFlash Research\n",
  "create_dirs": true
}
```

Supported actions:

- `write`: create a missing file or overwrite an existing file.
- `append`: append text to an existing file.
- `prepend`: prepend text to an existing file.
- `replace`: replace an exact anchor that appears once.
- `insert_before`: insert before an exact anchor that appears once.
- `insert_after`: insert after an exact anchor that appears once.

Use `dry_run: true` only when previewing policy and content checks is useful.

## Multi-File Docs Writes

Use `repo_write_changes` for a cohesive docs edit pack. A call may contain up to 10 changes.

```json
{
  "repo_id": "example-repo",
  "changes": [
    { "type": "write", "path": "docs/plans/decode-plan.md", "content": "# Decode Plan\n" },
    { "type": "append", "path": "README.md", "content": "\nSee docs/plans/decode-plan.md.\n" }
  ]
}
```

Exact-match edits use the same single-anchor semantics as `repo_write_file`. Duplicate target paths in one edit pack are rejected.

## Review

After a write:

```text
repo_git_status
repo_git_diff
```

`repo_last_write` reads safe metadata from `.chatgpt/operations/last-write.json` and suggests read-only status/diff payloads. It never stores file contents, snippets, raw diffs, prompts, command output, secrets, or absolute paths.

If a docs write is wrong, inspect with `repo_git_diff` and recover manually with local git tools. MCP does not stage, commit, restore, clean, push, pull, reset, checkout, switch, rebase, merge, stash, run shell commands, create external-agent tasks, or write source files.

## Suggested User Flow

1. `repo_project_brief`
2. `repo_index_summary`
3. `repo_tree`, `repo_search`, and `repo_symbols`
4. `repo_fetch_file` or `repo_fetch_region`
5. Write docs with `repo_write_file` or `repo_write_changes`
6. Review with `repo_git_status` and `repo_git_diff`
