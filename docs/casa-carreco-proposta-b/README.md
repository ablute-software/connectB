# Casa Plinto — Proposta B para a parcela A de Carreço

Estudo de ideia alternativo à v4 da sessão "Terrain": mesmo terreno, mesma implantação do PIP
(15,00 × 9,33 = 139,95 m²), T2 com duas suites no R/C que passa a T3 pela Sala do Jardim na cave,
garagem para 2 carros, piscina de 7,70 × 3,00 m e dois jardins (terraço norte e pátio afundado a sul).

Página publicada: https://claude.ai/artifact/YMitRLC7m1CaxFfJ51Qwto

## v3 (03/10/2026) — a partir da "casa completa sketchup v2" do Nuno
Mantém as alterações do Nuno: escada virada (chega ao R/C a norte, junto à cozinha e à lavandaria; à cave no átrio),
entrada sem WC, suite sul sem closet. Acrescenta:
- WC de serviço (3,0 m²) com porta pela passagem dos quartos, não pela entrada; WC da suite sul (4,6 m²) e roupeiro de 2,45 m.
- Cozinha a nascente (parede técnica + ilha de 2,20 m com lava-loiça virado ao mar), jantar a noroeste com janela nova V1b.
- Sala com lume, TV e mar no mesmo campo de visão: salamandra e TV no pilar cego entre os dois vãos poente.
- Entrada pedonal como no PIP (portão e 7 degraus na ponta sul da estrada, a subir para norte); piscina 2,1 m para nascente.
- Muros da estrada em patamares: muro à face da estrada ≤ 1,10 m, patamar plantado de 0,70 m, muro do deck recuado.
- Cave: porta EI30 entre o átrio e arrumos/garagem; técnica a nordeste, com porta pela garagem.
- Fase 1 ≈ 220,1 k€, fase 2 ≈ 33,2 k€ (base de preços do MQT v4.2, sem IVA).

O SketchUp v2 do Nuno foi lido diretamente do `.skp` (formato SketchUp 2021+: zip com `model.dat` em blocos
etiqueta-comprimento-valor; vértices, arestas, faces e grupos com transformações) para medir as paredes e a escada.

## Pastas
- `pagina/` — página (`casa_plinto.html`), renders, peças desenhadas em SVG, modelo 3D (`scene.js` + `spec.json`) e `cost.json`.
- `sketchup/` — `construir_casa_plinto_v3.rb` (constrói o modelo no SketchUp pela consola de Ruby), `casa_plinto_v3.dae` e `LEIA-ME.txt`.
- `Casa_Plinto.html` — a página num só ficheiro (abre sem internet, exceto as letras).
- `fonte/` — scripts que geram tudo a partir de uma só geometria:
  - `geom.py` — geometria (compartimentos, paredes, vãos, exteriores) em coordenadas locais da implantação v4 (DXF ETRS89).
  - `build3d.py` — gera `out/spec.json` (modelo 3D, terreno, vegetação, câmaras).
  - `draw.py` — plantas, implantação, cortes e alçados em SVG.
  - `cost.py` — medições e estimativa na base de preços unitários do MQT v4.2.
  - `scene.js`, `render.html`, `render.mjs` — cena three.js e renders em Chromium headless.
  - `skp.py` — exporta o modelo para SketchUp (`.rb` e `.dae`); `mock_su.rb` testa o `.rb` fora do SketchUp.

## Regenerar
```bash
cd fonte && mkdir -p out && pip install shapely ezdxf && npm i three@0.169.0
python3 build3d.py && python3 draw.py && python3 cost.py
node render.mjs hero,aerial,road,living,patio,cutaway,sala,entrada 1600 1000 1
python3 skp.py && ruby mock_su.rb
```

Terreno natural aproximado a partir das cotas dos cantos e do perfil da estrada; o levantamento manda.
Não substitui o projeto de arquitetura nem as especialidades.
