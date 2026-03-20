import localforage from 'localforage';

export class MyDialog {
  async: boolean = true;
  gameData: Uint8Array | null;
  gameName: string;
  
  constructor(gameName: string, gameData: Uint8Array | null) {
    this.gameName = gameName;
    this.gameData = gameData;
  }
  
  async read(path: string) {
    if (path === this.gameName || path.endsWith('/' + this.gameName)) return this.gameData;
    // Try to read from localforage (for save files)
    try {
      const data = await localforage.getItem<Uint8Array>(path);
      return data;
    } catch (e) {
      return null;
    }
  }
  
  async write(files: Record<string, Uint8Array>) {
    try {
      for (const [path, data] of Object.entries(files)) {
        await localforage.setItem(path, data);
      }
    } catch (e) {
      console.error('Failed to write files', e);
    }
  }
  
  async exists(path: string) {
    if (path === this.gameName || path.endsWith('/' + this.gameName)) return true;
    try {
      const data = await localforage.getItem(path);
      return data !== null;
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
