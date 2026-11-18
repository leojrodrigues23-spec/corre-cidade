/**
 * Máquina de estados da corrida. A fonte da verdade é o banco (função SQL public.ride_transition_allowed),
 * este módulo é o espelho usado pela UI e pelo backend demonstrativo local. Testes cobrem a equivalência.
 */
export const RIDE_STATUSES = [
  'rascunho',
  'solicitada',
  'procurando_motorista',
  'aceita',
  'motorista_a_caminho',
  'motorista_chegou',
  'em_andamento',
  'finalizada',
  'cancelada',
  'expirada',
] as const;
export type RideStatus = (typeof RIDE_STATUSES)[number];
export type RideActor = 'passageiro' | 'motorista' | 'admin' | 'sistema';

export const ACTIVE_RIDE_STATUSES: RideStatus[] = ['solicitada', 'procurando_motorista', 'aceita', 'motorista_a_caminho', 'motorista_chegou', 'em_andamento'];
export const DRIVER_ACTIVE_STATUSES: RideStatus[] = ['aceita', 'motorista_a_caminho', 'motorista_chegou', 'em_andamento'];
export const TERMINAL_STATUSES: RideStatus[] = ['finalizada', 'cancelada', 'expirada'];

const T: Record<RideStatus, Partial<Record<RideStatus, RideActor[]>>> = {
  rascunho: { solicitada: ['passageiro'], cancelada: ['passageiro'] },
  solicitada: { procurando_motorista: ['sistema'], cancelada: ['passageiro', 'admin'], expirada: ['sistema'] },
  procurando_motorista: { aceita: ['motorista'], cancelada: ['passageiro', 'admin'], expirada: ['sistema'] },
  // motorista desistir após aceitar devolve a corrida para reoferta
  aceita: { motorista_a_caminho: ['motorista'], procurando_motorista: ['motorista', 'sistema'], cancelada: ['passageiro', 'admin'] },
  motorista_a_caminho: { motorista_chegou: ['motorista'], procurando_motorista: ['motorista'], cancelada: ['passageiro', 'admin'] },
  motorista_chegou: { em_andamento: ['motorista'], cancelada: ['passageiro', 'motorista', 'admin'] },
  em_andamento: { finalizada: ['motorista', 'admin'], cancelada: ['admin'] },
  finalizada: {},
  cancelada: {},
  expirada: {},
};

export function canTransition(from: RideStatus, to: RideStatus, actor: RideActor): boolean {
  return T[from]?.[to]?.includes(actor) ?? false;
}

export function nextDriverAction(status: RideStatus): { to: RideStatus; label: string } | null {
  switch (status) {
    case 'aceita':
      return { to: 'motorista_a_caminho', label: 'Estou a caminho' };
    case 'motorista_a_caminho':
      return { to: 'motorista_chegou', label: 'Cheguei' };
    case 'motorista_chegou':
      return { to: 'em_andamento', label: 'Iniciar corrida' };
    case 'em_andamento':
      return { to: 'finalizada', label: 'Finalizar corrida' };
    default:
      return null;
  }
}

export const RIDE_STATUS_LABEL: Record<RideStatus, string> = {
  rascunho: 'Rascunho',
  solicitada: 'Solicitada',
  procurando_motorista: 'Procurando motorista',
  aceita: 'Motorista confirmado',
  motorista_a_caminho: 'Motorista a caminho',
  motorista_chegou: 'Motorista chegou',
  em_andamento: 'Em andamento',
  finalizada: 'Finalizada',
  cancelada: 'Cancelada',
  expirada: 'Expirada — nenhum motorista aceitou',
};

export const PASSENGER_CANCEL_REASONS = [
  'Mudei de ideia',
  'Demora para encontrar motorista',
  'Motorista muito longe',
  'Endereço de embarque errado',
  'Outro motivo',
];
export const DRIVER_CANCEL_REASONS = ['Passageiro não apareceu', 'Problema com o veículo', 'Endereço inacessível', 'Outro motivo'];
