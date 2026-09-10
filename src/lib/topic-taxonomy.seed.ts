// Prompt 585 §B.1 — versioned seed for `topic_taxonomy`. This file is the
// SOURCE OF TRUTH for the taxonomy content; the migration that creates
// `topic_taxonomy` inserts these exact rows (generated once via a disposable
// script, pasted into the migration as plain SQL — migrations in this repo
// are static .sql files, never a script import).
//
// Level 1 = the 5 real groups in src/lib/sector-taxonomy.ts (SECTOR_TAXONOMY
// has 5 groups / 51 sectors — NOT "6 groups / 56 sectors" as an earlier,
// stale description of this taxonomy claimed; verified directly against
// that file before writing this seed). Level 2 = the 51 sectors, one topic
// per sector, slug independent of the sector's display name but stable and
// kebab-cased from it, so `org_topics` derived-from-sectors mapping is a
// simple slugify(sector name) lookup, no translation table. Level 3+ exists
// ONLY under Health & Life Sciences (Nuno's decision, 2026-09-10: deep
// health/medtech/biotech taxonomy now, the other 4 groups stay at depth 2
// for v1) — the sub-tree below mirrors the prompt's own worked example
// (oncology by cancer type; diagnostics by modality; digital health by
// population/monitoring mode; devices by form factor).
//
// Synonyms are multilingual where the taxonomy goes deep (health): en/pt/es
// filled in for every node in that sub-tree (matches the Verify section's
// own test languages); fr/de added only where an obvious, unambiguous term
// exists rather than guessed — noted as a deliberate v1 simplification in
// the report, not silently done.

export interface TopicSeedNode {
  slug: string;
  parentSlug: string | null;
  labelEn: string;
  labelPt: string;
  depth: number;
  synonyms: string[];
}

// ---- Level 1: the 5 real sector groups -----------------------------------
const GROUPS: TopicSeedNode[] = [
  { slug: 'health-life-sciences', parentSlug: null, labelEn: 'Health & Life Sciences', labelPt: 'Saúde e Ciências da Vida', depth: 1, synonyms: ['health', 'life sciences', 'saúde', 'ciências da vida', 'salud'] },
  { slug: 'food-climate-natural-resources', parentSlug: null, labelEn: 'Food, Climate & Natural Resources', labelPt: 'Alimentação, Clima e Recursos Naturais', depth: 1, synonyms: ['food', 'climate', 'natural resources', 'alimentação', 'clima', 'recursos naturais', 'alimentación', 'clima', 'recursos naturales'] },
  { slug: 'deeptech-industry-infrastructure', parentSlug: null, labelEn: 'DeepTech, Industry & Infrastructure', labelPt: 'DeepTech, Indústria e Infraestrutura', depth: 1, synonyms: ['deeptech', 'industry', 'infrastructure', 'indústria', 'infraestrutura', 'industria', 'infraestructura'] },
  { slug: 'software-digital-services', parentSlug: null, labelEn: 'Software & Digital Services', labelPt: 'Software e Serviços Digitais', depth: 1, synonyms: ['software', 'digital services', 'serviços digitais', 'servicios digitales'] },
  { slug: 'consumer-impact', parentSlug: null, labelEn: 'Consumer & Impact', labelPt: 'Consumo e Impacto', depth: 1, synonyms: ['consumer', 'impact', 'consumo', 'impacto'] },
];

// ---- Level 2: the 51 sectors, one per src/lib/sector-taxonomy.ts entry ---
// slug/labelEn/labelPt/parentSlug only here; synonyms filled generously only
// for the Health & Life Sciences sectors (where the deep sub-tree lives and
// where matcher precision matters most for this prompt's own fixtures),
// a minimal single EN synonym elsewhere (the sector name itself, lowercased)
// so the matcher still has something to match on everywhere, without
// pretending a full multilingual pass was done outside health.
const SECTORS: TopicSeedNode[] = [
  // Health & Life Sciences (13)
  { slug: 'biotechnology-life-sciences', parentSlug: 'health-life-sciences', labelEn: 'Biotechnology & Life Sciences', labelPt: 'Biotecnologia e Ciências da Vida', depth: 2, synonyms: ['biotech', 'biotecnologia', 'biotecnología', 'life sciences'] },
  { slug: 'pharmaceuticals-therapeutics', parentSlug: 'health-life-sciences', labelEn: 'Pharmaceuticals & Therapeutics', labelPt: 'Farmacêutica e Terapêutica', depth: 2, synonyms: ['pharma', 'farmacêutica', 'farmacéutica', 'therapeutics', 'terapêutica'] },
  { slug: 'drug-discovery-development', parentSlug: 'health-life-sciences', labelEn: 'Drug Discovery & Development', labelPt: 'Descoberta e Desenvolvimento de Fármacos', depth: 2, synonyms: ['drug discovery', 'descoberta de fármacos', 'descubrimiento de fármacos'] },
  { slug: 'medtech-medical-devices', parentSlug: 'health-life-sciences', labelEn: 'MedTech & Medical Devices', labelPt: 'MedTech e Dispositivos Médicos', depth: 2, synonyms: ['medtech', 'medical devices', 'dispositivos médicos', 'dispositivos médicos'] },
  { slug: 'diagnostics', parentSlug: 'health-life-sciences', labelEn: 'Diagnostics', labelPt: 'Diagnóstico', depth: 2, synonyms: ['diagnostics', 'diagnóstico', 'diagnóstico', 'diagnostic'] },
  { slug: 'digital-health', parentSlug: 'health-life-sciences', labelEn: 'Digital Health', labelPt: 'Saúde Digital', depth: 2, synonyms: ['digital health', 'saúde digital', 'salud digital', 'e-health'] },
  { slug: 'healthcare-services-clinical-research', parentSlug: 'health-life-sciences', labelEn: 'Healthcare Services & Clinical Research', labelPt: 'Serviços de Saúde e Investigação Clínica', depth: 2, synonyms: ['healthcare services', 'clinical research', 'investigação clínica', 'investigación clínica'] },
  { slug: 'genomics-precision-medicine', parentSlug: 'health-life-sciences', labelEn: 'Genomics & Precision Medicine', labelPt: 'Genómica e Medicina de Precisão', depth: 2, synonyms: ['genomics', 'genómica', 'genómica', 'precision medicine', 'medicina de precisão'] },
  { slug: 'synthetic-biology', parentSlug: 'health-life-sciences', labelEn: 'Synthetic Biology', labelPt: 'Biologia Sintética', depth: 2, synonyms: ['synthetic biology', 'biologia sintética', 'biología sintética', 'synbio'] },
  { slug: 'femhealth', parentSlug: 'health-life-sciences', labelEn: 'FemHealth', labelPt: 'Saúde Feminina', depth: 2, synonyms: ['femhealth', 'femtech', 'saúde feminina', 'salud femenina', "women's health"] },
  { slug: 'mental-health', parentSlug: 'health-life-sciences', labelEn: 'Mental Health', labelPt: 'Saúde Mental', depth: 2, synonyms: ['mental health', 'saúde mental', 'salud mental'] },
  { slug: 'longevity-agetech-wellness', parentSlug: 'health-life-sciences', labelEn: 'Longevity, AgeTech & Wellness', labelPt: 'Longevidade, AgeTech e Bem-estar', depth: 2, synonyms: ['longevity', 'agetech', 'longevidade', 'longevidad', 'wellness', 'bem-estar'] },
  { slug: 'animal-health', parentSlug: 'health-life-sciences', labelEn: 'Animal Health', labelPt: 'Saúde Animal', depth: 2, synonyms: ['animal health', 'saúde animal', 'salud animal', 'veterinary'] },

  // Food, Climate & Natural Resources (7) — single-language synonym seed only
  { slug: 'agritech-foodtech', parentSlug: 'food-climate-natural-resources', labelEn: 'AgriTech & FoodTech', labelPt: 'AgriTech e FoodTech', depth: 2, synonyms: ['agritech', 'foodtech'] },
  { slug: 'alternative-proteins', parentSlug: 'food-climate-natural-resources', labelEn: 'Alternative Proteins', labelPt: 'Proteínas Alternativas', depth: 2, synonyms: ['alternative proteins', 'proteínas alternativas'] },
  { slug: 'climatetech-cleantech', parentSlug: 'food-climate-natural-resources', labelEn: 'ClimateTech & CleanTech', labelPt: 'ClimateTech e CleanTech', depth: 2, synonyms: ['climatetech', 'cleantech'] },
  { slug: 'energy-energy-storage', parentSlug: 'food-climate-natural-resources', labelEn: 'Energy & Energy Storage', labelPt: 'Energia e Armazenamento de Energia', depth: 2, synonyms: ['energy', 'energy storage', 'energia'] },
  { slug: 'circular-economy-waste', parentSlug: 'food-climate-natural-resources', labelEn: 'Circular Economy & Waste', labelPt: 'Economia Circular e Resíduos', depth: 2, synonyms: ['circular economy', 'economia circular', 'waste', 'resíduos'] },
  { slug: 'watertech', parentSlug: 'food-climate-natural-resources', labelEn: 'WaterTech', labelPt: 'WaterTech', depth: 2, synonyms: ['watertech'] },
  { slug: 'bluetech-oceantech', parentSlug: 'food-climate-natural-resources', labelEn: 'BlueTech & OceanTech', labelPt: 'BlueTech e OceanTech', depth: 2, synonyms: ['bluetech', 'oceantech'] },

  // DeepTech, Industry & Infrastructure (11)
  { slug: 'deeptech', parentSlug: 'deeptech-industry-infrastructure', labelEn: 'DeepTech', labelPt: 'DeepTech', depth: 2, synonyms: ['deeptech'] },
  { slug: 'industrialtech-advanced-manufacturing', parentSlug: 'deeptech-industry-infrastructure', labelEn: 'IndustrialTech & Advanced Manufacturing', labelPt: 'IndustrialTech e Fabricação Avançada', depth: 2, synonyms: ['industrialtech', 'advanced manufacturing', 'fabricação avançada'] },
  { slug: 'robotics-automation', parentSlug: 'deeptech-industry-infrastructure', labelEn: 'Robotics & Automation', labelPt: 'Robótica e Automação', depth: 2, synonyms: ['robotics', 'automation', 'robótica', 'automação'] },
  { slug: 'semiconductors-electronics', parentSlug: 'deeptech-industry-infrastructure', labelEn: 'Semiconductors & Electronics', labelPt: 'Semicondutores e Eletrónica', depth: 2, synonyms: ['semiconductors', 'electronics', 'semicondutores', 'eletrónica'] },
  { slug: 'advanced-materials-chemicals', parentSlug: 'deeptech-industry-infrastructure', labelEn: 'Advanced Materials & Chemicals', labelPt: 'Materiais Avançados e Químicos', depth: 2, synonyms: ['advanced materials', 'chemicals', 'materiais avançados'] },
  { slug: 'aerospace-spacetech', parentSlug: 'deeptech-industry-infrastructure', labelEn: 'Aerospace & SpaceTech', labelPt: 'Aeroespacial e SpaceTech', depth: 2, synonyms: ['aerospace', 'spacetech', 'aeroespacial'] },
  { slug: 'defence-dual-use', parentSlug: 'deeptech-industry-infrastructure', labelEn: 'Defence & Dual-Use', labelPt: 'Defesa e Uso Dual', depth: 2, synonyms: ['defence', 'defense', 'dual-use', 'defesa'] },
  { slug: 'automotive-mobility-transportation', parentSlug: 'deeptech-industry-infrastructure', labelEn: 'Automotive, Mobility & Transportation', labelPt: 'Automóvel, Mobilidade e Transportes', depth: 2, synonyms: ['automotive', 'mobility', 'transportation', 'mobilidade', 'transportes'] },
  { slug: 'logistics-supply-chain', parentSlug: 'deeptech-industry-infrastructure', labelEn: 'Logistics & Supply Chain', labelPt: 'Logística e Cadeia de Abastecimento', depth: 2, synonyms: ['logistics', 'supply chain', 'logística'] },
  { slug: 'constructiontech-infrastructure', parentSlug: 'deeptech-industry-infrastructure', labelEn: 'ConstructionTech & Infrastructure', labelPt: 'ConstructionTech e Infraestrutura', depth: 2, synonyms: ['constructiontech', 'infrastructure', 'infraestrutura'] },
  { slug: 'telecommunications-connectivity', parentSlug: 'deeptech-industry-infrastructure', labelEn: 'Telecommunications & Connectivity', labelPt: 'Telecomunicações e Conectividade', depth: 2, synonyms: ['telecommunications', 'connectivity', 'telecomunicações'] },

  // Software & Digital Services (14)
  { slug: 'enterprise-software-saas', parentSlug: 'software-digital-services', labelEn: 'Enterprise Software & SaaS', labelPt: 'Software Empresarial e SaaS', depth: 2, synonyms: ['enterprise software', 'saas', 'software empresarial'] },
  { slug: 'ai-data-analytics', parentSlug: 'software-digital-services', labelEn: 'AI, Data & Analytics', labelPt: 'IA, Dados e Analítica', depth: 2, synonyms: ['ai', 'artificial intelligence', 'data', 'analytics', 'inteligência artificial', 'dados'] },
  { slug: 'developer-tools-cloud-infrastructure', parentSlug: 'software-digital-services', labelEn: 'Developer Tools & Cloud Infrastructure', labelPt: 'Ferramentas de Programação e Infraestrutura Cloud', depth: 2, synonyms: ['developer tools', 'cloud infrastructure', 'devtools'] },
  { slug: 'cybersecurity', parentSlug: 'software-digital-services', labelEn: 'Cybersecurity', labelPt: 'Cibersegurança', depth: 2, synonyms: ['cybersecurity', 'cibersegurança', 'ciberseguridad'] },
  { slug: 'fintech-insurtech', parentSlug: 'software-digital-services', labelEn: 'FinTech & InsurTech', labelPt: 'FinTech e InsurTech', depth: 2, synonyms: ['fintech', 'insurtech'] },
  { slug: 'legaltech-regtech', parentSlug: 'software-digital-services', labelEn: 'LegalTech & RegTech', labelPt: 'LegalTech e RegTech', depth: 2, synonyms: ['legaltech', 'regtech'] },
  { slug: 'govtech', parentSlug: 'software-digital-services', labelEn: 'GovTech', labelPt: 'GovTech', depth: 2, synonyms: ['govtech'] },
  { slug: 'hrtech-future-of-work', parentSlug: 'software-digital-services', labelEn: 'HRTech & Future of Work', labelPt: 'HRTech e Futuro do Trabalho', depth: 2, synonyms: ['hrtech', 'future of work', 'futuro do trabalho'] },
  { slug: 'edtech', parentSlug: 'software-digital-services', labelEn: 'EdTech', labelPt: 'EdTech', depth: 2, synonyms: ['edtech'] },
  { slug: 'proptech', parentSlug: 'software-digital-services', labelEn: 'PropTech', labelPt: 'PropTech', depth: 2, synonyms: ['proptech'] },
  { slug: 'retailtech-ecommerce', parentSlug: 'software-digital-services', labelEn: 'RetailTech & E-commerce', labelPt: 'RetailTech e E-commerce', depth: 2, synonyms: ['retailtech', 'e-commerce', 'ecommerce'] },
  { slug: 'marketingtech-adtech', parentSlug: 'software-digital-services', labelEn: 'MarketingTech & AdTech', labelPt: 'MarketingTech e AdTech', depth: 2, synonyms: ['marketingtech', 'adtech'] },
  { slug: 'traveltech-hospitality', parentSlug: 'software-digital-services', labelEn: 'TravelTech & Hospitality', labelPt: 'TravelTech e Hotelaria', depth: 2, synonyms: ['traveltech', 'hospitality', 'hotelaria'] },
  { slug: 'gaming-media-entertainment', parentSlug: 'software-digital-services', labelEn: 'Gaming, Media & Entertainment', labelPt: 'Jogos, Media e Entretenimento', depth: 2, synonyms: ['gaming', 'media', 'entertainment', 'jogos', 'entretenimento'] },

  // Consumer & Impact (6)
  { slug: 'consumer-products-services', parentSlug: 'consumer-impact', labelEn: 'Consumer Products & Services', labelPt: 'Produtos e Serviços de Consumo', depth: 2, synonyms: ['consumer products', 'consumer services', 'produtos de consumo'] },
  { slug: 'fashion-beauty', parentSlug: 'consumer-impact', labelEn: 'Fashion & Beauty', labelPt: 'Moda e Beleza', depth: 2, synonyms: ['fashion', 'beauty', 'moda', 'beleza'] },
  { slug: 'sports-fitness-wellness', parentSlug: 'consumer-impact', labelEn: 'Sports, Fitness & Wellness', labelPt: 'Desporto, Fitness e Bem-estar', depth: 2, synonyms: ['sports', 'fitness', 'wellness', 'desporto'] },
  { slug: 'pettech', parentSlug: 'consumer-impact', labelEn: 'PetTech', labelPt: 'PetTech', depth: 2, synonyms: ['pettech'] },
  { slug: 'social-impact-financial-inclusion', parentSlug: 'consumer-impact', labelEn: 'Social Impact & Financial Inclusion', labelPt: 'Impacto Social e Inclusão Financeira', depth: 2, synonyms: ['social impact', 'financial inclusion', 'impacto social', 'inclusão financeira'] },
  { slug: 'smart-cities', parentSlug: 'consumer-impact', labelEn: 'Smart Cities', labelPt: 'Cidades Inteligentes', depth: 2, synonyms: ['smart cities', 'cidades inteligentes', 'ciudades inteligentes'] },
];

// ---- Level 3/4: deep sub-tree, Health & Life Sciences only ---------------
// Mirrors the prompt's own worked example verbatim: oncology by cancer
// type; diagnostics by modality; digital health by population/monitoring
// mode; devices by form factor.
const HEALTH_DEEP: TopicSeedNode[] = [
  // Oncology, under the general biotech/life-sciences sector — deliberately
  // NOT nested under Diagnostics: an oncology evidence tag should apply to
  // both a diagnostics story and a therapeutics story about the same cancer
  // type, so it sits as its own branch rather than diagnostics-scoped.
  { slug: 'oncology', parentSlug: 'biotechnology-life-sciences', labelEn: 'Oncology', labelPt: 'Oncologia', depth: 3, synonyms: ['oncology', 'oncologia', 'oncología', 'cancer', 'cancro', 'cáncer', 'onkologie', 'oncologie'] },
  { slug: 'oncology-prostate-cancer', parentSlug: 'oncology', labelEn: 'Prostate Cancer', labelPt: 'Cancro da Próstata', depth: 4, synonyms: ['prostate cancer', 'cancro da próstata', 'cáncer de próstata', 'prostatakrebs', 'cancer de la prostate'] },
  { slug: 'oncology-breast-cancer', parentSlug: 'oncology', labelEn: 'Breast Cancer', labelPt: 'Cancro da Mama', depth: 4, synonyms: ['breast cancer', 'cancro da mama', 'cáncer de mama', 'brustkrebs', 'cancer du sein'] },
  { slug: 'oncology-colorectal-cancer', parentSlug: 'oncology', labelEn: 'Colorectal Cancer', labelPt: 'Cancro Colorretal', depth: 4, synonyms: ['colorectal cancer', 'cancro colorretal', 'cáncer colorrectal', 'darmkrebs', 'cancer colorectal'] },
  { slug: 'oncology-lung-cancer', parentSlug: 'oncology', labelEn: 'Lung Cancer', labelPt: 'Cancro do Pulmão', depth: 4, synonyms: ['lung cancer', 'cancro do pulmão', 'cáncer de pulmón', 'lungenkrebs', 'cancer du poumon'] },

  // Diagnostics, by modality
  { slug: 'diagnostics-early-detection', parentSlug: 'diagnostics', labelEn: 'Early Detection', labelPt: 'Deteção Precoce', depth: 3, synonyms: ['early detection', 'deteção precoce', 'detección precoz', 'screening', 'rastreio'] },
  { slug: 'diagnostics-biomarkers', parentSlug: 'diagnostics', labelEn: 'Biomarkers', labelPt: 'Biomarcadores', depth: 3, synonyms: ['biomarkers', 'biomarcadores'] },
  { slug: 'diagnostics-biosensors', parentSlug: 'diagnostics', labelEn: 'Biosensors', labelPt: 'Biossensores', depth: 3, synonyms: ['biosensors', 'biossensores', 'biosensores'] },
  { slug: 'diagnostics-urinalysis', parentSlug: 'diagnostics', labelEn: 'Urinalysis', labelPt: 'Urinálise', depth: 3, synonyms: ['urinalysis', 'urinálise', 'urianálisis', 'urine test'] },
  { slug: 'diagnostics-imaging', parentSlug: 'diagnostics', labelEn: 'Imaging', labelPt: 'Imagiologia', depth: 3, synonyms: ['imaging', 'imagiologia', 'imagenología'] },

  // Digital health, by population / monitoring mode
  { slug: 'digital-health-remote-monitoring', parentSlug: 'digital-health', labelEn: 'Remote Monitoring', labelPt: 'Monitorização Remota', depth: 3, synonyms: ['remote monitoring', 'monitorização remota', 'monitorización remota', 'rpm'] },
  { slug: 'digital-health-womens-health', parentSlug: 'digital-health', labelEn: "Women's Health", labelPt: 'Saúde da Mulher', depth: 3, synonyms: ["women's health", 'saúde da mulher', 'salud de la mujer', 'femtech'] },
  { slug: 'digital-health-mens-health', parentSlug: 'digital-health', labelEn: "Men's Health", labelPt: 'Saúde Masculina', depth: 3, synonyms: ["men's health", 'saúde masculina', 'salud del hombre'] },
  { slug: 'digital-health-aging-longevity', parentSlug: 'digital-health', labelEn: 'Aging & Longevity Tech', labelPt: 'Envelhecimento e Longevidade', depth: 3, synonyms: ['aging', 'longevity tech', 'envelhecimento', 'envejecimiento'] },

  // Devices, by form factor
  { slug: 'medtech-wearables', parentSlug: 'medtech-medical-devices', labelEn: 'Wearables', labelPt: 'Wearables', depth: 3, synonyms: ['wearables', 'wearable devices', 'dispositivos vestíveis'] },
  { slug: 'medtech-ivd', parentSlug: 'medtech-medical-devices', labelEn: 'In Vitro Diagnostics (IVD)', labelPt: 'Diagnóstico In Vitro (IVD)', depth: 3, synonyms: ['ivd', 'in vitro diagnostics', 'diagnóstico in vitro'] },
  { slug: 'medtech-point-of-care', parentSlug: 'medtech-medical-devices', labelEn: 'Point of Care', labelPt: 'Ponto de Cuidado', depth: 3, synonyms: ['point of care', 'poc', 'ponto de cuidado', 'punto de atención'] },
];

export const TOPIC_TAXONOMY_VERSION = 1;

export const TOPIC_TAXONOMY_SEED: TopicSeedNode[] = [...GROUPS, ...SECTORS, ...HEALTH_DEEP];
