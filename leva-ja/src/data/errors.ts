import { BackendError } from './types';

const MESSAGES: Record<string, string> = {
  AUTH_REQUIRED: 'Entre na sua conta para continuar.',
  INVALID_CREDENTIALS: 'E-mail ou senha incorretos.',
  EMAIL_IN_USE: 'Já existe uma conta com este e-mail.',
  FORBIDDEN: 'Você não tem permissão para esta ação.',
  RATE_LIMITED: 'Muitas tentativas. Aguarde alguns minutos e tente novamente.',
  INVITE_INVALID: 'Convite inválido. Confira o link recebido.',
  INVITE_REVOKED: 'Este convite foi revogado pelo administrador.',
  INVITE_EXPIRED: 'Este convite expirou. Peça um novo ao administrador.',
  INVITE_EXHAUSTED: 'Este convite já atingiu o limite de usos.',
  INVITE_REQUIRED: 'O piloto está restrito a convidados. Use o link de convite que você recebeu.',
  DRIVER_NOT_APPROVED: 'Seu cadastro de motorista ainda não foi aprovado.',
  DRIVER_NOT_AVAILABLE: 'Ative sua disponibilidade para aceitar corridas.',
  VEHICLE_REQUIRED: 'Cadastre seu veículo antes de ficar disponível.',
  PIX_KEY_REQUIRED: 'Cadastre sua chave Pix de recebimento antes de ficar disponível.',
  LOCATION_CONSENT_REQUIRED: 'Autorize o uso da localização para ficar disponível.',
  INVALID_PIX_KEY: 'Chave Pix inválida para o tipo escolhido.',
  NOT_TRACKABLE: 'Localização só é enviada quando você está disponível ou em corrida.',
  INVALID_COORDS: 'Coordenadas inválidas.',
  QUOTE_NOT_FOUND: 'Cotação não encontrada. Calcule o preço novamente.',
  QUOTE_ALREADY_USED: 'Esta cotação já foi usada. Calcule o preço novamente.',
  QUOTE_EXPIRED: 'O preço expirou. Calcule novamente.',
  PICKUP_TOO_FAR_FROM_QUOTE: 'O ponto de embarque mudou muito em relação à cotação. Recalcule o preço.',
  PICKUP_OUTSIDE_SERVICE_AREA: 'O ponto de embarque está fora da área atendida no piloto.',
  DEST_OUTSIDE_SERVICE_AREA: 'O destino está fora da área atendida no piloto.',
  PASSENGER_HAS_ACTIVE_RIDE: 'Você já tem uma corrida em andamento.',
  DRIVER_HAS_ACTIVE_RIDE: 'Você já tem uma corrida ativa. Finalize-a antes de aceitar outra.',
  ALREADY_TAKEN_OR_UNAVAILABLE: 'Esta corrida já foi aceita por outro motorista ou não está mais disponível.',
  INVALID_TRANSITION: 'Esta ação não é permitida no estado atual da corrida.',
  INVALID_PAYMENT_TRANSITION: 'Esta alteração de pagamento não é permitida.',
  REASON_REQUIRED: 'Informe o motivo do cancelamento.',
  RIDE_NOT_FINISHED: 'A avaliação só é possível após a corrida finalizada.',
  RIDE_IN_PROGRESS: 'Há uma corrida em andamento. Conclua-a antes.',
  OPERATIONS_PAUSED: 'As solicitações estão temporariamente pausadas pelo administrador.',
  SIMULATED_ROUTES_DISABLED: 'Cálculo de rota indisponível: a Routes API não está configurada e rotas simuladas estão desativadas.',
  ROUTES_NOT_CONFIGURED: 'Cálculo de rota indisponível: configure a Google Routes API no servidor.',
  ROUTES_API_ERROR: 'Não foi possível calcular a rota agora. Tente novamente.',
  NO_ROUTE: 'Não encontramos rota de carro entre os pontos escolhidos.',
  MANUAL_PRICE_DISABLED: 'Preço manual não está habilitado na tarifa vigente.',
  MFA_INVALID: 'Código de verificação inválido.',
  NETWORK: 'Sem conexão com o servidor. Verifique sua internet.',
  NOT_FOUND: 'Registro não encontrado.',
};

export function errorCode(e: unknown): string {
  if (e instanceof BackendError) return e.code;
  const msg = e instanceof Error ? e.message : String(e);
  const m = msg.match(/[A-Z][A-Z_]{3,}/);
  if (m && MESSAGES[m[0]]) return m[0];
  if (/Failed to fetch|NetworkError|network/i.test(msg)) return 'NETWORK';
  if (/Invalid login credentials/i.test(msg)) return 'INVALID_CREDENTIALS';
  if (/already registered/i.test(msg)) return 'EMAIL_IN_USE';
  return 'UNKNOWN';
}

export function friendlyError(e: unknown): string {
  const code = errorCode(e);
  if (MESSAGES[code]) return MESSAGES[code];
  const msg = e instanceof Error ? e.message : String(e);
  return msg || 'Algo deu errado. Tente novamente.';
}
