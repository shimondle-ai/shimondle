export type Role = "user" | "assistant";

export interface Message {
  id: string;
  role: Role;
  content: string;
  ts: number;
  model?: string;
  thinking?: string;
  error?: string;
}

export interface Conversation {
  id: string;
  title: string;
  messages: Message[];
  model?: string;
  createdAt: number;
  updatedAt: number;
}

export interface Settings {
  baseUrl: string;
  system: string;
  temperature: number;
  numCtx: number;
  theme: "dark" | "light";
  model: string;
  thinking: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  baseUrl: "http://127.0.0.1:11434",
  system: "You are Shimondle, a thoughtful assistant running entirely on the user's own machine. Be direct, useful and warm. Prefer short paragraphs and concrete answers.",
  temperature: 0.7,
  numCtx: 4096,
  theme: "dark",
  model: "",
  thinking: true,
};

const CONVOS_KEY = "shimondle.convos.v1";
const SETTINGS_KEY = "shimondle.settings.v1";

export const uid = () =>
  Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

export function loadConversations(): Conversation[] {
  try {
    const raw = localStorage.getItem(CONVOS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveConversations(list: Conversation[]) {
  try { localStorage.setItem(CONVOS_KEY, JSON.stringify(list.slice(0, 200))); } catch { /* ignore */ }
}

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(s: Settings) {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); } catch { /* ignore */ }
}
