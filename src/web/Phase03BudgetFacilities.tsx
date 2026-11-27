import { FormEvent, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Building2,
  Clock,
  Factory,
  Landmark,
  PauseCircle,
  PlayCircle,
  PlusCircle,
  TrendingDown,
  TrendingUp,
  XCircle,
} from 'lucide-react';
import {
  BudgetAllocation,
  ExtendedResourceBasket,
  ExtendedResourceType,
  FacilityOperationalStatus,
  FacilityType,
  FilteredClientMatchView,
  FiscalStatus,
  fpFormat,
  MatchRoomSummary,
  wholeUnitsToFixedPoint,
} from '../contracts';
import { ClientPhase03NationReport } from './roomApi';

export const EXTENDED_RESOURCE_LABELS: Readonly<Record<ExtendedResourceType, string>> = {
  money: 'Tiền tệ',
  foreignExchange: 'Ngoại tệ',
  manpower: 'Nhân lực',
  food: 'Lương thực',
  fuel: 'Nhiên liệu',
  supplies: 'Vật tư',
  equipment: 'Trang bị',
  medical: 'Y tế',
};

const EXTENDED_RESOURCE_ORDER: readonly ExtendedResourceType[] = [
  'money',
  'foreignExchange',
  'manpower',
  'food',
  'fuel',
  'supplies',
  'equipment',
  'medical',
];

const FACILITY_TYPE_ORDER: readonly FacilityType[] = [
  'POWER_PLANT',
  'CIVILIAN_HOUSING',
  'GRANARY_FARM',
  'FUEL_REFINERY',
  'SUPPLY_DEPOT',
  'ARMS_FACTORY',
  'MEDICAL_CENTER',
  'TRADE_PORT',
];

const FISCAL_STATUS_META: Readonly<
  Record<FiscalStatus, { readonly label: string; readonly tone: string }>
> = {
  NORMAL: { label: 'Ổn định', tone: 'text-[#214235] border-[#BFD6CA] bg-[#EFF6F2]' },
  WARNING_24H: { label: 'Cảnh báo 24h', tone: 'text-[#8C5214] border-[#E8C89B] bg-[#FDF7EC]' },
  DEFICIT_BORROWING: { label: 'Thâm hụt / Dùng tín dụng', tone: 'text-[#9A3B26] border-[#E5B8AF] bg-[#FDF2F0]' },
  AUSTERITY_THROTTLED: { label: 'Thắt lưng buộc bụng', tone: 'text-[#9A3B26] border-[#9A3B26] bg-[#FDF2F0]' },
};

const FACILITY_STATUS_META: Readonly<
  Record<FacilityOperationalStatus, { readonly label: string; readonly tone: string }>
> = {
  ACTIVE: { label: 'Đang hoạt động', tone: 'text-[#214235] border-[#BFD6CA] bg-[#EFF6F2]' },
  PAUSED_MANUAL: { label: 'Tạm dừng thủ công', tone: 'text-[#545B66] border-[#D9D6CC] bg-[#F6F5F0]' },
  PAUSED_NO_INPUTS: { label: 'Tạm dừng: Thiếu đầu vào', tone: 'text-[#9A3B26] border-[#E5B8AF] bg-[#FDF2F0]' },
  PAUSED_NO_POWER: { label: 'Tạm dừng: Thiếu điện năng', tone: 'text-[#9A3B26] border-[#E5B8AF] bg-[#FDF2F0]' },
  PAUSED_NO_LABOR: { label: 'Tạm dừng: Thiếu lao động', tone: 'text-[#9A3B26] border-[#E5B8AF] bg-[#FDF2F0]' },
  PAUSED_AUSTERITY: { label: 'Tạm dừng: Cạn ngân khố', tone: 'text-[#9A3B26] border-[#E5B8AF] bg-[#FDF2F0]' },
  DAMAGED: { label: 'Hư hại cần sửa chữa', tone: 'text-[#9A3B26] border-[#9A3B26] bg-[#FDF2F0]' },
};

function formatUtcShort(ts: number): string {
  return new Date(ts).toISOString().replace('T', ' ').slice(5, 19) + 'Z';
}

function formatDurationEta(remainingMs: number): string {
  if (remainingMs <= 0) return 'Sắp hoàn tất';
  const totalMinutes = Math.ceil(remainingMs / 60_000);
  const hours = Math.floor(totalMinutes / 60);
  const mins = totalMinutes % 60;
  if (hours <= 0) return `${mins} phút`;
  if (mins === 0) return `${hours} giờ`;
  return `${hours}g ${mins}p`;
}

function formatBasketSummary(basket: ExtendedResourceBasket): string {
  const parts: string[] = [];
  for (const res of EXTENDED_RESOURCE_ORDER) {
    const val = basket[res] as number;
    if (val > 0) {
      parts.push(`${fpFormat(basket[res], 1)} ${EXTENDED_RESOURCE_LABELS[res]}`);
    }
  }
  return parts.length > 0 ? parts.join(' · ') : '0';
}

function getMissingResourcesText(
  cost: ExtendedResourceBasket,
  available: ExtendedResourceBasket
): string | null {
  const missing: string[] = [];
  for (const res of EXTENDED_RESOURCE_ORDER) {
    const need = cost[res] as number;
    const have = available[res] as number;
    if (need > have) {
      const diff = need - have;
      missing.push(
        `Thiếu ${fpFormat(diff as never, 1)} ${EXTENDED_RESOURCE_LABELS[res]} (cần ${fpFormat(cost[res], 1)}, hiện có ${fpFormat(available[res], 1)})`
      );
    }
  }
  return missing.length > 0 ? missing.join('; ') : null;
}

export interface Phase03BudgetTabProps {
  readonly room: MatchRoomSummary;
  readonly match: FilteredClientMatchView;
  readonly report: ClientPhase03NationReport;
  readonly busy: boolean;
  readonly onUpdateBudgetPolicy: (targetTaxRateBps: number, allocations: BudgetAllocation) => void;
  readonly onManageCredit: (action: 'DRAW' | 'REPAY', amountFp: number) => void;
}

export function Phase03BudgetTab({
  room,
  match,
  report,
  busy,
  onUpdateBudgetPolicy,
  onManageCredit,
}: Phase03BudgetTabProps) {
  const isActive = room.status === 'ACTIVE';
  const { budget, fiscalForecast24h, stock } = report;

  const [taxPct, setTaxPct] = useState<number>(Math.round(budget.targetTaxRateBps / 100));
  const [defensePct, setDefensePct] = useState<number>(Math.round(budget.allocations.defenseBps / 100));
  const [civilianPct, setCivilianPct] = useState<number>(Math.round(budget.allocations.civilianBps / 100));
  const [sciencePct, setSciencePct] = useState<number>(Math.round(budget.allocations.scienceBps / 100));
  const [industryPct, setIndustryPct] = useState<number>(Math.round(budget.allocations.industryBps / 100));
  const [creditUnits, setCreditUnits] = useState<string>('50');

  useEffect(() => {
    setTaxPct(Math.round(budget.targetTaxRateBps / 100));
    setDefensePct(Math.round(budget.allocations.defenseBps / 100));
    setCivilianPct(Math.round(budget.allocations.civilianBps / 100));
    setSciencePct(Math.round(budget.allocations.scienceBps / 100));
    setIndustryPct(Math.round(budget.allocations.industryBps / 100));
  }, [
    budget.targetTaxRateBps,
    budget.allocations.defenseBps,
    budget.allocations.civilianBps,
    budget.allocations.scienceBps,
    budget.allocations.industryBps,
  ]);

  const allocSumPct = defensePct + civilianPct + sciencePct + industryPct;
  const taxRateChanged = taxPct * 100 !== budget.targetTaxRateBps;
  const inTaxCooldown =
    budget.taxCooldownUntilUtc !== null && (match.currentUtc as number) < (budget.taxCooldownUntilUtc as number);
  const taxBlockedByCooldown = taxRateChanged && inTaxCooldown;

  const policyDisabledReason = useMemo(() => {
    if (!isActive) return 'Chỉ điều chỉnh được ngân sách khi phòng đấu đang ở trạng thái ACTIVE.';
    if (allocSumPct !== 100) {
      return `Tổng 4 lĩnh vực phân bổ đang là ${allocSumPct}% (phải bằng đúng 100%).`;
    }
    if (taxPct < 5 || taxPct > 60) {
      return 'Thuế suất mục tiêu phải nằm trong biên an toàn 5% – 60%.';
    }
    if (taxBlockedByCooldown && budget.taxCooldownUntilUtc !== null) {
      return `Đang trong thời gian hồi thay đổi thuế đến ${formatUtcShort(budget.taxCooldownUntilUtc as number)}.`;
    }
    return null;
  }, [isActive, allocSumPct, taxPct, taxBlockedByCooldown, budget.taxCooldownUntilUtc]);

  const parsedCreditAmount = Number(creditUnits);
  const creditAmountValid = Number.isFinite(parsedCreditAmount) && parsedCreditAmount > 0;
  const creditAmountFp = creditAmountValid ? (wholeUnitsToFixedPoint(Math.round(parsedCreditAmount)) as number) : 0;
  const creditHeadroomFp = fiscalForecast24h.creditHeadroomFp as number;
  const currentDebtFp = stock.debtMoneyFp as number;
  const currentMoneyFp = stock.available.money as number;

  const drawDisabledReason = !isActive
    ? 'Cần trạng thái phòng ACTIVE.'
    : !creditAmountValid
      ? 'Nhập số tiền vay > 0.'
      : creditAmountFp > creditHeadroomFp
        ? `Vượt hạn mức vay còn lại (${fpFormat(fiscalForecast24h.creditHeadroomFp, 1)}).`
        : null;

  const repayDisabledReason = !isActive
    ? 'Cần trạng thái phòng ACTIVE.'
    : !creditAmountValid
      ? 'Nhập số tiền trả nợ > 0.'
      : currentDebtFp <= 0
        ? 'Hiện không có dư nợ cần hoàn trả.'
        : creditAmountFp > currentMoneyFp
          ? `Không đủ tiền khả dụng (${fpFormat(stock.available.money, 1)}).`
          : null;

  const statusMeta = FISCAL_STATUS_META[fiscalForecast24h.fiscalStatus];

  const handleBudgetSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (policyDisabledReason || busy) return;
    onUpdateBudgetPolicy(taxPct * 100, {
      defenseBps: defensePct * 100,
      civilianBps: civilianPct * 100,
      scienceBps: sciencePct * 100,
      industryBps: industryPct * 100,
    });
  };

  return (
    <div data-testid="p03-budget-tab" className="space-y-5">
      {/* Top 4-KPI Summary Strip */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="border border-[#E6E3DA] bg-[#FAFAF7] p-3.5">
          <p className="text-[11px] font-medium text-[#545B66]">Cơ sở thuế / ngày &amp; Hiệu suất Laffer</p>
          <p className="mt-1 font-mono text-base font-bold text-[#171B20] tabular-nums">
            {fpFormat(fiscalForecast24h.taxBaseDailyFp, 1)}
          </p>
          <p className="mt-1 font-mono text-[11px] text-[#545B66] tabular-nums">
            Tuân thủ: {(fiscalForecast24h.taxComplianceBps / 100).toFixed(1)}% · Hiệu dụng:{' '}
            {(fiscalForecast24h.effectiveYieldBps / 100).toFixed(2)}%
          </p>
        </div>

        <div className="border border-[#E6E3DA] bg-[#FAFAF7] p-3.5">
          <p className="text-[11px] font-medium text-[#545B66]">Dự báo 24h (Thu thuế − Chi bắt buộc)</p>
          <p
            data-testid="budget-net-24h"
            className={`mt-1 flex items-center gap-1 font-mono text-base font-bold tabular-nums ${
              fiscalForecast24h.netMoneyDailySignedFp >= 0 ? 'text-[#214235]' : 'text-[#9A3B26]'
            }`}
          >
            {fiscalForecast24h.netMoneyDailySignedFp >= 0 ? (
              <TrendingUp className="h-4 w-4" />
            ) : (
              <TrendingDown className="h-4 w-4" />
            )}
            <span>
              {fiscalForecast24h.netMoneyDailySignedFp > 0 ? '+' : ''}
              {fpFormat(fiscalForecast24h.netMoneyDailySignedFp as never, 1)}
            </span>
          </p>
          <p className="mt-1 font-mono text-[11px] text-[#545B66] tabular-nums">
            Dự kiến 24h: {fpFormat(fiscalForecast24h.projectedMoney24hFp, 1)} tiền tệ
          </p>
        </div>

        <div className="border border-[#E6E3DA] bg-[#FAFAF7] p-3.5">
          <p className="text-[11px] font-medium text-[#545B66]">Nợ công có trần &amp; Lãi suất</p>
          <p data-testid="budget-debt-summary" className="mt-1 font-mono text-base font-bold text-[#171B20] tabular-nums">
            {fpFormat(stock.debtMoneyFp, 1)} / {fpFormat(budget.creditLimitFp, 0)}
          </p>
          <p className="mt-1 font-mono text-[11px] text-[#545B66] tabular-nums">
            Lãi {(budget.interestRateBpsPerDay / 100).toFixed(1)}%/ngày (
            {fpFormat(fiscalForecast24h.debtInterestDailyFp, 2)}/ngày)
          </p>
        </div>

        <div className="border border-[#E6E3DA] bg-[#FAFAF7] p-3.5">
          <p className="text-[11px] font-medium text-[#545B66]">Trạng thái Tài khóa &amp; Dân sự</p>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <span
              data-testid="budget-fiscal-status"
              className={`inline-block border px-2 py-0.5 text-[11px] font-semibold ${statusMeta.tone}`}
            >
              {statusMeta.label}
            </span>
            <span className="font-mono text-xs font-semibold text-[#171B20] tabular-nums">
              Hoạt động {(fiscalForecast24h.activityThrottleBps / 100).toFixed(0)}%
            </span>
          </div>
          <p className="mt-1 font-mono text-[11px] text-[#545B66] tabular-nums">
            Tinh thần dân sự: {fpFormat(budget.civilianMoraleFp, 1)}/100 · Khoa học:{' '}
            {fpFormat(budget.sciencePointsFp, 1)}
          </p>
        </div>
      </div>

      {/* Structured 24h Warnings */}
      {fiscalForecast24h.warnings.length > 0 && (
        <div
          data-testid="budget-warnings-box"
          className="space-y-1.5 border border-[#E8C89B] bg-[#FDF7EC] px-4 py-3 text-xs text-[#7A440F]"
        >
          <p className="flex items-center gap-1.5 font-semibold">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
            <span>Cảnh báo Ngân sách &amp; Dự báo 24 giờ ({fiscalForecast24h.warnings.length})</span>
          </p>
          <ul className="list-disc space-y-1 pl-5 text-[11px]">
            {fiscalForecast24h.warnings.map((w) => (
              <li key={w.code} data-testid={`budget-warning-${w.code}`}>
                {w.messageVi}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Main 2-Column Controls: Tax + 4-Sector Allocations | Bounded Credit + Breakdown */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1.35fr_1fr]">
        {/* Form: Tax Policy (Delayed) & 4-Sector Allocation */}
        <form onSubmit={handleBudgetSubmit} className="space-y-4 border border-[#E6E3DA] bg-[#FAFAF7] p-4">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#E6E3DA] pb-2.5">
            <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-[#171B20]">
              <Landmark className="h-3.5 w-3.5 text-[#2B4C3F]" />
              <span>Chính sách Thuế suất (Độ trễ 2h) &amp; Phân bổ 4 Lĩnh vực</span>
            </h3>
            <span className="font-mono text-[11px] text-[#2B4C3F] tabular-nums">
              Hiệu lực: {(budget.effectiveTaxRateBps / 100).toFixed(0)}% → Mục tiêu:{' '}
              {(budget.targetTaxRateBps / 100).toFixed(0)}%
            </span>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs">
              <label htmlFor="p03-tax-slider" className="font-medium text-[#171B20]">
                Thuế suất mục tiêu (5% – 60% · Đường cong Laffer đỉnh ~35%)
              </label>
              <span data-testid="budget-tax-input-value" className="font-mono font-bold text-[#2B4C3F] tabular-nums">
                {taxPct}%
              </span>
            </div>
            <input
              id="p03-tax-slider"
              data-testid="budget-tax-slider"
              type="range"
              min={5}
              max={60}
              step={5}
              value={taxPct}
              onChange={(e) => setTaxPct(Number(e.target.value))}
              className="w-full accent-[#2B4C3F]"
            />
            <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-[#545B66]">
              <span>Tăng thuế vượt 40% làm suy giảm tuân thủ và bào mòn thu ngân sách.</span>
              {budget.taxChangeEffectiveAtUtc !== null && (
                <span data-testid="budget-pending-tax-utc" className="font-mono text-[#8C5214]">
                  Hiệu lực lúc {formatUtcShort(budget.taxChangeEffectiveAtUtc as number)}
                </span>
              )}
            </div>
          </div>

          {/* 4-sector allocation inputs */}
          <div className="space-y-2 border-t border-[#E6E3DA] pt-3">
            <div className="flex items-center justify-between text-xs">
              <span className="font-medium text-[#171B20]">Phân bổ ngân sách 4 lĩnh vực (Tổng phải = 100%)</span>
              <span
                data-testid="budget-alloc-sum"
                className={`font-mono font-bold tabular-nums ${
                  allocSumPct === 100 ? 'text-[#214235]' : 'text-[#9A3B26]'
                }`}
              >
                Tổng: {allocSumPct}%
              </span>
            </div>

            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {[
                { id: 'alloc-defense', label: 'Quốc phòng (%)', value: defensePct, set: setDefensePct },
                { id: 'alloc-civilian', label: 'Dân sự (%)', value: civilianPct, set: setCivilianPct },
                { id: 'alloc-science', label: 'Khoa học (%)', value: sciencePct, set: setSciencePct },
                { id: 'alloc-industry', label: 'Công nghiệp (%)', value: industryPct, set: setIndustryPct },
              ].map((item) => (
                <div key={item.id}>
                  <label htmlFor={item.id} className="block text-[11px] font-medium text-[#545B66]">
                    {item.label}
                  </label>
                  <input
                    id={item.id}
                    data-testid={item.id}
                    type="number"
                    min={0}
                    max={100}
                    step={5}
                    value={item.value}
                    onChange={(e) => item.set(Math.max(0, Math.min(100, Number(e.target.value) || 0)))}
                    className="mt-1 w-full border border-[#D9D6CC] bg-[#FFFFFF] px-2.5 py-1.5 font-mono text-xs text-[#171B20] tabular-nums"
                  />
                </div>
              ))}
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
            <button
              type="submit"
              data-testid="save-budget-policy-btn"
              disabled={busy || policyDisabledReason !== null}
              className="border border-[#2B4C3F] bg-[#2B4C3F] px-4 py-2 text-xs font-semibold text-[#FFFFFF] hover:bg-[#223D33] disabled:cursor-not-allowed disabled:border-[#D9D6CC] disabled:bg-[#E6E3DA] disabled:text-[#6E7681]"
            >
              Lưu chính sách ngân sách
            </button>
            {policyDisabledReason && (
              <p data-testid="budget-policy-disabled-reason" className="text-[11px] text-[#9A3B26]">
                {policyDisabledReason}
              </p>
            )}
          </div>
        </form>

        {/* Bounded Credit Draw / Repay & Daily Cashflow Breakdown */}
        <div className="space-y-4">
          <div className="border border-[#E6E3DA] bg-[#FAFAF7] p-4">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-[#171B20]">
              Quản lý Nợ công có Giới hạn
            </h3>
            <p className="mt-1 text-[11px] text-[#545B66]">
              Vay trong hạn mức tín dụng ({fpFormat(fiscalForecast24h.creditHeadroomFp, 1)} còn lại) để tránh thắt lưng buộc bụng. Ngân khố không bao giờ âm vượt trần tín dụng.
            </p>
            <div className="mt-3 flex flex-wrap items-end gap-2">
              <div className="min-w-[110px] flex-1">
                <label htmlFor="p03-credit-amount" className="block text-[11px] font-medium text-[#545B66]">
                  Số tiền (đơn vị)
                </label>
                <input
                  id="p03-credit-amount"
                  data-testid="credit-amount-input"
                  type="number"
                  min={1}
                  step={10}
                  value={creditUnits}
                  onChange={(e) => setCreditUnits(e.target.value)}
                  className="mt-1 w-full border border-[#D9D6CC] bg-[#FFFFFF] px-2.5 py-1.5 font-mono text-xs text-[#171B20] tabular-nums"
                />
              </div>
              <button
                type="button"
                data-testid="credit-draw-btn"
                disabled={busy || drawDisabledReason !== null}
                onClick={() => onManageCredit('DRAW', creditAmountFp)}
                className="whitespace-nowrap border border-[#171B20] bg-[#171B20] px-3 py-1.5 text-xs font-semibold text-[#FFFFFF] hover:bg-[#2E343D] disabled:cursor-not-allowed disabled:border-[#D9D6CC] disabled:bg-[#E6E3DA] disabled:text-[#6E7681]"
              >
                Vay tín dụng
              </button>
              <button
                type="button"
                data-testid="credit-repay-btn"
                disabled={busy || repayDisabledReason !== null}
                onClick={() => onManageCredit('REPAY', creditAmountFp)}
                className="whitespace-nowrap border border-[#2B4C3F] bg-[#FFFFFF] px-3 py-1.5 text-xs font-semibold text-[#2B4C3F] hover:bg-[#EDF3F0] disabled:cursor-not-allowed disabled:border-[#D9D6CC] disabled:text-[#6E7681]"
              >
                Trả nợ
              </button>
            </div>
            {(drawDisabledReason || repayDisabledReason) && (
              <p className="mt-2 text-[11px] text-[#545B66]">
                {drawDisabledReason ? `Vay: ${drawDisabledReason}` : null}
                {drawDisabledReason && repayDisabledReason ? ' · ' : null}
                {repayDisabledReason ? `Trả: ${repayDisabledReason}` : null}
              </p>
            )}
          </div>

          <div className="border border-[#E6E3DA] bg-[#FAFAF7] p-4">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-[#171B20]">
              Chi tiết Thu – Chi Tiền tệ (24 giờ)
            </h3>
            <dl className="mt-2.5 space-y-1.5 text-xs">
              <div className="flex items-center justify-between border-b border-[#ECE8DF] pb-1">
                <dt className="text-[#545B66]">Thu thuế dự kiến / ngày</dt>
                <dd className="font-mono font-semibold text-[#214235] tabular-nums">
                  +{fpFormat(fiscalForecast24h.taxRevenueDailyFp, 2)}
                </dd>
              </div>
              <div className="flex items-center justify-between border-b border-[#ECE8DF] pb-1">
                <dt className="text-[#545B66]">Chi bắt buộc (Quân sự + Nhà máy) / ngày</dt>
                <dd className="font-mono text-[#9A3B26] tabular-nums">
                  -{fpFormat(fiscalForecast24h.mandatoryUpkeepDailyFp, 2)}
                </dd>
              </div>
              <div className="flex items-center justify-between border-b border-[#ECE8DF] pb-1">
                <dt className="text-[#545B66]">Lãi vay nợ công / ngày</dt>
                <dd className="font-mono text-[#9A3B26] tabular-nums">
                  -{fpFormat(fiscalForecast24h.debtInterestDailyFp, 2)}
                </dd>
              </div>
              <div className="flex items-center justify-between pt-0.5">
                <dt className="font-medium text-[#171B20]">Thời gian cạn tiền mặt dự kiến</dt>
                <dd className="font-mono font-semibold text-[#171B20] tabular-nums">
                  {fiscalForecast24h.hoursUntilCashDepletion === null
                    ? 'Không cạn trong 24h'
                    : `${fiscalForecast24h.hoursUntilCashDepletion} giờ`}
                </dd>
              </div>
            </dl>
          </div>
        </div>
      </div>
    </div>
  );
}

export interface Phase03FacilitiesTabProps {
  readonly initialRegionId?: string | null;
  readonly room: MatchRoomSummary;
  readonly match: FilteredClientMatchView;
  readonly report: ClientPhase03NationReport;
  readonly busy: boolean;
  readonly onQueueConstruction: (
    regionId: string,
    facilityType: FacilityType,
    targetFacilityId: string | null
  ) => void;
  readonly onCancelConstruction: (orderId: string) => void;
  readonly onQueueProduction: (facilityId: string, batchCount: number) => void;
  readonly onCancelProduction: (orderId: string) => void;
  readonly onToggleFacilityPause: (facilityId: string, paused: boolean) => void;
}

export function Phase03FacilitiesTab({
  initialRegionId,
  room,
  match,
  report,
  busy,
  onQueueConstruction,
  onCancelConstruction,
  onQueueProduction,
  onCancelProduction,
  onToggleFacilityPause,
}: Phase03FacilitiesTabProps) {
  const isActive = room.status === 'ACTIVE';
  const controlledRegions = useMemo(
    () =>
      Object.values(match.regions)
        .filter((r) => r.controllerNationId === room.viewerNationId)
        .sort((a, b) => a.name.localeCompare(b.name)),
    [match.regions, room.viewerNationId]
  );

  const [selectedRegionId, setSelectedRegionId] = useState<string>(
    controlledRegions.find((region) => region.regionId === initialRegionId)?.regionId ??
    controlledRegions[0]?.regionId ?? ''
  );

  useEffect(() => {
    if (controlledRegions.length > 0 && !controlledRegions.some((r) => r.regionId === selectedRegionId)) {
      setSelectedRegionId(controlledRegions[0].regionId);
    }
  }, [controlledRegions, selectedRegionId]);

  const activeConstructionOrders = report.constructionQueue.filter(
    (o) => o.status === 'IN_PROGRESS' || o.status === 'QUEUED' || o.status === 'PAUSED'
  );
  const activeProductionOrders = report.productionQueue.filter(
    (o) => o.status === 'IN_PROGRESS' || o.status === 'QUEUED' || o.status === 'PAUSED'
  );

  const laborUsed = report.capacity.laborUsedFp as number;
  const laborCap = Math.max(1, report.capacity.laborCapacityFp as number);
  const laborPct = Math.round((laborUsed / laborCap) * 100);

  const energyUsed = report.capacity.energyUsedFp as number;
  const energyCap = Math.max(1, report.capacity.energyCapacityFp as number);
  const energyPct = Math.round((energyUsed / energyCap) * 100);

  return (
    <div data-testid="p03-facilities-tab" className="space-y-5">
      {/* National Labor & Energy Capacity Bar */}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <div className="border border-[#E6E3DA] bg-[#FAFAF7] p-3.5">
          <div className="flex items-center justify-between text-xs">
            <span className="font-semibold text-[#171B20]">Công suất Lao động Quốc gia</span>
            <span
              data-testid="capacity-labor-summary"
              className={`font-mono font-bold tabular-nums ${
                laborUsed > laborCap ? 'text-[#9A3B26]' : 'text-[#214235]'
              }`}
            >
              {fpFormat(report.capacity.laborUsedFp, 1)} / {fpFormat(report.capacity.laborCapacityFp, 1)} ({laborPct}%)
            </span>
          </div>
          <div className="mt-2 h-2 w-full bg-[#E6E3DA]">
            <div
              className={`h-full ${laborUsed > laborCap ? 'bg-[#9A3B26]' : 'bg-[#2B4C3F]'}`}
              style={{ width: `${Math.min(100, laborPct)}%` }}
            />
          </div>
          <p className="mt-1.5 text-[11px] text-[#545B66]">
            {laborUsed > laborCap
              ? 'Quá tải lao động: xây thêm Khu Dân sinh & Lao động hoặc tạm dừng nhà máy ít ưu tiên.'
              : 'Đủ công suất lao động cho các cơ sở đang vận hành.'}
          </p>
        </div>

        <div className="border border-[#E6E3DA] bg-[#FAFAF7] p-3.5">
          <div className="flex items-center justify-between text-xs">
            <span className="font-semibold text-[#171B20]">Công suất Điện năng Quốc gia</span>
            <span
              data-testid="capacity-energy-summary"
              className={`font-mono font-bold tabular-nums ${
                energyUsed > energyCap ? 'text-[#9A3B26]' : 'text-[#214235]'
              }`}
            >
              {fpFormat(report.capacity.energyUsedFp, 1)} / {fpFormat(report.capacity.energyCapacityFp, 1)} ({energyPct}%)
            </span>
          </div>
          <div className="mt-2 h-2 w-full bg-[#E6E3DA]">
            <div
              className={`h-full ${energyUsed > energyCap ? 'bg-[#9A3B26]' : 'bg-[#2B4C3F]'}`}
              style={{ width: `${Math.min(100, energyPct)}%` }}
            />
          </div>
          <p className="mt-1.5 text-[11px] text-[#545B66]">
            {energyUsed > energyCap
              ? 'Thiếu điện năng: xây hoặc nâng cấp Nhà máy Điện để tránh tạm dừng tự động.'
              : 'Nguồn điện ổn định cho toàn bộ lưới sản xuất.'}
          </p>
        </div>
      </div>

      {/* Construction Builder: 8 Facility Types (Tier I) */}
      <div className="border border-[#E6E3DA] bg-[#FAFAF7] p-4">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#E6E3DA] pb-3">
          <div>
            <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-[#171B20]">
              <Building2 className="h-3.5 w-3.5 text-[#2B4C3F]" />
              <span>Xây dựng Công trình Mới (8 Loại · Cấp I–III)</span>
            </h3>
            <p className="mt-0.5 text-[11px] text-[#545B66]">
              Chi phí được tạm giữ qua sổ cái P03-01. Nếu hủy giữa chừng sẽ hoàn trả chính xác phần chưa tiêu thụ.
            </p>
          </div>
          <div className="flex items-center gap-2 text-xs">
            <label htmlFor="p03-build-region" className="font-medium text-[#545B66]">
              Vùng xây dựng:
            </label>
            <select
              id="p03-build-region"
              data-testid="build-region-select"
              value={selectedRegionId}
              onChange={(e) => setSelectedRegionId(e.target.value)}
              className="border border-[#D9D6CC] bg-[#FFFFFF] px-2.5 py-1.5 text-xs text-[#171B20]"
            >
              {controlledRegions.map((r) => (
                <option key={r.regionId} value={r.regionId}>
                  {r.name} ({r.regionId})
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
          {FACILITY_TYPE_ORDER.map((fType) => {
            const entry = report.catalog[fType];
            const tier1 = entry.tiers[1];
            const missingReason = !isActive
              ? 'Phòng đấu chưa ở trạng thái ACTIVE.'
              : !selectedRegionId
                ? 'Không có vùng kiểm soát hợp lệ.'
                : getMissingResourcesText(tier1.buildCost, report.stock.available);

            return (
              <div
                key={fType}
                data-testid={`catalog-card-${fType}`}
                className="flex flex-col justify-between border border-[#D9D6CC] bg-[#FFFFFF] p-3 text-xs"
              >
                <div>
                  <div className="flex items-start justify-between gap-2">
                    <h4 className="font-semibold text-[#171B20]">{entry.nameVi}</h4>
                    <span className="shrink-0 font-mono text-[10px] text-[#545B66]">
                      {Math.round(tier1.buildDurationMs / 3_600_000)}h
                    </span>
                  </div>
                  <p className="mt-1 text-[11px] leading-snug text-[#545B66]">{entry.roleSummaryVi}</p>
                  <p className="mt-2 font-mono text-[11px] text-[#171B20]">
                    Chi phí I: {formatBasketSummary(tier1.buildCost)}
                  </p>
                  <p className="mt-1 font-mono text-[10px] text-[#545B66]">
                    {tier1.energyCapacityProvidedFp > 0
                      ? `+${fpFormat(tier1.energyCapacityProvidedFp, 0)} Điện`
                      : tier1.energyDemandFp > 0
                        ? `Cần ${fpFormat(tier1.energyDemandFp, 0)} Điện`
                        : '0 Điện'}
                    {' · '}
                    {tier1.laborCapacityProvidedFp > 0
                      ? `+${fpFormat(tier1.laborCapacityProvidedFp, 0)} Lao động`
                      : tier1.laborDemandFp > 0
                        ? `Cần ${fpFormat(tier1.laborDemandFp, 0)} Lao động`
                        : '0 Lao động'}
                  </p>
                </div>

                <div className="mt-3">
                  <button
                    type="button"
                    data-testid={`build-facility-btn-${fType}`}
                    disabled={busy || missingReason !== null}
                    onClick={() => onQueueConstruction(selectedRegionId, fType, null)}
                    className="inline-flex w-full items-center justify-center gap-1.5 border border-[#2B4C3F] bg-[#2B4C3F] px-2.5 py-1.5 text-[11px] font-semibold text-[#FFFFFF] hover:bg-[#223D33] disabled:cursor-not-allowed disabled:border-[#D9D6CC] disabled:bg-[#E6E3DA] disabled:text-[#6E7681]"
                  >
                    <PlusCircle className="h-3.5 w-3.5" />
                    <span>Xây Cấp I</span>
                  </button>
                  {missingReason && (
                    <p className="mt-1.5 text-[10px] leading-snug text-[#9A3B26]">{missingReason}</p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Owned Facilities List (Explicitly Separating Ownership vs Operational Status) */}
      <div className="border border-[#E6E3DA] bg-[#FAFAF7] p-4">
        <div className="flex flex-wrap items-center justify-between gap-2 pb-2.5">
          <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-[#171B20]">
            <Factory className="h-3.5 w-3.5 text-[#2B4C3F]" />
            <span>Công trình Đang sở hữu ({report.facilities.length})</span>
          </h3>
          <span className="text-[11px] text-[#545B66]">
            Tách biệt rõ Quyền sở hữu (Chủ quản &amp; Vùng) với Trạng thái vận hành (Hoạt động / Tạm dừng).
          </span>
        </div>

        {report.facilities.length === 0 ? (
          <p className="py-3 text-xs text-[#6E7681]">Chưa có công trình nào được xây dựng.</p>
        ) : (
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            {report.facilities.map((fac) => {
              const cat = report.catalog[fac.type];
              const spec = cat.tiers[fac.tier];
              const nextTier = fac.tier < 3 ? ((fac.tier + 1) as 2 | 3) : null;
              const nextTierSpec = nextTier ? cat.tiers[nextTier] : null;
              const statusInfo = FACILITY_STATUS_META[fac.operationalStatus];
              const regionName = match.regions[fac.regionId]?.name ?? fac.regionId;

              const upgradeBusyOrQueued = activeConstructionOrders.some(
                (o) => o.targetFacilityId === fac.facilityId
              );
              const upgradeReason = !isActive
                ? 'Cần trạng thái ACTIVE.'
                : !nextTierSpec
                  ? 'Đã đạt cấp tối đa III.'
                  : upgradeBusyOrQueued
                    ? 'Đang có lệnh nâng cấp trong hàng đợi.'
                    : getMissingResourcesText(nextTierSpec.buildCost, report.stock.available);

              const recipe = spec.productionRecipe;
              const prodDisabledReason = !isActive
                ? 'Cần trạng thái ACTIVE.'
                : !recipe
                  ? 'Công trình không có dây chuyền sản xuất theo lô.'
                  : fac.operationalStatus !== 'ACTIVE'
                    ? `Không thể đặt lô khi cơ sở đang ${statusInfo.label.toLowerCase()}.`
                    : getMissingResourcesText(recipe.inputPerBatch, report.stock.available);

              return (
                <div
                  key={fac.facilityId}
                  data-testid={`facility-item-${fac.facilityId}`}
                  className="space-y-2.5 border border-[#D9D6CC] bg-[#FFFFFF] p-3.5 text-xs"
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <p className="font-semibold text-[#171B20]">
                        {cat.nameVi} · Cấp {fac.tier === 1 ? 'I' : fac.tier === 2 ? 'II' : 'III'}
                      </p>
                      <p className="font-mono text-[11px] text-[#545B66]">
                        Sở hữu: {fac.ownerNationId} · Vùng: {regionName} ({fac.facilityId})
                      </p>
                    </div>
                    <span
                      data-testid={`facility-status-${fac.facilityId}`}
                      className={`inline-block border px-2 py-0.5 text-[11px] font-semibold ${statusInfo.tone}`}
                    >
                      {statusInfo.label} · {(fac.efficiencyBps / 100).toFixed(0)}%
                    </span>
                  </div>

                  {fac.pauseReason && (
                    <p
                      data-testid={`facility-pause-reason-${fac.facilityId}`}
                      className="border border-[#E5B8AF] bg-[#FDF2F0] px-2.5 py-1.5 text-[11px] text-[#9A3B26]"
                    >
                      Lý do tạm dừng: {fac.pauseReason}
                    </p>
                  )}

                  <div className="grid grid-cols-1 gap-1 text-[11px] text-[#545B66] sm:grid-cols-2">
                    <span>Đầu vào/giờ: {formatBasketSummary(spec.hourlyInputs)}</span>
                    <span>Đầu ra/giờ: {formatBasketSummary(spec.hourlyOutputs)}</span>
                  </div>

                  <div className="flex flex-wrap items-center gap-2 border-t border-[#ECE8DF] pt-2.5">
                    <button
                      type="button"
                      data-testid={`toggle-pause-btn-${fac.facilityId}`}
                      disabled={!isActive || busy}
                      onClick={() => onToggleFacilityPause(fac.facilityId, !fac.manualPaused)}
                      className="inline-flex items-center gap-1 border border-[#D9D6CC] bg-[#F6F5F0] px-2.5 py-1 text-[11px] font-medium text-[#171B20] hover:bg-[#EBE8DF] disabled:opacity-50"
                    >
                      {fac.manualPaused ? (
                        <>
                          <PlayCircle className="h-3.5 w-3.5 text-[#2B4C3F]" />
                          <span>Khôi phục vận hành</span>
                        </>
                      ) : (
                        <>
                          <PauseCircle className="h-3.5 w-3.5 text-[#9A3B26]" />
                          <span>Tạm dừng</span>
                        </>
                      )}
                    </button>

                    {nextTier && nextTierSpec && (
                      <button
                        type="button"
                        data-testid={`upgrade-facility-btn-${fac.facilityId}`}
                        disabled={busy || upgradeReason !== null}
                        title={upgradeReason ?? undefined}
                        onClick={() => onQueueConstruction(fac.regionId, fac.type, fac.facilityId)}
                        className="border border-[#171B20] bg-[#FFFFFF] px-2.5 py-1 text-[11px] font-semibold text-[#171B20] hover:bg-[#F6F5F0] disabled:cursor-not-allowed disabled:border-[#D9D6CC] disabled:text-[#6E7681]"
                      >
                        Nâng cấp {nextTier === 2 ? 'II' : 'III'} ({Math.round(nextTierSpec.buildDurationMs / 3_600_000)}h)
                      </button>
                    )}

                    {recipe && (
                      <button
                        type="button"
                        data-testid={`queue-production-btn-${fac.facilityId}`}
                        disabled={busy || prodDisabledReason !== null}
                        title={prodDisabledReason ?? undefined}
                        onClick={() => onQueueProduction(fac.facilityId, 1)}
                        className="border border-[#2B4C3F] bg-[#2B4C3F] px-2.5 py-1 text-[11px] font-semibold text-[#FFFFFF] hover:bg-[#223D33] disabled:cursor-not-allowed disabled:border-[#D9D6CC] disabled:bg-[#E6E3DA] disabled:text-[#6E7681]"
                      >
                        Sản xuất 1 lô (+{fpFormat(recipe.outputPerBatchFp, 0)}{' '}
                        {EXTENDED_RESOURCE_LABELS[recipe.outputResource]})
                      </button>
                    )}
                  </div>

                  {recipe && prodDisabledReason && (
                    <p className="text-[10px] text-[#9A3B26]">Sản xuất lô: {prodDisabledReason}</p>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Live Construction Queue & Production Queue */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        {/* Construction Queue */}
        <div className="border border-[#E6E3DA] bg-[#FAFAF7] p-4">
          <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-[#171B20]">
            <Clock className="h-3.5 w-3.5 text-[#2B4C3F]" />
            <span>Hàng đợi Xây dựng / Nâng cấp ({activeConstructionOrders.length})</span>
          </h3>
          {activeConstructionOrders.length === 0 ? (
            <p className="mt-2 text-xs text-[#6E7681]">
              Không có công trình nào đang thi công. Chọn loại công trình ở danh mục phía trên để khởi công.
            </p>
          ) : (
            <ul className="mt-2.5 space-y-2">
              {activeConstructionOrders.map((ord) => {
                const remainingMs = Math.max(0, (ord.completesAtUtc as number) - (match.currentUtc as number));
                const cat = report.catalog[ord.facilityType];
                return (
                  <li
                    key={ord.orderId}
                    data-testid={`construction-order-${ord.orderId}`}
                    className="flex flex-wrap items-center justify-between gap-2 border border-[#D9D6CC] bg-[#FFFFFF] p-3 text-xs"
                  >
                    <div>
                      <p className="font-semibold text-[#171B20]">
                        {ord.targetFacilityId ? 'Nâng cấp' : 'Xây mới'} {cat.nameVi} (Cấp {ord.targetTier})
                      </p>
                      <p className="font-mono text-[11px] text-[#545B66] tabular-nums">
                        {ord.orderId} · Hạn UTC: {formatUtcShort(ord.completesAtUtc as number)} · Còn:{' '}
                        {formatDurationEta(remainingMs)}
                      </p>
                      {ord.pauseReason && (
                        <p className="mt-0.5 text-[11px] text-[#9A3B26]">Tạm dừng: {ord.pauseReason}</p>
                      )}
                    </div>
                    <button
                      type="button"
                      data-testid={`cancel-construction-btn-${ord.orderId}`}
                      disabled={!isActive || busy}
                      onClick={() => onCancelConstruction(ord.orderId)}
                      className="inline-flex items-center gap-1 border border-[#9A3B26] bg-[#FFFFFF] px-2.5 py-1 text-[11px] font-semibold text-[#9A3B26] hover:bg-[#FDF2F0] disabled:opacity-50"
                    >
                      <XCircle className="h-3.5 w-3.5" />
                      <span>Hủy &amp; Hoàn phần chưa dùng</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {/* Production Queue */}
        <div className="border border-[#E6E3DA] bg-[#FAFAF7] p-4">
          <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-[#171B20]">
            <Clock className="h-3.5 w-3.5 text-[#2B4C3F]" />
            <span>Hàng đợi Sản xuất Nhà máy ({activeProductionOrders.length})</span>
          </h3>
          {activeProductionOrders.length === 0 ? (
            <p className="mt-2 text-xs text-[#6E7681]">
              Chưa có đơn hàng sản xuất theo lô nào đang chạy. Chọn nút &ldquo;Sản xuất 1 lô&rdquo; trên nhà máy đang hoạt động.
            </p>
          ) : (
            <ul className="mt-2.5 space-y-2">
              {activeProductionOrders.map((ord) => {
                const remainingMs = Math.max(0, (ord.completesAtUtc as number) - (match.currentUtc as number));
                return (
                  <li
                    key={ord.orderId}
                    data-testid={`production-order-${ord.orderId}`}
                    className="flex flex-wrap items-center justify-between gap-2 border border-[#D9D6CC] bg-[#FFFFFF] p-3 text-xs"
                  >
                    <div>
                      <p className="font-semibold text-[#171B20]">
                        +{fpFormat(ord.outputAmountFp, 1)} {EXTENDED_RESOURCE_LABELS[ord.outputResource]} (
                        {ord.batchCount} lô · {ord.status})
                      </p>
                      <p className="font-mono text-[11px] text-[#545B66] tabular-nums">
                        {ord.orderId} · Hạn UTC: {formatUtcShort(ord.completesAtUtc as number)} · Còn:{' '}
                        {formatDurationEta(remainingMs)}
                      </p>
                      {ord.pauseReason && (
                        <p className="mt-0.5 text-[11px] text-[#9A3B26]">Tạm dừng: {ord.pauseReason}</p>
                      )}
                    </div>
                    <button
                      type="button"
                      data-testid={`cancel-production-btn-${ord.orderId}`}
                      disabled={!isActive || busy}
                      onClick={() => onCancelProduction(ord.orderId)}
                      className="inline-flex items-center gap-1 border border-[#9A3B26] bg-[#FFFFFF] px-2.5 py-1 text-[11px] font-semibold text-[#9A3B26] hover:bg-[#FDF2F0] disabled:opacity-50"
                    >
                      <XCircle className="h-3.5 w-3.5" />
                      <span>Hủy đơn &amp; Hoàn kho</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
