// P104 #7 — fixed sector taxonomy, verbatim from
// prompt_sectors_taxonomy_20260728.md. Six categories + a flat "Other"
// bucket (no subitems). Categories are for visual organization only on
// the startup side — never independently selectable there (the investor
// side, not yet rebuilt this pass, is where a whole category becomes a
// single selectable unit).
export interface SectorCategory {
  name: string;
  sectors: string[];
}

export const SECTOR_TAXONOMY: SectorCategory[] = [
  {
    name: 'Health & Life Sciences',
    sectors: [
      'Biotechnology & Life Sciences', 'Pharmaceuticals & Therapeutics', 'Drug Discovery & Development',
      'MedTech & Medical Devices', 'Diagnostics', 'Digital Health', 'Healthcare Services & Clinical Research',
      'Genomics & Precision Medicine', 'Synthetic Biology', 'FemHealth', 'Mental Health',
      'Longevity, AgeTech & Wellness', 'Animal Health',
    ],
  },
  {
    name: 'Food, Climate & Natural Resources',
    sectors: [
      'AgriTech & FoodTech', 'Alternative Proteins', 'ClimateTech & CleanTech', 'Energy & Energy Storage',
      'Circular Economy & Waste', 'WaterTech', 'BlueTech & OceanTech',
    ],
  },
  {
    name: 'DeepTech, Industry & Infrastructure',
    sectors: [
      'DeepTech', 'IndustrialTech & Advanced Manufacturing', 'Robotics & Automation',
      'Semiconductors & Electronics', 'Advanced Materials & Chemicals', 'Aerospace & SpaceTech',
      'Defence & Dual-Use', 'Automotive, Mobility & Transportation', 'Logistics & Supply Chain',
      'ConstructionTech & Infrastructure', 'Telecommunications & Connectivity',
    ],
  },
  {
    name: 'Software & Digital Services',
    sectors: [
      'Enterprise Software & SaaS', 'AI, Data & Analytics', 'Developer Tools & Cloud Infrastructure',
      'Cybersecurity', 'FinTech & InsurTech', 'LegalTech & RegTech', 'GovTech', 'HRTech & Future of Work',
      'EdTech', 'PropTech', 'RetailTech & E-commerce', 'MarketingTech & AdTech', 'TravelTech & Hospitality',
      'Gaming, Media & Entertainment',
    ],
  },
  {
    name: 'Consumer & Impact',
    sectors: [
      'Consumer Products & Services', 'Fashion & Beauty', 'Sports, Fitness & Wellness', 'PetTech',
      'Social Impact & Financial Inclusion', 'Smart Cities',
    ],
  },
];

export const ALL_SECTOR_NAMES: string[] = SECTOR_TAXONOMY.flatMap((c) => c.sectors);

export const STARTUP_SECTOR_MAX = 6;
export const SECTOR_OTHER_MAX_CHARS = 25;
