import localforage from 'localforage';

// Store uploaded files temporarily in memory for reading
export const pendingReads: Record<string, Uint8Array> = {};

export class MyDialog {
  async: boolean = true;
  gameData: Uint8Array | null;
  gameName: string;
  directoryHandle: any | null = null;
  
  constructor(gameName: string, gameData: Uint8Array | null, directoryHandle: any | null = null) {
    this.gameName = gameName;
    this.gameData = gameData;
    this.directoryHandle = directoryHandle;
  }
  
  async read(path: string) {
    const cleanPath = (p: string) => p.replace(/\\/g, '/').split('/').pop() || p;
    const target = cleanPath(path).toLowerCase();

    if (target === cleanPath(this.gameName).toLowerCase()) return this.gameData;
    
    // Check pending reads first (from file uploads)
    for (const [key, data] of Object.entries(pendingReads)) {
      const keyName = cleanPath(key).toLowerCase();
      const targetBase = target.replace(/\.[^/.]+$/, "");
      const keyBase = keyName.replace(/\.[^/.]+$/, "");
      
      if (target === keyName || targetBase === keyBase) {
        delete pendingReads[key]; // Clean up after reading
        return data;
      }
    }

    // Try reading from directory handle if available
    if (this.directoryHandle) {
      try {
        const fileHandle = await this.directoryHandle.getFileHandle(path);
        const file = await fileHandle.getFile();
        const buffer = await file.arrayBuffer();
        return new Uint8Array(buffer);
      } catch (e) {
        // Fall through to other methods
      }
    }

    // Fallback to localforage
    try {
      const data = await localforage.getItem<any>(path);
      if (data instanceof Uint8Array) {
        return data;
      }
      const cleanData = await localforage.getItem<any>(target);
      if (cleanData instanceof Uint8Array) {
        return cleanData;
      }
      return null;
    } catch (e) {
      return null;
    }
  }
  
  async write(files: Record<string, Uint8Array>) {
    console.log('MyDialog.write called with files:', Object.keys(files));
    try {
      for (const [path, data] of Object.entries(files)) {
        let writtenToDisk = false;
        
        // Clean the path to just the filename for the directory handle
        const filename = path.replace(/\\/g, '/').split('/').pop() || path;

        // Try writing to directory handle if available
        if (this.directoryHandle) {
          console.log(`Attempting to save ${filename} to directory handle: ${this.directoryHandle.name}`);
          try {
            // Check if we have permission and if createWritable is supported
            const permission = await this.directoryHandle.queryPermission({ mode: 'readwrite' });
            console.log(`Directory permission for ${this.directoryHandle.name}: ${permission}`);
            
            if (permission === 'granted') {
              const fileHandle = await this.directoryHandle.getFileHandle(filename, { create: true });
              console.log(`Got file handle for ${filename}`);
              
              if (typeof fileHandle.createWritable === 'function') {
                const writable = await fileHandle.createWritable();
                await writable.write(data);
                await writable.close();
                writtenToDisk = true;
                console.log(`Successfully saved ${filename} to local directory: ${this.directoryHandle.name}`);
              } else {
                console.warn(`createWritable not supported on file handle for ${filename}. Falling back to download.`);
              }
            } else {
              console.warn(`Permission not granted for directory ${this.directoryHandle.name}. Status: ${permission}. Falling back to download.`);
            }
          } catch (e) {
            console.warn(`Failed to save ${filename} to local directory, falling back to download.`, e);
          }
        } else {
          console.log('No directory handle available in MyDialog. Falling back to download.');
        }

        if (!writtenToDisk) {
          console.log(`Triggering browser download for ${filename} as fallback.`);
          // Trigger a download for the file as fallback
          const blob = new Blob([data], { type: 'application/octet-stream' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = filename;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          URL.revokeObjectURL(url);
        }
        
        // Also store in localforage for internal persistence
        await localforage.setItem(path, data);
        await localforage.setItem(filename, data); // Store both for easier lookup
      }
    } catch (e) {
      console.error('Failed to write files', e);
    }
  }
  
  async exists(path: string) {
    const cleanPath = (p: string) => p.replace(/\\/g, '/').split('/').pop() || p;
    const target = cleanPath(path).toLowerCase();

    if (target === cleanPath(this.gameName).toLowerCase()) return true;
    
    for (const key of Object.keys(pendingReads)) {
      const keyName = cleanPath(key).toLowerCase();
      const targetBase = target.replace(/\.[^/.]+$/, "");
      const keyBase = keyName.replace(/\.[^/.]+$/, "");
      if (target === keyName || targetBase === keyBase) return true;
    }

    if (this.directoryHandle) {
      try {
        await this.directoryHandle.getFileHandle(path);
        return true;
      } catch (e) {}
    }
    
    try {
      const data = await localforage.getItem<any>(path);
      if (data instanceof Uint8Array) return true;
      const cleanData = await localforage.getItem<any>(target);
      return cleanData instanceof Uint8Array;
    } catch (e) {
      return false;
    }
  }
  
  async delete(path: string) {
    try {
      await localforage.removeItem(path);
    } catch (e) {}
  }
  
  get_dirs() { return { storyfile: '/', working: '/', system_cwd: '/', temp: '/' }; }
  set_storyfile_dir(path: string) { return { storyfile: '/', working: '/', system_cwd: '/', temp: '/' }; }
}
