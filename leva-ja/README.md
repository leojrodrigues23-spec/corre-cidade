# Leva Já — *Seu destino começa aqui!*

Plataforma de mobilidade urbana para um **piloto privado por convite em Itupeva/SP**, com **corridas e pagamentos simulados**.
Uma única base de código gera:

| Endereço | O que é | Instalável |
|---|---|---|
| `/` | Landing pública com **Sou Passageiro** / **Sou Motorista** | — |
| `/passageiro/` | PWA **Leva Já** (manifest, ícone e service worker próprios) | sim |
| `/motorista/` | PWA **Leva Já Motorista** (manifest, ícone e service worker próprios) | sim |
| `/admin/` | Painel administrativo (MFA obrigatório) | não |

> ⚠️ Não operar transporte remunerado antes de verificar as exigências municipais e federais. O **Modo Piloto** (ligado por padrão) mantém o Pix sempre como simulação.

## Rodar localmente

```bash
npm install
npm run dev            # http://localhost:5173/  (/passageiro/, /motorista/, /admin/)
```

Sem variáveis de ambiente, o app entra em **MODO DEMO LOCAL** (faixa roxa em todas as telas): dados no navegador, mapa simulado, rotas simuladas. Abra passageiro e motorista em **abas do mesmo navegador** para ver o tempo real. Contas demo (senha `demo1234`; código MFA demo do admin `123456`) aparecem na tela de login.

## Testes

```bash
npm test               # unitários + integração (tarifa, Pix/CRC, estados, GPS, backend demo, aceite simultâneo)
npm run test:sql       # sobe Postgres 16 local, aplica migrações e testa RLS/RPC/concorrência real
npm run build && npm run test:e2e   # E2E Playwright: fluxo completo passageiro ↔ motorista ↔ admin
```

## Documentação

- [docs/ARQUITETURA.md](docs/ARQUITETURA.md) — arquitetura, telas, fluxos, decisões e riscos
- [docs/DEPLOY.md](docs/DEPLOY.md) — HTTPS, Supabase, Google Maps, variáveis, custos/cotas, atualização
- [docs/LIMITACOES.md](docs/LIMITACOES.md) — o que um PWA **não** garante (GPS em segundo plano, push no iOS…)
- [docs/PAGAMENTOS.md](docs/PAGAMENTOS.md) — Pix demonstrativo e caminho para PSP
- [docs/CHECKLIST_MANUAL.md](docs/CHECKLIST_MANUAL.md) — testes em aparelhos reais
- [docs/REGISTRO_FALHAS.md](docs/REGISTRO_FALHAS.md) — registro de falhas
