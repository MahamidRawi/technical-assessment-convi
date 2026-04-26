export function textPreview(text: string | null | undefined, maxLength = 500): string {
  if (!text) return '';
  return text.length > maxLength ? text.slice(0, maxLength) + '…' : text;
}
