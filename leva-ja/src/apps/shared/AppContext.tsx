import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { createBackend } from '../../data';
import type { Access, AppKind, Backend, PublicSettings, Session } from '../../data/types';
import { type ThemePref, useTheme } from '../../ui/components';

interface Ctx {
  app: AppKind;
  backend: Backend;
  session: Session | null;
  access: Access | null;
  settings: PublicSettings | null;
  loading: boolean;
  online: boolean;
  refreshAccess: () => Promise<void>;
  refreshSettings: () => Promise<void>;
  theme: { pref: ThemePref; setPref: (p: ThemePref) => void; dark: boolean };
}

const AppCtx = createContext<Ctx | null>(null);
export function useApp() {
  const c = useContext(AppCtx);
  if (!c) throw new Error('useApp fora do provider');
  return c;
}

export function AppProvider({ app, children }: { app: AppKind; children: ReactNode }) {
  const backend = useMemo(() => createBackend(app), [app]);
  const [session, setSession] = useState<Session | null>(null);
  const [access, setAccess] = useState<Access | null>(null);
  const [settings, setSettings] = useState<PublicSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [online, setOnline] = useState(navigator.onLine);
  const { pref, setPref } = useTheme(`levaja-theme-${app}`);
  const [dark, setDark] = useState(document.documentElement.classList.contains('dark'));

  useEffect(() => {
    const obs = new MutationObserver(() => setDark(document.documentElement.classList.contains('dark')));
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => obs.disconnect();
  }, []);

  const refreshAccess = useCallback(async () => {
    const s = await backend.getSession();
    setSession(s);
    setAccess(s ? await backend.getAccess().catch(() => null) : null);
  }, [backend]);
  const refreshSettings = useCallback(async () => {
    setSettings(await backend.getPublicSettings().catch(() => null));
  }, [backend]);

  useEffect(() => {
    let alive = true;
    (async () => {
      await refreshAccess().catch(() => undefined);
      if (alive) setLoading(false);
    })();
    const unsub = backend.onAuthChange(() => void refreshAccess());
    const unsubConn = backend.onConnectionChange(setOnline);
    return () => {
      alive = false;
      unsub();
      unsubConn();
    };
  }, [backend, refreshAccess]);

  useEffect(() => {
    if (session) void refreshSettings();
  }, [session, refreshSettings]);

  return (
    <AppCtx.Provider value={{ app, backend, session, access, settings, loading, online, refreshAccess, refreshSettings, theme: { pref, setPref, dark } }}>{children}</AppCtx.Provider>
  );
}
