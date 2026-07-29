# Sectors taxonomy — full mapping proposal (prompt 42 part 2)

Generated from live catalog_entities.sectors distribution, 155 distinct raw values, 1284 total (entity, sector) pairs across 536 entities. NOT APPLIED — proposal for review only.

## Proposed taxonomy additions

- **robotics** — split out of `hardware` (currently `Hardware/Robotics` combines them at 40 occurrences, plus several long-tail robotics-specific values)
- **agritech** — split out of `foodtech` (currently `Foodtech/Agritech` combines them at 18, plus agriculture/agtech/Food systems long tail)
- **proptech** — no existing bucket at all (Proptech + proptech + real estate + Built environment = ~10 occurrences), distinct enough vertical to warrant its own value

These three are the ones with enough real volume in your actual data to justify expanding the fixed list rather than forcing a fit. Everything else maps onto the 20 existing values.

## Mapped values, grouped by target taxonomy value

### `AI/ML` (109 total occurrences from 6 raw values)
| Raw value | Freq |
|---|---|
| AI/ML | 97 |
| AI | 7 |
| artificial intelligence | 2 |
| AI-native digitization | 1 |
| applied AI | 1 |
| ML | 1 |

### `agritech` (24 total occurrences from 7 raw values)
| Raw value | Freq |
|---|---|
| Foodtech/Agritech | 18 |
| agri-industry | 1 |
| agriculture | 1 |
| agritech | 1 |
| agtech | 1 |
| Food systems | 1 |
| Sustainable agriculture | 1 |

### `biotech` (106 total occurrences from 3 raw values)
| Raw value | Freq |
|---|---|
| Healthtech/Biotech | 100 |
| biotech | 5 |
| techbio | 1 |

### `climate` (131 total occurrences from 19 raw values)
| Raw value | Freq |
|---|---|
| Climate Tech/CleanTech | 101 |
| climate | 7 |
| energy | 3 |
| energy transition | 3 |
| cleantech | 2 |
| sustainability | 2 |
| bioeconomy | 1 |
| circular economy | 1 |
| Circular economy | 1 |
| Clean transport | 1 |
| climate fintech | 1 |
| Climate tech | 1 |
| climatetech | 1 |
| energy & sustainability | 1 |
| Energy storage | 1 |
| Environmental services | 1 |
| industrial, climate & deep tech | 1 |
| nature | 1 |
| Renewable energy | 1 |

### `consumer` (111 total occurrences from 10 raw values)
| Raw value | Freq |
|---|---|
| Consumer/Consumer Tech | 95 |
| Media/Gaming | 7 |
| consumer | 2 |
| adtech | 1 |
| Consumer | 1 |
| consumer tech | 1 |
| DTC | 1 |
| media | 1 |
| Retail | 1 |
| retail tech | 1 |

### `cybersecurity` (30 total occurrences from 4 raw values)
| Raw value | Freq |
|---|---|
| Cybersecurity | 23 |
| cybersecurity | 4 |
| security | 2 |
| cyber-physical security | 1 |

### `deep tech` (152 total occurrences from 14 raw values)
| Raw value | Freq |
|---|---|
| Deep Tech | 127 |
| deep tech | 12 |
| space tech | 2 |
| deeptech healthcare | 1 |
| defense | 1 |
| frontier tech | 1 |
| industrial, climate & deep tech | 1 |
| materials science | 1 |
| next-gen computing | 1 |
| quantum | 1 |
| science-based | 1 |
| science-based deeptech | 1 |
| science-based technologies (deep tech) | 1 |
| space | 1 |

### `digital health` (118 total occurrences from 8 raw values)
| Raw value | Freq |
|---|---|
| Healthtech/Biotech | 100 |
| healthtech | 7 |
| digital health | 6 |
| deeptech healthcare | 1 |
| HealthTech | 1 |
| medtech & digital health | 1 |
| patient platforms | 1 |
| provider tools | 1 |

### `edtech` (8 total occurrences from 3 raw values)
| Raw value | Freq |
|---|---|
| Edtech | 6 |
| edtech | 1 |
| education | 1 |

### `enterprise software` (246 total occurrences from 18 raw values)
| Raw value | Freq |
|---|---|
| Enterprise SaaS/B2B Software | 222 |
| B2B software | 4 |
| data | 3 |
| B2B | 2 |
| digital tech | 2 |
| B2B tech | 1 |
| data & connectivity | 1 |
| digital infrastructure | 1 |
| Digital Infrastructure | 1 |
| enterprise software | 1 |
| future of work | 1 |
| information technology | 1 |
| Infrastructure | 1 |
| IT | 1 |
| pre-seed B2B | 1 |
| software | 1 |
| Software | 1 |
| supply chain tech | 1 |

### `fintech` (93 total occurrences from 6 raw values)
| Raw value | Freq |
|---|---|
| Fintech | 75 |
| fintech | 8 |
| Insurtech | 7 |
| finance | 1 |
| insurtech | 1 |
| regtech | 1 |

### `foodtech` (18 total occurrences from 1 raw value)
| Raw value | Freq |
|---|---|
| Foodtech/Agritech | 18 |

### `hardware` (55 total occurrences from 13 raw values)
| Raw value | Freq |
|---|---|
| Hardware/Robotics | 40 |
| IoT | 4 |
| additive manufacturing | 1 |
| electronics & photonics | 1 |
| hardware | 1 |
| hardware components | 1 |
| industrial | 1 |
| industrial & enterprise solutions | 1 |
| industrial automation | 1 |
| industrial tech | 1 |
| industrial, climate & deep tech | 1 |
| industry tech | 1 |
| IoT/robotics | 1 |

### `health` (12 total occurrences from 5 raw values)
| Raw value | Freq |
|---|---|
| health | 5 |
| healthcare | 4 |
| healthcare services | 1 |
| improving health for humanity | 1 |
| taboo health | 1 |

### `life sciences` (3 total occurrences from 3 raw values)
| Raw value | Freq |
|---|---|
| biology | 1 |
| life science | 1 |
| life sciences & chemistry | 1 |

### `marketplace` (16 total occurrences from 1 raw value)
| Raw value | Freq |
|---|---|
| Marketplace | 16 |

### `medtech` (8 total occurrences from 4 raw values)
| Raw value | Freq |
|---|---|
| medtech | 5 |
| diagnostics | 1 |
| medical technologies | 1 |
| medtech & digital health | 1 |

### `mobility` (18 total occurrences from 2 raw values)
| Raw value | Freq |
|---|---|
| Mobility/Logistics | 17 |
| smart territories & mobility | 1 |

### `proptech` (11 total occurrences from 4 raw values)
| Raw value | Freq |
|---|---|
| Proptech | 6 |
| proptech | 3 |
| Built environment | 1 |
| real estate | 1 |

### `robotics` (44 total occurrences from 4 raw values)
| Raw value | Freq |
|---|---|
| Hardware/Robotics | 40 |
| robotics | 2 |
| autonomous systems & robotics | 1 |
| IoT/robotics | 1 |

### `saas` (232 total occurrences from 5 raw values)
| Raw value | Freq |
|---|---|
| Enterprise SaaS/B2B Software | 222 |
| SaaS | 7 |
| B2B SaaS | 1 |
| corporate VC B2B SaaS | 1 |
| enterprise SaaS | 1 |

### `sector-agnostic` (106 total occurrences from 9 raw values)
| Raw value | Freq |
|---|---|
| Generalist/Sector-agnostic | 56 |
| generalist tech | 26 |
| generalist | 16 |
| generalist PE | 3 |
| generalist early-stage | 1 |
| generalist syndicate | 1 |
| pre-seed generalist | 1 |
| seed generalist | 1 |
| SME generalist | 1 |

## Flagged — not mapped, need your call

| Raw value | Freq | Why flagged |
|---|---|---|
| impact | 4 | FLAG:not-a-sector (describes investment lens/thesis, not vertical) — candidates: sector-agnostic, or leave unmapped |
| corporate accelerator | 1 | FLAG:not-a-sector (investor type/structure) |
| corporate VC cross-industry | 1 | FLAG:not-a-sector (investor type/structure) |
| corporate VC generalist | 1 | FLAG:not-a-sector (investor type/structure) |
| digital | 1 | FLAG:too vague to map confidently — could be enterprise software or sector-agnostic |
| family office | 1 | FLAG:not-a-sector (investor type, already captured by entities.type) |
| generalist corporate VC | 1 | FLAG:not-a-sector (investor type/structure) |
| IP-rich | 1 | FLAG:not-a-sector (describes IP characteristic, not vertical) |
| PE for startups | 1 | FLAG:not-a-sector (investor type/structure) |
| PE-VC | 1 | FLAG:not-a-sector (investor type/structure) |
| professional services | 1 | FLAG:not-a-sector (describes buyer/customer type, not investor vertical) |
| SMBs | 1 | FLAG:not-a-sector (describes customer size, not vertical) |
| tech | 1 | FLAG:too vague to map confidently |
| technical | 1 | FLAG:too vague to map confidently |
| venture studio | 1 | FLAG:not-a-sector (investor type/structure) |

Flagged total: 18 occurrences across 15 raw values.
