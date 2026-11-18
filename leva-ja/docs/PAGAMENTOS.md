# Pix — fase demonstrativa

- Ao finalizar a corrida, o **servidor** gera um BR Code estático (EMV/BCB) com valor exato e CRC16-CCITT (`build_static_brcode`; espelho em `src/core/pix.ts`; vetores oficiais testados).
- **Modo Piloto ligado (padrão):** a chave usada é `simulacao@levaja.invalid` (domínio `.invalid` nunca existe no DICT), recebedor "SIMULACAO LEVA JA", QR com tarja "Simulação · não pague" exibido só após toque explícito.
- **Status:** `aguardando → informado (passageiro) → confirmacao_manual → confirmado_manual (motorista/admin)`, `cancelado (admin)`. Mostrar QR, copiar código ou receber imagem de comprovante **nunca** confirma pagamento. Transições com chave de idempotência.
- Chave Pix do passageiro: **opcional**, não usada para pagar.
- A plataforma **não** separa comissão automaticamente: o valor da comissão é apenas calculado/exibido.

## Integração futura com PSP
1. Escolher PSP com Pix cobrança (cob/cobv) e, se necessário, split.
2. Edge Function `create-charge`: cria cobrança dinâmica com `txid` = id da corrida; grava `provider`, `provider_reference`.
3. Edge Function `pix-webhook`: valida assinatura/mTLS do PSP, usa `endToEndId` como `idempotency_key` em `payment_status_events`, muda para um novo status `confirmado_psp`.
4. Repasse/split conforme contrato do PSP; só então comunicar "comissão retida automaticamente".
