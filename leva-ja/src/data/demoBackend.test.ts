import { afterEach, describe, expect, it } from 'vitest';
import { parseBrCode } from '../core/pix';
import { DEMO_ACCOUNTS, DEMO_ADMIN_MFA_CODE, DEMO_PASSWORD, DemoBackend, type KV } from './demoBackend';

function memKV(): KV {
  const m = new Map<string, string>();
  return { get: (k) => m.get(k) ?? null, set: (k, v) => void m.set(k, v), remove: (k) => void m.delete(k) };
}
const open: DemoBackend[] = [];
function mk(app: 'passageiro' | 'motorista' | 'admin', kv: KV) {
  const b = new DemoBackend(app, kv);
  open.push(b);
  return b;
}
afterEach(() => open.splice(0).forEach((b) => b.close()));

const ORIGIN = { lat: -23.153, lng: -47.0577 };
const DEST = { lat: -23.165, lng: -47.0487 };

describe('DemoBackend — fluxo completo com as mesmas regras do servidor', () => {
  it('passageiro solicita, motorista aceita e finaliza, Pix simulado e avaliação', async () => {
    const kv = memKV();
    const p = mk('passageiro', kv);
    const d = mk('motorista', kv);
    await p.signIn(DEMO_ACCOUNTS.passageiro, DEMO_PASSWORD);
    await d.signIn(DEMO_ACCOUNTS.motorista, DEMO_PASSWORD);
    expect((await p.getAccess()).roles).toEqual(['passageiro']);

    await expect(d.setAvailability(true)).rejects.toThrow('LOCATION_CONSENT_REQUIRED');
    await d.setLocationConsent(true);
    await d.setAvailability(true);
    expect((await d.pushLocation({ ...ORIGIN, accuracy: 10, heading: null, speed: null, timestamp: Date.now() })).accepted).toBe(true);

    const q = await p.quoteRide(ORIGIN, DEST);
    expect(q.routeSource).toBe('simulada');
    expect(q.commissionCents + q.driverNetCents).toBe(q.totalCents);
    const rideId = await p.requestRide({ quoteId: q.id, pickup: { ...ORIGIN, address: 'Rua X, Centro', accuracyM: 10 }, destAddress: 'Rua Y, Bairro' });
    await expect(p.requestRide({ quoteId: q.id, pickup: { ...ORIGIN, address: 'a', accuracyM: 1 }, destAddress: 'b' })).rejects.toThrow('QUOTE_ALREADY_USED');

    const offers = await d.listOpenRides();
    expect(offers).toHaveLength(1);
    expect(offers[0].pickupArea).toEqual({ lat: -23.153, lng: -47.058 });
    expect((await d.acceptRide(rideId)).accepted).toBe(true);
    await expect(d.advanceRide(rideId, 'em_andamento')).rejects.toThrow('INVALID_TRANSITION');
    await d.advanceRide(rideId, 'motorista_a_caminho');
    await d.advanceRide(rideId, 'motorista_chegou');
    await d.advanceRide(rideId, 'em_andamento');
    await expect(p.cancelRide(rideId, 'quero sair')).rejects.toThrow('INVALID_TRANSITION');
    await d.advanceRide(rideId, 'finalizada');

    const det = await p.getRideDetails(rideId);
    expect(det.ride.status).toBe('finalizada');
    expect(det.payment?.isSimulation).toBe(true);
    expect(parseBrCode(det.payment!.brcode).valid).toBe(true);
    expect(det.payment!.brcode).toContain('simulacao@levaja.invalid');
    expect(det.events.map((e) => e.to)).toEqual(['solicitada', 'procurando_motorista', 'aceita', 'motorista_a_caminho', 'motorista_chegou', 'em_andamento', 'finalizada']);

    await expect(p.setPaymentStatus(rideId, 'confirmado_manual')).rejects.toThrow('INVALID_PAYMENT_TRANSITION');
    await p.setPaymentStatus(rideId, 'informado');
    await d.setPaymentStatus(rideId, 'confirmado_manual');
    await p.rateRide(rideId, 5);
    expect((await d.getEarnings(30)).confirmedNetCents).toBe(det.ride.driverNetCents);
  });

  it('aceite simultâneo: somente um motorista fica com a corrida', async () => {
    const kv = memKV();
    const admin = mk('admin', kv);
    const p = mk('passageiro', kv);
    const d1 = mk('motorista', kv);
    await admin.signIn(DEMO_ACCOUNTS.admin, DEMO_PASSWORD);
    await expect(admin.admin.createInvite('motorista', 24, 1)).rejects.toThrow('FORBIDDEN');
    await admin.mfa.verify(null, DEMO_ADMIN_MFA_CODE);
    const inv = await admin.admin.createInvite('motorista', 24, 1, 'segundo motorista');

    const d2 = mk('motorista', memKVShared(kv));
    await d2.signUp({ email: 'd2@teste.invalid', password: 'segredo123', fullName: 'Dora Dois', phone: '+5511988887777' });
    await d2.redeemInvite(inv.token);
    await expect(mk('motorista', kv).redeemInvite(inv.token)).rejects.toThrow();
    await expect(d2.setAvailability(true)).rejects.toThrow('DRIVER_NOT_APPROVED');
    const users = await admin.admin.listUsers();
    await admin.admin.setDriverStatus(users.find((u) => u.fullName === 'Dora Dois')!.id, 'aprovado');
    await d2.saveVehicle({ make: 'VW', model: 'Gol', color: 'Branco', plate: 'XYZ9A87', year: 2020 });
    await d2.saveDriverPixKey({ type: 'email', value: 'dora@teste.invalid', holder: 'Dora Dois' });
    await d2.setLocationConsent(true);
    await d2.setAvailability(true);

    await d1.signIn(DEMO_ACCOUNTS.motorista, DEMO_PASSWORD);
    await d1.setLocationConsent(true);
    await d1.setAvailability(true);
    await p.signIn(DEMO_ACCOUNTS.passageiro, DEMO_PASSWORD);
    const q = await p.quoteRide(ORIGIN, DEST);
    const rideId = await p.requestRide({ quoteId: q.id, pickup: { ...ORIGIN, address: 'Rua X, Centro', accuracyM: 10 }, destAddress: 'Rua Y, Bairro' });

    const [a, b] = await Promise.all([d1.acceptRide(rideId), d2.acceptRide(rideId)]);
    expect([a.accepted, b.accepted].filter(Boolean)).toHaveLength(1);

    // desistência → reoferta para o outro motorista
    const winner = a.accepted ? d1 : d2;
    const loser = a.accepted ? d2 : d1;
    await winner.cancelRide(rideId, 'Problema com o veículo');
    expect((await winner.listOpenRides()).map((o) => o.rideId)).not.toContain(rideId);
    expect((await loser.listOpenRides()).map((o) => o.rideId)).toContain(rideId);
  });

  it('tarifa editável cria nova versão sem alterar cotação anterior', async () => {
    const kv = memKV();
    const admin = mk('admin', kv);
    const p = mk('passageiro', kv);
    await admin.signIn(DEMO_ACCOUNTS.admin, DEMO_PASSWORD);
    await admin.mfa.verify(null, DEMO_ADMIN_MFA_CODE);
    await p.signIn(DEMO_ACCOUNTS.passageiro, DEMO_PASSWORD);
    const q1 = await p.quoteRide(ORIGIN, DEST);
    const v = await admin.admin.setFare({ baseCents: 700, perKmCents: 300, perMinuteCents: 50, minimumCents: 1000, commissionBps: 1000, pricingMode: 'fixa_na_solicitacao', manualPriceEnabled: false, note: 'teste' });
    expect(v).toBe(2);
    const q2 = await p.quoteRide(ORIGIN, DEST);
    expect(q1.fareVersion).toBe(1);
    expect(q2.fareVersion).toBe(2);
    expect(q2.totalCents).toBeGreaterThan(q1.totalCents);
    expect((await admin.admin.auditLog()).some((x) => x.action === 'fare_changed')).toBe(true);
  });
});

/** Mesmo "banco" (KV), mas sessões independentes por instância. */
function memKVShared(base: KV): KV {
  const own = new Map<string, string>();
  return {
    get: (k) => (k.startsWith('levaja-demo-session') ? own.get(k) ?? null : base.get(k)),
    set: (k, v) => (k.startsWith('levaja-demo-session') ? void own.set(k, v) : base.set(k, v)),
    remove: (k) => (k.startsWith('levaja-demo-session') ? void own.delete(k) : base.remove(k)),
  };
}
