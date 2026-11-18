import type { LatLng } from '../core/geo';

/**
 * Navegação externa por links oficiais (abre o app instalado ou o site).
 * Waze: https://developers.google.com/waze/deeplinks — https://waze.com/ul?ll=LAT,LNG&navigate=yes
 * Google Maps: https://developers.google.com/maps/documentation/urls — /maps/dir/?api=1&destination=LAT,LNG
 * O estado da corrida fica no servidor; ao voltar ao Leva Já, a tela recarrega e continua de onde parou.
 */
export function wazeUrl(p: LatLng): string {
  return `https://waze.com/ul?ll=${p.lat.toFixed(6)},${p.lng.toFixed(6)}&navigate=yes`;
}

export function googleMapsNavUrl(p: LatLng, origin?: LatLng): string {
  const u = new URLSearchParams({ api: '1', destination: `${p.lat.toFixed(6)},${p.lng.toFixed(6)}`, travelmode: 'driving', dir_action: 'navigate' });
  if (origin) u.set('origin', `${origin.lat.toFixed(6)},${origin.lng.toFixed(6)}`);
  return `https://www.google.com/maps/dir/?${u}`;
}
