/** Unresolved Git diff3 delimiters must not become the final merged note. */
export function hasConflictMarkers(markdown: string): boolean {
  return /^(?:<{7}(?: .*|$)|\|{7}(?: .*|$)|={7}|>{7}(?: .*|$))\r?$/m.test(markdown);
}
