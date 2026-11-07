# 🏁 Corre Cidade

Corrida multiplayer 3D para navegador. Dirija por uma cidade com ruas sinalizadas, pegue moedas e chegue antes de todo mundo ao feixe de luz.

## Como jogar

Precisa do [Node.js](https://nodejs.org) 18 ou mais novo. Não há nada para instalar além dele.

- **Windows:** dê dois cliques em `iniciar.bat`.
- **Qualquer sistema:** rode `node server.js` nesta pasta e abra <http://localhost:3000>.

Para chamar amigos na mesma rede Wi-Fi, clique em **Convidar** dentro do jogo e mande o link. Na primeira vez, o Windows pode perguntar se libera o Node no firewall: permita em redes privadas.

## Regras

- Cada rodada dura 3 minutos. Vence quem tiver mais pontos.
- **Moeda:** +1 ponto.
- **Checkpoint (feixe de luz):** +5 pontos para quem chegar primeiro. Depois ele muda de lugar.
- **Batida forte:** quem leva a pancada derruba até 3 moedas, e qualquer um pode pegá-las.
- **Cristal azul:** recarrega o nitro.
- Bots completam a sala até 4 carros e saem conforme entram jogadores.

## Controles

| Ação | Teclado |
| --- | --- |
| Dirigir | Setas ou W A S D |
| Nitro | Shift |
| Derrapar | Espaço |
| Buzina | H |
| Voltar à rua | R |
| Trocar câmera | C |
| Emojis | 1 a 4 |
| Som | M |

No celular, os botões aparecem na tela. Jogue com o aparelho na horizontal.

## Configuração

| Variável | Padrão | Uso |
| --- | --- | --- |
| `PORT` | 3000 | Porta do servidor |
| `RONDA` | 180 | Duração da rodada, em segundos |

## Publicar na internet

O jogo precisa de um serviço que rode Node e aceite WebSocket. O arquivo `render.yaml` já deixa tudo pronto para o [Render](https://render.com). O jogo usa `PORT` e detecta `https` sozinho.

## Estrutura

- `server.js`: site, salas, bots, pontuação e colisões entre carros
- `public/js/map.js`: mapa, usado pelo servidor e pelo navegador
- `public/js/world.js`: cidade em 3D
- `public/js/car.js`: modelos dos carros
- `public/js/physics.js`: direção e colisões
- `public/js/main.js`: jogo, interface e rede
- `public/vendor/`: Three.js (licença MIT)
