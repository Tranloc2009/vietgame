import {
  asFixedPoint,
  BudgetAllocation,
  ExtendedResourceBasket,
  ExtendedResourceType,
  FacilityTier,
  FacilityType,
  FixedPointInt,
  wholeUnitsToFixedPoint,
} from '../contracts';

export const EXTENDED_RESOURCE_TYPES: readonly ExtendedResourceType[] = [
  'money',
  'foreignExchange',
  'manpower',
  'food',
  'fuel',
  'supplies',
  'equipment',
  'medical',
];

export const FACILITY_TYPES: readonly FacilityType[] = [
  'POWER_PLANT',
  'CIVILIAN_HOUSING',
  'GRANARY_FARM',
  'FUEL_REFINERY',
  'SUPPLY_DEPOT',
  'ARMS_FACTORY',
  'MEDICAL_CENTER',
  'TRADE_PORT',
];

export const PHASE03_SETTLEMENT_INTERVAL_MS = 3_600_000; // 1 real-time hour (24 cycles / 24h day)
export const TAX_POLICY_DELAY_MS = 2 * 3_600_000; // 2 hours delayed fiscal impact
export const TAX_CHANGE_COOLDOWN_MS = 3_600_000; // 1 hour cooldown between tax policy updates
export const MIN_PHASE03_TAX_BPS = 500; // 5%
export const MAX_PHASE03_TAX_BPS = 6000; // 60%
export const DEFAULT_PHASE03_TAX_BPS = 2000; // 20%
export const DEFAULT_INTEREST_RATE_BPS_PER_DAY = 240; // 2.4% / day (exact 10 bps / hour)
export const MAX_MORALE_FP = 100_000;
export const DEFAULT_PHASE03_LEDGER_CAP = 300;

export const DEFAULT_BUDGET_ALLOCATION: BudgetAllocation = {
  defenseBps: 3000,
  civilianBps: 3000,
  scienceBps: 1500,
  industryBps: 2500,
};

export function createZeroExtendedBasket(): ExtendedResourceBasket {
  return {
    money: asFixedPoint(0),
    foreignExchange: asFixedPoint(0),
    manpower: asFixedPoint(0),
    food: asFixedPoint(0),
    fuel: asFixedPoint(0),
    supplies: asFixedPoint(0),
    equipment: asFixedPoint(0),
    medical: asFixedPoint(0),
  };
}

export function makeExtendedBasket(
  partial: Partial<Record<ExtendedResourceType, number>>
): ExtendedResourceBasket {
  return {
    money: asFixedPoint(partial.money ?? 0),
    foreignExchange: asFixedPoint(partial.foreignExchange ?? 0),
    manpower: asFixedPoint(partial.manpower ?? 0),
    food: asFixedPoint(partial.food ?? 0),
    fuel: asFixedPoint(partial.fuel ?? 0),
    supplies: asFixedPoint(partial.supplies ?? 0),
    equipment: asFixedPoint(partial.equipment ?? 0),
    medical: asFixedPoint(partial.medical ?? 0),
  };
}

export const BASE_EXTENDED_STORAGE_CAPS: ExtendedResourceBasket = {
  money: wholeUnitsToFixedPoint(5000),
  foreignExchange: wholeUnitsToFixedPoint(2000),
  manpower: wholeUnitsToFixedPoint(4000),
  food: wholeUnitsToFixedPoint(3000),
  fuel: wholeUnitsToFixedPoint(2000),
  supplies: wholeUnitsToFixedPoint(2500),
  equipment: wholeUnitsToFixedPoint(1500),
  medical: wholeUnitsToFixedPoint(1200),
};

export interface ProductionRecipeSpec {
  readonly outputResource: ExtendedResourceType;
  readonly outputPerBatchFp: FixedPointInt;
  readonly inputPerBatch: ExtendedResourceBasket;
  readonly durationPerBatchMs: number;
  readonly labelVi: string;
}

export interface FacilityTierSpec {
  readonly tier: FacilityTier;
  readonly buildDurationMs: number;
  readonly buildCost: ExtendedResourceBasket;
  readonly laborCapacityProvidedFp: FixedPointInt;
  readonly energyCapacityProvidedFp: FixedPointInt;
  readonly laborDemandFp: FixedPointInt;
  readonly energyDemandFp: FixedPointInt;
  readonly storageCapBonus: ExtendedResourceBasket;
  readonly hourlyInputs: ExtendedResourceBasket;
  readonly hourlyOutputs: ExtendedResourceBasket;
  readonly productionRecipe: ProductionRecipeSpec | null;
}

export interface FacilityCatalogEntry {
  readonly type: FacilityType;
  readonly nameVi: string;
  readonly roleSummaryVi: string;
  readonly tiers: Readonly<Record<FacilityTier, FacilityTierSpec>>;
}

function makeTierSpec(params: {
  tier: FacilityTier;
  buildHours: number;
  buildCost: Partial<Record<ExtendedResourceType, number>>;
  laborCap?: number;
  energyCap?: number;
  laborDemand?: number;
  energyDemand?: number;
  storageCapBonus?: Partial<Record<ExtendedResourceType, number>>;
  hourlyInputs: Partial<Record<ExtendedResourceType, number>>;
  hourlyOutputs: Partial<Record<ExtendedResourceType, number>>;
  recipe?: {
    outputResource: ExtendedResourceType;
    outputUnits: number;
    durationMinutes: number;
    inputs: Partial<Record<ExtendedResourceType, number>>;
    labelVi: string;
  } | null;
}): FacilityTierSpec {
  return {
    tier: params.tier,
    buildDurationMs: params.buildHours * 3_600_000,
    buildCost: makeExtendedBasket(params.buildCost),
    laborCapacityProvidedFp: asFixedPoint(params.laborCap ?? 0),
    energyCapacityProvidedFp: asFixedPoint(params.energyCap ?? 0),
    laborDemandFp: asFixedPoint(params.laborDemand ?? 0),
    energyDemandFp: asFixedPoint(params.energyDemand ?? 0),
    storageCapBonus: makeExtendedBasket(params.storageCapBonus ?? {}),
    hourlyInputs: makeExtendedBasket(params.hourlyInputs),
    hourlyOutputs: makeExtendedBasket(params.hourlyOutputs),
    productionRecipe: params.recipe
      ? {
          outputResource: params.recipe.outputResource,
          outputPerBatchFp: wholeUnitsToFixedPoint(params.recipe.outputUnits),
          inputPerBatch: makeExtendedBasket(params.recipe.inputs),
          durationPerBatchMs: params.recipe.durationMinutes * 60_000,
          labelVi: params.recipe.labelVi,
        }
      : null,
  };
}

/**
 * 8 distinct facility types with Tiers I-III, data-driven costs, labor/energy budgets,
 * maintenance inputs, outputs, and batch production recipes.
 */
export const FACILITY_CATALOG: Readonly<Record<FacilityType, FacilityCatalogEntry>> = {
  POWER_PLANT: {
    type: 'POWER_PLANT',
    nameVi: 'Nhà máy Điện',
    roleSummaryVi: 'Cung cấp công suất năng lượng cho toàn bộ mạng nhà máy (tiêu thụ nhiên liệu & tiền).',
    tiers: {
      1: makeTierSpec({
        tier: 1,
        buildHours: 2,
        buildCost: { money: 45_000, supplies: 30_000 },
        energyCap: 60_000,
        laborDemand: 8_000,
        hourlyInputs: { fuel: 600, money: 400 },
        hourlyOutputs: {},
        recipe: null,
      }),
      2: makeTierSpec({
        tier: 2,
        buildHours: 4,
        buildCost: { money: 80_000, supplies: 55_000, foreignExchange: 12_000 },
        energyCap: 120_000,
        laborDemand: 14_000,
        hourlyInputs: { fuel: 1_100, money: 750 },
        hourlyOutputs: {},
        recipe: null,
      }),
      3: makeTierSpec({
        tier: 3,
        buildHours: 6,
        buildCost: { money: 130_000, supplies: 90_000, foreignExchange: 25_000 },
        energyCap: 200_000,
        laborDemand: 20_000,
        hourlyInputs: { fuel: 1_600, money: 1_100 },
        hourlyOutputs: {},
        recipe: null,
      }),
    },
  },
  CIVILIAN_HOUSING: {
    type: 'CIVILIAN_HOUSING',
    nameVi: 'Khu Dân sinh & Lao động',
    roleSummaryVi: 'Mở rộng công suất lao động, tái tạo nhân lực và giữ ổn định dân sự.',
    tiers: {
      1: makeTierSpec({
        tier: 1,
        buildHours: 2,
        buildCost: { money: 35_000, supplies: 25_000 },
        laborCap: 60_000,
        energyDemand: 6_000,
        storageCapBonus: { manpower: 250_000 },
        hourlyInputs: { food: 700, money: 350 },
        hourlyOutputs: { manpower: 900 },
        recipe: null,
      }),
      2: makeTierSpec({
        tier: 2,
        buildHours: 4,
        buildCost: { money: 65_000, supplies: 45_000 },
        laborCap: 120_000,
        energyDemand: 11_000,
        storageCapBonus: { manpower: 550_000 },
        hourlyInputs: { food: 1_300, money: 650 },
        hourlyOutputs: { manpower: 1_750 },
        recipe: null,
      }),
      3: makeTierSpec({
        tier: 3,
        buildHours: 6,
        buildCost: { money: 105_000, supplies: 75_000 },
        laborCap: 200_000,
        energyDemand: 16_000,
        storageCapBonus: { manpower: 900_000 },
        hourlyInputs: { food: 1_900, money: 950 },
        hourlyOutputs: { manpower: 2_800 },
        recipe: null,
      }),
    },
  },
  GRANARY_FARM: {
    type: 'GRANARY_FARM',
    nameVi: 'Nông trường & Kho lương',
    roleSummaryVi: 'Sản xuất lương thực định kỳ và mở rộng sức chứa kho lương thực.',
    tiers: {
      1: makeTierSpec({
        tier: 1,
        buildHours: 2,
        buildCost: { money: 30_000, supplies: 20_000 },
        laborDemand: 10_000,
        energyDemand: 6_000,
        storageCapBonus: { food: 300_000 },
        hourlyInputs: { money: 250 },
        hourlyOutputs: { food: 2_400 },
        recipe: {
          outputResource: 'food',
          outputUnits: 18,
          durationMinutes: 45,
          inputs: { money: 6_000, fuel: 3_000 },
          labelVi: 'Thu hoạch & dự trữ lương thực tăng cường',
        },
      }),
      2: makeTierSpec({
        tier: 2,
        buildHours: 4,
        buildCost: { money: 55_000, supplies: 40_000 },
        laborDemand: 16_000,
        energyDemand: 10_000,
        storageCapBonus: { food: 650_000 },
        hourlyInputs: { money: 450, fuel: 250 },
        hourlyOutputs: { food: 4_600 },
        recipe: {
          outputResource: 'food',
          outputUnits: 32,
          durationMinutes: 60,
          inputs: { money: 10_000, fuel: 5_000 },
          labelVi: 'Thu hoạch cơ giới cấp II',
        },
      }),
      3: makeTierSpec({
        tier: 3,
        buildHours: 6,
        buildCost: { money: 90_000, supplies: 65_000 },
        laborDemand: 22_000,
        energyDemand: 14_000,
        storageCapBonus: { food: 1_100_000 },
        hourlyInputs: { money: 700, fuel: 450 },
        hourlyOutputs: { food: 7_200 },
        recipe: {
          outputResource: 'food',
          outputUnits: 48,
          durationMinutes: 75,
          inputs: { money: 15_000, fuel: 8_000 },
          labelVi: 'Tổng kho lương thực cấp III',
        },
      }),
    },
  },
  FUEL_REFINERY: {
    type: 'FUEL_REFINERY',
    nameVi: 'Nhà máy Nhiên liệu',
    roleSummaryVi: 'Tinh chế nhiên liệu vận hành điện lực, công nghiệp và hậu cần.',
    tiers: {
      1: makeTierSpec({
        tier: 1,
        buildHours: 2,
        buildCost: { money: 50_000, supplies: 35_000 },
        laborDemand: 10_000,
        energyDemand: 10_000,
        storageCapBonus: { fuel: 250_000 },
        hourlyInputs: { supplies: 500, money: 450 },
        hourlyOutputs: { fuel: 2_200 },
        recipe: {
          outputResource: 'fuel',
          outputUnits: 16,
          durationMinutes: 50,
          inputs: { supplies: 6_000, money: 8_000 },
          labelVi: 'Tinh chế lô nhiên liệu tiêu chuẩn',
        },
      }),
      2: makeTierSpec({
        tier: 2,
        buildHours: 4,
        buildCost: { money: 90_000, supplies: 60_000, foreignExchange: 15_000 },
        laborDemand: 16_000,
        energyDemand: 16_000,
        storageCapBonus: { fuel: 550_000 },
        hourlyInputs: { supplies: 900, money: 800 },
        hourlyOutputs: { fuel: 4_200 },
        recipe: {
          outputResource: 'fuel',
          outputUnits: 30,
          durationMinutes: 60,
          inputs: { supplies: 11_000, money: 14_000 },
          labelVi: 'Tinh chế lô nhiên liệu cấp II',
        },
      }),
      3: makeTierSpec({
        tier: 3,
        buildHours: 6,
        buildCost: { money: 140_000, supplies: 95_000, foreignExchange: 30_000 },
        laborDemand: 24_000,
        energyDemand: 24_000,
        storageCapBonus: { fuel: 950_000 },
        hourlyInputs: { supplies: 1_350, money: 1_200 },
        hourlyOutputs: { fuel: 6_800 },
        recipe: {
          outputResource: 'fuel',
          outputUnits: 46,
          durationMinutes: 75,
          inputs: { supplies: 16_000, money: 20_000 },
          labelVi: 'Tinh chế lô nhiên liệu cấp III',
        },
      }),
    },
  },
  SUPPLY_DEPOT: {
    type: 'SUPPLY_DEPOT',
    nameVi: 'Xưởng Vật tư & Kho vận',
    roleSummaryVi: 'Sản xuất vật tư xây dựng/công nghiệp và mở rộng trần kho vật tư.',
    tiers: {
      1: makeTierSpec({
        tier: 1,
        buildHours: 2,
        buildCost: { money: 40_000, supplies: 20_000 },
        laborDemand: 12_000,
        energyDemand: 8_000,
        storageCapBonus: { supplies: 350_000, equipment: 150_000 },
        hourlyInputs: { fuel: 400, money: 400 },
        hourlyOutputs: { supplies: 2_300 },
        recipe: {
          outputResource: 'supplies',
          outputUnits: 18,
          durationMinutes: 45,
          inputs: { fuel: 4_000, money: 8_000 },
          labelVi: 'Gia công lô vật tư cơ bản',
        },
      }),
      2: makeTierSpec({
        tier: 2,
        buildHours: 4,
        buildCost: { money: 75_000, supplies: 40_000 },
        laborDemand: 18_000,
        energyDemand: 14_000,
        storageCapBonus: { supplies: 750_000, equipment: 350_000 },
        hourlyInputs: { fuel: 750, money: 750 },
        hourlyOutputs: { supplies: 4_400 },
        recipe: {
          outputResource: 'supplies',
          outputUnits: 34,
          durationMinutes: 60,
          inputs: { fuel: 7_000, money: 14_000 },
          labelVi: 'Gia công lô vật tư cấp II',
        },
      }),
      3: makeTierSpec({
        tier: 3,
        buildHours: 6,
        buildCost: { money: 120_000, supplies: 70_000 },
        laborDemand: 25_000,
        energyDemand: 20_000,
        storageCapBonus: { supplies: 1_250_000, equipment: 600_000 },
        hourlyInputs: { fuel: 1_100, money: 1_100 },
        hourlyOutputs: { supplies: 7_000 },
        recipe: {
          outputResource: 'supplies',
          outputUnits: 52,
          durationMinutes: 75,
          inputs: { fuel: 11_000, money: 22_000 },
          labelVi: 'Tổng xưởng vật tư cấp III',
        },
      }),
    },
  },
  ARMS_FACTORY: {
    type: 'ARMS_FACTORY',
    nameVi: 'Nhà máy Trang bị',
    roleSummaryVi: 'Chế tạo trang bị trừu tượng từ vật tư và nhiên liệu; tạm dừng ngay nếu thiếu vật tư.',
    tiers: {
      1: makeTierSpec({
        tier: 1,
        buildHours: 3,
        buildCost: { money: 60_000, supplies: 45_000, foreignExchange: 10_000 },
        laborDemand: 14_000,
        energyDemand: 12_000,
        storageCapBonus: { equipment: 200_000 },
        hourlyInputs: { supplies: 900, fuel: 400, money: 600 },
        hourlyOutputs: { equipment: 1_400 },
        recipe: {
          outputResource: 'equipment',
          outputUnits: 12,
          durationMinutes: 60,
          inputs: { supplies: 10_000, fuel: 5_000, money: 10_000 },
          labelVi: 'Chế tạo lô trang bị cấp I',
        },
      }),
      2: makeTierSpec({
        tier: 2,
        buildHours: 5,
        buildCost: { money: 105_000, supplies: 75_000, foreignExchange: 22_000 },
        laborDemand: 22_000,
        energyDemand: 18_000,
        storageCapBonus: { equipment: 450_000 },
        hourlyInputs: { supplies: 1_650, fuel: 750, money: 1_050 },
        hourlyOutputs: { equipment: 2_800 },
        recipe: {
          outputResource: 'equipment',
          outputUnits: 24,
          durationMinutes: 75,
          inputs: { supplies: 18_000, fuel: 9_000, money: 18_000 },
          labelVi: 'Chế tạo lô trang bị cấp II',
        },
      }),
      3: makeTierSpec({
        tier: 3,
        buildHours: 7,
        buildCost: { money: 165_000, supplies: 115_000, foreignExchange: 40_000 },
        laborDemand: 30_000,
        energyDemand: 26_000,
        storageCapBonus: { equipment: 800_000 },
        hourlyInputs: { supplies: 2_400, fuel: 1_100, money: 1_550 },
        hourlyOutputs: { equipment: 4_500 },
        recipe: {
          outputResource: 'equipment',
          outputUnits: 38,
          durationMinutes: 90,
          inputs: { supplies: 28_000, fuel: 14_000, money: 26_000 },
          labelVi: 'Chế tạo lô trang bị cấp III',
        },
      }),
    },
  },
  MEDICAL_CENTER: {
    type: 'MEDICAL_CENTER',
    nameVi: 'Cơ sở Y tế & Quân y',
    roleSummaryVi: 'Sản xuất vật tư y tế, nâng đỡ dân sinh và ổn định xã hội.',
    tiers: {
      1: makeTierSpec({
        tier: 1,
        buildHours: 2,
        buildCost: { money: 42_000, supplies: 28_000 },
        laborDemand: 10_000,
        energyDemand: 8_000,
        storageCapBonus: { medical: 200_000 },
        hourlyInputs: { supplies: 450, money: 500 },
        hourlyOutputs: { medical: 1_300 },
        recipe: {
          outputResource: 'medical',
          outputUnits: 12,
          durationMinutes: 45,
          inputs: { supplies: 6_000, money: 8_000 },
          labelVi: 'Điều chế lô cơ số y tế',
        },
      }),
      2: makeTierSpec({
        tier: 2,
        buildHours: 4,
        buildCost: { money: 78_000, supplies: 52_000, foreignExchange: 12_000 },
        laborDemand: 16_000,
        energyDemand: 12_000,
        storageCapBonus: { medical: 450_000 },
        hourlyInputs: { supplies: 850, money: 900 },
        hourlyOutputs: { medical: 2_600 },
        recipe: {
          outputResource: 'medical',
          outputUnits: 24,
          durationMinutes: 60,
          inputs: { supplies: 11_000, money: 14_000 },
          labelVi: 'Điều chế lô cơ số y tế cấp II',
        },
      }),
      3: makeTierSpec({
        tier: 3,
        buildHours: 6,
        buildCost: { money: 125_000, supplies: 82_000, foreignExchange: 24_000 },
        laborDemand: 22_000,
        energyDemand: 18_000,
        storageCapBonus: { medical: 800_000 },
        hourlyInputs: { supplies: 1_250, money: 1_350 },
        hourlyOutputs: { medical: 4_200 },
        recipe: {
          outputResource: 'medical',
          outputUnits: 38,
          durationMinutes: 75,
          inputs: { supplies: 17_000, money: 22_000 },
          labelVi: 'Trung tâm y tế tổng hợp cấp III',
        },
      }),
    },
  },
  TRADE_PORT: {
    type: 'TRADE_PORT',
    nameVi: 'Cảng Thương mại & Ngoại hối',
    roleSummaryVi: 'Tạo nguồn thu ngoại tệ và mở rộng cơ sở thuế ngân khố.',
    tiers: {
      1: makeTierSpec({
        tier: 1,
        buildHours: 3,
        buildCost: { money: 55_000, supplies: 40_000 },
        laborDemand: 10_000,
        energyDemand: 8_000,
        storageCapBonus: { foreignExchange: 250_000, money: 400_000 },
        hourlyInputs: { supplies: 350, fuel: 300 },
        hourlyOutputs: { foreignExchange: 1_200, money: 1_500 },
        recipe: {
          outputResource: 'foreignExchange',
          outputUnits: 14,
          durationMinutes: 60,
          inputs: { supplies: 8_000, food: 8_000 },
          labelVi: 'Xuất khẩu lô hàng đổi ngoại tệ',
        },
      }),
      2: makeTierSpec({
        tier: 2,
        buildHours: 5,
        buildCost: { money: 95_000, supplies: 70_000, foreignExchange: 15_000 },
        laborDemand: 16_000,
        energyDemand: 14_000,
        storageCapBonus: { foreignExchange: 550_000, money: 850_000 },
        hourlyInputs: { supplies: 650, fuel: 550 },
        hourlyOutputs: { foreignExchange: 2_300, money: 2_900 },
        recipe: {
          outputResource: 'foreignExchange',
          outputUnits: 26,
          durationMinutes: 75,
          inputs: { supplies: 14_000, food: 14_000 },
          labelVi: 'Thương vụ xuất khẩu cấp II',
        },
      }),
      3: makeTierSpec({
        tier: 3,
        buildHours: 7,
        buildCost: { money: 150_000, supplies: 105_000, foreignExchange: 32_000 },
        laborDemand: 24_000,
        energyDemand: 20_000,
        storageCapBonus: { foreignExchange: 950_000, money: 1_500_000 },
        hourlyInputs: { supplies: 1_000, fuel: 850 },
        hourlyOutputs: { foreignExchange: 3_700, money: 4_600 },
        recipe: {
          outputResource: 'foreignExchange',
          outputUnits: 42,
          durationMinutes: 90,
          inputs: { supplies: 22_000, food: 22_000 },
          labelVi: 'Thương cảng quốc tế cấp III',
        },
      }),
    },
  },
};

/**
 * Pure integer Laffer compliance curve (basis points, 10000 = 100% tax base compliance).
 * Guarantees NO infinite income from raising tax:
 * - 5%..25%: high compliance (100% -> 94%)
 * - 30%: 86% -> yield factor = 3000 * 8600 / 10000 = 2580
 * - 35%: 76% -> yield factor = 3500 * 7600 / 10000 = 2660 (near peak)
 * - 40%: 66% -> yield factor = 4000 * 6600 / 10000 = 2640 (begins declining!)
 * - 50%: 44% -> yield factor = 5000 * 4400 / 10000 = 2200 (strictly lower!)
 * - 60%: 28% -> yield factor = 6000 * 2800 / 10000 = 1680 (severe evasion & slowdown!)
 */
export function computeTaxComplianceBps(taxRateBps: number): number {
  const clamped = Math.max(MIN_PHASE03_TAX_BPS, Math.min(MAX_PHASE03_TAX_BPS, Math.trunc(taxRateBps)));
  if (clamped <= 2500) {
    // 10000 at 500 bps down gently to 9400 at 2500 bps
    return 10000 - Math.floor(((clamped - 500) * 600) / 2000);
  }
  if (clamped <= 3500) {
    // 9400 at 2500 bps down to 7600 at 3500 bps
    return 9400 - Math.floor(((clamped - 2500) * 1800) / 1000);
  }
  if (clamped <= 5000) {
    // 7600 at 3500 bps down steeply to 4400 at 5000 bps
    return 7600 - Math.floor(((clamped - 3500) * 3200) / 1500);
  }
  // 4400 at 5000 bps down to 2800 at 6000 bps
  return 4400 - Math.floor(((clamped - 5000) * 1600) / 1000);
}

/**
 * Effective tax yield multiplier in bps (rate * compliance / 10000).
 * Strictly bounded and non-monotonic (peaks around ~35-38%, then drops).
 */
export function computeEffectiveTaxYieldBps(taxRateBps: number, taxFatigueFp: FixedPointInt): number {
  const complianceBps = computeTaxComplianceBps(taxRateBps);
  // Tax fatigue (0..30_000 fp = 0..30%) further erodes compliance up to -30%
  const fatigueReductionBps = Math.min(3000, Math.floor((taxFatigueFp as number) / 10));
  const netCompliance = Math.max(2000, complianceBps - fatigueReductionBps);
  return Math.floor((Math.max(MIN_PHASE03_TAX_BPS, Math.min(MAX_PHASE03_TAX_BPS, taxRateBps)) * netCompliance) / 10000);
}
