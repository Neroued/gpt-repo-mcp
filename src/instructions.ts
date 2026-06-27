export const SERVER_INSTRUCTIONS = [
  "GPT Repo MCP is a local workspace assistant for repository reading and restricted documentation writing.",
  "Use it to understand approved repositories, search code, inspect symbols and bounded file regions, read git status and diffs, and write durable documentation only under docs/** or README.md when the repository write policy allows it.",
  "The normal first-pass workflow is repo_list_roots, repo_project_brief, repo_index_summary, repo_tree with tree_mode source_only and max_depth 3, then repo_search or repo_search_symbol, repo_outline_file for large source files, and repo_fetch_region or paginated repo_fetch_file for exact code context.",
  "Do not fetch entire large files by default; files over 200 lines should be read by symbol, region, or pagination. Use repo_read_many only for a bounded set of known files.",
  "Use repo_write_file for one documentation file and repo_write_changes for a small documentation edit pack. Write tools must only target docs/** or README.md unless the server policy explicitly says otherwise.",
  "After a documentation write, use repo_git_status and repo_git_diff to inspect the result. Git staging, commits, restore, cleanup, push, pull, reset, checkout, switch, rebase, merge, stash, shell commands, source edits, and external-agent task workflows are outside this MCP surface.",
  "Use repo_last_write to inspect safe metadata for the previous documentation write. It does not contain file contents, snippets, diffs, prompts, command output, secrets, or absolute paths.",
  "Use repo_decision_memory for project memory, architecture decisions, conventions, patterns, and rationale. Treat it as supporting evidence and confirm important claims with targeted file reads.",
  "When a read or write policy question is blocked, or the user asks what ChatGPT can access, call repo_policy_explain with the relevant repo_id and path before guessing.",
  "All paths are repo-relative POSIX paths and all repository access is scoped by repo_id. Default excludes, path sandboxing, write policy, and secret blocking are enforced by the server.",
  "Nested repositories and submodules are separate trust boundaries and are not read unless registered as their own repo_id."
].join(" ");
