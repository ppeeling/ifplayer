import { useState, useRef, useCallback } from 'react';

export function useGlkOte() {
  const [windows, setWindows] = useState<any[]>([]);
  const [inputs, setInputs] = useState<any[]>([]);
  const [windowBuffers, setWindowBuffers] = useState<Record<number, any[]>>({});
  const [filePrompt, setFilePrompt] = useState<{ type: string, filetype: string, filemode?: string } | null>(null);
  const acceptFuncRef = useRef<any>(null);
  const genRef = useRef<number>(0);
  const currentSessionRef = useRef<number>(0);

  const sendEvent = useCallback((event: any) => {
    if (acceptFuncRef.current) {
      console.log('Sending event:', event);
      acceptFuncRef.current({ ...event, gen: genRef.current });
    }
  }, []);

  const GlkOte = useRef({
    init: async (options: any) => {
      const sessionId = options.sessionId || 0;
      if (sessionId < currentSessionRef.current) {
        console.warn('Ignoring init from old session');
        return;
      }
      console.log('GlkOte init, session:', sessionId);
      acceptFuncRef.current = options.accept;
      genRef.current = 0;
      acceptFuncRef.current({
        type: 'init',
        gen: 0,
        metrics: {
          width: 80,
          height: 25,
          buffercharwidth: 1,
          buffercharheight: 1,
          buffermarginx: 0,
          buffermarginy: 0,
          graphicsmarginx: 0,
          graphicsmarginy: 0,
          gridcharheight: 1,
          gridcharwidth: 1,
          gridmarginx: 0,
          gridmarginy: 0,
          inspacingx: 0,
          inspacingy: 0,
          outspacingx: 0,
          outspacingy: 0
        },
        support: ['hyperlinks', 'graphics']
      });
    },
    update: (data: any) => {
      const sessionId = data.sessionId || 0;
      if (sessionId < currentSessionRef.current) {
        console.warn('Ignoring update from old session');
        return;
      }
      console.log('GlkOte update:', data);
      
      if (typeof data.gen === 'number') {
        genRef.current = data.gen;
      }
      
      if (data.windows) {
        setWindows(data.windows);
      }
      
      if (data.content) {
        setWindowBuffers(prev => {
          const next = { ...prev };
          for (const update of data.content) {
            const winId = update.id;
            if (!next[winId]) next[winId] = [];
            
            if (update.clear) {
              next[winId] = [];
            }
            
            if (update.text) {
              const newLines = [...next[winId]];
              for (const line of update.text) {
                if (line.append && newLines.length > 0) {
                  const lastLine = newLines[newLines.length - 1];
                  newLines[newLines.length - 1] = {
                    ...lastLine,
                    content: [...(lastLine.content || []), ...(line.content || [])]
                  };
                } else {
                  newLines.push(line);
                }
              }
              next[winId] = newLines;
            }
            
            if (update.lines) {
               // Grid window update
               const newLines = [...next[winId]];
               for (const line of update.lines) {
                 newLines[line.line] = line;
               }
               next[winId] = newLines;
            }
          }
          return next;
        });
      }
      
      if (data.input) {
        setInputs(data.input);
      } else if (data.type === 'update' && !data.content && !data.windows) {
        // If it's a pure update with no input, it might mean input is finished
        // But GlkOte spec says missing input means unchanged.
        // However, some VMs might expect us to clear it if it's not present in a full update.
        // We'll stick to the spec for now but keep an eye on it.
      }

      if (data.specialinput) {
        if (data.specialinput.type === 'fileref_prompt') {
          setFilePrompt({ type: data.specialinput.type, filetype: data.specialinput.filetype, filemode: data.specialinput.filemode });
        }
      }
    }
  }).current;

  const submitFilePrompt = useCallback((filename: string | null) => {
    if (!filePrompt) return;
    
    let value = null;
    if (filename) {
      if (filePrompt.filemode === 'read') {
        value = filename;
      } else {
        let ext = '.glkdata';
        if (filePrompt.filetype === 'command' || filePrompt.filetype === 'transcript') ext = '.txt';
        else if (filePrompt.filetype === 'save') ext = '.glksave';
        value = `${filename}${ext}`;
      }
    }
    
    setFilePrompt(null);
    
    if (acceptFuncRef.current) {
      acceptFuncRef.current({
        type: 'specialresponse',
        response: 'fileref_prompt',
        value: value,
        gen: genRef.current
      });
    }
  }, [filePrompt]);

  const clearState = useCallback(() => {
    currentSessionRef.current += 1;
    setWindows([]);
    setInputs([]);
    setWindowBuffers({});
    setFilePrompt(null);
    return currentSessionRef.current;
  }, []);

  return { GlkOte, sendEvent, windows, windowBuffers, inputs, clearState, filePrompt, submitFilePrompt };
}
