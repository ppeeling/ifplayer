/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
import { Bocfel, Git } from 'emglken';
import bocfelWasm from 'emglken/build/bocfel.wasm?url';
import gitWasm from 'emglken/build/git.wasm?url';
import { MyDialog, pendingReads } from './MyDialog';
import { useGlkOte } from './useGlkOte';
import { useAI } from './useAI';
import { Loader2, Sparkles, Settings, Play, RefreshCw, RotateCcw, Upload, Moon, Sun, ToggleLeft, ToggleRight, Trash2, ArrowUp, ArrowDown, Unlock, ExternalLink, Lightbulb, Wand2 } from 'lucide-react';
import localforage from 'localforage';

export default function App() {
  const { GlkOte, sendEvent, windows, windowBuffers, inputs, clearState, filePrompt, submitFilePrompt } = useGlkOte();
  const { suggestions, hintAnswer, loading: aiLoading, loadingMode: aiLoadingMode, error: aiError, getSuggestions, setSuggestions, setHintAnswer } = useAI();
  
  const [gameData, setGameData] = useState<Uint8Array | null>(null);
  const [gameName, setGameName] = useState<string>('');
  const [gameSessionId, setGameSessionId] = useState<number>(0);
  const [walkthroughFile, setWalkthroughFile] = useState<{ name: string, base64: string } | null>(null);
  const [isHintMode, setIsHintMode] = useState(false);
  const walkthroughInputRef = useRef<HTMLInputElement>(null);
  const [aiSettings, setAiSettings] = useState({
    contextWindowSize: 10000,
    historyLength: 15,
    suggestionCount: 7
  });
  const [inputValue, setInputValue] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);
  const [history, setHistory] = useState<string[]>([]);
  const [currentOutput, setCurrentOutput] = useState<string>('');
  const [historyIndex, setHistoryIndex] = useState(-1);
  
  const [gameStatus, setGameStatus] = useState<'idle' | 'loading' | 'playing' | 'ended' | 'error'>('idle');
  const isIframe = window.self !== window.top;
  
  // Wrapped setGameStatus with logging
  const updateGameStatus = (status: typeof gameStatus) => {
    console.log(`Game Status changing from ${gameStatus} to ${status}`);
    setGameStatus(status);
  };

  const [lastError, setLastError] = useState<string | null>(null);
  const [directoryHandle, setDirectoryHandle] = useState<any | null>(null);
  const [directoryPermission, setDirectoryPermission] = useState<'granted' | 'prompt' | 'denied'>('prompt');
  
  const [showSidebar, setShowSidebar] = useState(false);
  const [isDarkMode, setIsDarkMode] = useState(false);
  const [autoSuggest, setAutoSuggest] = useState(false);
  const [selectedModel, setSelectedModel] = useState('gemini-3-flash-preview');
  const [manualApiKey, setManualApiKey] = useState(localStorage.getItem('GEMINI_API_KEY_OVERRIDE') || '');
  const [showDebug, setShowDebug] = useState(false);
  const [filePromptInput, setFilePromptInput] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const saveFileInputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<MyDialog | null>(null);
  const lastSuggestedTurn = useRef(-1);

  useEffect(() => {
    // Check local storage for dark mode preference
    const savedMode = localStorage.getItem('darkMode');
    if (savedMode === 'true') {
      setIsDarkMode(true);
      document.documentElement.classList.add('dark');
    }
  }, []);

  const toggleDarkMode = () => {
    setIsDarkMode(!isDarkMode);
    if (!isDarkMode) {
      document.documentElement.classList.add('dark');
      localStorage.setItem('darkMode', 'true');
    } else {
      document.documentElement.classList.remove('dark');
      localStorage.setItem('darkMode', 'false');
    }
  };

  useEffect(() => {
    if (dialogRef.current) {
      dialogRef.current.directoryHandle = directoryHandle;
    }
  }, [directoryHandle]);

  const initDefaultGameRef = useRef(false);

  useEffect(() => {
    if (initDefaultGameRef.current) return;
    initDefaultGameRef.current = true;

    const initDefaultGame = async () => {
      // Try to load the last game played
      const lastGameName = await localforage.getItem<string>('lastGameName');
      const lastGameData = await localforage.getItem<Uint8Array>('lastGameData');
      const savedDirHandle = await localforage.getItem<any>('directoryHandle');

      if (savedDirHandle) {
        setDirectoryHandle(savedDirHandle);
        const permission = await savedDirHandle.queryPermission({ mode: 'readwrite' });
        setDirectoryPermission(permission);
      }

      if (lastGameName && lastGameData) {
        loadGameData(lastGameName, lastGameData);
        return;
      }
    };
    initDefaultGame();
  }, []);

  const loadGameData = async (name: string, data: Uint8Array) => {
    const sessionId = clearState();
    setGameSessionId(sessionId);
    setGameName(name);
    setGameData(new Uint8Array(data));
    setHistory([]);
    updateGameStatus('loading');
    setLastError(null);

    // Persist as last game played
    await localforage.setItem('lastGameName', name);
    await localforage.setItem('lastGameData', data);
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const buffer = await file.arrayBuffer();
    const data = new Uint8Array(buffer);
    loadGameData(file.name, data);
    
    // Reset file input
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleWalkthroughUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const base64 = (event.target?.result as string).split(',')[1];
      setWalkthroughFile({ name: file.name, base64 });
    };
    reader.readAsDataURL(file);

    // Reset file input
    if (walkthroughInputRef.current) {
      walkthroughInputRef.current.value = '';
    }
  };

  const handleOpenGame = async () => {
    try {
      if ('showOpenFilePicker' in window) {
        const [handle] = await (window as any).showOpenFilePicker({
          types: [
            {
              description: 'Interactive Fiction Games',
              accept: {
                'application/x-zmachine': ['.z3', '.z5', '.z8'],
                'application/x-glulx': ['.ulx', '.gblorb']
              }
            }
          ],
          id: 'if-player',
          startIn: 'documents'
        });
        
        const file = await handle.getFile();
        const buffer = await file.arrayBuffer();
        const data = new Uint8Array(buffer);
        loadGameData(file.name, data);
      } else {
        fileInputRef.current?.click();
      }
    } catch (err: any) {
      if (err.name === 'SecurityError' || err.message.includes('Cross origin sub frames')) {
        console.warn('File picker restricted in iframe, falling back to standard upload.');
        fileInputRef.current?.click();
      } else if (err.name !== 'AbortError') {
        console.error('Failed to open game:', err);
      }
    }
  };

  const handleSaveFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) {
      handleFilePromptSubmit(null);
      return;
    }

    const buffer = await file.arrayBuffer();
    const data = new Uint8Array(buffer);
    
    // Store in memory for MyDialog to read
    pendingReads[file.name] = data;
    // Also store in localforage so replay engine can find it after refresh
    await localforage.setItem(file.name, data);
    
    handleFilePromptSubmit(file.name);
    
    // Reset file input
    if (saveFileInputRef.current) {
      saveFileInputRef.current.value = '';
    }
  };

  useEffect(() => {
    console.log('VM Effect triggered. gameData:', !!gameData, 'gameName:', gameName, 'sessionId:', gameSessionId);
    if (!gameData || !gameName) return;

    let cancelled = false;
    let vm: any;
    
    const initVM = async () => {
      console.log('initVM function started. Status is currently:', gameStatus);
      try {
        console.log('Starting VM initialization for:', gameName, 'Session:', gameSessionId);
        console.log('gameData size:', gameData.length, 'First 4 bytes:', gameData.slice(0, 4));
        setLastError(null);
        
        const sessionId = gameSessionId;
        console.log('Creating MyDialog instance...');
        
        // Just check permission, don't request it here (it would fail in useEffect)
        if (directoryHandle) {
          await verifyDirectoryPermission();
        }
        
        const Dialog = new MyDialog(gameName, gameData, directoryHandle);
        dialogRef.current = Dialog;
        
        const isGit = gameName.endsWith('.ulx') || gameName.endsWith('.gblorb');
        const factory = isGit ? Git : Bocfel;
        const wasm = isGit ? gitWasm : bocfelWasm;
        
        console.log('WASM factory type:', typeof factory, 'isGit:', isGit);
        console.log('WASM URL:', wasm);
        
        if (cancelled) return;

        console.log('Loading WASM factory (awaiting factory function)...');
        
        // Add a timeout to the factory call
        const factoryPromise = factory({
          locateFile: (path: string) => {
            console.log('locateFile called for path:', path, 'Returning:', wasm);
            return wasm;
          }
        });
        
        const timeoutPromise = new Promise((_, reject) => 
          setTimeout(() => reject(new Error('WASM factory loading timed out after 20s')), 20000)
        );
        
        try {
          vm = await Promise.race([factoryPromise, timeoutPromise]);
          console.log('WASM factory loaded successfully. Setting status to playing...');
          if (!cancelled) {
            updateGameStatus('playing');
          }
        } catch (raceErr: any) {
          console.error('WASM factory loading failed or timed out:', raceErr);
          throw raceErr;
        }
        
        if (cancelled) {
          console.log('Initialization cancelled after WASM load for session:', sessionId);
          return;
        }

        console.log('Wrapping GlkOte methods for session isolation...');
        const sessionGlkOte = {
          ...GlkOte,
          init: (options: any) => {
            console.log('GlkOte.init wrapper called for session:', sessionId);
            return GlkOte.init({ ...options, sessionId });
          },
          update: (data: any) => {
            // Only log updates if they aren't too frequent or if we're debugging
            return GlkOte.update({ ...data, sessionId });
          }
        };

        console.log('Calling vm.start with sessionGlkOte...');
        try {
          const vmStartPromise = vm.start({
            Dialog,
            GlkOte: sessionGlkOte,
            arguments: [gameName]
          });
          
          const vmStartTimeout = new Promise((_, reject) => 
            setTimeout(() => reject(new Error('VM start timed out after 20s')), 20000)
          );
          
          await Promise.race([vmStartPromise, vmStartTimeout]);
          console.log('VM.start promise resolved for session:', sessionId);
          // We don't set 'ended' here because some VMs might resolve the promise 
          // before the game actually finishes (e.g. if they aren't fully blocking).
          // We rely on the ExitStatus exception to detect the real end of the game.
        } catch (err: any) {
          if (cancelled) {
            console.log('VM.start threw but effect was cancelled. Error:', err);
            return;
          }
          // Catch ExitStatus rejection which is normal when a game ends or is restarted
          if (err && err.name === 'ExitStatus') {
            console.log('Game session ended normally (ExitStatus):', err.message);
            updateGameStatus('ended');
          } else {
            console.error('VM Start Error (inside vm.start catch):', err);
            updateGameStatus('error');
            setLastError(err.message || String(err));
          }
        }
      } catch (err: any) {
        if (cancelled) {
          console.log('initVM threw but effect was cancelled. Error:', err);
          return;
        }
        console.error('VM Initialization Error (outer catch):', err);
        updateGameStatus('error');
        setLastError(err.message || String(err));
      }
    };

    initVM();
    return () => {
      console.log('Cleaning up VM effect for session:', gameSessionId);
      cancelled = true;
    };
  }, [gameData, gameName, GlkOte, gameSessionId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    
    const mainWinId = windows.find(w => w.type === 'buffer')?.id;
    if (mainWinId !== undefined && windowBuffers[mainWinId]) {
      const lines = windowBuffers[mainWinId];
      const recentLines = lines.slice(-10).map(line => {
        if (!line.content) return '';
        return line.content.map((run: any) => typeof run === 'string' ? run : run.text).join('');
      }).join('\n');
      setCurrentOutput(recentLines);
    }
  }, [windowBuffers, windows]);

  const handleFilePromptSubmit = async (filename: string | null) => {
    submitFilePrompt(filename);
  };

  useEffect(() => {
    if (filePrompt) {
      if (filePrompt.filemode === 'write' || filePrompt.filetype === 'save') {
        const date = new Date();
        const timestamp = date.toISOString().replace(/[:.]/g, '-').slice(0, 19);
        const baseName = gameName ? gameName.replace(/\.[^/.]+$/, "") : "save";
        setFilePromptInput(`${baseName}_${timestamp}`);
      } else {
        setFilePromptInput('');
      }
      
      if (filePrompt.filemode === 'read') {
        // Automatically trigger file selection
        setTimeout(() => {
          if (saveFileInputRef.current) {
            const handleCancel = () => {
              handleFilePromptSubmit(null);
            };
            saveFileInputRef.current.addEventListener('cancel', handleCancel, { once: true });
            saveFileInputRef.current.click();
          }
        }, 100);
      }
    }
  }, [filePrompt, gameName]);

  const handleInput = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && inputs.length > 0) {
      submitCommand(inputValue);
      setHistoryIndex(-1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (history.length > 0) {
        const newIndex = historyIndex < history.length - 1 ? historyIndex + 1 : historyIndex;
        setHistoryIndex(newIndex);
        setInputValue(history[history.length - 1 - newIndex]);
      }
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (historyIndex > 0) {
        const newIndex = historyIndex - 1;
        setHistoryIndex(newIndex);
        setInputValue(history[history.length - 1 - newIndex]);
      } else if (historyIndex === 0) {
        setHistoryIndex(-1);
        setInputValue('');
      }
    }
  };

  const submitCommand = (cmd: string) => {
    const inputReq = inputs[0];
    if (!inputReq) return;
    if (!cmd.trim() && inputReq.type !== 'char') return;
    
    // Dismiss keyboard on mobile
    if (window.innerWidth < 768) {
      (document.activeElement as HTMLElement)?.blur();
    }

    if (isHintMode) {
      handleSuggest('hint', cmd);
      setIsHintMode(false);
      setInputValue('');
      return;
    }
    
    if (inputReq.type === 'line') {
      sendEvent({
        type: 'line',
        window: inputReq.id,
        value: cmd
      });
      const newHistory = [...history, cmd];
      setHistory(newHistory);
      
      setInputValue('');
      if (!autoSuggest) {
        setSuggestions([]);
      }
    } else if (inputReq.type === 'char') {
      const char = cmd.length > 0 ? cmd[0] : 'return';
      const charValue = char === ' ' ? 'space' : char;
      sendEvent({
        type: 'char',
        window: inputReq.id,
        value: charValue
      });
      
      setInputValue('');
    }

    // Ensure we scroll to the bottom
    setTimeout(() => {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, 100);
  };

  const getGameType = () => {
    if (!gameName) return '';
    if (gameName.endsWith('.ulx') || gameName.endsWith('.gblorb')) return 'Glulx';
    if (gameName.match(/\.z\d$/i)) return 'Z-machine';
    return 'Interactive Fiction';
  };

  useEffect(() => {
    if (autoSuggest && inputs.length > 0 && inputs[0].type === 'line' && currentOutput) {
      if (lastSuggestedTurn.current !== history.length) {
        lastSuggestedTurn.current = history.length;
        getSuggestions('command', '', history, currentOutput, gameName, getGameType(), walkthroughFile?.base64 || null, selectedModel, aiSettings);
      }
    }
  }, [inputs, currentOutput, autoSuggest, history.length, getSuggestions, selectedModel, gameName, walkthroughFile, aiSettings]);

  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      if (inputs.length > 0 && inputs[0].type === 'char') {
        e.preventDefault();
        submitCommand('return');
      }
    };

    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => window.removeEventListener('keydown', handleGlobalKeyDown);
  }, [inputs]);

  const handleSuggest = (mode: 'command' | 'hint' = 'command', question: string = '') => {
    getSuggestions(mode, question, history, currentOutput, gameName, getGameType(), walkthroughFile?.base64 || null, selectedModel, aiSettings);
  };

  const clearAppCache = async () => {
    if (window.confirm('This will clear all local settings and refresh the app. Continue?')) {
      // Clear localForage
      await localforage.clear();
      // Clear localStorage
      localStorage.clear();
      // Unregister Service Workers
      if ('serviceWorker' in navigator) {
        const registrations = await navigator.serviceWorker.getRegistrations();
        for (const registration of registrations) {
          await registration.unregister();
        }
      }
      // Reload
      window.location.reload();
    }
  };

  const handleSetDirectory = async () => {
    try {
      if ('showDirectoryPicker' in window) {
        const handle = await (window as any).showDirectoryPicker({
          mode: 'readwrite'
        });
        setDirectoryHandle(handle);
        setDirectoryPermission('granted');
        await localforage.setItem('directoryHandle', handle);
      } else {
        alert('Your browser does not support the File System Access API. Please use a modern browser like Chrome or Edge.');
      }
    } catch (err: any) {
      console.error('Failed to set directory:', err);
      if (err.name === 'SecurityError' || err.message.includes('Cross origin sub frames')) {
        alert('Security restriction: Browsers do not allow linking folders when the app is inside an iframe. Please open the app in a new tab (using the button in the settings) to use this feature.');
      }
    }
  };

  const requestDirectoryPermission = async () => {
    if (!directoryHandle) return;
    try {
      const request = await directoryHandle.requestPermission({ mode: 'readwrite' });
      setDirectoryPermission(request);
      return request === 'granted';
    } catch (err) {
      console.error('Error requesting permission:', err);
      return false;
    }
  };

  const verifyDirectoryPermission = async () => {
    if (!directoryHandle) return false;
    try {
      const permission = await directoryHandle.queryPermission({ mode: 'readwrite' });
      setDirectoryPermission(permission);
      return permission === 'granted';
    } catch (err) {
      console.error('Error verifying permission:', err);
      return false;
    }
  };

  const getMaskedKey = () => {
    const key = manualApiKey || process.env.GEMINI_API_KEY;
    if (!key || key === 'undefined' || key === 'null') return 'Not detected (Missing in Secrets)';
    if (key.includes('MY_GEMINI_API_KEY') || key.includes('AI Studio Free Tier')) return 'Placeholder detected (Enter real key in Secrets)';
    if (key.length < 10) return 'Invalid format (Too short)';
    return `${key.slice(0, 4)}...${key.slice(-4)}`;
  };

  const handleManualKeyChange = (val: string) => {
    setManualApiKey(val);
    if (val.trim()) {
      localStorage.setItem('GEMINI_API_KEY_OVERRIDE', val.trim());
    } else {
      localStorage.removeItem('GEMINI_API_KEY_OVERRIDE');
    }
  };

  const renderRun = (run: any, idx: number) => {
    if (typeof run === 'string') {
      return <span key={idx}>{run}</span>;
    }
    const style: any = {};
    if (run.style === 'emphasized') style.fontStyle = 'italic';
    if (run.style === 'strong') style.fontWeight = 'bold';
    return <span key={idx} style={style}>{run.text}</span>;
  };

  return (
    <div className="flex h-[100dvh] bg-gray-100 dark:bg-gray-900 transition-colors duration-200 overflow-hidden">
      {/* Mobile Sidebar Overlay */}
      {showSidebar && (
        <div 
          className="fixed inset-0 bg-black/50 z-40 md:hidden"
          onClick={() => setShowSidebar(false)}
        />
      )}

      {/* Sidebar */}
      <div className={`fixed inset-y-0 left-0 z-50 bg-white dark:bg-gray-800 w-80 border-r border-gray-200 dark:border-gray-700 flex flex-col transition-transform duration-300 ${showSidebar ? 'translate-x-0' : '-translate-x-full'} md:relative md:translate-x-0 ${showSidebar ? 'md:ml-0' : 'md:-ml-80'}`}>
        <div 
          className="p-4 border-b border-gray-200 dark:border-gray-700 flex justify-between items-center bg-indigo-50 dark:bg-gray-800 cursor-pointer hover:bg-indigo-100 dark:hover:bg-gray-700 transition-colors"
          onClick={() => setShowSidebar(false)}
          title="Close Settings"
        >
          <h2 className="font-bold text-indigo-900 dark:text-indigo-300 flex items-center gap-2">
            <Settings className="w-5 h-5" /> Settings
          </h2>
          <button className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 md:hidden">✕</button>
          <button className="hidden md:block text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200">✕</button>
        </div>
        
        <div className="flex-1 overflow-y-auto p-4">
          <div className="space-y-6">
            <div>
              <p className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-4">AI Settings</p>
              <div className="space-y-4">
                <div>
                  <label className="block text-xs text-gray-400 mb-1">Suggestion Model</label>
                  <select 
                    value={selectedModel}
                    onChange={(e) => setSelectedModel(e.target.value)}
                    className="w-full bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg px-3 py-2 text-sm text-gray-700 dark:text-gray-200 outline-none focus:ring-2 focus:ring-indigo-500"
                  >
                    <option value="gemini-3-flash-preview">Gemini 3 Flash (Fastest)</option>
                    <option value="gemini-3.1-pro-preview">Gemini 3.1 Pro (Smarter)</option>
                    <option value="gemini-3.1-flash-lite-preview">Gemini 3.1 Flash Lite</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs text-gray-400 mb-1 flex justify-between">
                    <span>Manual API Key (iPhone Fallback)</span>
                    {manualApiKey && <button onClick={() => handleManualKeyChange('')} className="text-red-500 hover:underline">Clear</button>}
                  </label>
                  <input 
                    type="password"
                    value={manualApiKey}
                    onChange={(e) => handleManualKeyChange(e.target.value)}
                    placeholder="Paste AIza... key here"
                    className="w-full bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg px-3 py-2 text-sm text-gray-700 dark:text-gray-200 outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                  <p className="text-[10px] text-gray-500 mt-1">Only use this if the platform settings (gear icon) don't work on your device.</p>
                </div>
                
                <div className="pt-2 space-y-4">
                  <div className="border-t border-gray-200 dark:border-gray-700 pt-4">
                    <p className="text-[10px] font-bold text-gray-400 uppercase mb-2">Advanced AI Context</p>
                    <div className="space-y-3">
                      <div>
                        <label className="block text-[10px] text-gray-500 mb-1">Context Window ({aiSettings.contextWindowSize} chars)</label>
                        <input 
                          type="range" min="1000" max="20000" step="1000"
                          value={aiSettings.contextWindowSize}
                          onChange={(e) => setAiSettings({...aiSettings, contextWindowSize: parseInt(e.target.value)})}
                          className="w-full h-1 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-indigo-600"
                        />
                      </div>
                      <div>
                        <label className="block text-[10px] text-gray-500 mb-1">History Length ({aiSettings.historyLength} commands)</label>
                        <input 
                          type="range" min="1" max="50" step="1"
                          value={aiSettings.historyLength}
                          onChange={(e) => setAiSettings({...aiSettings, historyLength: parseInt(e.target.value)})}
                          className="w-full h-1 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-indigo-600"
                        />
                      </div>
                      <div>
                        <label className="block text-[10px] text-gray-500 mb-1">Suggestion Count ({aiSettings.suggestionCount})</label>
                        <input 
                          type="range" min="1" max="15" step="1"
                          value={aiSettings.suggestionCount}
                          onChange={(e) => setAiSettings({...aiSettings, suggestionCount: parseInt(e.target.value)})}
                          className="w-full h-1 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-indigo-600"
                        />
                      </div>
                    </div>
                  </div>

                  <button 
                    onClick={() => setShowDebug(!showDebug)}
                    className="text-xs text-indigo-600 dark:text-indigo-400 hover:underline"
                  >
                    {showDebug ? 'Hide Debug Info' : 'Show Debug Info'}
                  </button>
                  
                  {showDebug && (
                    <div className="mt-2 p-2 bg-gray-100 dark:bg-gray-900 rounded text-[10px] font-mono text-gray-500 dark:text-gray-400 break-all">
                      <p>Key: {getMaskedKey()}</p>
                      <p>UA: {navigator.userAgent.slice(0, 50)}...</p>
                    </div>
                  )}
                </div>

                <button 
                  onClick={clearAppCache}
                  className="w-full flex items-center justify-center gap-2 text-xs text-red-500 hover:text-red-700 border border-red-200 dark:border-red-900/30 px-3 py-2 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/10 transition-colors"
                >
                  <Trash2 className="w-3 h-3" /> Clear App Cache & Refresh
                </button>

                <div className="border-t border-gray-200 dark:border-gray-700 pt-4">
                  <p className="text-[10px] font-bold text-gray-400 uppercase mb-2">Local File System</p>
                  
                  {isIframe ? (
                    <div className="bg-amber-50 dark:bg-amber-900/10 border border-amber-200 dark:border-amber-900/30 p-3 rounded-lg">
                      <p className="text-[10px] text-amber-700 dark:text-amber-400 mb-2">
                        Folder linking is restricted in the preview window. Open in a new tab to enable direct saving to your PC.
                      </p>
                      <button 
                        onClick={() => window.open(window.location.href, '_blank')}
                        className="w-full flex items-center justify-center gap-2 text-xs bg-amber-600 text-white px-3 py-2 rounded-lg hover:bg-amber-700 transition-colors shadow-sm"
                      >
                        <ExternalLink className="w-3 h-3" /> Open in New Tab
                      </button>
                    </div>
                  ) : (
                    <>
                      <button 
                        onClick={handleSetDirectory}
                        className={`w-full flex items-center justify-center gap-2 text-xs px-3 py-2 rounded-lg transition-colors border ${directoryHandle ? 'bg-emerald-50 dark:bg-emerald-900/10 border-emerald-200 dark:border-emerald-800 text-emerald-600' : 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700'}`}
                      >
                        <Settings className="w-3 h-3" /> {directoryHandle ? 'Change Game Folder' : 'Set Game Folder'}
                      </button>
                      {directoryHandle && (
                        <div className="mt-2 space-y-2">
                          <p className="text-[10px] text-emerald-600 text-center">Folder linked: {directoryHandle.name}</p>
                          {directoryPermission !== 'granted' && (
                            <button 
                              onClick={requestDirectoryPermission}
                              className="w-full flex items-center justify-center gap-2 text-[10px] bg-amber-50 dark:bg-amber-900/20 text-amber-700 border border-amber-200 dark:border-amber-800 px-2 py-1 rounded hover:bg-amber-100 transition-colors"
                            >
                              <Unlock className="w-3 h-3" /> Unlock Folder Access
                            </button>
                          )}
                        </div>
                      )}
                      <p className="text-[10px] text-gray-500 mt-1">Allows saving directly to your PC instead of Downloads.</p>
                    </>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div 
        className="flex-1 flex flex-col max-w-4xl mx-auto w-full p-2 sm:p-4 relative min-w-0"
        style={{ paddingBottom: 'max(0.5rem, env(safe-area-inset-bottom))' }}
      >
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 sm:gap-4 mb-4">
          <div className="flex items-center gap-3 w-full sm:w-auto min-w-0">
            <button onClick={() => {
              setShowSidebar(!showSidebar);
            }} className="p-2 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-lg text-gray-700 dark:text-gray-300 shrink-0">
              <Settings className="w-6 h-6" />
            </button>
            <h1 className="text-xl sm:text-2xl font-bold text-gray-900 dark:text-white truncate">
              {gameName ? gameName : 'Interactive Fiction Player'}
            </h1>
          </div>
          <div className="flex items-center gap-2 w-full sm:w-auto overflow-x-auto pb-1 sm:pb-0 no-scrollbar shrink-0">
            <button 
              onClick={handleOpenGame}
              className="p-2 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-lg text-indigo-600 dark:text-indigo-400 shrink-0"
              title="Upload Game File"
            >
              <Upload className="w-5 h-5" />
            </button>
            <input 
              type="file" 
              ref={fileInputRef} 
              onChange={handleFileUpload} 
              className="hidden" 
              accept=".z3,.z5,.z8,.ulx,.gblorb"
            />
            <input 
              type="file" 
              ref={walkthroughInputRef} 
              onChange={handleWalkthroughUpload} 
              className="hidden" 
              accept="application/pdf"
            />
            <button 
              onClick={() => window.location.reload()}
              className="p-2 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-lg text-gray-700 dark:text-gray-300 shrink-0"
              title="Refresh App"
            >
              <RefreshCw className="w-5 h-5" />
            </button>
            <button 
              onClick={toggleDarkMode}
              className="p-2 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-lg text-gray-700 dark:text-gray-300 shrink-0"
              title="Toggle Dark Mode"
            >
              {isDarkMode ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
            </button>
            <button 
              onClick={() => {
                setAutoSuggest(!autoSuggest);
                if (!autoSuggest && inputs.length > 0 && inputs[0].type === 'line' && currentOutput) {
                  lastSuggestedTurn.current = history.length;
                  getSuggestions('command', '', history, currentOutput, gameName, getGameType(), walkthroughFile?.base64 || null, selectedModel, aiSettings);
                }
              }}
              className={`flex items-center gap-2 px-3 sm:px-4 py-2 rounded-lg transition-colors shadow-sm shrink-0 ${autoSuggest ? 'bg-emerald-600 text-white hover:bg-emerald-700' : 'bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700'}`}
              title="Toggle Auto-Suggest"
            >
              {autoSuggest ? <ToggleRight className="w-5 h-5" /> : <ToggleLeft className="w-5 h-5" />}
              <span className="hidden sm:inline">Auto</span>
            </button>

            {gameData && (
              <div className="flex items-center gap-2">
                <button 
                  onClick={() => {
                    if (!walkthroughFile) {
                      walkthroughInputRef.current?.click();
                    } else {
                      setIsHintMode(!isHintMode);
                      if (!isHintMode) {
                        setTimeout(() => {
                          const input = document.querySelector('input[name="if-command-input"]') as HTMLInputElement;
                          input?.focus();
                        }, 100);
                      }
                    }
                  }}
                  className={`flex items-center gap-2 px-3 sm:px-4 py-2 rounded-lg transition-colors shadow-sm shrink-0 ${isHintMode ? 'bg-amber-500 text-white hover:bg-amber-600' : 'bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700'}`}
                  title={walkthroughFile ? "Toggle Hint Mode" : "Load Walkthrough PDF"}
                >
                  {aiLoadingMode === 'hint' ? <Loader2 className="w-5 h-5 animate-spin" /> : <Lightbulb className="w-5 h-5" />}
                  <span className="hidden sm:inline">Hint</span>
                </button>
                {walkthroughFile && (
                  <button
                    onClick={() => { setWalkthroughFile(null); setIsHintMode(false); }}
                    className="p-2 text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg border border-transparent hover:border-red-200 dark:hover:border-red-800"
                    title="Clear Walkthrough"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
                <button 
                  onClick={() => handleSuggest('command')}
                  disabled={aiLoading || !gameData}
                  className="flex items-center gap-2 bg-indigo-600 text-white px-3 sm:px-4 py-2 rounded-lg hover:bg-indigo-700 disabled:opacity-50 shadow-sm shrink-0"
                >
                  {aiLoadingMode === 'command' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wand2 className="w-4 h-4" />}
                  <span className="hidden sm:inline">Suggest</span>
                </button>
              </div>
            )}
          </div>
        </div>
        
        {/* Main Content Area */}
        <div className="flex-1 border border-gray-300 dark:border-gray-700 rounded-xl p-4 overflow-y-auto font-mono whitespace-pre-wrap bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 shadow-sm flex flex-col min-h-0 relative">
          {!gameData ? (
            <div className="flex-1 flex flex-col items-center justify-center text-gray-500 dark:text-gray-400">
              <Upload className="w-12 h-12 mb-4 text-gray-300 dark:text-gray-600" />
              <p className="mb-4 text-center px-4 text-sm sm:text-base">Load a game file to start playing.</p>
              <button
                onClick={() => fileInputRef.current?.click()}
                className="inline-flex items-center gap-2 px-6 py-3 bg-indigo-600 hover:bg-indigo-700 text-white font-medium rounded-xl transition-colors shadow-sm"
              >
                <Upload size={20} />
                Upload Game File
              </button>
            </div>
          ) : (
            <>
              {gameStatus === 'error' && (
                <div className="mb-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 p-4 rounded-xl text-red-600 dark:text-red-400">
                  <p className="font-bold mb-1">Game Error</p>
                  <p className="text-sm font-mono break-all">{lastError || 'An unknown error occurred in the VM.'}</p>
                  <button
                    onClick={() => window.location.reload()}
                    className="mt-3 px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg transition-colors font-sans text-sm"
                  >
                    Restart App
                  </button>
                </div>
              )}

              {gameStatus === 'ended' && (
                <div className="mb-4 bg-gray-100 dark:bg-gray-800 border border-gray-300 dark:border-gray-700 p-4 rounded-xl text-center">
                  <p className="font-bold text-lg mb-2 text-gray-900 dark:text-gray-100">Game Session Ended</p>
                  <button
                    onClick={() => window.location.reload()}
                    className="px-6 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg transition-colors text-sm"
                  >
                    Restart Game
                  </button>
                </div>
              )}

              {windows.map(win => (
                <div key={win.id} className="mb-4">
                  {windowBuffers[win.id]?.map((line: any, i: number) => (
                    <div key={i} className="min-h-[1.5em]">
                      {line.content ? line.content.map((run: any, j: number) => renderRun(run, j)) : <br />}
                    </div>
                  ))}
                </div>
              ))}
              <div ref={bottomRef} />
            </>
          )}
        </div>

        {(hintAnswer || aiError) && (
          <div className={`mt-3 gap-2 overflow-x-auto pb-2 no-scrollbar shrink-0 min-h-[48px] items-center relative z-10 flex`}>
            {aiError ? (
              <div className="text-xs text-red-500 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 px-3 py-2 rounded-lg flex items-center gap-2">
                <span className="font-bold shrink-0">AI Error:</span>
                <span className="truncate max-w-[250px] sm:max-w-md" title={aiError}>{aiError}</span>
                <button 
                  onClick={() => handleSuggest()}
                  className="ml-2 underline hover:no-underline font-medium shrink-0"
                >
                  Retry
                </button>
              </div>
            ) : hintAnswer ? (
              <div className="w-full text-sm text-indigo-900 dark:text-indigo-100 bg-indigo-50 dark:bg-indigo-900/30 border border-indigo-200 dark:border-indigo-800 p-3 rounded-lg relative">
                <button 
                  onClick={() => setHintAnswer(null)}
                  className="absolute top-2 right-2 text-indigo-400 hover:text-indigo-600 dark:hover:text-indigo-200"
                >
                  ✕
                </button>
                <div className="font-bold mb-1 flex items-center gap-2"><Lightbulb className="w-4 h-4"/> Hint</div>
                <div className="whitespace-pre-wrap">{hintAnswer}</div>
              </div>
            ) : null}
          </div>
        )}

        {gameData && !filePrompt && (
          <div className={`flex items-center mt-2 mb-4 p-3 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-xl shadow-sm shrink-0 ${inputs.length === 0 ? 'opacity-70' : ''}`}>
            <span className="mr-2 text-blue-600 dark:text-blue-400 font-bold text-lg">&gt;</span>
            <input
              type="text"
              name="if-command-input"
              list="ai-suggestions"
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="none"
              spellCheck="false"
              data-1p-ignore="true"
              data-lpignore="true"
              className="flex-1 outline-none bg-transparent font-mono text-gray-900 dark:text-gray-100 text-lg w-full disabled:opacity-50"
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={handleInput}
              disabled={gameStatus !== 'playing' || inputs.length === 0}
              onFocus={() => {
                setTimeout(() => {
                  bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
                }, 300);
              }}
              autoFocus
              placeholder={
                isHintMode ? "Ask a hint..." :
                gameStatus === 'loading' ? "Initializing..." :
                gameStatus === 'ended' ? "Game ended." :
                gameStatus === 'error' ? "Error occurred." :
                inputs.length === 0 ? "Waiting for game..." : 
                inputs[0].type === 'char' ? "Press any key..." : 
                "Enter command..."
              }
            />
            <datalist id="ai-suggestions">
              {suggestions.map((sug, i) => (
                <option key={i} value={sug} />
              ))}
            </datalist>
            <div className="flex items-center gap-1 ml-2 md:hidden">
              <button 
                onClick={(e) => { e.preventDefault(); handleInput({ key: 'ArrowUp', preventDefault: () => {} } as any); }}
                className="p-2 bg-gray-100 dark:bg-gray-700 rounded-lg text-gray-600 dark:text-gray-300 active:bg-gray-200 dark:active:bg-gray-600"
                title="Previous Command"
              >
                <ArrowUp className="w-5 h-5" />
              </button>
              <button 
                onClick={(e) => { e.preventDefault(); handleInput({ key: 'ArrowDown', preventDefault: () => {} } as any); }}
                className="p-2 bg-gray-100 dark:bg-gray-700 rounded-lg text-gray-600 dark:text-gray-300 active:bg-gray-200 dark:active:bg-gray-600"
                title="Next Command"
              >
                <ArrowDown className="w-5 h-5" />
              </button>
              <button 
                onClick={() => {
                  submitCommand(inputValue);
                  setHistoryIndex(-1);
                }}
                className="p-2 text-indigo-600 hover:text-indigo-800 dark:text-indigo-400 dark:hover:text-indigo-200 bg-indigo-50 dark:bg-indigo-900/30 rounded-lg font-bold"
              >
                ↵
              </button>
            </div>
          </div>
        )}

        {gameData && inputs.length > 0 && inputs[0].type === 'char' && (
          <div className="flex items-center mt-2 mb-4 p-3 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-xl shadow-sm shrink-0">
            <button
              onClick={() => submitCommand('return')}
              className="w-full py-3 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-lg transition-colors animate-pulse"
            >
              Press any key or tap to continue...
            </button>
          </div>
        )}
      </div>
      {/* File Prompt Modal */}
      {filePrompt && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-gray-800 p-6 rounded-xl shadow-xl max-w-md w-full mx-4">
            <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-4">
              {filePrompt.filemode === 'read' ? 'Restore Game' : 'Save Game'}
            </h3>
            
            {filePrompt.filemode === 'read' ? (
              <>
                <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
                  Waiting for file selection... (If the file chooser doesn't open automatically, please click below)
                </p>
                <input
                  type="file"
                  ref={saveFileInputRef}
                  onChange={handleSaveFileUpload}
                  className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 mb-4 bg-transparent text-gray-900 dark:text-white outline-none focus:ring-2 focus:ring-indigo-500"
                />
                <div className="flex justify-end gap-2">
                  <button
                    onClick={() => {
                      handleFilePromptSubmit(null);
                      if (saveFileInputRef.current) saveFileInputRef.current.value = '';
                    }}
                    className="px-4 py-2 text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg"
                  >
                    Cancel
                  </button>
                </div>
              </>
            ) : (
              <>
                <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
                  Please enter a file name (without an extension):
                </p>
                <input
                  type="text"
                  className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 mb-4 bg-transparent text-gray-900 dark:text-white outline-none focus:ring-2 focus:ring-indigo-500"
                  value={filePromptInput}
                  onChange={(e) => setFilePromptInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      handleFilePromptSubmit(filePromptInput);
                      setFilePromptInput('');
                    } else if (e.key === 'Escape') {
                      handleFilePromptSubmit(null);
                      setFilePromptInput('');
                    }
                  }}
                  autoFocus
                />
                <div className="flex justify-end gap-2">
                  <button
                    onClick={() => {
                      handleFilePromptSubmit(null);
                      setFilePromptInput('');
                    }}
                    className="px-4 py-2 text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => {
                      handleFilePromptSubmit(filePromptInput);
                      setFilePromptInput('');
                    }}
                    className="px-4 py-2 bg-indigo-600 text-white hover:bg-indigo-700 rounded-lg"
                  >
                    Save
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

    </div>
  );
}



