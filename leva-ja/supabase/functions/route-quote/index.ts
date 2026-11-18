// Supabase Edge Function (Deno): cotação de corrida com rota REAL calculada no servidor.
// - Identifica o passageiro pelo JWT do usuário (não confia em nada enviado pelo cliente além de origem/destino).
// - Chama a Google Routes API com a chave de SERVIDOR (secret GOOGLE_ROUTES_SERVER_KEY, nunca exposta ao navegador).
// - Grava a cotação via RPC create_fare_snapshot (executável somente com service_role).
// Deploy: supabase functions deploy route-quote
//         supabase secrets set GOOGLE_ROUTES_SERVER_KEY=... ALLOWED_ORIGINS=https://seu-dominio
import { createClient } from 'npm:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const ROUTES_KEY = Deno.env.get('GOOGLE_ROUTES_SERVER_KEY') ?? '';
const ALLOWED = (Deno.env.get('ALLOWED_ORIGINS') ?? '').split(',').map((s) => s.trim()).filter(Boolean);

function cors(origin: string | null) {
  const allow = origin && (ALLOWED.length === 0 || ALLOWED.includes(origin)) ? origin : ALLOWED[0] ?? '';
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    Vary: 'Origin',
  };
}

function json(body: unknown, status: number, origin: string | null) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors(origin), 'Content-Type': 'application/json' } });
}

const isCoord = (v: unknown, max: number) => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= max;

Deno.serve(async (req) => {
  const origin = req.headers.get('Origin');
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors(origin) });
  if (req.method !== 'POST') return json({ error: 'METHOD_NOT_ALLOWED' }, 405, origin);
  if (ALLOWED.length && origin && !ALLOWED.includes(origin)) return json({ error: 'ORIGIN_NOT_ALLOWED' }, 403, origin);

  const auth = req.headers.get('Authorization') ?? '';
  const userClient = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: auth } } });
  const { data: userData, error: userErr } = await userClient.auth.getUser();
  if (userErr || !userData.user) return json({ error: 'AUTH_REQUIRED' }, 401, origin);
  const uid = userData.user.id;

  const { data: isPassenger } = await userClient.rpc('has_role', { p_role: 'passageiro', p_user: uid });
  if (!isPassenger) return json({ error: 'FORBIDDEN' }, 403, origin);

  let body: { origin?: { lat: number; lng: number }; destination?: { lat: number; lng: number } };
  try {
    body = await req.json();
  } catch {
    return json({ error: 'INVALID_JSON' }, 400, origin);
  }
  const o = body.origin, d = body.destination;
  if (!o || !d || !isCoord(o.lat, 90) || !isCoord(o.lng, 180) || !isCoord(d.lat, 90) || !isCoord(d.lng, 180)) {
    return json({ error: 'INVALID_COORDS' }, 400, origin);
  }

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

  // Limite simples de abuso: 60 cotações/hora por usuário (cada cotação custa uma chamada paga à Routes API)
  const since = new Date(Date.now() - 3600_000).toISOString();
  const { count } = await admin.from('fare_snapshots').select('id', { count: 'exact', head: true }).eq('passenger_id', uid).gte('created_at', since);
  if ((count ?? 0) >= 60) return json({ error: 'RATE_LIMITED' }, 429, origin);

  if (!ROUTES_KEY) return json({ error: 'ROUTES_NOT_CONFIGURED' }, 503, origin);

  // Routes API (computeRoutes). FieldMask mínimo para reduzir custo.
  const res = await fetch('https://routes.googleapis.com/directions/v2:computeRoutes', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': ROUTES_KEY,
      'X-Goog-FieldMask': 'routes.distanceMeters,routes.duration,routes.polyline.encodedPolyline',
    },
    body: JSON.stringify({
      origin: { location: { latLng: { latitude: o.lat, longitude: o.lng } } },
      destination: { location: { latLng: { latitude: d.lat, longitude: d.lng } } },
      travelMode: 'DRIVE',
      routingPreference: 'TRAFFIC_AWARE',
      languageCode: 'pt-BR',
      regionCode: 'BR',
      units: 'METRIC',
    }),
  });
  if (!res.ok) {
    console.error('routes_api_error', res.status, await res.text());
    return json({ error: 'ROUTES_API_ERROR' }, 502, origin);
  }
  const data = await res.json();
  const route = data.routes?.[0];
  if (!route || typeof route.distanceMeters !== 'number') return json({ error: 'NO_ROUTE' }, 422, origin);
  const durationS = Number(String(route.duration ?? '0s').replace('s', ''));

  const { data: snap, error } = await admin.rpc('create_fare_snapshot', {
    p_passenger: uid,
    p_origin_lat: o.lat,
    p_origin_lng: o.lng,
    p_dest_lat: d.lat,
    p_dest_lng: d.lng,
    p_distance_m: Math.round(route.distanceMeters),
    p_duration_s: Math.round(durationS),
    p_polyline: route.polyline?.encodedPolyline ?? null,
    p_source: 'google_routes',
  });
  if (error) return json({ error: error.message }, 400, origin);
  return json(snap, 200, origin);
});
