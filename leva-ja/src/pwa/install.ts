import { useEffect, useState } from 'react';

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

// Captura o evento o mais cedo possível (ele pode disparar antes do React montar).
let deferred: BeforeInstallPromptEvent | null = null;
const listeners = new Set<() => void>();
if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferred = e as BeforeInstallPromptEvent;
    listeners.forEach((l) => l());
  });
  window.addEventListener('appinstalled', () => {
    deferred = null;
    listeners.forEach((l) => l());
  });
}

export type Platform = 'ios' | 'android' | 'desktop';

export function detectPlatform(): Platform {
  const ua = navigator.userAgent;
  const iPadOS = navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;
  if (/iPhone|iPad|iPod/.test(ua) || iPadOS) return 'ios';
  if (/Android/.test(ua)) return 'android';
  return 'desktop';
}

/** Standalone = aberto como app instalado (Android/desktop via display-mode; iOS via navigator.standalone). */
export function isStandalone(): boolean {
  return window.matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

export function useInstallPrompt() {
  const [, force] = useState(0);
  useEffect(() => {
    const l = () => force((x) => x + 1);
    listeners.add(l);
    return () => void listeners.delete(l);
  }, []);
  return {
    /** true SOMENTE se o navegador disparou beforeinstallprompt (nunca prometemos instalação automática) */
    canPrompt: !!deferred,
    standalone: isStandalone(),
    platform: detectPlatform(),
    async prompt() {
      if (!deferred) return 'unavailable' as const;
      await deferred.prompt();
      const { outcome } = await deferred.userChoice;
      deferred = null;
      listeners.forEach((l) => l());
      return outcome;
    },
  };
}

/**
 * Service worker por perfil: /passageiro/sw.js (escopo /passageiro/) e /motorista/sw.js (escopo /motorista/).
 * Escopos distintos → caches e atualizações independentes, sem conflito entre os dois PWAs.
 */
export function registerServiceWorker(app: 'passageiro' | 'motorista', onUpdate: (apply: () => void) => void) {
  if (!('serviceWorker' in navigator) || import.meta.env.DEV) return;
  window.addEventListener('load', async () => {
    try {
      const reg = await navigator.serviceWorker.register(`/${app}/sw.js`, { scope: `/${app}/` });
      const offer = (w: ServiceWorker) =>
        onUpdate(() => {
          w.postMessage({ type: 'SKIP_WAITING' });
        });
      if (reg.waiting && navigator.serviceWorker.controller) offer(reg.waiting);
      reg.addEventListener('updatefound', () => {
        const w = reg.installing;
        w?.addEventListener('statechange', () => {
          if (w.state === 'installed' && navigator.serviceWorker.controller) offer(w);
        });
      });
      let reloaded = false;
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (!reloaded) {
          reloaded = true;
          window.location.reload();
        }
      });
      // verifica atualização ao voltar para o app
      document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && reg.update().catch(() => undefined));
    } catch (e) {
      console.warn('SW não registrado', e);
    }
  });
}

/** Notificação local (via SW quando disponível). Não é Web Push do servidor; ver docs/LIMITACOES.md. */
export async function localNotify(title: string, body?: string, tag?: string) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return false;
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    if (reg) await reg.showNotification(title, { body, tag, icon: './icons/icon-192.png', badge: './icons/icon-192.png' });
    else new Notification(title, { body, tag });
    return true;
  } catch {
    return false;
  }
}
