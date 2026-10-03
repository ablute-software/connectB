# Terreno de Poente — divisão da área resultante B e duas casas T3

Estudo de ideia para a área resultante B do PIP de Carreço (a poente da estrada nova). Divide-a em
dois lotes iguais e desenha uma casa T3 térrea com piscina em cada um, com as mesmas peças.

Página publicada: https://claude.ai/artifact/1XGv1VHyTjNKf4KcRFYj8a

- **Divisão:** áreas iguais (817,8 + 817,8 m²) e frentes iguais para a estrada (15,45 + 15,45 m).
  Linha E (estrada) M −60 421,58 P 229 931,66 → W (poente) M −60 460,62 P 229 904,22 (ETRS89/PT-TM06).
- **Casa do Pátio** (B-norte): em L à volta da piscina; R/C 32,95, sala 32,44, topo 37,20.
- **Casa Comprida** (B-sul): linear, sala no fim e piscina a poente; R/C 33,45, sala 32,94, topo 37,70.
- As duas casas: 169,9 m² de área bruta, ≈ 142,6 m² úteis, sala com pé-direito de 4,11 m, alpendre para 2 carros,
  piscina, e alpendre da piscina que fecha na Fase 2 (escritório/estúdio).
- Custo (sem IVA, base de preços do MQT v4.2): casa ≈ 162 k€ / 171 k€; piscina ≈ 19 k€ / 17 k€; Fase 2 ≈ 19 k€.
- **Antes de avançar:** confirmar se B pode ser dividido por destaque (RJUE art. 6.º — 10 anos sem novo destaque no
  prédio original, se A for destacada) e a classificação de B no PDM. Alternativas: loteamento de 3 lotes ou propriedade
  horizontal. Ver a secção «Antes de avançar» da página.

## Pastas
- `HANDOFF.md`, `parcelas_etrs89.json`, `terreno_parcelas.png` — ponto de partida (sessão da Casa Plinto).
- `pagina/` — página (`terreno_poente.html`), imagens, desenhos SVG, modelo 3D (`scene.js` + `spec.json`) e `cost.json`.
- `sketchup/` — modelo SketchUp (script Ruby e COLLADA) com as duas casas, o terreno e a casa de A em volumetria.
- `fonte/` — scripts que geram tudo a partir de uma só geometria:
  - `sitio.py` — polígonos, coordenadas locais (as mesmas da casa de A) e modelo do terreno a partir das curvas do
    levantamento, com cota atribuída pelas curvas mestras (equidistância 0,20 m).
  - `divisao.py` — a linha de divisão (áreas e frentes iguais) e as métricas de cada lote.
  - `casas.py` — as duas casas (kit de peças, compartimentos, paredes, vãos, alpendres, piscina, cotas).
  - `build3d.py` — `out/spec.json` (modelo 3D, terreno final, muros, vegetação, câmaras).
  - `draw.py` (divisão, implantação, plantas) e `cortes.py` (cortes e alçados tirados do modelo 3D).
  - `cost.py` — medições e estimativa na base de preços do MQT v4.2.
  - `scene.js`, `render.html`, `render.mjs` — cena three.js e renders sem ecrã (Chromium + swiftshader).
  - `skp.py` — exportação para SketchUp.
  - `pagina.py` — monta a página e copia as peças para `pagina/`.

## Regenerar
```bash
cd docs/terreno-poente/fonte && mkdir -p out
pip install shapely scipy pillow numpy mapbox_earcut
npm i --no-save three@0.169.0          # instala na raiz do repositório (node_modules, ignorado pelo git)
python3 divisao.py && python3 build3d.py && python3 draw.py && python3 cortes.py && python3 cost.py
node render.mjs aerial,aerial2,courtN,courtS,livingN,fromA,road,cutaway 1600 1000 1
python3 skp.py && python3 pagina.py
```

Terreno: curvas de nível do levantamento (sem cota no ficheiro de origem) com cota atribuída a partir das etiquetas
32/33/34/35 da imagem do levantamento; o `pip.dxf` original confirma ponto a ponto. Árvores fora do terreno indicativas.
Não substitui o projeto de arquitetura nem as especialidades.
