/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
import { Bocfel, Git } from 'emglken';
import bocfelWasm from 'emglken/build/bocfel.wasm?url';
import gitWasm from 'emglken/build/git.wasm?url';
import { MyDialog } from './MyDialog';
import { useGlkOte } from './useGlkOte';
import { useAI } from './useAI';
import { useGoogleDrive } from './useGoogleDrive';
import { Loader2, Sparkles, Folder, Download, Play, LogIn, LogOut, RefreshCw, Upload, Moon, Sun, ToggleLeft, ToggleRight, Trash2, ArrowUp, ArrowDown } from 'lucide-react';
import localforage from 'localforage';
import { extractStrings, findRelevantStrings } from './services/stringExtractor';

export default function App() {
  const { GlkOte, sendEvent, windows, windowBuffers, inputs, clearState, filePrompt, submitFilePrompt } = useGlkOte();
  const { suggestions, hintAnswer, loading: aiLoading, error: aiError, getSuggestions, setSuggestions, setHintAnswer } = useAI();
  const { login, logout, accessToken, listFiles, downloadFile, uploadFile, deleteFile, loading: driveLoading } = useGoogleDrive();
  
  const [gameData, setGameData] = useState<Uint8Array | null>(null);
  const [gameName, setGameName] = useState<string>('');
  const [gameStrings, setGameStrings] = useState<string[]>([]);
  const [aiMode, setAiMode] = useState<'command' | 'hint'>('command');
  const [hintQuestion, setHintQuestion] = useState('');
  const [aiSettings, setAiSettings] = useState({
    contextWindowSize: 10000,
    historyLength: 15,
    relevantStringsCount: 20
  });
  const [inputValue, setInputValue] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);
  const [history, setHistory] = useState<string[]>([]);
  const [currentOutput, setCurrentOutput] = useState<string>('');
  const [historyIndex, setHistoryIndex] = useState(-1);
  
  const [localGames, setLocalGames] = useState<string[]>([]);
  const [localSaves, setLocalSaves] = useState<string[]>([]);
  const [driveFiles, setDriveFiles] = useState<any[]>([]);
  const [showSidebar, setShowSidebar] = useState(false);
  const [isDarkMode, setIsDarkMode] = useState(false);
  const [autoSuggest, setAutoSuggest] = useState(false);
  const [selectedModel, setSelectedModel] = useState('gemini-3-flash-preview');
  const [manualApiKey, setManualApiKey] = useState(localStorage.getItem('GEMINI_API_KEY_OVERRIDE') || '');
  const [showDebug, setShowDebug] = useState(false);
  const [filePromptInput, setFilePromptInput] = useState('');
  const [isSyncing, setIsSyncing] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const lastSuggestedTurn = useRef(-1);
  const [replayQueue, setReplayQueue] = useState<string[]>([]);
  const [isReplaying, setIsReplaying] = useState(false);

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
    const initDefaultGame = async () => {
      const exists = await localforage.getItem('minizork.z3');
      if (!exists) {
        try {
          const res = await fetch('/minizork.z3');
          const buffer = await res.arrayBuffer();
          await localforage.setItem('minizork.z3', new Uint8Array(buffer));
          refreshLocalGames();
        } catch (err) {
          console.error('Failed to load default game:', err);
        }
      } else {
        refreshLocalGames();
      }
    };
    initDefaultGame();
  }, []);

  const refreshLocalGames = async () => {
    const keys = await localforage.keys();
    // Filter out save files (assuming games end with .z3, .z5, .z8, .ulx, .gblorb)
    const games = keys.filter(k => k.match(/\.(z\d|ulx|gblorb)$/i));
    const saves = keys.filter(k => !k.match(/\.(z\d|ulx|gblorb)$/i) && !k.startsWith('autosave_'));
    setLocalGames(games);
    setLocalSaves(saves);
    
    // Auto-load first game if available and no game is loaded
    if (games.length > 0 && !gameName) {
      loadLocalGame(games[0]);
    }
  };

  const loadLocalGame = async (name: string) => {
    const data = await localforage.getItem<Uint8Array>(name);
    if (data) {
      clearState();
      setGameName(name);
      setGameData(data);
      setGameStrings(extractStrings(data));
      setShowSidebar(false);
      
      const autosave = await localforage.getItem<string[]>(`autosave_${name}`);
      if (autosave && autosave.length > 0) {
        // Auto-restore without asking
        setReplayQueue(autosave);
        setIsReplaying(true);
        setHistory(autosave);
      } else {
        setHistory([]);
      }
    }
  };

  const deleteLocalFile = async (name: string) => {
    await localforage.removeItem(name);
    await localforage.removeItem(`autosave_${name}`);
    refreshLocalGames();
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const buffer = await file.arrayBuffer();
    const data = new Uint8Array(buffer);
    await localforage.setItem(file.name, data);
    setGameStrings(extractStrings(data));
    refreshLocalGames();
    loadLocalGame(file.name);
    
    // Reset file input
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleDriveSync = async () => {
    if (!accessToken) return;
    const files = await listFiles();
    setDriveFiles(files);
  };

  const downloadFromDrive = async (file: any) => {
    const data = await downloadFile(file.id);
    if (data) {
      await localforage.setItem(file.name, data);
      refreshLocalGames();
    }
  };

  const deleteFromDrive = async (file: any) => {
    if (window.confirm(`Are you sure you want to delete ${file.name} from Google Drive?`)) {
      await deleteFile(file.id);
      handleDriveSync();
    }
  };

  const syncAllToDrive = async () => {
    if (!accessToken) return;
    setIsSyncing(true);
    try {
      const keys = await localforage.keys();
      for (const key of keys) {
        const data = await localforage.getItem<Uint8Array>(key);
        if (data) {
          await uploadFile(key, data);
        }
      }
      await handleDriveSync();
      alert('All local files (games and saves) synced to Google Drive!');
    } catch (err) {
      console.error('Failed to sync to drive:', err);
      alert('An error occurred while syncing to Google Drive.');
    } finally {
      setIsSyncing(false);
    }
  };

  useEffect(() => {
    if (!gameData || !gameName) return;

    let vm: any;
    const initVM = async () => {
      try {
        const Dialog = new MyDialog(gameName, gameData);
        if (gameName.endsWith('.ulx') || gameName.endsWith('.gblorb')) {
          vm = await Git({
            locateFile: () => gitWasm
          });
        } else {
          vm = await Bocfel({
            locateFile: () => bocfelWasm
          });
        }
        
        vm.start({
          Dialog,
          GlkOte,
          arguments: [gameName]
        });
      } catch (err) {
        console.error('VM Error:', err);
      }
    };

    initVM();
  }, [gameData, gameName, GlkOte]);

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

  useEffect(() => {
    if (filePrompt) {
      setFilePromptInput('');
    }
  }, [filePrompt]);

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
    
    if (inputReq.type === 'line') {
      sendEvent({
        type: 'line',
        window: inputReq.id,
        value: cmd
      });
      const newHistory = [...history, cmd];
      setHistory(newHistory);
      
      const lowerCmd = cmd.toLowerCase().trim();
      if (['restart', 'restore', 'quit'].includes(lowerCmd)) {
        localforage.removeItem(`autosave_${gameName}`);
      } else if (lowerCmd !== 'save') {
        localforage.setItem(`autosave_${gameName}`, newHistory.filter(c => !['save', 'restore', 'restart', 'quit'].includes(c.toLowerCase().trim())));
      }

      setInputValue('');
      if (!autoSuggest) {
        setSuggestions([]);
      }
    } else if (inputReq.type === 'char') {
      sendEvent({
        type: 'char',
        window: inputReq.id,
        value: 'return'
      });
      setInputValue('');
    }

    // Ensure we scroll to the bottom
    setTimeout(() => {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, 100);
  };

  useEffect(() => {
    if (isReplaying && inputs.length > 0) {
      if (inputs[0].type === 'char') {
        sendEvent({
          type: 'char',
          window: inputs[0].id,
          value: 'return'
        });
      } else if (inputs[0].type === 'line') {
        if (replayQueue.length > 0) {
          const cmd = replayQueue[0];
          setReplayQueue(prev => prev.slice(1));
          
          sendEvent({
            type: 'line',
            window: inputs[0].id,
            value: cmd
          });
        } else {
          setIsReplaying(false);
        }
      }
    }
  }, [inputs, isReplaying, replayQueue, sendEvent]);

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
        const relevant = findRelevantStrings(gameStrings, currentOutput);
        console.log(`Top ${aiSettings.relevantStringsCount} relevant strings:`, relevant.slice(0, aiSettings.relevantStringsCount));
        getSuggestions('command', '', history, currentOutput, gameName, getGameType(), relevant, selectedModel, aiSettings);
      }
    }
  }, [inputs, currentOutput, autoSuggest, history.length, getSuggestions, selectedModel, gameName, gameStrings, aiSettings]);

  const handleSuggest = () => {
    const relevant = findRelevantStrings(gameStrings, currentOutput);
    console.log(`Top ${aiSettings.relevantStringsCount} relevant strings:`, relevant.slice(0, aiSettings.relevantStringsCount));
    getSuggestions(aiMode, hintQuestion, history, currentOutput, gameName, getGameType(), relevant, selectedModel, aiSettings);
  };

  const clearAppCache = async () => {
    if (window.confirm('This will clear all local settings and refresh the app. Your game saves in Google Drive will not be affected. Continue?')) {
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
          title="Close Library"
        >
          <h2 className="font-bold text-indigo-900 dark:text-indigo-300 flex items-center gap-2">
            <Folder className="w-5 h-5" /> Library
          </h2>
          <button className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 md:hidden">✕</button>
          <button className="hidden md:block text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200">✕</button>
        </div>
        
        <div className="flex-1 overflow-y-auto p-4">
          <div className="flex justify-between items-center mb-3">
            <h3 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Local Games</h3>
            <button 
              onClick={() => fileInputRef.current?.click()}
              className="text-indigo-600 hover:text-indigo-800 dark:text-indigo-400 dark:hover:text-indigo-300"
              title="Upload Game"
            >
              <Upload className="w-4 h-4" />
            </button>
            <input 
              type="file" 
              ref={fileInputRef} 
              onChange={handleFileUpload} 
              className="hidden" 
              accept=".z3,.z5,.z8,.ulx,.gblorb"
            />
          </div>
          
          {localGames.length === 0 ? (
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">No games downloaded yet.</p>
          ) : (
            <ul className="space-y-2 mb-6">
              {localGames.map(game => (
                <li key={game} className="flex items-center justify-between p-2 hover:bg-gray-50 dark:hover:bg-gray-700 rounded-lg border border-transparent hover:border-gray-200 dark:hover:border-gray-600 group">
                  <span className="text-sm truncate flex-1 dark:text-gray-200" title={game}>{game}</span>
                  <div className="flex items-center gap-1 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity">
                    <button onClick={() => deleteLocalFile(game)} className="text-red-500 hover:text-red-700 p-1" title="Delete">
                      <Trash2 className="w-4 h-4" />
                    </button>
                    <button onClick={() => loadLocalGame(game)} className="text-indigo-600 hover:text-indigo-800 dark:text-indigo-400 dark:hover:text-indigo-300 p-1" title="Play">
                      <Play className="w-4 h-4" />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}

          <div className="flex justify-between items-center mb-3">
            <h3 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Local Saves</h3>
          </div>
          
          {localSaves.length === 0 ? (
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">No saves found.</p>
          ) : (
            <ul className="space-y-2 mb-6">
              {localSaves.map(save => (
                <li key={save} className="flex items-center justify-between p-2 hover:bg-gray-50 dark:hover:bg-gray-700 rounded-lg border border-transparent hover:border-gray-200 dark:hover:border-gray-600 group">
                  <span className="text-sm truncate flex-1 dark:text-gray-200" title={save}>{save}</span>
                  <div className="flex items-center gap-1 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity">
                    <button onClick={() => deleteLocalFile(save)} className="text-red-500 hover:text-red-700 p-1" title="Delete">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}

          <div className="border-t border-gray-200 dark:border-gray-700 pt-6">
            <h3 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-3 flex justify-between items-center">
              Google Drive
              {accessToken && (
                <div className="flex gap-2">
                  <button onClick={handleDriveSync} className="text-indigo-600 hover:text-indigo-800 dark:text-indigo-400 dark:hover:text-indigo-300" title="Refresh Drive">
                    <RefreshCw className={`w-4 h-4 ${driveLoading ? 'animate-spin' : ''}`} />
                  </button>
                  <button onClick={logout} className="text-red-500 hover:text-red-700" title="Disconnect Drive">
                    <LogOut className="w-4 h-4" />
                  </button>
                </div>
              )}
            </h3>
            
            {!accessToken ? (
              <button onClick={() => login()} className="w-full flex items-center justify-center gap-2 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 px-4 py-2 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-600">
                <LogIn className="w-4 h-4" /> Connect Drive
              </button>
            ) : (
              <div className="space-y-4">
                <button 
                  onClick={syncAllToDrive} 
                  disabled={isSyncing}
                  className="w-full flex items-center justify-center gap-2 bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800 px-4 py-2 rounded-lg hover:bg-indigo-100 dark:hover:bg-indigo-900/50 disabled:opacity-50"
                >
                  {isSyncing ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />} 
                  {isSyncing ? 'Syncing...' : 'Sync All to Drive'}
                </button>
                
                <ul className="space-y-2">
                  {driveFiles.map(file => (
                    <li key={file.id} className="flex items-center justify-between p-2 hover:bg-gray-50 dark:hover:bg-gray-700 rounded-lg border border-transparent hover:border-gray-200 dark:hover:border-gray-600 group">
                      <span className="text-sm truncate flex-1 dark:text-gray-200" title={file.name}>{file.name}</span>
                      <div className="flex items-center gap-1 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity">
                        <button onClick={() => deleteFromDrive(file)} className="text-red-500 hover:text-red-700 p-1" title="Delete from Drive">
                          <Trash2 className="w-4 h-4" />
                        </button>
                        <button onClick={() => downloadFromDrive(file)} className="text-indigo-600 hover:text-indigo-800 dark:text-indigo-400 dark:hover:text-indigo-300 p-1" title="Download">
                          <Download className="w-4 h-4" />
                        </button>
                      </div>
                    </li>
                  ))}
                  {driveFiles.length === 0 && !driveLoading && (
                    <p className="text-sm text-gray-500 dark:text-gray-400">No files found in "IF Games" folder.</p>
                  )}
                </ul>
              </div>
            )}
          </div>

          <div className="mt-8 border-t border-gray-200 dark:border-gray-700 pt-6 pb-8">
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
                        <label className="block text-[10px] text-gray-500 mb-1">Relevant Strings ({aiSettings.relevantStringsCount})</label>
                        <input 
                          type="range" min="0" max="100" step="5"
                          value={aiSettings.relevantStringsCount}
                          onChange={(e) => setAiSettings({...aiSettings, relevantStringsCount: parseInt(e.target.value)})}
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
              if (!showSidebar) refreshLocalGames();
              setShowSidebar(!showSidebar);
            }} className="p-2 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-lg text-gray-700 dark:text-gray-300 shrink-0">
              <Folder className="w-6 h-6" />
            </button>
            <h1 className="text-xl sm:text-2xl font-bold text-gray-900 dark:text-white truncate">
              {gameName ? gameName : 'Interactive Fiction Player'}
            </h1>
          </div>
          <div className="flex items-center gap-2 w-full sm:w-auto overflow-x-auto pb-1 sm:pb-0 no-scrollbar shrink-0">
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
                  const relevant = findRelevantStrings(gameStrings, currentOutput);
                  console.log(`Top ${aiSettings.relevantStringsCount} relevant strings:`, relevant.slice(0, aiSettings.relevantStringsCount));
                  getSuggestions('command', '', history, currentOutput, gameName, getGameType(), relevant, selectedModel, aiSettings);
                }
              }}
              className={`flex items-center gap-2 px-3 sm:px-4 py-2 rounded-lg transition-colors shadow-sm shrink-0 ${autoSuggest ? 'bg-emerald-600 text-white hover:bg-emerald-700' : 'bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700'}`}
              title="Toggle Auto-Suggest"
            >
              {autoSuggest ? <ToggleRight className="w-5 h-5" /> : <ToggleLeft className="w-5 h-5" />}
              <span className="hidden sm:inline">Auto</span>
            </button>
            <button 
              onClick={handleSuggest}
              disabled={aiLoading || !gameData || (aiMode === 'hint' && !hintQuestion.trim())}
              className="flex items-center gap-2 bg-indigo-600 text-white px-3 sm:px-4 py-2 rounded-lg hover:bg-indigo-700 disabled:opacity-50 shadow-sm shrink-0"
            >
              {aiLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
              <span className="hidden sm:inline">{aiMode === 'command' ? 'Suggest' : 'Ask'}</span>
            </button>
          </div>
        </div>
        
        {/* AI Mode Toggle & Hint Input */}
        {gameData && (
          <div className="mb-4 flex flex-col sm:flex-row gap-3 items-center bg-white dark:bg-gray-800 p-3 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm">
            <div className="flex bg-gray-100 dark:bg-gray-900 p-1 rounded-lg shrink-0">
              <button
                onClick={() => setAiMode('command')}
                className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${aiMode === 'command' ? 'bg-white dark:bg-gray-700 text-indigo-600 dark:text-indigo-400 shadow-sm' : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'}`}
              >
                Command Mode
              </button>
              <button
                onClick={() => setAiMode('hint')}
                className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${aiMode === 'hint' ? 'bg-white dark:bg-gray-700 text-indigo-600 dark:text-indigo-400 shadow-sm' : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'}`}
              >
                Hint Mode
              </button>
            </div>
            {aiMode === 'hint' && (
              <input
                type="text"
                placeholder="Ask a question about the game..."
                value={hintQuestion}
                onChange={(e) => setHintQuestion(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && hintQuestion.trim()) {
                    handleSuggest();
                  }
                }}
                className="flex-1 w-full bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-900 dark:text-gray-100 outline-none focus:ring-2 focus:ring-indigo-500"
              />
            )}
          </div>
        )}

        <div className="flex-1 border border-gray-300 dark:border-gray-700 rounded-xl p-4 overflow-y-auto font-mono whitespace-pre-wrap bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 shadow-sm flex flex-col min-h-0 relative">
          {!gameData ? (
            <div className="flex-1 flex flex-col items-center justify-center text-gray-500 dark:text-gray-400">
              <Folder className="w-12 h-12 mb-4 text-gray-300 dark:text-gray-600" />
              <p>Open the library to load a game.</p>
            </div>
          ) : (
            <>
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

        {(autoSuggest || aiLoading || suggestions.length > 0 || hintAnswer || aiError) && (
          <div className="mt-3 flex gap-2 overflow-x-auto pb-2 no-scrollbar shrink-0 min-h-[48px] items-center relative z-10">
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
                <div className="font-bold mb-1 flex items-center gap-2"><Sparkles className="w-4 h-4"/> Hint</div>
                <div className="whitespace-pre-wrap">{hintAnswer}</div>
              </div>
            ) : (
              <>
                {suggestions.map((sug, i) => (
                  <button
                    key={i}
                    onClick={() => submitCommand(sug)}
                    className="bg-white dark:bg-gray-800 border border-indigo-200 dark:border-indigo-700 text-indigo-700 dark:text-indigo-300 px-4 py-2 rounded-full text-sm hover:bg-indigo-50 dark:hover:bg-gray-700 transition-colors shadow-sm whitespace-nowrap shrink-0 active:scale-95 touch-manipulation"
                  >
                    {sug}
                  </button>
                ))}
                {aiLoading && (
                  <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400 italic px-2 shrink-0">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Generating suggestions...
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {gameData && inputs.length > 0 && inputs[0].type === 'line' && !isReplaying && (
          <div className="flex items-center mt-2 mb-4 p-3 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-xl shadow-sm shrink-0">
            <span className="mr-2 text-blue-600 dark:text-blue-400 font-bold text-lg">&gt;</span>
            <input
              type="text"
              name="if-command-input"
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="none"
              spellCheck="false"
              data-1p-ignore="true"
              data-lpignore="true"
              className="flex-1 outline-none bg-transparent font-mono text-gray-900 dark:text-gray-100 text-lg w-full"
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={handleInput}
              onFocus={() => {
                setTimeout(() => {
                  bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
                }, 300);
              }}
              autoFocus
              placeholder="Enter command..."
            />
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
      </div>
      {/* File Prompt Modal */}
      {filePrompt && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-gray-800 p-6 rounded-xl shadow-xl max-w-md w-full mx-4">
            <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-4">
              {filePrompt.filetype === 'save' ? 'Save Game' : 'Enter filename'}
            </h3>
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
                  submitFilePrompt(filePromptInput);
                  setFilePromptInput('');
                } else if (e.key === 'Escape') {
                  submitFilePrompt(null);
                  setFilePromptInput('');
                }
              }}
              autoFocus
            />
            <div className="flex justify-end gap-2">
              <button
                onClick={() => {
                  submitFilePrompt(null);
                  setFilePromptInput('');
                }}
                className="px-4 py-2 text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  submitFilePrompt(filePromptInput);
                  setFilePromptInput('');
                }}
                className="px-4 py-2 bg-indigo-600 text-white hover:bg-indigo-700 rounded-lg"
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}



