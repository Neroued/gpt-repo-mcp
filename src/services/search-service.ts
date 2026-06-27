import { DEFAULT_LIMITS } from "../policies/limits.js";
import { RepoReaderError } from "../runtime/errors.js";
import { readFilePrefix } from "./bounded-read.js";
import { FileClassifier } from "./file-classifier.js";
import { isExcludedByGlob, isIncludedByGlob } from "./glob-service.js";
import { IgnoreEngine } from "./ignore-engine.js";
import { PathSandbox } from "./path-sandbox.js";
import { RepoTreeService } from "./repo-tree-service.js";
import { SecretScanner } from "./secret-scanner.js";

export type SearchOptions = {
  query?: string;
  queries?: string[];
  combine?: "OR" | "AND";
  mode?: "literal" | "regex";
  include_globs?: string[];
  exclude_globs?: string[];
  context_lines?: number;
  max_results?: number;
  cursor?: string;
};

type SearchMatch = {
  path: string;
  line: number;
  column: number;
  matched_query?: string;
  text: string;
  before: string[];
  after: string[];
};

type LineMatch = {
  column: number;
  matched_query?: string;
};

export class SearchService {
  private readonly ignoreEngine = new IgnoreEngine();
  private readonly classifier = new FileClassifier(this.ignoreEngine);
  private readonly secretScanner = new SecretScanner();

  constructor(private readonly root: string, private readonly sandbox: PathSandbox) {}

  async search(options: SearchOptions) {
    const maxResults = Math.min(options.max_results ?? DEFAULT_LIMITS.max_search_results, DEFAULT_LIMITS.max_search_results);
    const contextLines = Math.min(options.context_lines ?? 0, 5);
    const start = parseCursor(options.cursor);
    const matcher = createMatcher(options);
    const matches: SearchMatch[] = [];
    const warnings: string[] = [];
    const treeService = new RepoTreeService(this.root, this.sandbox);
    let treeCursor: string | undefined;

    do {
      const tree = await treeService.tree({
        include_files: true,
        page_size: DEFAULT_LIMITS.max_tree_entries,
        respect_default_excludes: true,
        cursor: treeCursor
      });

      for (const entry of tree.entries) {
        if (entry.type !== "file") {
          continue;
        }
        if (!isIncludedByGlob(entry.path, options.include_globs) || isExcludedByGlob(entry.path, options.exclude_globs)) {
          continue;
        }
        if (this.ignoreEngine.isSensitiveCandidate(entry.path)) {
          continue;
        }
        const resolved = await this.sandbox.resolve(entry.path);
        const classification = await this.classifier.classify(entry.path, resolved.absolutePath);
        if (classification.is_binary) {
          continue;
        }
        const readResult = await readFilePrefix(resolved.absolutePath, DEFAULT_LIMITS.max_bytes_per_file);
        if (readResult.truncated) {
          addWarning(warnings, `FILE_TRUNCATED:${entry.path}`);
        }
        const rawText = readResult.buffer.toString("utf8");
        const rawLines = rawText.split(/\r?\n/);
        const redactedLines = this.secretScanner.redact(rawText).text.split(/\r?\n/);
        rawLines.forEach((lineText, index) => {
          const match = matcher.match(lineText);
          if (!match) {
            return;
          }
          matches.push({
            path: entry.path,
            line: index + 1,
            column: match.column,
            matched_query: match.matched_query,
            text: redactedLines[index] ?? "",
            before: redactedLines.slice(Math.max(0, index - contextLines), index),
            after: redactedLines.slice(index + 1, index + 1 + contextLines)
          });
        });
      }

      treeCursor = tree.truncated ? tree.next_cursor : undefined;
      if (tree.truncated && !treeCursor) {
        addWarning(warnings, "TREE_CURSOR_MISSING");
        break;
      }
    } while (treeCursor);

    matches.sort((a, b) => a.path.localeCompare(b.path) || a.line - b.line || a.column - b.column);
    const results = matches.slice(start, start + maxResults);
    const nextIndex = start + results.length;
    const truncated = nextIndex < matches.length;
    return {
      results,
      matched_count: matches.length,
      returned_count: results.length,
      truncated,
      next_cursor: truncated ? String(nextIndex) : undefined,
      warnings
    };
  }
}

function createMatcher(options: SearchOptions): { match: (line: string) => LineMatch | undefined } {
  const queries = normalizeQueries(options);
  const combine = options.combine ?? "OR";
  if (options.mode === "regex") {
    const regexes = queries.map((query) => {
      try {
        return { query, regex: new RegExp(query, "i") };
      } catch {
        throw new RepoReaderError("VALIDATION_ERROR", "Invalid regex query.");
      }
    });
    return {
      match: (line: string) => {
        const hits = regexes
          .map(({ query, regex }) => ({ query, index: line.search(regex) }))
          .filter((hit) => hit.index >= 0);
        if (combine === "AND" && hits.length !== regexes.length) {
          return undefined;
        }
        if (combine === "OR" && hits.length === 0) {
          return undefined;
        }
        const first = hits.sort((a, b) => a.index - b.index)[0];
        return { column: first.index + 1, matched_query: combine === "AND" ? queries.join(" ") : first.query };
      }
    };
  }

  const loweredQueries = queries.map((query) => ({ query, lowered: query.toLowerCase() }));
  return {
    match: (line: string) => {
      const loweredLine = line.toLowerCase();
      const hits = loweredQueries
        .map(({ query, lowered }) => ({ query, index: loweredLine.indexOf(lowered) }))
        .filter((hit) => hit.index >= 0);
      if (combine === "AND" && hits.length !== loweredQueries.length) {
        return undefined;
      }
      if (combine === "OR" && hits.length === 0) {
        return undefined;
      }
      const first = hits.sort((a, b) => a.index - b.index)[0];
      return { column: first.index + 1, matched_query: combine === "AND" ? queries.join(" ") : first.query };
    }
  };
}

function normalizeQueries(options: SearchOptions): string[] {
  const queries = [...(options.queries ?? [])];
  if (options.query) {
    queries.unshift(options.query);
  }
  const unique = [...new Set(queries.map((query) => query.trim()).filter(Boolean))];
  if (unique.length === 0) {
    throw new RepoReaderError("VALIDATION_ERROR", "repo_search requires query or queries.");
  }
  return unique;
}

function parseCursor(cursor?: string): number {
  if (!cursor) {
    return 0;
  }
  const parsed = Number.parseInt(cursor, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function addWarning(warnings: string[], warning: string): void {
  if (!warnings.includes(warning)) {
    warnings.push(warning);
  }
}
