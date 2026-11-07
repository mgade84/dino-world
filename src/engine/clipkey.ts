/**
 * File name of a pre-recorded speech clip, shared by say() and scripts/voice.
 * FNV-1a over the normalized text, so the browser needs no lookup table of phrases.
 */
export function clipKey(text: string): string {
  const s = text.trim().replace(/\s+/g, ' ');
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}
