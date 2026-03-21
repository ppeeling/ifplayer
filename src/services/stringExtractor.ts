/**
 * Utility to extract printable strings from Glulx and Z-machine binaries.
 * Inspired by glulx-strings and standard 'strings' utility.
 */

import * as glulx from './glulx-strings.js';

export function extractStrings(data: Uint8Array): string[] {
  const strings = new Set<string>();
  
  try {
    glulx.extract_strings(data, (s: string) => {
      if (s && typeof s === 'string') {
        const trimmed = s.trim();
        // Filter out very short strings and common noise
        if (trimmed.length >= 4) {
          const alphaNumericCount = (trimmed.match(/[a-zA-Z0-9]/g) || []).length;
          if (alphaNumericCount / trimmed.length > 0.5) {
            strings.add(trimmed);
          }
        }
      }
    });
  } catch (e) {
    console.error("Error extracting strings with glulx-strings:", e);
  }
  
  return Array.from(strings);
}

/**
 * Finds strings relevant to the current game state.
 * This is a simple "RAG-lite" approach.
 */
export function findRelevantStrings(allStrings: string[], context: string, limit: number = 20): string[] {
  if (!allStrings.length || !context) return [];
  
  // Extract keywords from context (words >= 4 chars)
  const keywords = Array.from(new Set(
    context.toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length >= 4)
  ));
  
  if (!keywords.length) return allStrings.slice(0, limit);

  // Score strings based on keyword matches
  const scored = allStrings.map(s => {
    const lowerS = s.toLowerCase();
    let score = 0;
    for (const kw of keywords) {
      if (lowerS.includes(kw)) {
        score += 1;
      }
    }
    return { s, score };
  });

  // Sort by score and return top matches
  return scored
    .filter(item => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(item => item.s);
}
