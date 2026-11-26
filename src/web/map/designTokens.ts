/**
 * Centralized Cartographic Design Token System (P02-06C).
 * Historical military command-room atlas palette inspired by mid-20th-century
 * topographic strategic maps & modern grand strategy interfaces.
 * Zero neon, zero generic dashboard glassmorphism, disciplined contrast.
 */

export const MAP_TOKENS = {
  // Command Room Interface Surfaces (Dark Charcoal + Restrained Brass/Gold)
  ui: {
    canvasBg: '#11151A',
    panelBg: '#161C22',
    panelElevated: '#1D242C',
    panelHeader: '#12171D',
    border: '#2B3540',
    borderStrong: '#3C4957',
    textPrimary: '#EFE9DC',
    textSecondary: '#A8B2BC',
    textMuted: '#758290',
    accentGold: '#C6A15B',
    accentGoldHover: '#D8B672',
    accentOlive: '#4D6B53',
    danger: '#B84B3E',
    success: '#4F8A64',
    warning: '#C8923C',
  },

  // Cartographic Water & Coastal Shading (Desaturated Strategic Atlas Blue)
  // NOTE: Coastal tinting is visual cartographic styling, NOT scientific bathymetry.
  water: {
    deepOcean: '#1F3545',
    shelfWater: '#28455A',
    coastalShallow: '#355A72',
    coastalEdgeHalo: '#567B90',
    graticule: '#395569',
    riverMajor: '#3C759C',
    riverMinor: '#4E86AA',
    riverCasing: '#1C3A4E',
    seaLabel: '#8EB0C2',
  },

  // Surrounding Indochina Context Landmass (Muted Olive-Parchment Charcoal)
  context: {
    landFill: '#454A41',
    landFillAlt: '#4B5046',
    borderLine: '#727A6B',
    coastLine: '#2B3E4B',
    countryLabel: '#A9B0A0',
  },

  // Natural Terrain Hypsometric & Landcover Palette (Earth / Topographic Atlas)
  terrain: {
    coastalDelta: '#849572',
    riverBasin: '#94A17A',
    agriculturalPlain: '#A6A47E',
    wetlandCoast: '#728A73',
    forestCorridor: '#556E4F',
    highlands: '#8D8060',
    mountainSlope: '#7C6952',
    mountainHigh: '#6D5844',
    alpinePeak: '#8A7866',
    urbanCore: '#696E74',
    islandFill: '#6E816D',
    islandBorder: '#2C3B34',
  },

  // Political Faction Palette (Muted Military Atlas Tones — Semi-Transparent over Terrain)
  factions: {
    nat_north_dir: {
      fill: '#A84438',
      border: '#D67164',
      darkBorder: '#69241C',
      badge: '#C95A4C',
      name: 'Liên Minh Phương Bắc (Bắc)',
      shortName: 'Phương Bắc',
    },
    nat_south_rep: {
      fill: '#346087',
      border: '#6EA1CC',
      darkBorder: '#1E3C57',
      badge: '#4B82B3',
      name: 'Cộng Hòa Phương Nam (Nam)',
      shortName: 'Phương Nam',
    },
    nat_npc_highland: {
      fill: '#9E8248',
      border: '#CEB274',
      darkBorder: '#645026',
      badge: '#B89A5A',
      name: 'Hội Đồng Cao Nguyên (NPC)',
      shortName: 'Cao Nguyên (NPC)',
    },
    nat_npc_border: {
      fill: '#5E7559',
      border: '#8EA888',
      darkBorder: '#394A35',
      badge: '#748F6E',
      name: 'Liên Minh Biên Giới (NPC)',
      shortName: 'Biên Giới (NPC)',
    },
    unknown: {
      fill: '#606B74',
      border: '#8E99A2',
      darkBorder: '#3B4248',
      badge: '#79858F',
      name: 'Chưa xác định',
      shortName: 'Không rõ',
    },
  },

  // Economy Choropleth Scale (Restrained Forest-Gold Scale)
  economy: {
    tierHigh: '#2E6247',
    tierGood: '#4E8262',
    tierMedium: '#7D9E7D',
    tierLow: '#A8B69A',
  },

  // Infrastructure Choropleth Scale (Topographic Sepia-Bronze Scale)
  infrastructure: {
    tierHigh: '#6B4F35',
    tierGood: '#8E704D',
    tierMedium: '#B09670',
    tierLow: '#C9BA9C',
  },

  // Political & Regional Boundaries
  boundaries: {
    internalRegion: '#DED8C8',
    internalRegionOpacity: 0.42,
    nationalBorderCasing: '#15191E',
    nationalBorderLine: '#E8D7A7',
    selectedOutline: '#F3D27A',
    selectedHalo: '#12161B',
    hoverFill: '#F5E7C4',
    hoverOutline: '#EBD395',
  },

  // 4-Tier Transportation Network (1955 Abstract Corridors)
  transport: {
    primaryRoadCasing: '#2A1D15',
    primaryRoadLine: '#C66B36',
    secondaryRoadLine: '#8D7B64',
    railwayBase: '#1D2227',
    railwayTies: '#E6DEC8',
    riverCrossingLine: '#42A5B5',
  },

  // Typography & Labels on Map
  labels: {
    ivory: '#F5EFE2',
    ivoryMuted: '#D6CEBD',
    inkHalo: '#12161C',
    capitalGold: '#E6BD63',
    peakBrown: '#E8DAC2',
  },

  // Semantic Zoom Level Thresholds (Levels 1..5)
  zoom: {
    min: 3.6,
    max: 9.6,
    level1Max: 5.15, // Regional Overview (Indochina)
    level2Max: 6.15, // National Overview (72 regions)
    level3Max: 7.15, // Provincial Overview (Detailed terrain & secondary roads)
    level4Max: 8.15, // Local Strategic View (Detailed cities, infra, future units)
    // >= 8.15 => Level 5 Terrain Inspection (Optional pitch & 2.5D relief)
  },
} as const;

export type FactionVisualKey = keyof typeof MAP_TOKENS.factions;

export function getFactionVisual(nationId: string | null | undefined) {
  if (!nationId) return MAP_TOKENS.factions.unknown;
  if (nationId in MAP_TOKENS.factions) {
    return MAP_TOKENS.factions[nationId as FactionVisualKey];
  }
  return MAP_TOKENS.factions.unknown;
}
