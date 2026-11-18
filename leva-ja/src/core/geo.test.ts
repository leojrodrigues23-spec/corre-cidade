import { describe, expect, it } from 'vitest';
import { assessFix, coarsen, decodePolyline, encodePolyline, haversineM, isValidLatLng, PlausibilityFilter, pointInPolygon, shouldSendLocation } from './geo';

const base = { lat: -23.153, lng: -47.0577 };

describe('haversine', () => {
  it('1 grau de latitude ~ 111 km', () => {
    expect(haversineM({ lat: 0, lng: 0 }, { lat: 1, lng: 0 })).toBeGreaterThan(111000);
    expect(haversineM({ lat: 0, lng: 0 }, { lat: 1, lng: 0 })).toBeLessThan(111300);
  });
});

describe('qualidade/idade', () => {
  it('detecta posição desatualizada', () => {
    const fix = { ...base, accuracy: 10, timestamp: 1000 };
    expect(assessFix(fix, 2000).stale).toBe(false);
    const a = assessFix(fix, 60_000);
    expect(a.stale).toBe(true);
    expect(a.label).toMatch(/desatualizada/);
  });
  it('classifica precisão', () => {
    expect(assessFix({ ...base, accuracy: 8, timestamp: 0 }, 0).quality).toBe('bom');
    expect(assessFix({ ...base, accuracy: 120, timestamp: 0 }, 0).quality).toBe('fraco');
  });
  it('rejeita 0,0 e NaN', () => {
    expect(isValidLatLng({ lat: 0, lng: 0 })).toBe(false);
    expect(isValidLatLng({ lat: NaN, lng: 1 })).toBe(false);
    expect(isValidLatLng(base)).toBe(true);
  });
});

describe('PlausibilityFilter', () => {
  it('aceita deslocamento normal e rejeita salto impossível', () => {
    const f = new PlausibilityFilter();
    expect(f.accept({ ...base, accuracy: 10, timestamp: 0 }).accepted).toBe(true);
    // 100 m em 10 s = 10 m/s
    expect(f.accept({ lat: base.lat + 0.0009, lng: base.lng, accuracy: 10, timestamp: 10_000 }).accepted).toBe(true);
    // 5 km em 2 s
    const r = f.accept({ lat: base.lat + 0.05, lng: base.lng, accuracy: 10, timestamp: 12_000 });
    expect(r.accepted).toBe(false);
    expect(r.reason).toBe('salto impossível');
  });
  it('rejeita leitura fora de ordem e sem precisão', () => {
    const f = new PlausibilityFilter();
    f.accept({ ...base, accuracy: 10, timestamp: 5000 });
    expect(f.accept({ ...base, accuracy: 10, timestamp: 4000 }).accepted).toBe(false);
    expect(f.accept({ ...base, accuracy: 0, timestamp: 9000 }).accepted).toBe(false);
  });
  it('salto grande com incerteza grande é tolerado', () => {
    const f = new PlausibilityFilter();
    f.accept({ ...base, accuracy: 300, timestamp: 0 });
    expect(f.accept({ lat: base.lat + 0.004, lng: base.lng, accuracy: 200, timestamp: 1000 }).accepted).toBe(true);
  });
});

describe('throttling de envio', () => {
  it('em corrida respeita intervalo mínimo e heartbeat', () => {
    const last = { ...base, accuracy: 10, timestamp: 0, sentAt: 0 };
    expect(shouldSendLocation({ mode: 'corrida', last, fix: { ...base, accuracy: 10, timestamp: 2000 }, now: 2000 })).toBe(false);
    expect(shouldSendLocation({ mode: 'corrida', last, fix: { ...base, accuracy: 10, timestamp: 5000 }, now: 5000 })).toBe(false);
    expect(shouldSendLocation({ mode: 'corrida', last, fix: { lat: base.lat + 0.0003, lng: base.lng, accuracy: 10, timestamp: 5000 }, now: 5000 })).toBe(true);
    expect(shouldSendLocation({ mode: 'corrida', last, fix: { ...base, accuracy: 10, timestamp: 16000 }, now: 16000 })).toBe(true);
  });
});

describe('polyline', () => {
  it('exemplo oficial do Google', () => {
    const pts = decodePolyline('_p~iF~ps|U_ulLnnqC_mqNvxq`@');
    expect(pts).toEqual([
      { lat: 38.5, lng: -120.2 },
      { lat: 40.7, lng: -120.95 },
      { lat: 43.252, lng: -126.453 },
    ]);
    expect(encodePolyline(pts)).toBe('_p~iF~ps|U_ulLnnqC_mqNvxq`@');
  });
});

describe('privacidade e área', () => {
  it('coarsen reduz precisão', () => {
    expect(coarsen({ lat: -23.153456, lng: -47.057712 })).toEqual({ lat: -23.153, lng: -47.058 });
  });
  it('ponto em polígono', () => {
    const sq = [
      { lat: 0, lng: 0 },
      { lat: 0, lng: 1 },
      { lat: 1, lng: 1 },
      { lat: 1, lng: 0 },
    ];
    expect(pointInPolygon({ lat: 0.5, lng: 0.5 }, sq)).toBe(true);
    expect(pointInPolygon({ lat: 1.5, lng: 0.5 }, sq)).toBe(false);
  });
});
