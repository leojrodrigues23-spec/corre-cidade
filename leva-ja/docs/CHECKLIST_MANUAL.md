# Checklist de testes manuais (aparelhos reais)

Marque ✅/❌ e registre falhas em REGISTRO_FALHAS.md com aparelho, sistema, navegador e horário.

## Aparelhos mínimos
- [ ] Android (Chrome) — motorista  · [ ] iPhone (Safari) — passageiro · [ ] repetir invertendo os papéis

## Instalação e atualização
- [ ] Android: instalar Leva Já pelo botão (quando aparecer) e pelo menu ⋮
- [ ] Android: instalar Leva Já Motorista no MESMO aparelho; dois ícones distintos; cada um abre no seu perfil
- [ ] iPhone: Compartilhar → Adicionar à Tela de Início (ambos os apps)
- [ ] Sessões independentes: sair de um não desloga o outro
- [ ] Publicar nova versão → aviso "Nova versão disponível" → Atualizar funciona
- [ ] QR Code da Distribuição abre a URL HTTPS correta

## GPS
- [ ] GPS bom ao ar livre (≤ 20 m) · [ ] GPS fraco em ambiente fechado (aviso aparece)
- [ ] Permissão negada → mensagem e escolha manual no mapa
- [ ] Revogar consentimento no Perfil → posição some do servidor
- [ ] Motorista bloqueia a tela 2 min → passageiro vê "Último sinal há…" (não "ao vivo")
- [ ] Desbloqueio → volta "ao vivo" em até ~15 s
- [ ] Modo avião 1 min no motorista → faixa "Sem conexão" → reconecta sozinho

## Corrida
- [ ] Endereço ambíguo/aproximado → aviso; ajuste de pino funciona
- [ ] Dois motoristas tocam "Aceitar" juntos → só um fica com a corrida
- [ ] Desistência do motorista → reoferta para outro
- [ ] Busca expira → passageiro vê "Expirada" e pode pedir de novo
- [ ] Cancelamento com motivo (passageiro antes de iniciar; motorista no-show após chegar)
- [ ] Waze e Google Maps abrem com o destino; voltar ao Leva Já mantém a corrida
- [ ] Fechar e reabrir o app no meio da corrida → retoma o estado
- [ ] Rede lenta (DevTools "Slow 3G") → skeletons, sem travar

## Valores e Pix
- [ ] Detalhamento bate com a fórmula (6 km/15 min = R$ 22,25 com tarifa inicial)
- [ ] Alterar tarifa no admin → nova cotação usa nova versão; corrida antiga mantém a anterior
- [ ] Pix em modo piloto mostra "SIMULAÇÃO — não pague"; app bancário NÃO encontra a chave
- [ ] "Informar que paguei" não confirma; só motorista/admin confirmam
