import localforage from 'localforage';

// Store uploaded files temporarily in memory for reading
export const pendingReads: Record<string, Uint8Array> = {};

export class MyDialog {
  async: boolean = true;
  gameData: Uint8Array | null;
  gameName: string;
  
  constructor(gameName: string, gameData: Uint8Array | null) {
    this.gameName = gameName;
    this.gameData = gameData;
  }
  
  async read(path: string) {
    const cleanPath = (p: string) => p.replace(/\\/g, '/').split('/').pop() || p;
    const target = cleanPath(path).toLowerCase();

    if (target === cleanPath(this.gameName).toLowerCase()) return this.gameData;
    
    // Check pending reads first (from file uploads)
    for (const [key, data] of Object.entries(pendingReads)) {
      const keyName = cleanPath(key).toLowerCase();
      // Match if target is keyName, or if one is a prefix of the other (ignoring extension)
      const targetBase = target.replace(/\.[^/.]+$/, "");
      const keyBase = keyName.replace(/\.[^/.]+$/, "");
      
      if (target === keyName || targetBase === keyBase) {
        delete pendingReads[key]; // Clean up after reading
        return data;
      }
    }

    // Fallback to localforage (for older saves if they still exist)
    try {
      const data = await localforage.getItem<any>(path);
      if (data instanceof Uint8Array) {
        return data;
      }
      // Try cleaning the path for localforage too
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
    try {
      for (const [path, data] of Object.entries(files)) {
        // Trigger a download for the file
        const blob = new Blob([data], { type: 'application/octet-stream' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = path;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        
        // Also store in localforage for internal persistence
        await localforage.setItem(path, data);
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
