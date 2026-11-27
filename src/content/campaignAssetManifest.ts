import { CampaignUnitKey } from '../contracts';

export type CampaignVisualFaction = 'NORTH' | 'SOUTH';
export type CampaignVisualLod = 'lod0' | 'lod1' | 'lod2';
export type CampaignRenderLodMode = 'SYMBOL' | 'LOD2' | 'LOD1' | 'LOD0';

export interface GlbLodMetadata {
  readonly lod: CampaignVisualLod;
  readonly url: string;
  readonly relativePath: string;
  readonly triangles: number;
  readonly vertices: number;
  readonly materials: number;
  readonly textures: number;
  readonly sizeBytes: number;
}

export interface CampaignUnitVisualEntry {
  readonly id: string;
  readonly code: string;
  readonly faction: CampaignVisualFaction;
  readonly unitKey: CampaignUnitKey;
  readonly researchTier: 1 | 2;
  readonly requiredDoctrine: string | null;
  readonly displayNameVi: string;
  readonly modelSlug: string | null;
  readonly glbStatus: 'READY' | 'MISSING_GLB';
  readonly fallbackVisual: 'PROCEDURAL_2_5D';
  readonly forwardAxis: '+Z';
  readonly pivotMinY: number;
  readonly bboxSizeXYZ: readonly [number, number, number];
  /** Visual scale multiplier normalizing real-world meters onto the strategic Vietnam map. */
  readonly mapVisualScale: number;
  /** Number of 3D instances clustered per unit counter (e.g., 3 soldiers for infantry squad). */
  readonly formationCount: number;
  readonly lods: Readonly<Record<CampaignVisualLod, GlbLodMetadata>> | null;
}

/** Zoom thresholds controlling automatic LOD switching on the 2D Vietnam map. */
export const CAMPAIGN_VISUAL_LOD_THRESHOLDS = {
  /** Below this zoom, render lightweight tactical symbols (0 3D draw calls). */
  symbolBelowZoom: 1.55,
  /** [1.55, 2.45): render ultra-light LOD2 GLB models. */
  lod1MinZoom: 2.45,
  /** >= 3.60: render full-detail LOD0 GLB models. */
  lod0MinZoom: 3.6,
} as const;

export function selectVisualLodForZoom(zoom: number): CampaignRenderLodMode {
  if (zoom < CAMPAIGN_VISUAL_LOD_THRESHOLDS.symbolBelowZoom) return 'SYMBOL';
  if (zoom < CAMPAIGN_VISUAL_LOD_THRESHOLDS.lod1MinZoom) return 'LOD2';
  if (zoom < CAMPAIGN_VISUAL_LOD_THRESHOLDS.lod0MinZoom) return 'LOD1';
  return 'LOD0';
}

function makeLods(
  factionDir: 'north' | 'south',
  slug: string,
  specs: Readonly<
    Record<
      CampaignVisualLod,
      { triangles: number; vertices: number; materials: number; textures: number; sizeBytes: number }
    >
  >
): Readonly<Record<CampaignVisualLod, GlbLodMetadata>> {
  const build = (lod: CampaignVisualLod): GlbLodMetadata => {
    const relativePath = `models/${factionDir}/${slug}/${slug}_${lod}.glb`;
    return {
      lod,
      url: `/assets/units/${relativePath}`,
      relativePath,
      ...specs[lod],
    };
  };
  return {
    lod0: build('lod0'),
    lod1: build('lod1'),
    lod2: build('lod2'),
  };
}

/**
 * Canonical T09 Military Visual Asset Manifest.
 * Maps all 36 audited GLB files (12 unit models × 3 LODs) by faction, unitKey & researchTier,
 * and explicitly tracks the 8 missing air/naval/SAM GLB slots without marking them complete.
 */
export const CAMPAIGN_UNIT_ASSET_MANIFEST: readonly CampaignUnitVisualEntry[] = [
  // =========================================================================
  // PHƯƠNG BẮC (NORTH) — 6 GLB-BACKED GROUND MODELS (18 GLB FILES)
  // =========================================================================
  {
    id: 'north_reserve_t1',
    code: 'N-INF-01',
    faction: 'NORTH',
    unitKey: 'reserve',
    researchTier: 1,
    requiredDoctrine: null,
    displayNameVi: 'Bộ binh QĐNDVN',
    modelSlug: 'pavn_infantry',
    glbStatus: 'READY',
    fallbackVisual: 'PROCEDURAL_2_5D',
    forwardAxis: '+Z',
    pivotMinY: 0,
    bboxSizeXYZ: [0.755, 1.81, 0.487],
    mapVisualScale: 1.05,
    formationCount: 3,
    lods: makeLods('north', 'pavn_infantry', {
      lod0: { triangles: 3120, vertices: 3323, materials: 9, textures: 2, sizeBytes: 176072 },
      lod1: { triangles: 1872, vertices: 2267, materials: 9, textures: 2, sizeBytes: 127284 },
      lod2: { triangles: 1040, vertices: 1427, materials: 9, textures: 2, sizeBytes: 90384 },
    }),
  },
  {
    id: 'north_motor_t1',
    code: 'N-APC-01',
    faction: 'NORTH',
    unitKey: 'motor',
    researchTier: 1,
    requiredDoctrine: 'motor',
    displayNameVi: 'Bộ binh cơ giới BTR-40 (Cấp I)',
    modelSlug: 'btr40',
    glbStatus: 'READY',
    fallbackVisual: 'PROCEDURAL_2_5D',
    forwardAxis: '+Z',
    pivotMinY: 0,
    bboxSizeXYZ: [2.024, 3.273, 5.11],
    mapVisualScale: 1.08,
    formationCount: 1,
    lods: makeLods('north', 'btr40', {
      lod0: { triangles: 3700, vertices: 5548, materials: 7, textures: 3, sizeBytes: 252300 },
      lod1: { triangles: 1540, vertices: 2116, materials: 7, textures: 3, sizeBytes: 116520 },
      lod2: { triangles: 816, vertices: 1452, materials: 7, textures: 3, sizeBytes: 86564 },
    }),
  },
  {
    id: 'north_motor_t2',
    code: 'N-APC-02',
    faction: 'NORTH',
    unitKey: 'motor',
    researchTier: 2,
    requiredDoctrine: 'motor2',
    displayNameVi: 'Bộ binh cơ giới BTR-60PB (Cấp II)',
    modelSlug: 'btr60pb',
    glbStatus: 'READY',
    fallbackVisual: 'PROCEDURAL_2_5D',
    forwardAxis: '+Z',
    pivotMinY: 0,
    bboxSizeXYZ: [2.98, 3.656, 7.104],
    mapVisualScale: 1.15,
    formationCount: 1,
    lods: makeLods('north', 'btr60pb', {
      lod0: { triangles: 6892, vertices: 10132, materials: 7, textures: 3, sizeBytes: 437360 },
      lod1: { triangles: 2660, vertices: 3388, materials: 7, textures: 3, sizeBytes: 170744 },
      lod2: { triangles: 1388, vertices: 2396, materials: 6, textures: 3, sizeBytes: 122756 },
    }),
  },
  {
    id: 'north_recon_t1',
    code: 'N-REC-01',
    faction: 'NORTH',
    unitKey: 'recon',
    researchTier: 1,
    requiredDoctrine: 'recon',
    displayNameVi: 'Xe tăng trinh sát lội nước PT-76',
    modelSlug: 'pt76',
    glbStatus: 'READY',
    fallbackVisual: 'PROCEDURAL_2_5D',
    forwardAxis: '+Z',
    pivotMinY: 0,
    bboxSizeXYZ: [3.077, 3.243, 8.53],
    mapVisualScale: 1.14,
    formationCount: 1,
    lods: makeLods('north', 'pt76', {
      lod0: { triangles: 6648, vertices: 11277, materials: 6, textures: 3, sizeBytes: 470152 },
      lod1: { triangles: 3100, vertices: 4999, materials: 6, textures: 3, sizeBytes: 226664 },
      lod2: { triangles: 2160, vertices: 3567, materials: 6, textures: 3, sizeBytes: 169552 },
    }),
  },
  {
    id: 'north_artillery_t1',
    code: 'N-ART-01',
    faction: 'NORTH',
    unitKey: 'artillery',
    researchTier: 1,
    requiredDoctrine: 'artillery',
    displayNameVi: 'Lựu pháo 122mm M-30',
    modelSlug: 'howitzer_m30_122mm',
    glbStatus: 'READY',
    fallbackVisual: 'PROCEDURAL_2_5D',
    forwardAxis: '+Z',
    pivotMinY: 0,
    bboxSizeXYZ: [2.121, 2.247, 6.481],
    mapVisualScale: 1.06,
    formationCount: 1,
    lods: makeLods('north', 'howitzer_m30_122mm', {
      lod0: { triangles: 2236, vertices: 3195, materials: 4, textures: 3, sizeBytes: 156616 },
      lod1: { triangles: 1036, vertices: 1311, materials: 4, textures: 3, sizeBytes: 81912 },
      lod2: { triangles: 444, vertices: 784, materials: 4, textures: 3, sizeBytes: 57944 },
    }),
  },
  {
    id: 'north_tank_t1',
    code: 'N-MBT-01',
    faction: 'NORTH',
    unitKey: 'tank',
    researchTier: 1,
    requiredDoctrine: 'tank',
    displayNameVi: 'Xe tăng chủ lực T-54/55',
    modelSlug: 't54_55',
    glbStatus: 'READY',
    fallbackVisual: 'PROCEDURAL_2_5D',
    forwardAxis: '+Z',
    pivotMinY: 0,
    bboxSizeXYZ: [3.34, 3.643, 9.29],
    mapVisualScale: 1.24,
    formationCount: 1,
    lods: makeLods('north', 't54_55', {
      lod0: { triangles: 6612, vertices: 11170, materials: 6, textures: 3, sizeBytes: 466264 },
      lod1: { triangles: 3120, vertices: 5030, materials: 6, textures: 3, sizeBytes: 227864 },
      lod2: { triangles: 2196, vertices: 3642, materials: 6, textures: 3, sizeBytes: 172352 },
    }),
  },

  // =========================================================================
  // PHƯƠNG NAM (SOUTH) — 6 GLB-BACKED GROUND MODELS (18 GLB FILES)
  // =========================================================================
  {
    id: 'south_reserve_t1',
    code: 'S-INF-01',
    faction: 'SOUTH',
    unitKey: 'reserve',
    researchTier: 1,
    requiredDoctrine: null,
    displayNameVi: 'Bộ binh QLVNCH',
    modelSlug: 'arvn_infantry',
    glbStatus: 'READY',
    fallbackVisual: 'PROCEDURAL_2_5D',
    forwardAxis: '+Z',
    pivotMinY: 0,
    bboxSizeXYZ: [0.755, 1.8, 0.391],
    mapVisualScale: 1.05,
    formationCount: 3,
    lods: makeLods('south', 'arvn_infantry', {
      lod0: { triangles: 3008, vertices: 3208, materials: 6, textures: 2, sizeBytes: 166088 },
      lod1: { triangles: 1772, vertices: 2138, materials: 6, textures: 2, sizeBytes: 117000 },
      lod2: { triangles: 988, vertices: 1366, materials: 6, textures: 2, sizeBytes: 82848 },
    }),
  },
  {
    id: 'south_motor_t1',
    code: 'S-APC-01',
    faction: 'SOUTH',
    unitKey: 'motor',
    researchTier: 1,
    requiredDoctrine: 'motor',
    displayNameVi: 'Bộ binh cơ giới M113 APC (Cấp I)',
    modelSlug: 'm113_apc',
    glbStatus: 'READY',
    fallbackVisual: 'PROCEDURAL_2_5D',
    forwardAxis: '+Z',
    pivotMinY: 0,
    bboxSizeXYZ: [2.72, 3.643, 4.881],
    mapVisualScale: 1.08,
    formationCount: 1,
    lods: makeLods('south', 'm113_apc', {
      lod0: { triangles: 5712, vertices: 9852, materials: 7, textures: 3, sizeBytes: 412384 },
      lod1: { triangles: 2784, vertices: 4620, materials: 7, textures: 3, sizeBytes: 209804 },
      lod2: { triangles: 1932, vertices: 3288, materials: 6, textures: 3, sizeBytes: 156024 },
    }),
  },
  {
    id: 'south_motor_t2',
    code: 'S-APC-02',
    faction: 'SOUTH',
    unitKey: 'motor',
    researchTier: 2,
    requiredDoctrine: 'motor2',
    displayNameVi: 'Bộ binh cơ giới M113 ACAV (Cấp II)',
    modelSlug: 'm113_acav',
    glbStatus: 'READY',
    fallbackVisual: 'PROCEDURAL_2_5D',
    forwardAxis: '+Z',
    pivotMinY: 0,
    bboxSizeXYZ: [2.72, 3.643, 4.881],
    mapVisualScale: 1.15,
    formationCount: 1,
    lods: makeLods('south', 'm113_acav', {
      lod0: { triangles: 5868, vertices: 10148, materials: 7, textures: 3, sizeBytes: 423732 },
      lod1: { triangles: 2940, vertices: 4916, materials: 7, textures: 3, sizeBytes: 221152 },
      lod2: { triangles: 2040, vertices: 3504, materials: 6, textures: 3, sizeBytes: 164236 },
    }),
  },
  {
    id: 'south_recon_t1',
    code: 'S-REC-01',
    faction: 'SOUTH',
    unitKey: 'recon',
    researchTier: 1,
    requiredDoctrine: 'recon',
    displayNameVi: 'Xe bọc thép trinh sát V-100 Commando',
    modelSlug: 'v100_commando',
    glbStatus: 'READY',
    fallbackVisual: 'PROCEDURAL_2_5D',
    forwardAxis: '+Z',
    pivotMinY: 0,
    bboxSizeXYZ: [2.49, 3.559, 5.398],
    mapVisualScale: 1.12,
    formationCount: 1,
    lods: makeLods('south', 'v100_commando', {
      lod0: { triangles: 3744, vertices: 5624, materials: 6, textures: 3, sizeBytes: 252552 },
      lod1: { triangles: 1560, vertices: 2120, materials: 6, textures: 3, sizeBytes: 114184 },
      lod2: { triangles: 896, vertices: 1552, materials: 6, textures: 3, sizeBytes: 88028 },
    }),
  },
  {
    id: 'south_artillery_t1',
    code: 'S-ART-01',
    faction: 'SOUTH',
    unitKey: 'artillery',
    researchTier: 1,
    requiredDoctrine: 'artillery',
    displayNameVi: 'Lựu pháo 105mm M101A1',
    modelSlug: 'howitzer_m101_105mm',
    glbStatus: 'READY',
    fallbackVisual: 'PROCEDURAL_2_5D',
    forwardAxis: '+Z',
    pivotMinY: 0,
    bboxSizeXYZ: [2.222, 1.957, 5.158],
    mapVisualScale: 1.06,
    formationCount: 1,
    lods: makeLods('south', 'howitzer_m101_105mm', {
      lod0: { triangles: 2020, vertices: 2847, materials: 4, textures: 3, sizeBytes: 141048 },
      lod1: { triangles: 892, vertices: 1071, materials: 4, textures: 3, sizeBytes: 70664 },
      lod2: { triangles: 396, vertices: 688, materials: 4, textures: 3, sizeBytes: 52452 },
    }),
  },
  {
    id: 'south_tank_t1',
    code: 'S-MBT-01',
    faction: 'SOUTH',
    unitKey: 'tank',
    researchTier: 1,
    requiredDoctrine: 'tank',
    displayNameVi: 'Xe tăng chủ lực M48A3 Patton',
    modelSlug: 'm48a3_patton',
    glbStatus: 'READY',
    fallbackVisual: 'PROCEDURAL_2_5D',
    forwardAxis: '+Z',
    pivotMinY: 0,
    bboxSizeXYZ: [3.6, 4.073, 9.064],
    mapVisualScale: 1.24,
    formationCount: 1,
    lods: makeLods('south', 'm48a3_patton', {
      lod0: { triangles: 7644, vertices: 12926, materials: 6, textures: 3, sizeBytes: 533024 },
      lod1: { triangles: 3832, vertices: 6194, materials: 6, textures: 3, sizeBytes: 271844 },
      lod2: { triangles: 2484, vertices: 4118, materials: 6, textures: 3, sizeBytes: 189192 },
    }),
  },

  // =========================================================================
  // MISSING GLB SLOTS (8 ENTRIES: SAM, FIGHTER, CORVETTE, SUBMARINE × 2 PHE)
  // Explicitly tracked as MISSING_GLB — never marked complete!
  // =========================================================================
  ...(['NORTH', 'SOUTH'] as const).flatMap((faction): CampaignUnitVisualEntry[] => {
    const pfx = faction === 'NORTH' ? 'N' : 'S';
    const facLabel = faction === 'NORTH' ? 'Phương Bắc' : 'Phương Nam';
    return [
      {
        id: `${faction.toLowerCase()}_sam_t1`,
        code: `${pfx}-SAM-01`,
        faction,
        unitKey: 'sam',
        researchTier: 1,
        requiredDoctrine: 'sam',
        displayNameVi: `Tên lửa phòng không SAM (${facLabel})`,
        modelSlug: null,
        glbStatus: 'MISSING_GLB',
        fallbackVisual: 'PROCEDURAL_2_5D',
        forwardAxis: '+Z',
        pivotMinY: 0,
        bboxSizeXYZ: [2.8, 3.2, 7.2],
        mapVisualScale: 1.12,
        formationCount: 1,
        lods: null,
      },
      {
        id: `${faction.toLowerCase()}_fighter_t1`,
        code: `${pfx}-AIR-01`,
        faction,
        unitKey: 'fighter',
        researchTier: 1,
        requiredDoctrine: 'fighter',
        displayNameVi: `Tiêm kích đánh chặn (${facLabel})`,
        modelSlug: null,
        glbStatus: 'MISSING_GLB',
        fallbackVisual: 'PROCEDURAL_2_5D',
        forwardAxis: '+Z',
        pivotMinY: 0,
        bboxSizeXYZ: [8.5, 2.8, 12.0],
        mapVisualScale: 1.25,
        formationCount: 1,
        lods: null,
      },
      {
        id: `${faction.toLowerCase()}_corvette_t1`,
        code: `${pfx}-NAV-01`,
        faction,
        unitKey: 'corvette',
        researchTier: 1,
        requiredDoctrine: 'corvette',
        displayNameVi: `Tàu hộ vệ tên lửa (${facLabel})`,
        modelSlug: null,
        glbStatus: 'MISSING_GLB',
        fallbackVisual: 'PROCEDURAL_2_5D',
        forwardAxis: '+Z',
        pivotMinY: 0,
        bboxSizeXYZ: [4.2, 4.5, 16.0],
        mapVisualScale: 1.32,
        formationCount: 1,
        lods: null,
      },
      {
        id: `${faction.toLowerCase()}_submarine_t1`,
        code: `${pfx}-SUB-01`,
        faction,
        unitKey: 'submarine',
        researchTier: 1,
        requiredDoctrine: 'submarine',
        displayNameVi: `Tàu ngầm tấn công (${facLabel})`,
        modelSlug: null,
        glbStatus: 'MISSING_GLB',
        fallbackVisual: 'PROCEDURAL_2_5D',
        forwardAxis: '+Z',
        pivotMinY: 0,
        bboxSizeXYZ: [3.2, 2.8, 15.0],
        mapVisualScale: 1.28,
        formationCount: 1,
        lods: null,
      },
    ];
  }),
];

export const CAMPAIGN_READY_GLB_ENTRIES = CAMPAIGN_UNIT_ASSET_MANIFEST.filter(
  (entry) => entry.glbStatus === 'READY'
);

export const CAMPAIGN_MISSING_GLB_ENTRIES = CAMPAIGN_UNIT_ASSET_MANIFEST.filter(
  (entry) => entry.glbStatus === 'MISSING_GLB'
);

export function resolveCampaignUnitVisual(
  faction: CampaignVisualFaction,
  unitKey: CampaignUnitKey,
  learnedDoctrines: readonly string[] = []
): CampaignUnitVisualEntry {
  const desiredTier: 1 | 2 =
    unitKey === 'motor' && learnedDoctrines.includes('motor2') ? 2 : 1;

  const exact = CAMPAIGN_UNIT_ASSET_MANIFEST.find(
    (entry) =>
      entry.faction === faction &&
      entry.unitKey === unitKey &&
      entry.researchTier === desiredTier
  );
  if (exact) return exact;

  const fallbackTier1 = CAMPAIGN_UNIT_ASSET_MANIFEST.find(
    (entry) =>
      entry.faction === faction &&
      entry.unitKey === unitKey &&
      entry.researchTier === 1
  );
  if (fallbackTier1) return fallbackTier1;

  return CAMPAIGN_UNIT_ASSET_MANIFEST[0];
}
