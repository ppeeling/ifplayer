import { useState, useCallback, useEffect } from 'react';
import { useGoogleLogin } from '@react-oauth/google';

const FOLDER_NAME = 'IF Games';
const TOKEN_STORAGE_KEY = 'google_drive_access_token';
const TOKEN_EXPIRY_KEY = 'google_drive_token_expiry';

export function useGoogleDrive() {
  const [accessToken, setAccessToken] = useState<string | null>(() => {
    const storedToken = localStorage.getItem(TOKEN_STORAGE_KEY);
    const storedExpiry = localStorage.getItem(TOKEN_EXPIRY_KEY);
    if (storedToken && storedExpiry) {
      if (Date.now() < parseInt(storedExpiry, 10)) {
        return storedToken;
      } else {
        localStorage.removeItem(TOKEN_STORAGE_KEY);
        localStorage.removeItem(TOKEN_EXPIRY_KEY);
      }
    }
    return null;
  });
  const [loading, setLoading] = useState(false);

  const login = useGoogleLogin({
    onSuccess: (tokenResponse) => {
      setAccessToken(tokenResponse.access_token);
      localStorage.setItem(TOKEN_STORAGE_KEY, tokenResponse.access_token);
      const expiresIn = tokenResponse.expires_in || 3600;
      localStorage.setItem(TOKEN_EXPIRY_KEY, (Date.now() + expiresIn * 1000).toString());
    },
    scope: 'https://www.googleapis.com/auth/drive.file',
  });

  const logout = useCallback(() => {
    setAccessToken(null);
    localStorage.removeItem(TOKEN_STORAGE_KEY);
    localStorage.removeItem(TOKEN_EXPIRY_KEY);
  }, []);

  const fetchWithAuth = useCallback(async (url: string, options: RequestInit = {}) => {
    if (!accessToken) throw new Error('No access token');
    const res = await fetch(url, {
      ...options,
      headers: {
        ...options.headers,
        Authorization: `Bearer ${accessToken}`
      }
    });
    if (!res.ok) {
      if (res.status === 401) {
        logout();
        throw new Error('Unauthorized');
      }
      const errText = await res.text();
      console.error('Drive API Error:', res.status, errText, 'URL:', url);
      
      try {
        const errJson = JSON.parse(errText);
        if (res.status === 403 && errJson.error?.message?.includes('has not been used in project')) {
          alert('Google Drive API is not enabled for your Google Cloud Project. Please enable it in the Google Cloud Console (search for "Google Drive API") and try again.');
        }
      } catch (e) {
        // Ignore JSON parse error
      }
      
      throw new Error(`Drive API Error: ${res.status} ${errText}`);
    }
    return res;
  }, [accessToken, logout]);

  const getFolderId = useCallback(async () => {
    if (!accessToken) return null;
    const q = encodeURIComponent(`name='${FOLDER_NAME}' and mimeType='application/vnd.google-apps.folder' and trashed=false`);
    const res = await fetchWithAuth(`https://www.googleapis.com/drive/v3/files?q=${q}`);
    const data = await res.json();
    if (data.files && data.files.length > 0) {
      return data.files[0].id;
    }
    // Create folder
    const createRes = await fetchWithAuth('https://www.googleapis.com/drive/v3/files', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        name: FOLDER_NAME,
        mimeType: 'application/vnd.google-apps.folder'
      })
    });
    const createData = await createRes.json();
    return createData.id;
  }, [accessToken, fetchWithAuth]);

  const listFiles = useCallback(async () => {
    if (!accessToken) return [];
    setLoading(true);
    try {
      const folderId = await getFolderId();
      if (!folderId) return [];
      const q = encodeURIComponent(`'${folderId}' in parents and trashed=false`);
      const res = await fetchWithAuth(`https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name,modifiedTime)`);
      const data = await res.json();
      return data.files || [];
    } catch (e) {
      console.error(e);
      return [];
    } finally {
      setLoading(false);
    }
  }, [accessToken, getFolderId, fetchWithAuth]);

  const downloadFile = useCallback(async (fileId: string) => {
    if (!accessToken) return null;
    try {
      const res = await fetchWithAuth(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`);
      const buffer = await res.arrayBuffer();
      return new Uint8Array(buffer);
    } catch (e) {
      console.error(e);
      return null;
    }
  }, [accessToken, fetchWithAuth]);

  const uploadFile = useCallback(async (name: string, data: Uint8Array) => {
    if (!accessToken) return;
    try {
      const folderId = await getFolderId();
      if (!folderId) return;
      
      // Check if file exists
      const safeName = name.replace(/'/g, "\\'");
      const q = encodeURIComponent(`name='${safeName}' and '${folderId}' in parents and trashed=false`);
      const searchRes = await fetchWithAuth(`https://www.googleapis.com/drive/v3/files?q=${q}`);
      const searchData = await searchRes.json();
      
      const metadata = {
        name,
        parents: [folderId]
      };

      const boundary = '-------314159265358979323846';
      const delimiter = `\r\n--${boundary}\r\n`;
      const close_delim = `\r\n--${boundary}--`;

      let url = 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart';
      let method = 'POST';

      if (searchData.files && searchData.files.length > 0) {
        url = `https://www.googleapis.com/upload/drive/v3/files/${searchData.files[0].id}?uploadType=multipart`;
        method = 'PATCH';
        delete (metadata as any).parents;
      }

      const multipartRequestBody =
        `--${boundary}\r\n` +
        'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
        JSON.stringify(metadata) +
        delimiter +
        'Content-Type: application/octet-stream\r\n\r\n';

      const multipartRequestBodyEnd = close_delim;

      const blob = new Blob([
        multipartRequestBody,
        data,
        multipartRequestBodyEnd
      ], { type: `multipart/related; boundary=${boundary}` });

      await fetchWithAuth(url, {
        method,
        body: blob
      });
    } catch (e) {
      console.error(e);
    }
  }, [accessToken, getFolderId, fetchWithAuth]);

  const deleteFile = useCallback(async (fileId: string) => {
    if (!accessToken) return;
    try {
      await fetchWithAuth(`https://www.googleapis.com/drive/v3/files/${fileId}`, {
        method: 'DELETE'
      });
    } catch (e) {
      console.error(e);
    }
  }, [accessToken, fetchWithAuth]);

  return { login, logout, accessToken, listFiles, downloadFile, uploadFile, deleteFile, loading };
}
