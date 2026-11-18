# Implantação — HTTPS, Supabase, Google Maps

## 1. Dependências (checklist)
| Item | Status no repositório | Quem providencia |
|---|---|---|
| Domínio + HTTPS público | **pendente** — nenhum domínio foi inventado | você |
| Projeto Supabase | **pendente** (migrações prontas e testadas em Postgres 16) | você |
| Google Cloud: chave de navegador (Maps JS, Places New, Geocoding) | **pendente** — sem ela o app usa mapa SIMULADO sinalizado | você |
| Google Cloud: chave de servidor (Routes API) | **pendente** — sem ela, cotação falha ou usa rota simulada se o admin permitir | você |
| Aparelhos Android + iPhone para teste | **pendente** | você |
| Revisão jurídica (transporte remunerado, LGPD) | **pendente** | profissional habilitado |

## 2. Supabase
```bash
npm i -g supabase
supabase login
supabase link --project-ref SEU_PROJECT_REF
supabase db push                      # aplica supabase/migrations
supabase functions deploy route-quote
supabase secrets set GOOGLE_ROUTES_SERVER_KEY=... ALLOWED_ORIGINS=https://seu-dominio
```
- Dashboard → Authentication: habilite e-mail/senha, **MFA TOTP**, confirmação de e-mail; Site URL = `https://seu-dominio`; redirect URLs `/passageiro/`, `/motorista/`, `/admin/`.
- Database → Extensions: habilite **pg_cron** e rode novamente o bloco de agendamento (final de `…_rls.sql`) — expira buscas a cada minuto e aplica retenção diária.
- Realtime: as tabelas `ride_requests`, `driver_locations`, `notifications`, `payment_intents_demo` são adicionadas à publicação pela migração.
- **Primeiro administrador:** crie a conta pelo `/admin/` e depois, no SQL Editor:
  ```sql
  insert into public.roles (user_id, role) select id, 'admin' from auth.users where email = 'SEU_EMAIL';
  ```
  Ao entrar no `/admin/` será exigido cadastrar o autenticador (TOTP).
- Em seguida, no painel: Configurações → **URL pública** = `https://seu-dominio` (habilita QR Codes).

## 3. Google Maps Platform
1. Ative: Maps JavaScript API, Places API (New), Geocoding API, Routes API.
2. **Chave de navegador** → restrição "Sites": `https://seu-dominio/*` (+ `http://localhost:5173/*` só na chave de desenvolvimento); restrição de APIs: Maps JS, Places (New), Geocoding.
3. **Chave de servidor** (Routes) → restrição de API: Routes; sem referenciador; guardada só em `supabase secrets`.
4. Defina **cotas diárias** e **alertas de orçamento** no Cloud Console.
5. Mantenha as atribuições do Google visíveis (o SDK as desenha no mapa; não cubra com elementos).

### Uso e custo (por corrida, ordem de grandeza)
| Chamada | Quando | Controle de abuso |
|---|---|---|
| Maps JS (carregamento do mapa) | por abertura de tela com mapa | — |
| Places Autocomplete (sessão) + Place Details | por busca de destino | debounce 350 ms, mínimo 3 caracteres, token de sessão |
| Geocoding reverso | ao parar de arrastar o pino | debounce 450 ms |
| Routes computeRoutes | 1 por cotação | servidor; 60/h por usuário; FieldMask mínimo |
| ETA de aproximação | — | calculado localmente, **sem** chamada paga |

Consulte a tabela de preços vigente do Google Maps Platform antes de abrir o piloto.

## 4. Frontend
```bash
cp .env.example .env.local   # preencha VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY, VITE_GOOGLE_MAPS_BROWSER_KEY
npm ci && npm test && npm run build
```
Publique `dist/` em qualquer host estático com HTTPS (Netlify, Vercel, Cloudflare Pages, Render static…). Requisitos:
- servir `/passageiro/sw.js` e `/motorista/sw.js` com `Cache-Control: no-cache`;
- `*.webmanifest` com `Content-Type: application/manifest+json`;
- `/assets/*` com cache longo (arquivos têm hash).
Não são necessárias regras de rewrite (roteamento por `#/`).

## 5. Atualização e manutenção
- Cada build carimba um novo `BUILD_ID` nos service workers → usuários veem "Nova versão disponível".
- Migrações novas: sempre arquivos novos em `supabase/migrations` (+ `npm run test:sql`).
- Tarifas e configurações mudam pelo painel, sem republicar.
- Contas demo no Supabase (opcional, só com Modo Piloto ligado), rodando **no seu computador**:
  ```bash
  SUPABASE_URL=https://xxxx.supabase.co SUPABASE_SERVICE_ROLE_KEY=... npm run seed:demo
  npm run seed:demo -- --dry-run            # mostra o que faria, sem conectar
  npm run seed:demo -- --senha=MinhaSenha123  # senha escolhida (padrão: aleatória, exibida uma vez)
  npm run seed:demo -- --remover            # remove (ou bloqueia, se já tiverem corridas)
  ```
  Cria passageiro, motorista (aprovado, veículo DEM0A00, chave Pix `.invalid`) e admin (TOTP no 1º acesso), todos com "DEMO" no nome.
