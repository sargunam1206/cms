/** Escape user input so it matches literally inside a RegExp. */
export const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
