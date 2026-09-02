# CARLOSASSETs

Repositório visual da CARLOS Arena. Este repo contém somente conteúdo público do espectador: mapa, modelos, texturas, materiais, sons, partículas e arquivos do cliente 3D.

## Estrutura
- `arena/resenha-inferno/map.json` — layout e pontos de câmera.
- `models/` — modelos 3D.
- `textures/` — texturas.
- `materials/` — materiais/configurações visuais.
- `sounds/` — sons públicos da arena.
- `particles/` — efeitos.
- `index.html`, `arena.js`, `arena.css` — espectador web.

## GitHub Pages
Publique este repositório como GitHub Pages e defina no cliente o endereço da API do `CARLOS-main` com `window.ARENA_API_BASE`.

O backend permanece no CARLOS-main. Nunca coloque tokens, chaves ou lógica de pagamento neste repositório.

## URL final
Depois do Pages, o espectador fica em:
`https://SEU-USUARIO.github.io/CARLOSASSETs/arena/resenha-inferno/`

O link que o Discord mostra continua vindo do `CARLOS-main`; ele redireciona para essa URL com `?id=...`.
