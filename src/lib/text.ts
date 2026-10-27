/** Browsers submit textarea line breaks as CRLF; store LF only so diffs and exports stay clean. */
export const normalizeText = (text: string) => text.replace(/\r\n?/g, "\n").trim();
