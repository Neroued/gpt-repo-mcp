import { createHash } from "node:crypto";
import { DEFAULT_LIMITS } from "../policies/limits.js";
import type { CMakeTarget, IndexedFile, LanguageStat } from "../contracts/index.contract.js";
import type { SymbolKind, SymbolLocation } from "../contracts/symbol.contract.js";
import { readFilePrefix } from "./bounded-read.js";
import { FileClassifier } from "./file-classifier.js";
import { isExcludedByGlob, isIncludedByGlob } from "./glob-service.js";
import { IgnoreEngine } from "./ignore-engine.js";
import { OutlineService } from "./outline-service.js";
import { PathSandbox } from "./path-sandbox.js";
import { RepoTreeService } from "./repo-tree-service.js";

type RepoIndex = {
  index_id: string;
  fingerprint: string;
  indexed_at: string;
  files: IndexedFile[];
  symbols: SymbolLocation[];
  language_stats: LanguageStat[];
  cmake_targets: CMakeTarget[];
  warnings: string[];
};

type CachedIndex = RepoIndex & {
  root: string;
};

const CACHE = new Map<string, CachedIndex>();
const SNAPSHOTS = new Map<string, RepoIndex>();

export type IndexOptions = {
  force_refresh?: boolean;
};

export type SymbolQueryOptions = {
  name?: string;
  kind?: "function" | "class" | "method" | "kernel" | "any";
  include_globs?: string[];
  exclude_globs?: string[];
  max_results?: number;
  cursor?: string;
  force_refresh?: boolean;
};

export class RepoIndexService {
  private readonly ignoreEngine = new IgnoreEngine();
  private readonly classifier = new FileClassifier(this.ignoreEngine);

  constructor(private readonly root: string, private readonly sandbox: PathSandbox) {}

  async summary(options: IndexOptions = {}) {
    const { index, cacheHit } = await this.getIndex(options);
    return {
      index_id: index.index_id,
      cache_hit: cacheHit,
      indexed_at: index.indexed_at,
      file_count: index.files.length,
      source_files_count: index.files.filter((file) => file.is_source).length,
      test_files_count: index.files.filter((file) => file.is_test).length,
      doc_files_count: index.files.filter((file) => file.is_doc).length,
      kernel_files_count: index.symbols.filter((symbol) => symbol.kind === "kernel").length,
      language_stats: index.language_stats,
      largest_files: index.files.slice().sort((a, b) => b.size_bytes - a.size_bytes).slice(0, 20),
      recently_modified_files: index.files.slice().sort((a, b) => b.mtime_ms - a.mtime_ms).slice(0, 20),
      cmake_targets: index.cmake_targets,
      warnings: index.warnings
    };
  }

  async symbols(options: SymbolQueryOptions = {}) {
    const { index } = await this.getIndex({ force_refresh: options.force_refresh });
    const start = parseCursor(options.cursor);
    const maxResults = Math.min(options.max_results ?? DEFAULT_LIMITS.max_search_results, DEFAULT_LIMITS.max_search_results);
    const matched = index.symbols
      .filter((symbol) => matchesSymbol(symbol, options))
      .sort((a, b) => a.path.localeCompare(b.path) || a.start_line - b.start_line || a.name.localeCompare(b.name));
    const symbols = matched.slice(start, start + maxResults);
    const nextIndex = start + symbols.length;
    const truncated = nextIndex < matched.length;
    return {
      index_id: index.index_id,
      symbols,
      matched_count: matched.length,
      returned_count: symbols.length,
      truncated,
      next_cursor: truncated ? String(nextIndex) : undefined,
      warnings: index.warnings
    };
  }

  async changedSince(previousIndexId: string, options: IndexOptions = {}) {
    const previous = SNAPSHOTS.get(previousIndexId);
    const { index } = await this.getIndex(options);
    if (!previous) {
      return {
        previous_index_id: previousIndexId,
        current_index_id: index.index_id,
        changed: previousIndexId !== index.index_id,
        added: [],
        modified: [],
        removed: [],
        warnings: ["PREVIOUS_INDEX_NOT_FOUND"]
      };
    }
    const previousFiles = new Map(previous.files.map((file) => [file.path, file]));
    const currentFiles = new Map(index.files.map((file) => [file.path, file]));
    const added: string[] = [];
    const modified: string[] = [];
    const removed: string[] = [];
    for (const [path, file] of currentFiles) {
      const before = previousFiles.get(path);
      if (!before) {
        added.push(path);
      } else if (before.size_bytes !== file.size_bytes || before.mtime_ms !== file.mtime_ms || before.sha256 !== file.sha256) {
        modified.push(path);
      }
    }
    for (const path of previousFiles.keys()) {
      if (!currentFiles.has(path)) {
        removed.push(path);
      }
    }
    return {
      previous_index_id: previousIndexId,
      current_index_id: index.index_id,
      changed: added.length > 0 || modified.length > 0 || removed.length > 0 || previousIndexId !== index.index_id,
      added,
      modified,
      removed,
      warnings: index.warnings
    };
  }

  private async getIndex(options: IndexOptions): Promise<{ index: RepoIndex; cacheHit: boolean }> {
    const fingerprint = await this.fingerprint();
    const cached = CACHE.get(this.root);
    if (!options.force_refresh && cached?.fingerprint === fingerprint) {
      return { index: cached, cacheHit: true };
    }
    const index = await this.buildIndex(fingerprint);
    CACHE.set(this.root, { ...index, root: this.root });
    SNAPSHOTS.set(index.index_id, index);
    return { index, cacheHit: false };
  }

  private async fingerprint(): Promise<string> {
    const files = await this.listFiles();
    const hash = createHash("sha256");
    for (const file of files) {
      const resolved = await this.sandbox.resolve(file.path);
      hash.update(file.path);
      hash.update(String(resolved.stat.size));
      hash.update(String(Number(resolved.stat.mtimeMs)));
    }
    return hash.digest("hex");
  }

  private async buildIndex(fingerprint: string): Promise<RepoIndex> {
    const files: IndexedFile[] = [];
    const symbols: SymbolLocation[] = [];
    const cmakeTargets: CMakeTarget[] = [];
    const warnings: string[] = [];
    const outlineService = new OutlineService(this.sandbox);

    for (const entry of await this.listFiles()) {
      const resolved = await this.sandbox.resolve(entry.path);
      const classification = await this.classifier.classify(entry.path, resolved.absolutePath);
      if (classification.is_binary) {
        continue;
      }
      const readResult = await readFilePrefix(resolved.absolutePath, DEFAULT_LIMITS.max_bytes_per_file);
      if (readResult.truncated) {
        addWarning(warnings, `FILE_TRUNCATED:${entry.path}`);
      }
      const text = readResult.buffer.toString("utf8");
      const indexedFile: IndexedFile = {
        path: entry.path,
        language: classification.language,
        size_bytes: entry.size_bytes ?? Number(resolved.stat.size),
        sha256: createHash("sha256").update(readResult.buffer).digest("hex"),
        mtime_ms: Number(resolved.stat.mtimeMs),
        loc: countLoc(text),
        is_source: isSourcePath(entry.path, classification.language),
        is_test: isTestPath(entry.path),
        is_doc: isDocPath(entry.path)
      };
      files.push(indexedFile);

      if (entry.path === "CMakeLists.txt" || entry.path.endsWith(".cmake")) {
        cmakeTargets.push(...parseCMakeTargets(entry.path, text));
      }
      if (shouldOutline(entry.path, classification.language)) {
        try {
          const outline = await outlineService.outline({ path: entry.path, max_symbols: 1_000 });
          symbols.push(...outline.symbols);
          outline.warnings
            .filter((warning) => warning !== "OUTLINE_LIGHTWEIGHT_SCANNER")
            .forEach((warning) => addWarning(warnings, warning));
        } catch {
          addWarning(warnings, `OUTLINE_SKIPPED:${entry.path}`);
        }
      }
    }

    const languageStats = computeLanguageStats(files);
    const indexedAt = new Date().toISOString();
    const indexId = createHash("sha256").update(`${this.root}:${fingerprint}:${files.length}`).digest("hex").slice(0, 16);
    return {
      index_id: indexId,
      fingerprint,
      indexed_at: indexedAt,
      files,
      symbols,
      language_stats: languageStats,
      cmake_targets: cmakeTargets,
      warnings
    };
  }

  private async listFiles(): Promise<Array<{ path: string; size_bytes?: number }>> {
    const treeService = new RepoTreeService(this.root, this.sandbox);
    const files: Array<{ path: string; size_bytes?: number }> = [];
    let cursor: string | undefined;
    do {
      const tree = await treeService.tree({
        include_files: true,
        page_size: DEFAULT_LIMITS.max_tree_entries,
        respect_default_excludes: true,
        cursor
      });
      files.push(...tree.entries.filter((entry) => entry.type === "file"));
      cursor = tree.truncated ? tree.next_cursor : undefined;
    } while (cursor);
    return files;
  }
}

function matchesSymbol(symbol: SymbolLocation, options: SymbolQueryOptions): boolean {
  if (options.name && symbol.name !== options.name && !symbol.signature?.includes(options.name)) {
    return false;
  }
  if (options.kind && options.kind !== "any" && !kindMatches(symbol.kind, options.kind)) {
    return false;
  }
  if (!isIncludedByGlob(symbol.path, options.include_globs) || isExcludedByGlob(symbol.path, options.exclude_globs)) {
    return false;
  }
  return true;
}

function kindMatches(actual: SymbolKind, expected: Exclude<SymbolQueryOptions["kind"], undefined>): boolean {
  if (expected === "kernel") {
    return actual === "kernel";
  }
  if (expected === "method") {
    return actual === "method";
  }
  if (expected === "function") {
    return actual === "function" || actual === "method" || actual === "kernel";
  }
  if (expected === "class") {
    return actual === "class";
  }
  return true;
}

function computeLanguageStats(files: IndexedFile[]): LanguageStat[] {
  const stats = new Map<string, LanguageStat>();
  for (const file of files) {
    const language = file.language ?? "unknown";
    const current = stats.get(language) ?? { language, files: 0, loc: 0 };
    current.files += 1;
    current.loc += file.loc;
    stats.set(language, current);
  }
  return [...stats.values()].sort((a, b) => b.files - a.files || a.language.localeCompare(b.language));
}

function parseCMakeTargets(path: string, text: string): CMakeTarget[] {
  const targets: CMakeTarget[] = [];
  const lines = text.split(/\r?\n/);
  lines.forEach((line, index) => {
    const match = line.match(/\b(add_executable|add_library)\s*\(\s*([A-Za-z0-9_.:-]+)/);
    if (match) {
      targets.push({ path, line: index + 1, kind: match[1], name: match[2] });
    }
  });
  return targets;
}

function countLoc(text: string): number {
  return text.split(/\r?\n/).filter((line) => line.trim().length > 0).length;
}

function shouldOutline(path: string, language?: string): boolean {
  return Boolean(language && ["c", "cpp", "cuda", "typescript", "tsx", "javascript"].includes(language)) || /\.(c|cc|cpp|cxx|h|hh|hpp|hxx|cu|cuh)$/i.test(path);
}

function isSourcePath(path: string, language?: string): boolean {
  return Boolean(language && ["c", "cpp", "cuda", "typescript", "tsx", "javascript", "python", "go", "rust", "java"].includes(language)) ||
    /^(src|include|tools)\//.test(path);
}

function isTestPath(path: string): boolean {
  return /(^|\/)(tests?|__tests__)(\/|$)|\.(test|spec)\.[A-Za-z0-9]+$/.test(path);
}

function isDocPath(path: string): boolean {
  return /(^|\/)(docs?|README\.md)|\.md$/i.test(path);
}

function addWarning(warnings: string[], warning: string): void {
  if (!warnings.includes(warning)) {
    warnings.push(warning);
  }
}

function parseCursor(cursor?: string): number {
  if (!cursor) {
    return 0;
  }
  const parsed = Number.parseInt(cursor, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}
