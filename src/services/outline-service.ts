import { DEFAULT_LIMITS } from "../policies/limits.js";
import { RepoReaderError } from "../runtime/errors.js";
import type { SymbolKind, SymbolLocation } from "../contracts/symbol.contract.js";
import { readFilePrefix } from "./bounded-read.js";
import { FileClassifier } from "./file-classifier.js";
import { IgnoreEngine } from "./ignore-engine.js";
import { PathSandbox } from "./path-sandbox.js";
import { SecretScanner } from "./secret-scanner.js";
import { FileReader } from "./file-reader.js";

export type OutlineOptions = {
  path: string;
  max_symbols?: number;
};

export type FetchRegionOptions = {
  path: string;
  region: "symbol" | "function" | "class" | "around_line";
  name?: string;
  line?: number;
  context_lines?: number;
  max_lines?: number;
};

export class OutlineService {
  private readonly ignoreEngine = new IgnoreEngine();
  private readonly classifier = new FileClassifier(this.ignoreEngine);
  private readonly secretScanner = new SecretScanner();

  constructor(private readonly sandbox: PathSandbox) {}

  async outline(options: OutlineOptions) {
    const { repoPath, text, language, totalLines, warnings } = await this.readOutlineText(options.path);
    const raw = scanSymbols(repoPath, text, language);
    warnings.push(...raw.warnings);
    const maxSymbols = Math.min(options.max_symbols ?? 500, 1_000);
    const symbols = raw.symbols.slice(0, maxSymbols);
    const truncated = raw.symbols.length > symbols.length;
    if (truncated) {
      warnings.push(`SYMBOLS_TRUNCATED:${raw.symbols.length}`);
    }

    return {
      path: repoPath,
      language,
      total_lines: totalLines,
      includes: raw.includes,
      namespaces: symbols.filter((symbol) => symbol.kind === "namespace"),
      classes: symbols.filter((symbol) => symbol.kind === "class"),
      functions: symbols.filter((symbol) => symbol.kind === "function"),
      methods: symbols.filter((symbol) => symbol.kind === "method"),
      cuda_kernels: symbols.filter((symbol) => symbol.kind === "kernel"),
      templates: symbols.filter((symbol) => symbol.kind === "template"),
      todos: symbols.filter((symbol) => symbol.kind === "todo"),
      symbols,
      truncated,
      warnings
    };
  }

  async fetchRegion(options: FetchRegionOptions) {
    const outline = await this.outline({ path: options.path });
    const contextLines = options.context_lines ?? 40;
    const match = resolveRegionSymbol(outline.symbols, options);
    let startLine: number;
    let endLine: number | undefined;
    let matchedSymbol: string | undefined;

    if (options.region === "around_line") {
      if (!options.line) {
        throw new RepoReaderError("VALIDATION_ERROR", "line is required when region is around_line.");
      }
      startLine = Math.max(1, options.line - contextLines);
      endLine = options.line + contextLines;
    } else {
      if (!options.name) {
        throw new RepoReaderError("VALIDATION_ERROR", "name is required for symbol, function, and class regions.");
      }
      if (!match) {
        throw new RepoReaderError("VALIDATION_ERROR", `Symbol not found in ${options.path}: ${options.name}`);
      }
      startLine = Math.max(1, match.start_line - (options.region === "symbol" ? contextLines : 0));
      endLine = match.end_line + (options.region === "symbol" ? contextLines : 0);
      matchedSymbol = match.name;
    }

    const maxLines = options.max_lines ?? (endLine ? endLine - startLine + 1 : undefined);
    const file = await new FileReader(this.sandbox).read({
      path: options.path,
      start_line: startLine,
      ...(endLine ? { end_line: endLine } : {}),
      ...(maxLines ? { max_lines: maxLines } : {})
    });
    return {
      ...file,
      region: {
        kind: options.region,
        name: options.name,
        line: options.line,
        matched_symbol: matchedSymbol
      }
    };
  }

  private async readOutlineText(path: string) {
    const resolved = await this.sandbox.resolve(path);
    if (!resolved.stat.isFile()) {
      throw new RepoReaderError("UNSUPPORTED_FILE_TYPE", `Not a regular file: ${resolved.repoPath}`);
    }
    if (this.ignoreEngine.isIgnored(resolved.repoPath)) {
      throw new RepoReaderError("DEFAULT_EXCLUDE_BLOCKED", `Path is excluded by default: ${resolved.repoPath}`);
    }
    if (this.ignoreEngine.isSensitiveCandidate(resolved.repoPath)) {
      throw new RepoReaderError("SECRET_CANDIDATE_BLOCKED", `Secret candidate blocked: ${resolved.repoPath}`);
    }
    const classification = await this.classifier.classify(resolved.repoPath, resolved.absolutePath);
    if (classification.is_binary) {
      throw new RepoReaderError("BINARY_FILE_REJECTED", `Binary file blocked: ${resolved.repoPath}`);
    }
    const readResult = await readFilePrefix(resolved.absolutePath, DEFAULT_LIMITS.max_bytes_per_file);
    const warnings: string[] = [];
    if (readResult.truncated) {
      warnings.push(`FILE_TRUNCATED:${resolved.repoPath}`);
    }
    const text = this.secretScanner.redact(readResult.buffer.toString("utf8")).text;
    return {
      repoPath: resolved.repoPath,
      text,
      language: classification.language,
      totalLines: text.split(/\r?\n/).length,
      warnings
    };
  }
}

function scanSymbols(path: string, text: string, language?: string) {
  const lines = text.split(/\r?\n/);
  const includes: Array<{ line: number; value: string }> = [];
  const symbols: SymbolLocation[] = [];
  const warnings = ["OUTLINE_LIGHTWEIGHT_SCANNER"];
  const containers: Array<{ name: string; kind: SymbolKind; end_line: number }> = [];

  lines.forEach((line, index) => {
    const lineNumber = index + 1;
    while (containers.length > 0 && lineNumber > containers[containers.length - 1].end_line) {
      containers.pop();
    }
    const includeMatch = line.match(/^\s*#\s*include\s+([<"][^>"]+[>"])/);
    if (includeMatch) {
      includes.push({ line: lineNumber, value: includeMatch[1] });
    }
    const todoMatch = line.match(/\b(TODO|FIXME)\b:?/i);
    if (todoMatch) {
      symbols.push({
        path,
        name: todoMatch[1].toUpperCase(),
        kind: "todo",
        start_line: lineNumber,
        end_line: lineNumber,
        signature: line.trim()
      });
    }
    const namespaceMatch = line.match(/^\s*namespace\s+([A-Za-z_]\w*)\b/);
    if (namespaceMatch) {
      const symbol = symbolFromLine(path, namespaceMatch[1], "namespace", line, lineNumber, lines);
      symbols.push(symbol);
      containers.push({ name: symbol.name, kind: symbol.kind, end_line: symbol.end_line });
    }
    const classMatch = line.match(/^\s*(?:template\s*<[^>]+>\s*)?(?:class|struct)\s+([A-Za-z_]\w*)\b/);
    if (classMatch) {
      const symbol = symbolFromLine(path, classMatch[1], "class", line, lineNumber, lines);
      symbols.push(symbol);
      containers.push({ name: symbol.name, kind: symbol.kind, end_line: symbol.end_line });
    }
    if (/^\s*template\s*</.test(line)) {
      symbols.push({
        path,
        name: "template",
        kind: "template",
        start_line: lineNumber,
        end_line: lineNumber,
        signature: line.trim()
      });
    }
  });

  if (language && !["c", "cpp", "cuda", "typescript", "tsx", "javascript"].includes(language)) {
    return { includes, symbols, warnings: [...warnings, `UNSUPPORTED_LANGUAGE:${language}`] };
  }

  for (let index = 0; index < lines.length; index += 1) {
    const signature = signatureEndingAt(lines, index);
    if (!signature) {
      continue;
    }
    const name = extractFunctionName(signature);
    if (!name || isControlName(name)) {
      continue;
    }
    const startLine = signature.startLine;
    if (symbols.some((symbol) => symbol.start_line === startLine && symbol.name === name)) {
      continue;
    }
    const endLine = findBraceEnd(lines, index);
    const container = nearestContainer(symbols, startLine);
    const kind = functionKind(signature.text, name, container);
    symbols.push({
      path,
      name: displayName(name),
      kind,
      start_line: startLine,
      end_line: endLine,
      signature: signature.text,
      container: container?.name
    });
  }

  symbols.sort((a, b) => a.start_line - b.start_line || a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name));
  return { includes, symbols, warnings };
}

function symbolFromLine(
  path: string,
  name: string,
  kind: SymbolKind,
  line: string,
  lineNumber: number,
  lines: string[]
): SymbolLocation {
  return {
    path,
    name,
    kind,
    start_line: lineNumber,
    end_line: findBraceEnd(lines, lineNumber - 1),
    signature: line.trim()
  };
}

function signatureEndingAt(lines: string[], index: number): { text: string; startLine: number } | undefined {
  const line = lines[index];
  if (!line.includes("{") || !line.includes(")")) {
    return undefined;
  }
  const parts = [line.slice(0, line.indexOf("{")).trim()];
  let start = index;
  for (let cursor = index - 1; cursor >= Math.max(0, index - 6); cursor -= 1) {
    const previous = lines[cursor].trim();
    if (!previous || previous.endsWith(";") || previous.endsWith("}") || previous.startsWith("#")) {
      break;
    }
    parts.unshift(previous);
    start = cursor;
    if (/^[A-Za-z_~].*\)$/.test(previous) || previous.includes("(")) {
      break;
    }
  }
  const text = parts.join(" ").replace(/\s+/g, " ").trim();
  if (!text.includes("(") || text.includes(";")) {
    return undefined;
  }
  if (/^\s*(if|for|while|switch|catch)\s*\(/.test(text)) {
    return undefined;
  }
  return { text, startLine: start + 1 };
}

function extractFunctionName(signature: { text: string }): string | undefined {
  const beforeParen = signature.text.slice(0, signature.text.indexOf("(")).trim();
  const match = beforeParen.match(/([~A-Za-z_][\w:~]*)$/);
  return match?.[1];
}

function functionKind(signature: string, name: string, container: SymbolLocation | undefined): SymbolKind {
  if (/\b__global__\b/.test(signature) || /(?:^|::|_)kernel$/i.test(name)) {
    return "kernel";
  }
  if (name.includes("::") || container?.kind === "class") {
    return "method";
  }
  return "function";
}

function displayName(name: string): string {
  return name.split("::").pop() ?? name;
}

function nearestContainer(symbols: SymbolLocation[], line: number): SymbolLocation | undefined {
  return symbols
    .filter((symbol) => (symbol.kind === "class" || symbol.kind === "namespace") && symbol.start_line < line && symbol.end_line >= line)
    .sort((a, b) => b.start_line - a.start_line)[0];
}

function findBraceEnd(lines: string[], startIndex: number): number {
  let balance = 0;
  let sawOpen = false;
  for (let index = startIndex; index < lines.length; index += 1) {
    for (const char of lines[index]) {
      if (char === "{") {
        balance += 1;
        sawOpen = true;
      } else if (char === "}") {
        balance -= 1;
      }
    }
    if (sawOpen && balance <= 0) {
      return index + 1;
    }
  }
  return startIndex + 1;
}

function isControlName(name: string): boolean {
  return ["if", "for", "while", "switch", "catch"].includes(name);
}

function resolveRegionSymbol(symbols: SymbolLocation[], options: FetchRegionOptions): SymbolLocation | undefined {
  if (!options.name) {
    return undefined;
  }
  const name = options.name;
  const allowedKinds = options.region === "function"
    ? new Set<SymbolKind>(["function", "method", "kernel"])
    : options.region === "class"
      ? new Set<SymbolKind>(["class"])
      : undefined;
  return symbols.find((symbol) => {
    if (allowedKinds && !allowedKinds.has(symbol.kind)) {
      return false;
    }
    return symbol.name === name || symbol.signature?.includes(name) || `${symbol.container ?? ""}::${symbol.name}` === name;
  });
}
