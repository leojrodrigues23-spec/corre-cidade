import { describe, expect, it } from 'vitest';
import { canTransition, nextDriverAction, RIDE_STATUSES, TERMINAL_STATUSES } from './ride';

describe('máquina de estados da corrida', () => {
  it('fluxo feliz completo', () => {
    expect(canTransition('rascunho', 'solicitada', 'passageiro')).toBe(true);
    expect(canTransition('solicitada', 'procurando_motorista', 'sistema')).toBe(true);
    expect(canTransition('procurando_motorista', 'aceita', 'motorista')).toBe(true);
    expect(canTransition('aceita', 'motorista_a_caminho', 'motorista')).toBe(true);
    expect(canTransition('motorista_a_caminho', 'motorista_chegou', 'motorista')).toBe(true);
    expect(canTransition('motorista_chegou', 'em_andamento', 'motorista')).toBe(true);
    expect(canTransition('em_andamento', 'finalizada', 'motorista')).toBe(true);
  });
  it('passageiro não pode aceitar nem finalizar', () => {
    expect(canTransition('procurando_motorista', 'aceita', 'passageiro')).toBe(false);
    expect(canTransition('em_andamento', 'finalizada', 'passageiro')).toBe(false);
  });
  it('não pula etapas', () => {
    expect(canTransition('aceita', 'em_andamento', 'motorista')).toBe(false);
    expect(canTransition('procurando_motorista', 'finalizada', 'motorista')).toBe(false);
  });
  it('estados terminais não saem', () => {
    for (const t of TERMINAL_STATUSES) for (const s of RIDE_STATUSES) for (const a of ['passageiro', 'motorista', 'admin', 'sistema'] as const) expect(canTransition(t, s, a)).toBe(false);
  });
  it('passageiro não cancela corrida em andamento (apenas admin)', () => {
    expect(canTransition('em_andamento', 'cancelada', 'passageiro')).toBe(false);
    expect(canTransition('em_andamento', 'cancelada', 'admin')).toBe(true);
  });
  it('próxima ação do motorista', () => {
    expect(nextDriverAction('aceita')?.to).toBe('motorista_a_caminho');
    expect(nextDriverAction('finalizada')).toBeNull();
  });
});
