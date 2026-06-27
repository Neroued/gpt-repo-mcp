# Tool Surface

GPT Repo MCP is a closed-world repository reader and restricted documentation writer. The default MCP surface exposes only repository reading, search, symbol inspection, read-only git status/diff, last-write metadata, policy explanation, and docs-only writes.

## Default Tools

The default `tools/list` surface is:

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

Only `repo_write_file` and `repo_write_changes` are mutating in the default surface. They use write annotations and still require repository write opt-in plus policy checks.

These internal legacy tools are not registered by default: git review, git mutation/recovery tools, external-agent task tools, resume-note tools, and advisory planning workflow tools.

## Reading Workflow

Use this order for repository-level understanding:

1. `repo_list_roots`
2. `repo_project_brief`
3. `repo_index_summary`
4. `repo_tree` with `tree_mode: "source_only"` and `max_depth: 3`
5. `repo_search`, `repo_search_symbol`, or `repo_symbols`
6. `repo_outline_file` for large source files
7. `repo_fetch_region` or paginated `repo_fetch_file`

Do not fetch entire large files by default. Files over 200 lines should be read by symbol, region, or line pagination.

## Docs-Only Writing

`repo_write_file` writes or edits one allowed documentation file. `repo_write_changes` applies a small documentation edit pack. The default write policy allows only:

```text
docs/**
README.md
```

Default deny rules block source, tests, scripts, build output, cache directories, env files, private key files, CMake files, C/C++/CUDA files, Python files, JavaScript/TypeScript files, and other generated or sensitive paths. Deny rules win over allowed globs.

Use `repo_write_file` for one document:

```json
{
  "repo_id": "example-repo",
  "path": "docs/research/qwen3_6_dflash.md",
  "content": "# Research\n",
  "create_dirs": true
}
```

Use `repo_write_changes` for up to 10 documentation changes:

```json
{
  "repo_id": "example-repo",
  "changes": [
    { "type": "write", "path": "docs/plans/decode-plan.md", "content": "# Decode Plan\n" },
    { "type": "append", "path": "README.md", "content": "\nSee docs/plans/decode-plan.md.\n" }
  ]
}
```

`replace`, `insert_before`, and `insert_after` require an exact text anchor that appears exactly once.

## Review After Writes

After a documentation write, use read-only git tools:

```text
repo_git_status
repo_git_diff
```

If a write is wrong, recover manually with local git commands outside MCP. The default MCP surface does not stage, commit, restore, clean up files, push, pull, reset, checkout, switch, rebase, merge, stash, run shell commands, create external-agent tasks, or write source files.

## Policy Explanation

Use `repo_policy_explain` when a read or documentation-write path is blocked, or when a user asks what ChatGPT can access. It returns matched globs, stable block codes, effective policy, and guidance without reading or mutating files.
