import { useState, useCallback } from 'react';
import { GoogleGenAI, Type } from '@google/genai';

export function useAI() {
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const getSuggestions = useCallback(async (history: string[], currentOutput: string, model: string = 'gemini-3-flash-preview') => {
    if (!currentOutput.trim()) return;
    setLoading(true);
    setError(null);
    try {
      // Check localStorage first, then process.env
      let apiKey = localStorage.getItem('GEMINI_API_KEY_OVERRIDE') || process.env.GEMINI_API_KEY;
      
      // Check for missing or placeholder keys
      const isPlaceholder = !apiKey || 
        apiKey === 'undefined' || 
        apiKey === 'null' || 
        apiKey.length < 10 || 
        apiKey.includes('MY_GEMINI_API_KEY') ||
        apiKey.includes('YOUR_API_KEY') ||
        apiKey.includes('AI Studio Free Tier');

      if (isPlaceholder) {
        throw new Error('Gemini API key is invalid or missing. If you are on iPhone and cannot use the platform settings, please enter your API key manually in the Library (folder icon) sidebar.');
      }
      
      const ai = new GoogleGenAI({ apiKey });

      // Limit output to last 2000 characters to prevent prompt overflow
      const truncatedOutput = currentOutput.length > 2000 ? currentOutput.slice(-2000) : currentOutput;
      
      const prompt = `You are an AI assistant playing an interactive fiction game.
Based on the game's recent output and the history of commands, suggest 7 short, concise commands the player could try next.
Return ONLY a JSON array of strings.

Recent history:
${history.slice(-5).join('\n')}

Current output:
${truncatedOutput}`;

      const response = await ai.models.generateContent({
        model: model,
        contents: prompt,
        config: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.ARRAY,
            items: { type: Type.STRING }
          }
        }
      });
      
      const text = response.text;
      if (text) {
        setSuggestions(JSON.parse(text));
      } else {
        setError('No suggestions returned from AI.');
      }
    } catch (err: any) {
      console.error('Failed to get suggestions:', err);
      // More descriptive error for common issues
      if (err?.message?.includes('fetch')) {
        setError('Network error: The AI request was blocked or failed. Check your internet or browser settings.');
      } else {
        setError(err?.message || 'Failed to get suggestions. Check your connection.');
      }
    } finally {
      setLoading(false);
    }
  }, []);

  return { suggestions, loading, error, getSuggestions, setSuggestions };
}
