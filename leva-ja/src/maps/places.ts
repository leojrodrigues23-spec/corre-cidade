import { haversineM, type LatLng } from '../core/geo';
import { DEMO_PLACES } from '../data/demoBackend';
import type { Place } from '../data/types';
import { hasGoogleMaps, loadGoogleMaps } from './google';

export interface Suggestion {
  id: string;
  primary: string;
  secondary: string;
  source: 'google' | 'simulado';
  /** só para sugestões simuladas */
  place?: Place;
  prediction?: google.maps.places.PlacePrediction;
}

let sessionToken: google.maps.places.AutocompleteSessionToken | null = null;

/**
 * Autocomplete de endereços. Com chave Google: Places API (New) com token de sessão
 * (agrupa digitação + seleção em uma única cobrança). Sem chave: locais FICTÍCIOS de teste.
 */
export async function searchPlaces(query: string, bias: LatLng): Promise<Suggestion[]> {
  const q = query.trim();
  if (q.length < 3) return [];
  if (!hasGoogleMaps()) {
    // tudo é fictício no modo simulado: filtra pelo texto e, se nada casar, oferece todos os pontos de teste
    const matches = DEMO_PLACES.filter((p) => p.label.toLowerCase().includes(q.toLowerCase()));
    return (matches.length ? matches : DEMO_PLACES).map((p, i) => {
      const place: Place = { lat: bias.lat + p.dlat, lng: bias.lng + p.dlng, label: p.label, address: `${p.label}, Área de teste`, source: 'simulado' };
      return { id: `demo-${i}`, primary: p.label, secondary: 'Local fictício — mapa simulado', source: 'simulado' as const, place };
    });
  }
  const g = await loadGoogleMaps();
  const { AutocompleteSuggestion, AutocompleteSessionToken } = (await g.maps.importLibrary('places')) as google.maps.PlacesLibrary;
  sessionToken ??= new AutocompleteSessionToken();
  const { suggestions } = await AutocompleteSuggestion.fetchAutocompleteSuggestions({
    input: q,
    sessionToken,
    locationBias: { center: bias, radius: 30000 },
    includedRegionCodes: ['br'],
    language: 'pt-BR',
    region: 'br',
  });
  return suggestions
    .filter((s) => s.placePrediction)
    .map((s) => {
      const p = s.placePrediction!;
      return { id: p.placeId, primary: p.mainText?.text ?? p.text.text, secondary: p.secondaryText?.text ?? '', source: 'google' as const, prediction: p };
    });
}

export async function resolveSuggestion(s: Suggestion): Promise<Place> {
  if (s.place) return s.place;
  const place = s.prediction!.toPlace();
  await place.fetchFields({ fields: ['location', 'formattedAddress', 'displayName'] });
  sessionToken = null; // encerra a sessão de autocomplete (faturamento por sessão)
  const loc = place.location;
  if (!loc) throw new Error('Endereço sem coordenadas');
  return { lat: loc.lat(), lng: loc.lng(), label: place.displayName ?? s.primary, address: place.formattedAddress ?? `${s.primary}, ${s.secondary}`, source: 'google', placeId: place.id };
}

/** Geocodificação reversa do pino de embarque. Sem chave Google, descreve o ponto sem inventar endereço. */
export async function reverseGeocode(p: LatLng): Promise<{ address: string; ambiguous: boolean }> {
  if (!hasGoogleMaps()) return { address: `Ponto no mapa simulado (${p.lat.toFixed(5)} / ${p.lng.toFixed(5)})`, ambiguous: true };
  const g = await loadGoogleMaps();
  const geocoder = new g.maps.Geocoder();
  const { results } = await geocoder.geocode({ location: p, language: 'pt-BR', region: 'BR' });
  const best = results.find((r) => r.types.includes('street_address') || r.types.includes('premise')) ?? results[0];
  if (!best) return { address: `Ponto no mapa (${p.lat.toFixed(5)} / ${p.lng.toFixed(5)})`, ambiguous: true };
  const loc = best.geometry.location;
  // endereço "aproximado" (rua/rota) ou distante do pino é sinalizado para o usuário confirmar
  const far = haversineM(p, { lat: loc.lat(), lng: loc.lng() }) > 40;
  const approx = best.geometry.location_type === 'APPROXIMATE' || best.geometry.location_type === 'GEOMETRIC_CENTER';
  return { address: best.formatted_address, ambiguous: far || approx };
}
