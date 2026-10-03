# Handoff — plano para o terreno de poente (área resultante B), Carreço

Preparado a 03/10/2026 na sessão da Casa Plinto (`session_01R2suzZ4iMbQc4ouB1NKCid`, ramo
`claude/compassionate-ride-32dcyz`). A nova sessão vai fazer o **plano para o terreno a poente
da estrada nova** — a "área resultante (B)" do PIP. A casa da parcela A continua nas sessões
dela (ver §6).

Lê isto primeiro, depois abre `terreno_parcelas.png` e `parcelas_etrs89.json` nesta pasta.

---

## 1. O que é o terreno

- **Local:** Trav. de João Pires, Carreço (Viana do Castelo). Encosta virada a poente, com o mar
  a poente. A Trav. de João Pires fica a sul.
- **PIP** do arq. Henrique Arezes (folha 02, set. 2026), submetido à Câmara. À data **não há
  resposta**. O PIP:
  - divide o terreno em **parcela A** (onde se constrói a casa);
  - prevê uma **cedência para a estrada nova**, que separa A de B;
  - deixa uma **área resultante B**, a poente da estrada.

| Áreas | PIP (m²) | Medido no levantamento (m²) |
|---|---|---|
| Terreno total | 2 488,40 | 2 492,1 |
| Parcela A | 685,20 | 685,2 |
| Cedência — estrada nova | 172,50 | 172,5 |
| **Área resultante B** | **1 630,70** | **1 635,8** (= total − A − estrada) |
| Implantação da casa em A (R/C / cave) | 140 / 110 | — |

**Forma de B** (calculada a partir do levantamento, ETRS89):
- Polígono de cerca de **55 × 41 m** no retângulo mínimo.
- Centro a **cerca de 43 m de A, para OSO** (rumo de 242°).
- Cerca de **31 m de frente para a estrada nova**, ao longo do lado nascente.
- Lado norte comprido, alinhado com o limite norte do terreno total. Lados poente e sul em linha
  quebrada.

**Cotas de B:** lidas *a olho* na folha do PIP. Não estão confirmadas como dados.

| Zona | Cota aprox. (m) |
|---|---|
| Junto à estrada nova | ≈ 33,0–34,3 |
| Miolo | ≈ 31,5–32,8 |
| Extremo poente | ≈ 30,9–31,2 |

Isto dá uma descida suave para poente, de cerca de 3–4 m em 45 m (≈ 7–8 %). Nas curvas de nível
do levantamento (ver `terreno_parcelas.png`), B é a parte mais suave. O declive forte fica em A
e a sul de B, fora do terreno.

**Estrada nova** (perfil do PIP):
- **Cotas:** 35,9 na ponta sul, no fim da Trav. de João Pires → 34,2 em frente à garagem da casa
  de A → cerca de 33,6 na ponta norte.
- **Dimensões:** largura média de cerca de 4,8 m, numa extensão de cerca de 36 m.
- **Perfil tipo do PIP:** calçada portuguesa sobre almofada de areia e tout-venant; lancil de rampa
  em betão; passeio.

## 2. Coordenadas (todas as peças usam isto)

- **Sistema:** ETRS89 / PT-TM06 (EPSG:3763). As cotas são as absolutas do levantamento.
- **Coordenadas locais da casa de A** (usadas em `docs/casa-carreco-proposta-b/fonte/`):
  - origem em M = −60 409,15, P = 229 931,92 (canto SO exterior da casa/cave do estudo v4);
  - eixo **u** a 19,951° a norte do nascente (ao longo da casa, ENE);
  - eixo **v** perpendicular (NNO).
  - Conversão:
    `M = M0 + u·cos(a) − v·sin(a)`
    `P = P0 + u·sin(a) + v·cos(a)`, com a = 19,951°.
- `parcelas_etrs89.json` (nesta pasta) traz os polígonos `A_etrs89`, `B_etrs89`, `road_etrs89`
  e `total_etrs89` já em ETRS89.

## 3. Ficheiros e onde estão

### No repositório (ramo `claude/compassionate-ride-32dcyz`)

Esta pasta e a da Casa Plinto **não estão no `main`**. Lê-as com:
`git fetch origin claude/compassionate-ride-32dcyz` e depois
`git show origin/claude/compassionate-ride-32dcyz:<caminho>`.
Também as podes copiar para o teu ramo com `git checkout origin/claude/compassionate-ride-32dcyz -- docs/terreno-poente`.

| Caminho | O que é |
|---|---|
| `docs/terreno-poente/HANDOFF.md` | Este documento |
| `docs/terreno-poente/parcelas_etrs89.json` | Polígonos A, B, estrada e total em ETRS89 |
| `docs/terreno-poente/terreno_parcelas.png` | Planta de conjunto: parcelas, curvas de nível e limites do levantamento, implantação da casa |
| `docs/casa-carreco-proposta-b/fonte/site_local.json` | Os mesmos polígonos em coordenadas locais. **Atenção:** a chave `parcelB` é o contorno do terreno **total** (A + estrada + B, 2 492,1 m²), não B. B = total − A − estrada. `parcelA`, `road`, `angle` e `origin` estão certos. |
| `docs/casa-carreco-proposta-b/fonte/site_lines_local.json` | Planimetria do levantamento em coordenadas locais: `terreno` (67 polilinhas, são as curvas de nível) e `limites` (57 polilinhas, limites e muros). **Sem cotas** (z = 0). |
| `docs/casa-carreco-proposta-b/` | Casa Plinto completa: página, desenhos SVG, renders, modelo 3D, SketchUp (.rb + .dae), custo |

### Na Google Drive do Nuno

Pasta "NORDIC SEA _ carreço" e subpastas, id `14hjOMsjU3Rps73W2Lvsv1NlCeInYeM_3`.

| Ficheiro | id | Nota |
|---|---|---|
| `pip.dxf` (8 MB) | `1OC8geQmKrL22qvTU3P8LzCvVzTiak5bH` | **O DXF do PIP do Arezes, com o levantamento e as cotas.** Grande demais para o conector (ver §5). |
| `terreno_dwg.dwg` (45 MB) | `1pEpIUMv2TcM7Et_BbW_5L_zUqHpaQzOU` (cópia: `1e9-0CYlFSb-7iPblm1BNe_XlpEPmaSlJ`) | Levantamento original em DWG. Grande demais e ilegível aqui. |
| `pip_folha_implantacao.png` | `10h8i_lHAe5GetFIdX7PXchQce4AvTTcM` | Imagem da folha 02 do PIP, com cotas, áreas e legenda. Descarrega bem (≈ 480 KB). |
| `pip_geo_total.png` | `12ZAUQdmV7gRgrel5h3zMLdmH0aKlvH2b` | Folha do PIP sobre eixos métricos (feita na sessão Terrain) |
| `pip_real.json` | `1I8AAwTsiRLf6ogfSXRefj3fzt5uq2iCE` | Camadas ARQ do PIP (limite de A, área a ceder, implantação, linha e perfil do arruamento), em coordenadas **da folha do PIP**, não ETRS89 |
| `pip_georef.py`, `pip_T.npy`, `pip_estrada.py` | `1ZL49jnnv6I4vu3_J97VJjZm3AdsQfbKc`, `1bbiAqalqY-K8U_lxhPj5pg6CuWx2Ua9J`, `1tAmo-FQcsxG3MVPmYb8lrZdv4Naal1XK` | Georreferenciação da folha do PIP para ETRS89 (sessão Terrain) |
| `Implantacao_RC_v4_ETRS89.dxf` | `18aco3FIq3DKiNuxNZBYfTf8dSEdHVjmV` | Implantação v4 em ETRS89, com as camadas `TERRENO` e `LIMITES` do levantamento. Origem dos JSON acima. |
| Memória descritiva (PDF) | `1Z_IXheQnqzpddCDVeZZzc_cd7hUMAvFt` | Da casa de A (v4.1) |
| `MQT_Moradia_Carreco_v4.2.xlsx` | `18NvgD4kjPrU6TNzRnLy9eQHYIhUGFT9C` | Mapa de quantidades da casa de A; base de preços usada nas comparações |

Nota sobre a folha do PIP: o contorno azul tracejado da "área total do terreno" está desenhado
noutra posição que não coincide com A + B (parece outro desenho sobreposto na mesma folha). A
geometria de confiança é a do ETRS89 (`parcelas_etrs89.json`), que bate certo com as áreas do PIP.

### Páginas e documentos (claude.ai)

- **Casa Plinto** (proposta B para A): https://claude.ai/artifact/YMitRLC7m1CaxFfJ51Qwto
- **Moradia Carreço — Decisões e notas de projeto** (v4): https://claude.ai/artifact/BjkuvQ37imSgJL84uKgE7f
- **Reunião com o arquiteto:** https://claude.ai/artifact/3uUGkTUvHrTSeAhnFfGkih
- **Memória Descritiva e Caderno de Encargos:** https://claude.ai/artifact/CA7tu3jYoMyYdcDtHFNKZr

## 4. O que ainda não se sabe sobre B (perguntar antes de desenhar)

1. **O que o Nuno quer para B.** Outra casa para construir ou vender? Lote para venda? Jardim,
   pomar ou horta da casa de A? Anexos (garagem, piscina, alojamento)? Orçamento e prazo?
2. **Classificação no PDM de Viana do Castelo e capacidade construtiva de B.** **Não está
   confirmada em lado nenhum.** Os desenhos da Plinto chamam-lhe "parcela B (rústica) · prado e
   pomar", mas isso foi uma suposição de desenho, não um dado. Perguntar ao arquiteto:
   - se B é solo urbano ou rústico;
   - que índices e cércea se aplicam;
   - se a divisão do PIP é um destaque e o que isso implica para B (frente para via pública, ónus
     de não fracionamento, etc.).
3. **As cotas reais de B** (ver §5).
4. **Infraestruturas.** B fica mais baixo (≈ 31–34) do que a casa de A (R/C a 37,00). A cota e a
   posição da ligação de esgoto de A ainda estão por confirmar com as Águas do Alto Minho (nota da
   v4: "≥ 35,35 para gravidade"; a cave da Plinto já leva estação elevatória). Falta confirmar:
   - se B escoa esgoto por gravidade para a rede da estrada, ou se precisa de bombagem;
   - para onde vão as pluviais da estrada nova e de A. O terreno desce para B.
5. **Vistas da casa de A.** A sala de A olha para poente, por cima de B, para o mar:
   - na v4, uma empena de vidro de cerca de 45 m² a poente;
   - na Plinto, os vãos de correr a poente.

   O R/C de A está a 37,00. Uma construção em B que fique abaixo de cerca de 37 m de cota no topo
   (por exemplo, um piso sobre terreno a 32–33) não corta essa vista. Dois pisos já a cortam em
   parte. É um critério de desenho, não uma regra do PDM.

## 5. Problemas práticos já encontrados (poupa tempo)

- **O conector da Google Drive não traz ficheiros grandes.** Os ficheiros chegam em base64. Até
  cerca de 1,6 MB funciona: o resultado é gravado num `.txt` em JSON, e descodifica-se o campo
  `content` com Python. O `pip.dxf` (8 MB) **fez cair a ligação**. Pede ao Nuno para o
  **comprimir em .zip** (um DXF encolhe 8–10×, fica perto de 1 MB) e pô-lo na Drive, ou para o
  pôr no repositório.
- **Ficheiros DWG não se leem** no contentor (não há ODA nem LibreDWG). Pede DXF: AutoCAD
  "Guardar como → DXF", ou o ODA File Converter, gratuito.
- **As curvas de nível de `TERRENO` vêm achatadas (z = 0).** Para lhes dar cota é preciso o
  `pip.dxf` original, ou saber a equidistância e uma cota de referência.
- O `CLAUDE.md` do repositório é sobre a app connectB (CRM). Não se aplica a estes documentos da
  casa. **Não mexer no código da app.** Os projetos da casa vivem em `docs/`.
- **SketchUp no PC do Nuno.** Ele carrega modelos gerados como script Ruby: copia o `.rb` para
  `C:\casa\` e escreve na consola Ruby `load 'C:/casa/<ficheiro>.rb'`. Caminhos com espaços ou
  sem o nome do ficheiro falharam. O Ruby não se testa na nuvem; usou-se uma API simulada
  (`fonte/mock_su.rb`).
- **Ferramentas que funcionaram aqui:**
  - Python com ezdxf, shapely, matplotlib e openpyxl;
  - three.js 0.169 com Playwright (Chromium em `/opt/pw-browsers`, `--use-angle=swiftshader`)
    para renders sem ecrã;
  - páginas publicadas como Artifact.

## 6. Relação com a casa da parcela A

Estão em cima da mesa duas casas para A, as duas na mesma implantação do PIP (140 m², R/C a 37,00,
cave e garagem a 34,10 com acesso pela estrada nova):

- **NordicSea v4.x:** sessão "Terrain" `session_01KsbwVdFZWQ98aGzgXejnTV`, ramo
  `claude/optimistic-tesla-v9fg7u`. Telhado de duas águas a 37°, sótão, empena de vidro a poente.
  Custo: v4.1 274 k€; v4.2 225 k€ (mais 37 k€ deixados para "fazer depois").
- **Casa Plinto (proposta B):** esta sessão. Térrea com cave, cobertura plana, pala, piscina junto
  ao muro da estrada. Custo: 223 k€ (Fase 1) + 33 k€ (Fase 2).
  - **Dependência com B:** o orçamento da Plinto conta espalhar em B o sobrante das terras, cerca
    de 80 m³ (artigo "Sobrante espalhado e modelado na parcela B", 2,5 k€). O plano de B deve
    acolher isso ou dizer outra coisa.
- **Em LSF**, nenhuma das duas fica mais barata: Plinto ≈ +2 %, NordicSea ≈ +4–5 %. A cave tem de
  ser em betão.

## 7. Como trabalhar com o Nuno

- Português de Portugal, direto, sem jargão. Números com vírgula decimal e espaço nos milhares.
- Ele gosta de: páginas HTML publicadas, desenhos (plantas, cortes, alçados), renders, modelo
  SketchUp e custos na base de preços do MQT v4.2.
- Antes de desenhar, fazer as perguntas da §4.1 e da §4.2, e pedir o `pip.dxf` em .zip.
- Commits no ramo da sessão, numa pasta própria em `docs/`. Por exemplo, continuar em
  `docs/terreno-poente/`.
