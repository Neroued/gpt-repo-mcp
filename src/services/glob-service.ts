export function matchesGlob(path: string, glob: string): boolean {
  return globToRegExp(glob).test(path);
}

export function isExcludedByGlob(path: string, excludeGlobs: string[] = []): boolean {
  return excludeGlobs.some((glob) => matchesGlob(path, glob));
}

export function isIncludedByGlob(path: string, includeGlobs: string[] = []): boolean {
  if (includeGlobs.length === 0) {
    return true;
  }
  return includeGlobs.some((glob) => matchesGlob(path, glob));
}

export function canContainIncludedPath(path: string, includeGlobs: string[] = []): boolean {
  if (includeGlobs.length === 0) {
    return true;
  }
  const normalized = path === "." ? "" : `${path}/`;
  return includeGlobs.some((glob) => {
    const staticPrefix = glob.split("*", 1)[0];
    if (staticPrefix.length === 0) {
      return true;
    }
    return staticPrefix.startsWith(normalized) || normalized.startsWith(staticPrefix);
  });
}

function globToRegExp(glob: string): RegExp {
  let pattern = "";
  for (let index = 0; index < glob.length; index += 1) {
    const char = glob[index];
    const next = glob[index + 1];

    if (char === "*" && next === "*") {
      const afterNext = glob[index + 2];
      if (afterNext === "/") {
        pattern += "(?:.*/)?";
        index += 2;
      } else {
        pattern += ".*";
        index += 1;
      }
      continue;
    }
    if (char === "*") {
      pattern += "[^/]*";
      continue;
    }
    pattern += escapeRegExp(char);
  }
  return new RegExp(`^${pattern}$`);
}

function escapeRegExp(value: string): string {
  return value.replace(/[|\\{}()[\]^$+?.]/g, "\\$&");
}
