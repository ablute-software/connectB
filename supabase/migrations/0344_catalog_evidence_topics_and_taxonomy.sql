-- Prompt 585 Phase 1 — evidence is the unit: a person/entity fact only
-- exists in this system if it has a real, public url. This migration is
-- purely additive: new tables, a new taxonomy, a backfill of what already
-- exists as unstructured text/rows elsewhere. It changes no existing
-- table's meaning and adds nothing to any live read path yet (Phase 2
-- wires the matching-engine component and the entity-header block; Phase 3
-- wires the person page).
--
-- Corrections made against the prompt's own text after reading the real
-- schema first (grounded, not guessed):
--   - The prompt's "§B.1: 6 groups / 56 sectors" is stale. The REAL
--     taxonomy (src/lib/sector-taxonomy.ts, SECTOR_TAXONOMY) is 5 groups /
--     51 sectors. Level 1/2 below mirror that real file exactly, not the
--     prompt's numbers.
--   - "0146/0147" for catalog_entity_enrichment_sources: the table is
--     entirely from 0146; 0147 is an unrelated RLS security fix on
--     catalog_people/catalog_person_affiliations. Cited correctly here.
--   - is_test and is_internal are two separate columns (0139, 0316) with
--     different semantics; the consensus-exclusion pattern this migration
--     doesn't touch (Phase 3's evidence-consensus function will) checks
--     both, matching catalog_person_check_consensus's own pattern.

-- ============================================================
-- Enums
-- ============================================================
create type public.evidence_kind as enum (
  'bio', 'interview', 'podcast', 'talk_event', 'article_authored', 'article_about',
  'statement', 'press_release', 'investment', 'fund_announcement', 'social_post', 'photo', 'other'
);

create type public.evidence_polarity as enum ('positive', 'negative', 'neutral');

create type public.evidence_origin as enum ('worker', 'admin', 'founder', 'platform_member', 'import', 'backfill');

create type public.evidence_status as enum ('found', 'verified', 'quarantined', 'rejected', 'erased');

create type public.evidence_tag_source as enum ('dictionary', 'ai', 'admin');

-- ============================================================
-- topic_taxonomy — hierarchy + multilingual synonyms
-- ============================================================
create table public.topic_taxonomy (
  id uuid primary key default uuid_generate_v4(),
  slug text not null unique,
  parent_id uuid references public.topic_taxonomy(id) on delete cascade,
  label_en text not null,
  label_pt text,
  depth smallint not null check (depth >= 1),
  synonyms text[] not null default '{}',
  taxonomy_version int not null default 1,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create index topic_taxonomy_parent_id_idx on public.topic_taxonomy(parent_id);
create index topic_taxonomy_synonyms_gin_idx on public.topic_taxonomy using gin(synonyms);

alter table public.topic_taxonomy enable row level security;

-- Reference data: any signed-in user can read it (used by the org_topics
-- picker and the matcher's own lookups); only platform admin/service role
-- writes (creating a topic is "edit the seed file + migration", per the
-- prompt's own §G.2 — no UI creates new topics in v1).
create policy topic_taxonomy_read on public.topic_taxonomy for select
  using (auth.uid() is not null or is_platform_admin());
create policy topic_taxonomy_admin_write on public.topic_taxonomy for all
  using (is_platform_admin()) with check (is_platform_admin());

-- ============================================================
-- Seed v1 — generated from src/lib/topic-taxonomy.seed.ts (source of
-- truth for the content; this file is the static snapshot a migration
-- can actually run). 5 groups (depth 1), 51 sectors (depth 2, slug
-- identical to a kebab-cased sector name from SECTOR_TAXONOMY), and a
-- deep sub-tree (depth 3-4) under Health & Life Sciences only, per
-- Nuno's decision (2026-09-10): health/medtech/biotech deep now, the
-- other 4 groups stay at depth 2 for v1.
-- ============================================================
insert into public.topic_taxonomy (slug, parent_id, label_en, label_pt, depth, synonyms, taxonomy_version, is_active) values ('health-life-sciences', null, 'Health & Life Sciences', 'Saúde e Ciências da Vida', 1, array['health','life sciences','saúde','ciências da vida','salud']::text[], 1, true);
insert into public.topic_taxonomy (slug, parent_id, label_en, label_pt, depth, synonyms, taxonomy_version, is_active) values ('food-climate-natural-resources', null, 'Food, Climate & Natural Resources', 'Alimentação, Clima e Recursos Naturais', 1, array['food','climate','natural resources','alimentação','clima','recursos naturais','alimentación','clima','recursos naturales']::text[], 1, true);
insert into public.topic_taxonomy (slug, parent_id, label_en, label_pt, depth, synonyms, taxonomy_version, is_active) values ('deeptech-industry-infrastructure', null, 'DeepTech, Industry & Infrastructure', 'DeepTech, Indústria e Infraestrutura', 1, array['deeptech','industry','infrastructure','indústria','infraestrutura','industria','infraestructura']::text[], 1, true);
insert into public.topic_taxonomy (slug, parent_id, label_en, label_pt, depth, synonyms, taxonomy_version, is_active) values ('software-digital-services', null, 'Software & Digital Services', 'Software e Serviços Digitais', 1, array['software','digital services','serviços digitais','servicios digitales']::text[], 1, true);
insert into public.topic_taxonomy (slug, parent_id, label_en, label_pt, depth, synonyms, taxonomy_version, is_active) values ('consumer-impact', null, 'Consumer & Impact', 'Consumo e Impacto', 1, array['consumer','impact','consumo','impacto']::text[], 1, true);
insert into public.topic_taxonomy (slug, parent_id, label_en, label_pt, depth, synonyms, taxonomy_version, is_active) values ('biotechnology-life-sciences', (select id from public.topic_taxonomy where slug = 'health-life-sciences'), 'Biotechnology & Life Sciences', 'Biotecnologia e Ciências da Vida', 2, array['biotech','biotecnologia','biotecnología','life sciences']::text[], 1, true);
insert into public.topic_taxonomy (slug, parent_id, label_en, label_pt, depth, synonyms, taxonomy_version, is_active) values ('pharmaceuticals-therapeutics', (select id from public.topic_taxonomy where slug = 'health-life-sciences'), 'Pharmaceuticals & Therapeutics', 'Farmacêutica e Terapêutica', 2, array['pharma','farmacêutica','farmacéutica','therapeutics','terapêutica']::text[], 1, true);
insert into public.topic_taxonomy (slug, parent_id, label_en, label_pt, depth, synonyms, taxonomy_version, is_active) values ('drug-discovery-development', (select id from public.topic_taxonomy where slug = 'health-life-sciences'), 'Drug Discovery & Development', 'Descoberta e Desenvolvimento de Fármacos', 2, array['drug discovery','descoberta de fármacos','descubrimiento de fármacos']::text[], 1, true);
insert into public.topic_taxonomy (slug, parent_id, label_en, label_pt, depth, synonyms, taxonomy_version, is_active) values ('medtech-medical-devices', (select id from public.topic_taxonomy where slug = 'health-life-sciences'), 'MedTech & Medical Devices', 'MedTech e Dispositivos Médicos', 2, array['medtech','medical devices','dispositivos médicos','dispositivos médicos']::text[], 1, true);
insert into public.topic_taxonomy (slug, parent_id, label_en, label_pt, depth, synonyms, taxonomy_version, is_active) values ('diagnostics', (select id from public.topic_taxonomy where slug = 'health-life-sciences'), 'Diagnostics', 'Diagnóstico', 2, array['diagnostics','diagnóstico','diagnóstico','diagnostic']::text[], 1, true);
insert into public.topic_taxonomy (slug, parent_id, label_en, label_pt, depth, synonyms, taxonomy_version, is_active) values ('digital-health', (select id from public.topic_taxonomy where slug = 'health-life-sciences'), 'Digital Health', 'Saúde Digital', 2, array['digital health','saúde digital','salud digital','e-health']::text[], 1, true);
insert into public.topic_taxonomy (slug, parent_id, label_en, label_pt, depth, synonyms, taxonomy_version, is_active) values ('healthcare-services-clinical-research', (select id from public.topic_taxonomy where slug = 'health-life-sciences'), 'Healthcare Services & Clinical Research', 'Serviços de Saúde e Investigação Clínica', 2, array['healthcare services','clinical research','investigação clínica','investigación clínica']::text[], 1, true);
insert into public.topic_taxonomy (slug, parent_id, label_en, label_pt, depth, synonyms, taxonomy_version, is_active) values ('genomics-precision-medicine', (select id from public.topic_taxonomy where slug = 'health-life-sciences'), 'Genomics & Precision Medicine', 'Genómica e Medicina de Precisão', 2, array['genomics','genómica','genómica','precision medicine','medicina de precisão']::text[], 1, true);
insert into public.topic_taxonomy (slug, parent_id, label_en, label_pt, depth, synonyms, taxonomy_version, is_active) values ('synthetic-biology', (select id from public.topic_taxonomy where slug = 'health-life-sciences'), 'Synthetic Biology', 'Biologia Sintética', 2, array['synthetic biology','biologia sintética','biología sintética','synbio']::text[], 1, true);
insert into public.topic_taxonomy (slug, parent_id, label_en, label_pt, depth, synonyms, taxonomy_version, is_active) values ('femhealth', (select id from public.topic_taxonomy where slug = 'health-life-sciences'), 'FemHealth', 'Saúde Feminina', 2, array['femhealth','femtech','saúde feminina','salud femenina','women''s health']::text[], 1, true);
insert into public.topic_taxonomy (slug, parent_id, label_en, label_pt, depth, synonyms, taxonomy_version, is_active) values ('mental-health', (select id from public.topic_taxonomy where slug = 'health-life-sciences'), 'Mental Health', 'Saúde Mental', 2, array['mental health','saúde mental','salud mental']::text[], 1, true);
insert into public.topic_taxonomy (slug, parent_id, label_en, label_pt, depth, synonyms, taxonomy_version, is_active) values ('longevity-agetech-wellness', (select id from public.topic_taxonomy where slug = 'health-life-sciences'), 'Longevity, AgeTech & Wellness', 'Longevidade, AgeTech e Bem-estar', 2, array['longevity','agetech','longevidade','longevidad','wellness','bem-estar']::text[], 1, true);
insert into public.topic_taxonomy (slug, parent_id, label_en, label_pt, depth, synonyms, taxonomy_version, is_active) values ('animal-health', (select id from public.topic_taxonomy where slug = 'health-life-sciences'), 'Animal Health', 'Saúde Animal', 2, array['animal health','saúde animal','salud animal','veterinary']::text[], 1, true);
insert into public.topic_taxonomy (slug, parent_id, label_en, label_pt, depth, synonyms, taxonomy_version, is_active) values ('agritech-foodtech', (select id from public.topic_taxonomy where slug = 'food-climate-natural-resources'), 'AgriTech & FoodTech', 'AgriTech e FoodTech', 2, array['agritech','foodtech']::text[], 1, true);
insert into public.topic_taxonomy (slug, parent_id, label_en, label_pt, depth, synonyms, taxonomy_version, is_active) values ('alternative-proteins', (select id from public.topic_taxonomy where slug = 'food-climate-natural-resources'), 'Alternative Proteins', 'Proteínas Alternativas', 2, array['alternative proteins','proteínas alternativas']::text[], 1, true);
insert into public.topic_taxonomy (slug, parent_id, label_en, label_pt, depth, synonyms, taxonomy_version, is_active) values ('climatetech-cleantech', (select id from public.topic_taxonomy where slug = 'food-climate-natural-resources'), 'ClimateTech & CleanTech', 'ClimateTech e CleanTech', 2, array['climatetech','cleantech']::text[], 1, true);
insert into public.topic_taxonomy (slug, parent_id, label_en, label_pt, depth, synonyms, taxonomy_version, is_active) values ('energy-energy-storage', (select id from public.topic_taxonomy where slug = 'food-climate-natural-resources'), 'Energy & Energy Storage', 'Energia e Armazenamento de Energia', 2, array['energy','energy storage','energia']::text[], 1, true);
insert into public.topic_taxonomy (slug, parent_id, label_en, label_pt, depth, synonyms, taxonomy_version, is_active) values ('circular-economy-waste', (select id from public.topic_taxonomy where slug = 'food-climate-natural-resources'), 'Circular Economy & Waste', 'Economia Circular e Resíduos', 2, array['circular economy','economia circular','waste','resíduos']::text[], 1, true);
insert into public.topic_taxonomy (slug, parent_id, label_en, label_pt, depth, synonyms, taxonomy_version, is_active) values ('watertech', (select id from public.topic_taxonomy where slug = 'food-climate-natural-resources'), 'WaterTech', 'WaterTech', 2, array['watertech']::text[], 1, true);
insert into public.topic_taxonomy (slug, parent_id, label_en, label_pt, depth, synonyms, taxonomy_version, is_active) values ('bluetech-oceantech', (select id from public.topic_taxonomy where slug = 'food-climate-natural-resources'), 'BlueTech & OceanTech', 'BlueTech e OceanTech', 2, array['bluetech','oceantech']::text[], 1, true);
insert into public.topic_taxonomy (slug, parent_id, label_en, label_pt, depth, synonyms, taxonomy_version, is_active) values ('deeptech', (select id from public.topic_taxonomy where slug = 'deeptech-industry-infrastructure'), 'DeepTech', 'DeepTech', 2, array['deeptech']::text[], 1, true);
insert into public.topic_taxonomy (slug, parent_id, label_en, label_pt, depth, synonyms, taxonomy_version, is_active) values ('industrialtech-advanced-manufacturing', (select id from public.topic_taxonomy where slug = 'deeptech-industry-infrastructure'), 'IndustrialTech & Advanced Manufacturing', 'IndustrialTech e Fabricação Avançada', 2, array['industrialtech','advanced manufacturing','fabricação avançada']::text[], 1, true);
insert into public.topic_taxonomy (slug, parent_id, label_en, label_pt, depth, synonyms, taxonomy_version, is_active) values ('robotics-automation', (select id from public.topic_taxonomy where slug = 'deeptech-industry-infrastructure'), 'Robotics & Automation', 'Robótica e Automação', 2, array['robotics','automation','robótica','automação']::text[], 1, true);
insert into public.topic_taxonomy (slug, parent_id, label_en, label_pt, depth, synonyms, taxonomy_version, is_active) values ('semiconductors-electronics', (select id from public.topic_taxonomy where slug = 'deeptech-industry-infrastructure'), 'Semiconductors & Electronics', 'Semicondutores e Eletrónica', 2, array['semiconductors','electronics','semicondutores','eletrónica']::text[], 1, true);
insert into public.topic_taxonomy (slug, parent_id, label_en, label_pt, depth, synonyms, taxonomy_version, is_active) values ('advanced-materials-chemicals', (select id from public.topic_taxonomy where slug = 'deeptech-industry-infrastructure'), 'Advanced Materials & Chemicals', 'Materiais Avançados e Químicos', 2, array['advanced materials','chemicals','materiais avançados']::text[], 1, true);
insert into public.topic_taxonomy (slug, parent_id, label_en, label_pt, depth, synonyms, taxonomy_version, is_active) values ('aerospace-spacetech', (select id from public.topic_taxonomy where slug = 'deeptech-industry-infrastructure'), 'Aerospace & SpaceTech', 'Aeroespacial e SpaceTech', 2, array['aerospace','spacetech','aeroespacial']::text[], 1, true);
insert into public.topic_taxonomy (slug, parent_id, label_en, label_pt, depth, synonyms, taxonomy_version, is_active) values ('defence-dual-use', (select id from public.topic_taxonomy where slug = 'deeptech-industry-infrastructure'), 'Defence & Dual-Use', 'Defesa e Uso Dual', 2, array['defence','defense','dual-use','defesa']::text[], 1, true);
insert into public.topic_taxonomy (slug, parent_id, label_en, label_pt, depth, synonyms, taxonomy_version, is_active) values ('automotive-mobility-transportation', (select id from public.topic_taxonomy where slug = 'deeptech-industry-infrastructure'), 'Automotive, Mobility & Transportation', 'Automóvel, Mobilidade e Transportes', 2, array['automotive','mobility','transportation','mobilidade','transportes']::text[], 1, true);
insert into public.topic_taxonomy (slug, parent_id, label_en, label_pt, depth, synonyms, taxonomy_version, is_active) values ('logistics-supply-chain', (select id from public.topic_taxonomy where slug = 'deeptech-industry-infrastructure'), 'Logistics & Supply Chain', 'Logística e Cadeia de Abastecimento', 2, array['logistics','supply chain','logística']::text[], 1, true);
insert into public.topic_taxonomy (slug, parent_id, label_en, label_pt, depth, synonyms, taxonomy_version, is_active) values ('constructiontech-infrastructure', (select id from public.topic_taxonomy where slug = 'deeptech-industry-infrastructure'), 'ConstructionTech & Infrastructure', 'ConstructionTech e Infraestrutura', 2, array['constructiontech','infrastructure','infraestrutura']::text[], 1, true);
insert into public.topic_taxonomy (slug, parent_id, label_en, label_pt, depth, synonyms, taxonomy_version, is_active) values ('telecommunications-connectivity', (select id from public.topic_taxonomy where slug = 'deeptech-industry-infrastructure'), 'Telecommunications & Connectivity', 'Telecomunicações e Conectividade', 2, array['telecommunications','connectivity','telecomunicações']::text[], 1, true);
insert into public.topic_taxonomy (slug, parent_id, label_en, label_pt, depth, synonyms, taxonomy_version, is_active) values ('enterprise-software-saas', (select id from public.topic_taxonomy where slug = 'software-digital-services'), 'Enterprise Software & SaaS', 'Software Empresarial e SaaS', 2, array['enterprise software','saas','software empresarial']::text[], 1, true);
insert into public.topic_taxonomy (slug, parent_id, label_en, label_pt, depth, synonyms, taxonomy_version, is_active) values ('ai-data-analytics', (select id from public.topic_taxonomy where slug = 'software-digital-services'), 'AI, Data & Analytics', 'IA, Dados e Analítica', 2, array['ai','artificial intelligence','data','analytics','inteligência artificial','dados']::text[], 1, true);
insert into public.topic_taxonomy (slug, parent_id, label_en, label_pt, depth, synonyms, taxonomy_version, is_active) values ('developer-tools-cloud-infrastructure', (select id from public.topic_taxonomy where slug = 'software-digital-services'), 'Developer Tools & Cloud Infrastructure', 'Ferramentas de Programação e Infraestrutura Cloud', 2, array['developer tools','cloud infrastructure','devtools']::text[], 1, true);
insert into public.topic_taxonomy (slug, parent_id, label_en, label_pt, depth, synonyms, taxonomy_version, is_active) values ('cybersecurity', (select id from public.topic_taxonomy where slug = 'software-digital-services'), 'Cybersecurity', 'Cibersegurança', 2, array['cybersecurity','cibersegurança','ciberseguridad']::text[], 1, true);
insert into public.topic_taxonomy (slug, parent_id, label_en, label_pt, depth, synonyms, taxonomy_version, is_active) values ('fintech-insurtech', (select id from public.topic_taxonomy where slug = 'software-digital-services'), 'FinTech & InsurTech', 'FinTech e InsurTech', 2, array['fintech','insurtech']::text[], 1, true);
insert into public.topic_taxonomy (slug, parent_id, label_en, label_pt, depth, synonyms, taxonomy_version, is_active) values ('legaltech-regtech', (select id from public.topic_taxonomy where slug = 'software-digital-services'), 'LegalTech & RegTech', 'LegalTech e RegTech', 2, array['legaltech','regtech']::text[], 1, true);
insert into public.topic_taxonomy (slug, parent_id, label_en, label_pt, depth, synonyms, taxonomy_version, is_active) values ('govtech', (select id from public.topic_taxonomy where slug = 'software-digital-services'), 'GovTech', 'GovTech', 2, array['govtech']::text[], 1, true);
insert into public.topic_taxonomy (slug, parent_id, label_en, label_pt, depth, synonyms, taxonomy_version, is_active) values ('hrtech-future-of-work', (select id from public.topic_taxonomy where slug = 'software-digital-services'), 'HRTech & Future of Work', 'HRTech e Futuro do Trabalho', 2, array['hrtech','future of work','futuro do trabalho']::text[], 1, true);
insert into public.topic_taxonomy (slug, parent_id, label_en, label_pt, depth, synonyms, taxonomy_version, is_active) values ('edtech', (select id from public.topic_taxonomy where slug = 'software-digital-services'), 'EdTech', 'EdTech', 2, array['edtech']::text[], 1, true);
insert into public.topic_taxonomy (slug, parent_id, label_en, label_pt, depth, synonyms, taxonomy_version, is_active) values ('proptech', (select id from public.topic_taxonomy where slug = 'software-digital-services'), 'PropTech', 'PropTech', 2, array['proptech']::text[], 1, true);
insert into public.topic_taxonomy (slug, parent_id, label_en, label_pt, depth, synonyms, taxonomy_version, is_active) values ('retailtech-ecommerce', (select id from public.topic_taxonomy where slug = 'software-digital-services'), 'RetailTech & E-commerce', 'RetailTech e E-commerce', 2, array['retailtech','e-commerce','ecommerce']::text[], 1, true);
insert into public.topic_taxonomy (slug, parent_id, label_en, label_pt, depth, synonyms, taxonomy_version, is_active) values ('marketingtech-adtech', (select id from public.topic_taxonomy where slug = 'software-digital-services'), 'MarketingTech & AdTech', 'MarketingTech e AdTech', 2, array['marketingtech','adtech']::text[], 1, true);
insert into public.topic_taxonomy (slug, parent_id, label_en, label_pt, depth, synonyms, taxonomy_version, is_active) values ('traveltech-hospitality', (select id from public.topic_taxonomy where slug = 'software-digital-services'), 'TravelTech & Hospitality', 'TravelTech e Hotelaria', 2, array['traveltech','hospitality','hotelaria']::text[], 1, true);
insert into public.topic_taxonomy (slug, parent_id, label_en, label_pt, depth, synonyms, taxonomy_version, is_active) values ('gaming-media-entertainment', (select id from public.topic_taxonomy where slug = 'software-digital-services'), 'Gaming, Media & Entertainment', 'Jogos, Media e Entretenimento', 2, array['gaming','media','entertainment','jogos','entretenimento']::text[], 1, true);
insert into public.topic_taxonomy (slug, parent_id, label_en, label_pt, depth, synonyms, taxonomy_version, is_active) values ('consumer-products-services', (select id from public.topic_taxonomy where slug = 'consumer-impact'), 'Consumer Products & Services', 'Produtos e Serviços de Consumo', 2, array['consumer products','consumer services','produtos de consumo']::text[], 1, true);
insert into public.topic_taxonomy (slug, parent_id, label_en, label_pt, depth, synonyms, taxonomy_version, is_active) values ('fashion-beauty', (select id from public.topic_taxonomy where slug = 'consumer-impact'), 'Fashion & Beauty', 'Moda e Beleza', 2, array['fashion','beauty','moda','beleza']::text[], 1, true);
insert into public.topic_taxonomy (slug, parent_id, label_en, label_pt, depth, synonyms, taxonomy_version, is_active) values ('sports-fitness-wellness', (select id from public.topic_taxonomy where slug = 'consumer-impact'), 'Sports, Fitness & Wellness', 'Desporto, Fitness e Bem-estar', 2, array['sports','fitness','wellness','desporto']::text[], 1, true);
insert into public.topic_taxonomy (slug, parent_id, label_en, label_pt, depth, synonyms, taxonomy_version, is_active) values ('pettech', (select id from public.topic_taxonomy where slug = 'consumer-impact'), 'PetTech', 'PetTech', 2, array['pettech']::text[], 1, true);
insert into public.topic_taxonomy (slug, parent_id, label_en, label_pt, depth, synonyms, taxonomy_version, is_active) values ('social-impact-financial-inclusion', (select id from public.topic_taxonomy where slug = 'consumer-impact'), 'Social Impact & Financial Inclusion', 'Impacto Social e Inclusão Financeira', 2, array['social impact','financial inclusion','impacto social','inclusão financeira']::text[], 1, true);
insert into public.topic_taxonomy (slug, parent_id, label_en, label_pt, depth, synonyms, taxonomy_version, is_active) values ('smart-cities', (select id from public.topic_taxonomy where slug = 'consumer-impact'), 'Smart Cities', 'Cidades Inteligentes', 2, array['smart cities','cidades inteligentes','ciudades inteligentes']::text[], 1, true);
insert into public.topic_taxonomy (slug, parent_id, label_en, label_pt, depth, synonyms, taxonomy_version, is_active) values ('oncology', (select id from public.topic_taxonomy where slug = 'biotechnology-life-sciences'), 'Oncology', 'Oncologia', 3, array['oncology','oncologia','oncología','cancer','cancro','cáncer','onkologie','oncologie']::text[], 1, true);
insert into public.topic_taxonomy (slug, parent_id, label_en, label_pt, depth, synonyms, taxonomy_version, is_active) values ('oncology-prostate-cancer', (select id from public.topic_taxonomy where slug = 'oncology'), 'Prostate Cancer', 'Cancro da Próstata', 4, array['prostate cancer','cancro da próstata','cáncer de próstata','prostatakrebs','cancer de la prostate']::text[], 1, true);
insert into public.topic_taxonomy (slug, parent_id, label_en, label_pt, depth, synonyms, taxonomy_version, is_active) values ('oncology-breast-cancer', (select id from public.topic_taxonomy where slug = 'oncology'), 'Breast Cancer', 'Cancro da Mama', 4, array['breast cancer','cancro da mama','cáncer de mama','brustkrebs','cancer du sein']::text[], 1, true);
insert into public.topic_taxonomy (slug, parent_id, label_en, label_pt, depth, synonyms, taxonomy_version, is_active) values ('oncology-colorectal-cancer', (select id from public.topic_taxonomy where slug = 'oncology'), 'Colorectal Cancer', 'Cancro Colorretal', 4, array['colorectal cancer','cancro colorretal','cáncer colorrectal','darmkrebs','cancer colorectal']::text[], 1, true);
insert into public.topic_taxonomy (slug, parent_id, label_en, label_pt, depth, synonyms, taxonomy_version, is_active) values ('oncology-lung-cancer', (select id from public.topic_taxonomy where slug = 'oncology'), 'Lung Cancer', 'Cancro do Pulmão', 4, array['lung cancer','cancro do pulmão','cáncer de pulmón','lungenkrebs','cancer du poumon']::text[], 1, true);
insert into public.topic_taxonomy (slug, parent_id, label_en, label_pt, depth, synonyms, taxonomy_version, is_active) values ('diagnostics-early-detection', (select id from public.topic_taxonomy where slug = 'diagnostics'), 'Early Detection', 'Deteção Precoce', 3, array['early detection','deteção precoce','detección precoz','screening','rastreio']::text[], 1, true);
insert into public.topic_taxonomy (slug, parent_id, label_en, label_pt, depth, synonyms, taxonomy_version, is_active) values ('diagnostics-biomarkers', (select id from public.topic_taxonomy where slug = 'diagnostics'), 'Biomarkers', 'Biomarcadores', 3, array['biomarkers','biomarcadores']::text[], 1, true);
insert into public.topic_taxonomy (slug, parent_id, label_en, label_pt, depth, synonyms, taxonomy_version, is_active) values ('diagnostics-biosensors', (select id from public.topic_taxonomy where slug = 'diagnostics'), 'Biosensors', 'Biossensores', 3, array['biosensors','biossensores','biosensores']::text[], 1, true);
insert into public.topic_taxonomy (slug, parent_id, label_en, label_pt, depth, synonyms, taxonomy_version, is_active) values ('diagnostics-urinalysis', (select id from public.topic_taxonomy where slug = 'diagnostics'), 'Urinalysis', 'Urinálise', 3, array['urinalysis','urinálise','urianálisis','urine test']::text[], 1, true);
insert into public.topic_taxonomy (slug, parent_id, label_en, label_pt, depth, synonyms, taxonomy_version, is_active) values ('diagnostics-imaging', (select id from public.topic_taxonomy where slug = 'diagnostics'), 'Imaging', 'Imagiologia', 3, array['imaging','imagiologia','imagenología']::text[], 1, true);
insert into public.topic_taxonomy (slug, parent_id, label_en, label_pt, depth, synonyms, taxonomy_version, is_active) values ('digital-health-remote-monitoring', (select id from public.topic_taxonomy where slug = 'digital-health'), 'Remote Monitoring', 'Monitorização Remota', 3, array['remote monitoring','monitorização remota','monitorización remota','rpm']::text[], 1, true);
insert into public.topic_taxonomy (slug, parent_id, label_en, label_pt, depth, synonyms, taxonomy_version, is_active) values ('digital-health-womens-health', (select id from public.topic_taxonomy where slug = 'digital-health'), 'Women''s Health', 'Saúde da Mulher', 3, array['women''s health','saúde da mulher','salud de la mujer','femtech']::text[], 1, true);
insert into public.topic_taxonomy (slug, parent_id, label_en, label_pt, depth, synonyms, taxonomy_version, is_active) values ('digital-health-mens-health', (select id from public.topic_taxonomy where slug = 'digital-health'), 'Men''s Health', 'Saúde Masculina', 3, array['men''s health','saúde masculina','salud del hombre']::text[], 1, true);
insert into public.topic_taxonomy (slug, parent_id, label_en, label_pt, depth, synonyms, taxonomy_version, is_active) values ('digital-health-aging-longevity', (select id from public.topic_taxonomy where slug = 'digital-health'), 'Aging & Longevity Tech', 'Envelhecimento e Longevidade', 3, array['aging','longevity tech','envelhecimento','envejecimiento']::text[], 1, true);
insert into public.topic_taxonomy (slug, parent_id, label_en, label_pt, depth, synonyms, taxonomy_version, is_active) values ('medtech-wearables', (select id from public.topic_taxonomy where slug = 'medtech-medical-devices'), 'Wearables', 'Wearables', 3, array['wearables','wearable devices','dispositivos vestíveis']::text[], 1, true);
insert into public.topic_taxonomy (slug, parent_id, label_en, label_pt, depth, synonyms, taxonomy_version, is_active) values ('medtech-ivd', (select id from public.topic_taxonomy where slug = 'medtech-medical-devices'), 'In Vitro Diagnostics (IVD)', 'Diagnóstico In Vitro (IVD)', 3, array['ivd','in vitro diagnostics','diagnóstico in vitro']::text[], 1, true);
insert into public.topic_taxonomy (slug, parent_id, label_en, label_pt, depth, synonyms, taxonomy_version, is_active) values ('medtech-point-of-care', (select id from public.topic_taxonomy where slug = 'medtech-medical-devices'), 'Point of Care', 'Ponto de Cuidado', 3, array['point of care','poc','ponto de cuidado','punto de atención']::text[], 1, true);

-- ============================================================
-- org_topics — derived from sectors, declared by the founder (max 8,
-- enforced app-side by the same picker pattern as SectorPicker.tsx), or
-- caught by the dictionary in the startup's own description. Composite
-- PK includes `source` (not just org_id+topic_id) so a topic reachable via
-- more than one path (e.g. derived AND declared) keeps both rows — a
-- founder removing a dictionary-sourced suggestion must not also delete
-- a `declared` row for the same topic if one exists. This is a deliberate
-- widening of the prompt's own literal "pk composto (org_id, topic_id)"
-- for exactly that reason.
-- ============================================================
create table public.org_topics (
  org_id uuid not null references public.orgs(id) on delete cascade,
  topic_id uuid not null references public.topic_taxonomy(id) on delete cascade,
  source text not null check (source in ('derived_from_sectors', 'declared', 'dictionary')),
  created_at timestamptz not null default now(),
  primary key (org_id, topic_id, source)
);

create index org_topics_topic_id_idx on public.org_topics(topic_id);

alter table public.org_topics enable row level security;

create policy org_topics_read on public.org_topics for select
  using (is_platform_admin() or is_org_member(org_id));
create policy org_topics_admin_write on public.org_topics for all
  using (is_platform_admin()) with check (is_platform_admin());

-- ============================================================
-- catalog_evidence — the unit. No url, no row (app-level rule; the schema
-- also carries a not-null constraint so this can never be bypassed by a
-- direct insert either).
-- ============================================================
create table public.catalog_evidence (
  id uuid primary key default uuid_generate_v4(),
  person_id uuid references public.catalog_people(id) on delete cascade,
  entity_id uuid references public.catalog_entities(id) on delete cascade,
  kind public.evidence_kind not null,
  title text not null,
  url text not null,
  published_at date,
  excerpt text check (excerpt is null or char_length(excerpt) <= 600),
  language text,
  polarity public.evidence_polarity not null default 'neutral',
  strength smallint not null check (strength between 1 and 4),
  is_personal boolean not null default false,
  origin public.evidence_origin not null,
  status public.evidence_status not null default 'found',
  created_by_org_id uuid references public.orgs(id) on delete set null,
  verified_by uuid references auth.users(id) on delete set null,
  verified_at timestamptz,
  provenance jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (person_id is not null or entity_id is not null),
  check (origin <> 'founder' or created_by_org_id is not null)
);

-- source_domain: generated from the (caller-normalized) url — used for
-- the "team's own domain" photo-source check and for display grouping.
alter table public.catalog_evidence add column source_domain text
  generated always as (lower(regexp_replace(regexp_replace(url, '^[a-zA-Z]+://', ''), '[/?#].*$', ''))) stored;

-- content_hash: idempotency key for import/backfill — one row per
-- (subject, url, excerpt). A null excerpt still hashes deterministically
-- (md5 of empty string), so two re-imports of the exact same bio-derived
-- evidence (no excerpt) collide correctly instead of duplicating.
alter table public.catalog_evidence add column content_hash text
  generated always as (
    md5(coalesce(person_id::text, '') || '|' || coalesce(entity_id::text, '') || '|' || url || '|' || md5(coalesce(excerpt, '')))
  ) stored;
create unique index catalog_evidence_content_hash_uidx on public.catalog_evidence(content_hash);

create index catalog_evidence_person_id_idx on public.catalog_evidence(person_id) where person_id is not null;
create index catalog_evidence_entity_id_idx on public.catalog_evidence(entity_id) where entity_id is not null;
create index catalog_evidence_status_idx on public.catalog_evidence(status);
create index catalog_evidence_created_by_org_id_idx on public.catalog_evidence(created_by_org_id) where created_by_org_id is not null;

create trigger catalog_evidence_touch before update on public.catalog_evidence
  for each row execute function touch_updated_at();

alter table public.catalog_evidence enable row level security;

-- Same shape as catalog_people_research_read (0146 l.251-260): admin, or
-- an org member whose org has the linked entity (directly, or via the
-- person's affiliation) in catalog_deliveries — i.e. "delivered to your
-- pipeline". A `quarantined` row is additionally visible to the org that
-- proposed it, so a founder can see their own pending proposal.
create policy catalog_evidence_read on public.catalog_evidence for select
  using (
    is_platform_admin()
    or (
      status in ('found', 'verified')
      and (
        (entity_id is not null and exists (
          select 1 from public.catalog_deliveries cd
          where cd.catalog_id = catalog_evidence.entity_id and is_org_member(cd.org_id)
        ))
        or (person_id is not null and exists (
          select 1 from public.catalog_person_affiliations cpa
          join public.catalog_deliveries cd on cd.catalog_id = cpa.entity_id
          where cpa.person_id = catalog_evidence.person_id and is_org_member(cd.org_id)
        ))
      )
    )
    or (status = 'quarantined' and created_by_org_id is not null and is_org_member(created_by_org_id))
  );
create policy catalog_evidence_admin_write on public.catalog_evidence for all
  using (is_platform_admin()) with check (is_platform_admin());
-- No founder-insert policy: a founder's "propose evidence" write goes
-- through a service-role API route (Phase 3), same pattern as every other
-- privileged write in this codebase (never a direct RLS-permitted client
-- insert) — matches the prompt's own §A: "Escrita: is_platform_admin() e
-- service role; founder só por rota".

revoke all on public.catalog_evidence from anon, authenticated;
grant select on public.catalog_evidence to authenticated;

-- ============================================================
-- catalog_evidence_topics — tags on an evidence row.
-- ============================================================
create table public.catalog_evidence_topics (
  evidence_id uuid not null references public.catalog_evidence(id) on delete cascade,
  topic_id uuid not null references public.topic_taxonomy(id) on delete cascade,
  confidence numeric,
  tag_source public.evidence_tag_source not null,
  primary key (evidence_id, topic_id)
);

create index catalog_evidence_topics_topic_id_idx on public.catalog_evidence_topics(topic_id);

alter table public.catalog_evidence_topics enable row level security;

-- Readable wherever the parent evidence row is readable; no separate
-- write policy (admin/service-role only, same as the parent table).
create policy catalog_evidence_topics_read on public.catalog_evidence_topics for select
  using (
    is_platform_admin()
    or exists (select 1 from public.catalog_evidence ce where ce.id = catalog_evidence_topics.evidence_id)
  );
create policy catalog_evidence_topics_admin_write on public.catalog_evidence_topics for all
  using (is_platform_admin()) with check (is_platform_admin());

revoke all on public.catalog_evidence_topics from anon, authenticated;
grant select on public.catalog_evidence_topics to authenticated;

-- ============================================================
-- Backfill — idempotent (content_hash unique index makes a re-run of this
-- migration's own inserts a no-op via on conflict do nothing; this
-- matters because Supabase migrations can be replayed against a branch).
-- ============================================================

-- 1) catalog_entity_enrichment_sources -> evidence. source_type is one of
--    exactly two real values in this codebase today ('team_page',
--    'web_search' — confirmed by grepping the worker) — mapped
--    conservatively: 'team_page' -> bio (it's the entity's own about/team
--    page), 'web_search' -> other (we don't actually know what kind of
--    page it turned out to be, so 'article_about' would overclaim).
--    strength 2 (participation/mention-level) for both — this backfill
--    has no basis to claim a stronger, interview-quote-level signal.
insert into public.catalog_evidence (person_id, entity_id, kind, title, url, published_at, excerpt, polarity, strength, is_personal, origin, status, provenance)
select
  s.person_id, s.entity_id,
  case s.source_type when 'team_page' then 'bio'::evidence_kind else 'other'::evidence_kind end,
  coalesce(s.notes, s.source_type, 'Enrichment source'),
  s.source_url,
  case when s.published_at ~ '^\d{4}-\d{2}-\d{2}$' then s.published_at::date else null end,
  null, 'neutral', 2, false, 'backfill', 'found',
  jsonb_build_object('backfilled_from', 'catalog_entity_enrichment_sources', 'source_id', s.id, 'batch_id', s.batch_id)
from public.catalog_entity_enrichment_sources s
where s.source_url is not null and length(trim(s.source_url)) > 0
on conflict (content_hash) do nothing;

-- 2) catalog_people_research.bio_raw -> evidence, kind='bio'. Rule 2
--    applies literally here: no url, no row — a bio with no linkedin_url
--    AND no derivable team-page url is skipped, not defaulted to some
--    made-up url. Counted via the NOTICE below.
do $$
declare
  v_created int;
  v_skipped_no_url int;
begin
  with candidates as (
    select
      r.person_id,
      p.entity_id as primary_entity_id,
      r.bio_raw,
      coalesce(
        (select ce.website from public.catalog_entities ce
          join public.catalog_person_affiliations cpa on cpa.entity_id = ce.id
          where cpa.person_id = r.person_id and cpa.is_primary and ce.website is not null
          limit 1),
        p.linkedin_url
      ) as evidence_url
    from public.catalog_people_research r
    join public.catalog_people p on p.id = r.person_id
    where r.bio_raw is not null and length(trim(r.bio_raw)) > 0
  ),
  inserted as (
    insert into public.catalog_evidence (person_id, entity_id, kind, title, url, excerpt, polarity, strength, is_personal, origin, status, provenance)
    select
      person_id, primary_entity_id, 'bio', 'Public bio', evidence_url,
      left(bio_raw, 600), 'neutral', 2, false, 'backfill', 'found',
      jsonb_build_object('backfilled_from', 'catalog_people_research.bio_raw')
    from candidates
    where evidence_url is not null
    on conflict (content_hash) do nothing
    returning 1
  )
  select count(*) into v_created from inserted;
  select count(*) into v_skipped_no_url from candidates where evidence_url is null;
  raise notice 'catalog_evidence backfill (bio_raw): % created, % skipped for having no url', v_created, v_skipped_no_url;
end $$;

-- 3) Portfolio structure — checked against the real schema before writing
--    this: matchdeal_profiles.portfolio_companies is a single free-text
--    column (migration 0053), not a structured per-company table with
--    per-company sectors. Per the prompt's own instruction ("se não
--    existir estrutura, não inventar"), no investment-kind evidence rows
--    are created here. Reported as a finding, not silently skipped.
do $$
begin
  raise notice 'catalog_evidence backfill (investments): no structured portfolio-company table exists (matchdeal_profiles.portfolio_companies is free text) — no investment-kind evidence created, per "no structure, do not invent".';
end $$;

-- ============================================================
-- org_topics backfill — derive from each org's confirmed sectors
-- (orgs.sectors, matched against topic_taxonomy by exact label; sectors
-- stores display names verbatim per src/lib/sector-taxonomy.ts, so a
-- direct label_en match is correct and requires no slugify step here).
-- ============================================================
insert into public.org_topics (org_id, topic_id, source)
select distinct o.id, t.id, 'derived_from_sectors'
from public.orgs o
cross join lateral unnest(o.sectors) as sec(name)
join public.topic_taxonomy t on t.label_en = sec.name and t.depth = 2
on conflict (org_id, topic_id, source) do nothing;

-- ============================================================
-- evidence_tagging_queue — §B.4's AI-fallback queue. Same shape as the
-- existing enrichment_jobs table (0146), narrowed to one target column
-- since evidence rows are the only target here.
-- ============================================================
create table public.evidence_tagging_queue (
  id uuid primary key default uuid_generate_v4(),
  evidence_id uuid not null references public.catalog_evidence(id) on delete cascade,
  status text not null default 'queued' check (status in ('queued', 'running', 'done', 'failed', 'skipped')),
  attempts int not null default 0,
  last_error text,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz,
  model text,
  tokens_in int,
  tokens_out int,
  cost_eur numeric(10, 5)
);

create unique index evidence_tagging_queue_one_active_per_evidence
  on public.evidence_tagging_queue (evidence_id)
  where status in ('queued', 'running');

create index evidence_tagging_queue_queue_order_idx
  on public.evidence_tagging_queue (created_at) where status = 'queued';

alter table public.evidence_tagging_queue enable row level security;
create policy evidence_tagging_queue_admin_only on public.evidence_tagging_queue for all
  using (is_platform_admin()) with check (is_platform_admin());
revoke all on public.evidence_tagging_queue from anon, authenticated;

-- ============================================================
-- Dictionary tagging function — §B.3/§B.4's deterministic pass, callable
-- at insert time (future evidence rows, wired into a writer in a later
-- phase) and run once below over the backfilled rows. Per-topic: longest
-- matching synonym wins. Across topics: capped at 5, longest first.
--
-- Disclosed simplification vs. src/lib/topic-matcher.ts (the tested TS
-- reference implementation used for the app's own matcher tests): this
-- SQL version does not suppress a broader topic ("oncology") when a more
-- specific overlapping child topic also matched the same span ("breast
-- cancer") — it tags both if both synonyms are present in the text.
-- Acceptable for a bulk/trigger tagging pass; a real, bounded v1 gap
-- versus the TS matcher's overlap logic, not silently glossed over.
-- ============================================================
create or replace function public.catalog_tag_evidence_dictionary(p_evidence_id uuid)
returns int language plpgsql as $$
declare
  v_text text;
  v_count int := 0;
begin
  select lower(extensions.unaccent(coalesce(title, '') || ' ' || coalesce(excerpt, '')))
  into v_text
  from public.catalog_evidence where id = p_evidence_id;

  if v_text is null or length(trim(v_text)) = 0 then return 0; end if;

  with syn as (
    select t.id as topic_id, s as synonym, length(s) as syn_len
    from public.topic_taxonomy t
    cross join lateral unnest(t.synonyms) as s
    where t.is_active
  ),
  matched as (
    select topic_id, synonym, syn_len,
      row_number() over (partition by topic_id order by syn_len desc) as rn
    from syn
    where v_text ~* ('\y' || regexp_replace(lower(extensions.unaccent(synonym)), '([.^$*+?()\[\]{}|\\])', '\\\1', 'g') || '\y')
  ),
  best_per_topic as (
    select topic_id, synonym, syn_len from matched where rn = 1
  ),
  ranked as (
    select topic_id, row_number() over (order by syn_len desc) as overall_rank
    from best_per_topic
  ),
  capped as (
    select topic_id from ranked where overall_rank <= 5
  )
  insert into public.catalog_evidence_topics (evidence_id, topic_id, confidence, tag_source)
  select p_evidence_id, topic_id, 1.0, 'dictionary' from capped
  on conflict (evidence_id, topic_id) do nothing;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.catalog_tag_evidence_dictionary(uuid) from public, anon, authenticated;

-- One-time, set-based run of the dictionary pass over every backfilled
-- evidence row (the per-row PL/pgSQL-loop version of this timed out in
-- practice at ~4987 rows; this CTE-based form runs as one planned query).
with ev as materialized (
  select id as evidence_id, lower(extensions.unaccent(coalesce(title, '') || ' ' || coalesce(excerpt, ''))) as norm_text
  from public.catalog_evidence
),
syn as materialized (
  select t.id as topic_id, length(s) as syn_len,
    '\y' || regexp_replace(lower(extensions.unaccent(s)), '([.^$*+?()\[\]{}|\\])', '\\\1', 'g') || '\y' as pat
  from public.topic_taxonomy t cross join lateral unnest(t.synonyms) as s
  where t.is_active
),
matched as (
  select ev.evidence_id, syn.topic_id, syn.syn_len,
    row_number() over (partition by ev.evidence_id, syn.topic_id order by syn.syn_len desc) as rn
  from ev join syn on ev.norm_text ~* syn.pat
),
best_per_topic as (
  select evidence_id, topic_id, syn_len from matched where rn = 1
),
capped as (
  select evidence_id, topic_id from (
    select evidence_id, topic_id, row_number() over (partition by evidence_id order by syn_len desc) as overall_rank
    from best_per_topic
  ) x where overall_rank <= 5
)
insert into public.catalog_evidence_topics (evidence_id, topic_id, confidence, tag_source)
select evidence_id, topic_id, 1.0, 'dictionary' from capped
on conflict (evidence_id, topic_id) do nothing;

-- Enqueue every still-untagged evidence row with enough text to plausibly
-- contain a topic (≥300 chars) for the AI fallback (§B.4). The remainder
-- (mostly generic 'team_page'/'web_search' backfill rows with no excerpt)
-- correctly stays untagged and un-queued — no AI spend on text too short
-- to judge.
insert into public.evidence_tagging_queue (evidence_id)
select ce.id
from public.catalog_evidence ce
where not exists (select 1 from public.catalog_evidence_topics cet where cet.evidence_id = ce.id)
  and coalesce(length(ce.title), 0) + coalesce(length(ce.excerpt), 0) >= 300
on conflict do nothing;
