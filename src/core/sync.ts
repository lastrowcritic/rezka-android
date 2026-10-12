// Syncs viewing history through a server the user hosts. Sync stays off until its address is set in Settings.
import { Capacitor, registerPlugin } from '@capacitor/core';
import type { WatchRecord } from './types';
import { episodeKey, normalizeRecord } from './store';

/** server is the address the session belongs to, so a session is never sent to another server. */
export interface SyncSession { token: string; email: string; expiresAt: number; server: string }
const SyncStore = registerPlugin<{
  session(): Promise<{ session: SyncSession | null }>;
  saveSession(session: SyncSession): Promise<void>;
  clearSession(): Promise<void>;
}>('RezkaSync');
// The browser preview has no secure storage, so it keeps the session for the current page only.
let previewSession: SyncSession | null = null;

/** Returns the server's base address, or '' when sync is off. */
export function normalizeSyncServer(value: string) {
  const text = value.trim();
  if (!text) return '';
  let url: URL;
  try { url = new URL(/^[a-z][a-z\d+.-]*:\/\//i.test(text) ? text : `https://${text}`); } catch { throw new Error('Enter your sync server address, for example https://sync.example.com.'); }
  if (url.protocol !== 'https:') throw new Error('The sync server address must start with https://.');
  if (url.username || url.password || url.search || url.hash) throw new Error('Enter only the sync server address, without a query or sign-in details.');
  return `${url.origin}${url.pathname.replace(/\/+$/, '')}`;
}

/** The saved session for this server. A session for another server is ignored. */
export async function storedSession(server: string) {
  const session = Capacitor.isNativePlatform() ? (await SyncStore.session()).session : previewSession;
  return session?.server === server ? session : null;
}

export async function saveSession(session: SyncSession) {
  if (Capacitor.isNativePlatform()) await SyncStore.saveSession(session); else previewSession = session;
}

export async function clearSession() {
  if (Capacitor.isNativePlatform()) await SyncStore.clearSession(); else previewSession = null;
}

async function request<T>(server: string, path: string, method: string, data?: unknown, token?: string): Promise<T> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (token) headers.authorization = `Bearer ${token}`;
  let response: Response;
  try { response = await fetch(`${server}${path}`, { method, headers, body: data === undefined ? undefined : JSON.stringify(data) }); }
  catch { throw new Error('The sync server could not be reached.'); }
  let body: any;
  try { body = await response.json(); } catch { body = {}; }
  if (!response.ok) throw new Error(typeof body.error === 'string' ? body.error : 'The sync server is temporarily unavailable.');
  return body as T;
}

export async function authenticate(server: string, mode: 'login' | 'register', email: string, password: string): Promise<SyncSession> {
  const reply = await request<{ token: string; expiresAt: number; user: { email: string } }>(server, `/v1/auth/${mode}`, 'POST', { email, password });
  return { token: reply.token, email: reply.user.email, expiresAt: reply.expiresAt, server };
}

export async function signOut(session: SyncSession) {
  try { await request(session.server, '/v1/auth/logout', 'POST', {}, session.token); } finally { await clearSession(); }
}

export interface HistorySnapshot { records: WatchRecord[]; clearedAt: number }
export function mergeHistory(local: WatchRecord[], remote: WatchRecord[], clearedAt: number) {
  const merged = new Map<string, WatchRecord>();
  for (const raw of [...remote, ...local]) {
    const record = normalizeRecord(raw);
    if (!record || record.updatedAt <= clearedAt) continue;
    const key = episodeKey(record.item, record);
    const previous = merged.get(key);
    if (!previous || previous.updatedAt < record.updatedAt) merged.set(key, record);
  }
  return [...merged.values()].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 500);
}

export const pullHistory = (session: SyncSession) => request<HistorySnapshot>(session.server, '/v1/history', 'GET', undefined, session.token);
export const pushHistory = (session: SyncSession, records: WatchRecord[]) => request<HistorySnapshot>(session.server, '/v1/history', 'PUT', { records }, session.token);
export const deleteHistory = (session: SyncSession) => request<HistorySnapshot>(session.server, '/v1/history', 'DELETE', undefined, session.token);
