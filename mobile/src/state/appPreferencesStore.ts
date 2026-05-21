import * as SecureStore from "expo-secure-store";
import { create } from "zustand";

export type AppLanguage = "en" | "es" | "fr" | "ht";
export type AppMode = "home" | "learn" | "tools" | "pro";
export type EnabledModes = Record<AppMode, boolean>;

const STORAGE_KEY = "oxs:mobile-preferences";

const defaultModes: EnabledModes = {
  home: true,
  learn: true,
  tools: true,
  pro: true
};

type PersistedPreferences = {
  language?: AppLanguage;
  enabledModes?: Partial<EnabledModes>;
};

type AppPreferencesState = {
  isHydrating: boolean;
  language: AppLanguage;
  enabledModes: EnabledModes;
  hydrate: () => Promise<void>;
  setLanguage: (language: AppLanguage) => Promise<void>;
  toggleMode: (mode: AppMode) => Promise<boolean>;
};

async function savePreferences(state: Pick<AppPreferencesState, "language" | "enabledModes">) {
  await SecureStore.setItemAsync(
    STORAGE_KEY,
    JSON.stringify({
      language: state.language,
      enabledModes: state.enabledModes
    })
  );
}

export const useAppPreferencesStore = create<AppPreferencesState>((set, get) => ({
  isHydrating: true,
  language: "en",
  enabledModes: defaultModes,

  async hydrate() {
    try {
      const raw = await SecureStore.getItemAsync(STORAGE_KEY);
      if (!raw) {
        set({ isHydrating: false });
        return;
      }

      const parsed = JSON.parse(raw) as PersistedPreferences;
      set({
        language: parsed.language ?? "en",
        enabledModes: {
          ...defaultModes,
          ...parsed.enabledModes
        },
        isHydrating: false
      });
    } catch {
      set({ isHydrating: false });
    }
  },

  async setLanguage(language) {
    set({ language });
    await savePreferences(get());
  },

  async toggleMode(mode) {
    const current = get().enabledModes;
    const enabledCount = Object.values(current).filter(Boolean).length;
    const nextValue = !current[mode];

    if (!nextValue && enabledCount === 1) {
      return false;
    }

    set({
      enabledModes: {
        ...current,
        [mode]: nextValue
      }
    });
    await savePreferences(get());
    return true;
  }
}));
