export function toDisplayTitleCase(value: string): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return "";
  }
  const lower = normalized.toLowerCase();
  return lower.replace(/(^|[\s\-\/('"])([a-z])/g, (_match, prefix: string, char: string) => `${prefix}${char.toUpperCase()}`);
}
