# Registro de falhas

| Data | Aparelho / SO / navegador | Perfil | Passos | Esperado | Obtido | Gravidade | Status |
|---|---|---|---|---|---|---|---|
| 2026-11-18 | Chromium (E2E, Pixel 7 emulado) | todos | login demo | 1 faixa "modo demo" | faixa duplicada na tela de login | baixa | corrigido |
| 2026-11-18 | Chromium (E2E) | passageiro | abrir mapa simulado | mapa visível | container com altura zero (classes relative+absolute) | alta | corrigido |
| 2026-11-18 | Chromium (E2E) | motorista | ver oferta | bairro do embarque | fragmento de coordenada (vírgula no endereço simulado) | baixa | corrigido |
| 2026-11-18 | Postgres 16 (teste SQL) | — | aplicar migração | sucesso | coluna ambígua em `driver_earnings` | alta | corrigido |
