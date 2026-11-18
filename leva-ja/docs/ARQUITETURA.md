# Arquitetura — Leva Já

## Visão geral
```
           ┌──────────── uma build Vite (React + TS + Tailwind) ────────────┐
 /            landing (Sou Passageiro / Sou Motorista)
 /passageiro/ PWA "Leva Já"            manifest + SW próprios (escopo /passageiro/)
 /motorista/  PWA "Leva Já Motorista"  manifest + SW próprios (escopo /motorista/)
 /admin/      painel (MFA TOTP obrigatório, não instalável)
           └──────────── src/core (regras puras)  +  src/data (contrato Backend) ┘
                                   │
            ┌──────────────────────┴───────────────────────┐
     SupabaseBackend (produção)                    DemoBackend (MODO DEMO LOCAL)
     Auth · Postgres+RLS · RPC · Realtime          localStorage + BroadcastChannel + Web Locks
     Edge Function route-quote → Google Routes     rotas/mapas simulados, sempre sinalizados
```

### Por que Supabase
Pedido no briefing; entrega Auth com MFA, Postgres com RLS, Realtime que respeita RLS e Edge Functions para segredos. As escritas acontecem **somente** via funções `SECURITY DEFINER` que validam papel/estado — o cliente tem apenas `SELECT` filtrado por RLS.

### Pastas
| Pasta | Conteúdo |
|---|---|
| `src/core` | tarifa (centavos), BR Code Pix + CRC16, máquina de estados, qualidade/plausibilidade de GPS, validações — 100% testado |
| `src/data` | contrato `Backend` + implementações Supabase e Demo |
| `src/geo`, `src/maps` | `watchPosition`, Google Maps/Places (New)/Geocoding, mapa simulado, links Waze/Google |
| `src/pwa` | instalação (`beforeinstallprompt`, iOS), registro de SW por escopo, notificação local |
| `src/apps/*` | landing, passageiro, motorista, admin, componentes compartilhados |
| `supabase/migrations` | esquema, RPCs, RLS, dados iniciais |
| `supabase/functions/route-quote` | cotação com rota real (chave de servidor) |
| `supabase/tests` | testes SQL (RLS, regras, aceite concorrente real) |

## Mapa de telas
- **Passageiro:** login/cadastro → convite → consentimento de localização → mapa + "Para onde vamos?" → busca (autocomplete) → confirmar embarque (pino fixo, mapa arrastável, endereço reverso, aviso de endereço aproximado) → cotação detalhada → procurando (contagem regressiva) → motorista a caminho (veículo, placa, ETA estimado, idade do sinal) → em andamento → recibo + Pix demonstrativo + avaliação. Histórico, perfil (tema, permissões, chave Pix opcional, exclusão de conta), instalar.
- **Motorista:** cadastro pendente (checklist veículo/Pix) → aprovado → consentimento → disponibilidade (GPS, envio, wake lock) → ofertas (região aproximada, valor líquido, expiração) → aceitar/recusar → corrida (Waze/Google Maps, Estou a caminho → Cheguei → Iniciar → Finalizar com confirmação, desistir/no-show) → resumo financeiro + confirmação manual do Pix. Ganhos (1/7/30 dias), perfil (veículo, chave Pix).
- **Admin:** dashboard + Modo Piloto, usuários (aprovar/suspender/revogar), convites (link/QR uma única vez), distribuição (QR dos dois apps após URL pública), corridas (cancelar, preço manual), mapa ao vivo, tarifas (versões), pagamentos, configurações (+ histórico), auditoria.

## Ciclo da corrida
`rascunho → solicitada → procurando_motorista → aceita → motorista_a_caminho → motorista_chegou → em_andamento → finalizada` (+ `cancelada`, `expirada`).
- Transições validadas em `public.ride_transition_allowed` (espelho em `src/core/ride.ts`), cada uma registrada em `ride_events`.
- **Aceite atômico:** `UPDATE … WHERE status='procurando_motorista'` + índice único parcial "uma corrida ativa por motorista". Testado com duas conexões simultâneas.
- **Timeout/reoferta:** busca expira em `offer_timeout_seconds` (pg_cron + verificação preguiçosa). Desistência do motorista devolve a corrida para a fila; quem desistiu/recusou não a recebe de novo.
- **Recuperação:** o estado vive no servidor; a tela recarrega ao reconectar, ao voltar do Waze/Maps e após reload.

## Tarifa
`max(minima, bandeirada + km*valor_km + min*valor_min)`, cada componente arredondado *half-up* em centavos, comissão `half-up(total*bps/10000)`. Calculada **no servidor** a partir da distância/duração da Routes API. Cada cotação grava a versão da tarifa; alterações criam nova versão (sem retroatividade). Modo variável recalcula apenas o tempo real com a mesma versão.

## Privacidade de localização
Somente a última posição do motorista é guardada; apagada ao ficar indisponível/revogar consentimento e após 24 h. Visível ao próprio motorista, ao passageiro **da corrida ativa com ele** (RLS) e ao admin. Ofertas mostram só a região (3 casas decimais ≈ 110 m); endereço exato só após o aceite.

## Decisões e riscos
| Decisão | Motivo | Risco/mitigação |
|---|---|---|
| Lat/lng + B-tree em vez de PostGIS | escala do piloto; menos dependências | migrar para PostGIS (`geography` + GiST) ao crescer |
| HashRouter | funciona em qualquer host estático sem regras de rewrite | URLs com `#/` |
| Rotas simuladas só com flag do admin | não bloquear testes sem Routes API | corridas marcadas `simulada`; desligado por padrão no Supabase |
| ETA de aproximação estimado localmente | evitar chamada paga a cada posição | é exibido como "estimativa" |
| Push via notificação local | Web Push exige VAPID + servidor; iOS só com app instalado | ver LIMITACOES.md |
| PWA para motorista | instalação simples no piloto | GPS para com tela bloqueada (iOS); módulo `runtime.tsx` isolado para trocar por app nativo |

## PIN de embarque e preço por km do motorista (migração 20261118000004)

- **PIN de embarque**: toda corrida ganha um código de 4 dígitos (`ride_pins`, sem nenhuma permissão de leitura direta).
  Só o passageiro recebe o PIN, via `get_ride_details`, até a corrida começar. Se o motorista usa PIN (preferência
  `driver_profiles.require_pin`, padrão ligado; copiada para `ride_requests.pin_required` no aceite), `advance_ride` recusa
  `em_andamento` com `PIN_REQUIRED` até `verify_ride_pin` acertar o código. O limite de tentativas vem de `pin_max_attempts` (padrão 5).
- **Preço por km do motorista**: o motorista escolhe `automatico` (tarifa Leva Já) ou `proprio`, com o valor por km dentro
  de `driver_price_per_km_min_cents` e `driver_price_per_km_max_cents`. O admin pode desligar tudo com `driver_custom_price_enabled`.
  Base, tempo, mínimo e comissão continuam vindo da tarifa vigente.
- **Escolha do passageiro**: na tarifa automática, a oferta vai para todos os motoristas aptos. Em "escolher motorista",
  `list_driver_prices` mostra os motoristas aptos com o total de cada um, e `request_ride(..., p_driver, p_expected_total_cents)`
  recalcula o preço no servidor e recusa com `PRICE_CHANGED` se o valor mudou.
  A corrida fica **direcionada**: só aquele motorista a vê e aceita. Se ele recusa ou desiste, a busca termina na hora e o passageiro escolhe de novo.
- **Etiqueta no mapa**: o carrinho do motorista mostra tempo e distância estimados até o embarque (ou até o destino, em viagem).
  É uma estimativa local (linha reta × 1,35 a 25 km/h), sem chamar a API paga a cada sinal de GPS.
