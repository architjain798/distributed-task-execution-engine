import { create } from 'zustand';
import { DEFAULT_API_KEY } from '../config/env';

const STORAGE_KEY = 'task-engine.api-key';

interface ApiKeyState {
  apiKey: string;
  setApiKey: (apiKey: string) => void;
}

/**
 * Which client we are acting as. Being able to switch this in the header is what
 * makes fair scheduling demonstrable: submit a flood as one client and watch
 * another client's tasks still start.
 */
export const useApiKeyStore = create<ApiKeyState>((set) => ({
  apiKey: readStoredKey(),
  setApiKey: (apiKey) => {
    set({ apiKey });
    writeStoredKey(apiKey);
  },
}));

function readStoredKey(): string {
  try {
    return localStorage.getItem(STORAGE_KEY) ?? DEFAULT_API_KEY;
  } catch {
    // Private browsing and blocked site data both throw here.
    return DEFAULT_API_KEY;
  }
}

function writeStoredKey(apiKey: string): void {
  try {
    localStorage.setItem(STORAGE_KEY, apiKey);
  } catch {
    // A remembered preference is not worth failing a click over.
  }
}
