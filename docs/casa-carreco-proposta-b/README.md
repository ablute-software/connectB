# Casa Plinto — Proposta B para a parcela A de Carreço

Estudo de ideia alternativo à v4 da sessão "Terrain": mesmo terreno, mesma implantação do PIP
(15,00 × 9,33 = 139,95 m²), T2 com duas suites no R/C que passa a T3 pela Sala do Jardim na cave,
garagem para 2 carros, piscina de 9 × 3 m e dois jardins (terraço norte e pátio afundado a sul).

Página publicada: https://claude.ai/artifact/YMitRLC7m1CaxFfJ51Qwto

## Pastas
- `pagina/` — página (`casa_plinto.html`), renders, peças desenhadas em SVG, modelo 3D (`scene.js` + `spec.json`) e `cost.json`.
- `fonte/` — scripts que geram tudo a partir de uma só geometria:
  - `geom.py` — geometria (compartimentos, paredes, vãos, exteriores) em coordenadas locais da implantação v4 (DXF ETRS89).
  - `build3d.py` — gera `out/spec.json` (modelo 3D, terreno, vegetação, câmaras).
  - `draw.py` — plantas, implantação, cortes e alçados em SVG.
  - `cost.py` — medições e estimativa na base de preços unitários do MQT v4.2.
  - `scene.js`, `render.html`, `render.mjs` — cena three.js e renders em Chromium headless.

## Regenerar
```bash
cd fonte && mkdir -p out && pip install shapely ezdxf && npm i three@0.169.0
python3 build3d.py && python3 draw.py && python3 cost.py
node render.mjs hero,aerial,road,living,patio,cutaway 1600 1000 1
```

Terreno natural aproximado a partir das cotas dos cantos e do perfil da estrada; o levantamento manda.
Não substitui o projeto de arquitetura nem as especialidades.
