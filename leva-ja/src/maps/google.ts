/**
 * Carregamento da Google Maps JavaScript API (chave de NAVEGADOR).
 * A chave de navegador deve ser restringida no Google Cloud por:
 *   - referenciadores HTTP (seu domínio HTTPS + localhost de desenvolvimento)
 *   - APIs: Maps JavaScript API, Places API (New), Geocoding API
 * A chave de SERVIDOR (Routes API) fica só na Edge Function.
 */
let loading: Promise<typeof google> | null = null;

export const GOOGLE_BROWSER_KEY = (import.meta.env.VITE_GOOGLE_MAPS_BROWSER_KEY as string | undefined) || '';
export const GOOGLE_MAP_ID = (import.meta.env.VITE_GOOGLE_MAPS_MAP_ID as string | undefined) || '';
export const hasGoogleMaps = () => !!GOOGLE_BROWSER_KEY;

export function loadGoogleMaps(): Promise<typeof google> {
  if (!GOOGLE_BROWSER_KEY) return Promise.reject(new Error('GOOGLE_MAPS_NOT_CONFIGURED'));
  if (loading) return loading;
  loading = new Promise((resolve, reject) => {
    const w = window as unknown as { __levajaGmapsReady?: () => void; gm_authFailure?: () => void };
    w.__levajaGmapsReady = () => resolve(google);
    // chamado pela API quando a chave é inválida/restrita para este domínio
    w.gm_authFailure = () => {
      loading = null;
      reject(new Error('GOOGLE_MAPS_AUTH_FAILURE'));
      window.dispatchEvent(new CustomEvent('levaja:maps-auth-failure'));
    };
    const s = document.createElement('script');
    const params = new URLSearchParams({ key: GOOGLE_BROWSER_KEY, v: 'weekly', libraries: 'places,geometry,marker', language: 'pt-BR', region: 'BR', loading: 'async', callback: '__levajaGmapsReady' });
    s.src = `https://maps.googleapis.com/maps/api/js?${params}`;
    s.async = true;
    s.onerror = () => {
      loading = null;
      reject(new Error('GOOGLE_MAPS_LOAD_ERROR'));
    };
    document.head.appendChild(s);
  });
  return loading;
}
