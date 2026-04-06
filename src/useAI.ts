import { useState, useCallback } from 'react';
import { GoogleGenAI, Type } from '@google/genai';

export function useAI() {
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [hintAnswer, setHintAnswer] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingMode, setLoadingMode] = useState<'command' | 'hint' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const getSuggestions = useCallback(async (
    mode: 'command' | 'hint',
    question: string,
    history: string[], 
    currentOutput: string, 
    gameName: string = '', 
    gameType: string = '', 
    walkthroughBase64: string | null = null, 
    model: string = 'gemini-3-flash-preview',
    settings: { contextWindowSize: number, historyLength: number, suggestionCount: number } = { contextWindowSize: 10000, historyLength: 15, suggestionCount: 7 }
  ) => {
    if (!currentOutput.trim()) return;
    setLoading(true);
    setLoadingMode(mode);
    setError(null);
    if (mode === 'hint') setHintAnswer(null);
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

      // Use user-defined context window size
      const truncatedOutput = currentOutput.length > settings.contextWindowSize ? currentOutput.slice(-settings.contextWindowSize) : currentOutput;
      
      let prompt = '';
      let config: any = {};

      if (mode === 'command') {
        prompt = `You are an expert AI assistant playing an interactive fiction game.
Your goal is to provide ${settings.suggestionCount} helpful, concise command suggestions for the player.

Game Info:
- Name: ${gameName || 'Unknown'}
- Type: ${gameType || 'Interactive Fiction'}

Context:
- Analyze the "Current output" for objects, room descriptions, exits, and narrative clues.
- Review the "Recent history" to avoid repeating failed actions and to understand the current quest.
- Suggestions should be short (1-4 words) and relevant to the current situation.

Recent history (last ${settings.historyLength} commands):
${history.slice(-settings.historyLength).join('\n')}

Current output (last ${settings.contextWindowSize} characters):
${truncatedOutput}

Return ONLY a JSON array of ${settings.suggestionCount} strings.`;

        config = {
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.ARRAY,
            items: { type: Type.STRING }
          }
        };
      } else {
        // Hint mode
        prompt = `You are an expert AI assistant playing an interactive fiction game.
The player is asking for a hint or asking a question about the game.

Game Info:
- Name: ${gameName || 'Unknown'}
- Type: ${gameType || 'Interactive Fiction'}

User Question:
"${question}"

Context:
- Analyze the "Current output" for objects, room descriptions, exits, and narrative clues.
- Review the "Recent history" to understand what the player has tried.
- Use the provided walkthrough PDF document to find clues, hidden objects, or narrative hints that might answer the question.
- Provide a helpful, concise answer. Do not give away the entire solution unless explicitly asked, but be helpful.

Recent history (last ${settings.historyLength} commands):
${history.slice(-settings.historyLength).join('\n')}

Current output (last ${settings.contextWindowSize} characters):
${truncatedOutput}

Return a helpful, concise answer in plain text.`;
      }

      const contents: any[] = [];
      if (walkthroughBase64 && mode === 'hint') {
        contents.push({
          inlineData: {
            data: walkthroughBase64,
            mimeType: 'application/pdf'
          }
        });
      }
      contents.push(prompt);

      const response = await ai.models.generateContent({
        model: model,
        contents: contents,
        config: config
      });
      
      const text = response.text;
      if (text) {
        if (mode === 'command') {
          setSuggestions(JSON.parse(text));
        } else {
          setHintAnswer(text);
        }
      } else {
        setError('No response returned from AI.');
      }
    } catch (err: any) {
      console.error('Failed to get AI response:', err);
      // More descriptive error for common issues
      if (err?.message?.includes('fetch')) {
        setError('Network error: The AI request was blocked or failed. Check your internet or browser settings.');
      } else {
        setError(err?.message || 'Failed to get AI response. Check your connection.');
      }
    } finally {
      setLoading(false);
      setLoadingMode(null);
    }
  }, []);

  return { suggestions, hintAnswer, loading, loadingMode, error, getSuggestions, setSuggestions, setHintAnswer };
}
