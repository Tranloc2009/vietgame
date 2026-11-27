import { useState } from 'react';
import {
  AlertTriangle,
  Building2,
  CheckCircle2,
  Coins,
  Landmark,
  ReceiptText,
  RefreshCw,
  ShieldAlert,
  XCircle,
} from 'lucide-react';
import {
  BudgetAllocation,
  EconomicLedgerEntry,
  EconomicLedgerKind,
  ExtendedLedgerKind,
  ExtendedResourceType,
  FacilityType,
  FilteredClientMatchView,
  fpFormat,
  Job,
  MatchRoomSummary,
  ResourceType,
} from '../contracts';
import { RoomEconomyResponse } from './roomApi';
import {
  EXTENDED_RESOURCE_LABELS,
  Phase03BudgetTab,
  Phase03FacilitiesTab,
} from './Phase03BudgetFacilities';

const LEGACY_RESOURCE_META: ReadonlyArray<{
  readonly key: ResourceType;
  readonly label: string;
}> = [
  { key: 'food', label: 'Lương thực' },
  { key: 'industrial', label: 'Công nghiệp' },
  { key: 'treasury', label: 'Ngân sách' },
  { key: 'manpower', label: 'Nhân lực' },
  { key: 'politicalCapital', label: 'Vốn chính trị' },
];

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

const TAX_PRESETS_BPS = [1000, 2000, 3000, 4000] as const;

const LEGACY_LEDGER_KIND_LABEL: Readonly<Record<EconomicLedgerKind, string>> = {
  PRODUCTION_CYCLE: 'Sản lượng chu kỳ',
  UPKEEP_CYCLE: 'Chi phí duy trì',
  TRANSFER_DEBIT: 'Chuyển đi',
  TRANSFER_CREDIT: 'Tiếp nhận',
  JOB_RESERVE: 'Tạm giữ dự án',
  JOB_REFUND: 'Hoàn trả 80%',
  JOB_CANCEL_OVERHEAD: 'Phí hủy 20%',
  JOB_COMPLETE_SETTLE: 'Tất toán dự án',
  POLICY_ENACT: 'Ban hành chính sách',
};

const EXTENDED_LEDGER_KIND_LABEL: Readonly<Record<ExtendedLedgerKind, string>> = {
  PRODUCTION_CREDIT: 'Sản lượng cơ bản',
  UPKEEP_DEBIT: 'Duy trì bắt buộc',
  TAX_REVENUE: 'Thu thuế ngân sách',
  FACILITY_UPKEEP: 'Đầu vào nhà máy',
  FACILITY_OUTPUT: 'Đầu ra nhà máy',
  RESERVATION_HOLD: 'Tạm giữ (Reserve)',
  RESERVATION_COMMIT: 'Tất toán (Commit)',
  RESERVATION_RELEASE: 'Hoàn trả (Release)',
  DEBT_DRAW: 'Vay tín dụng',
  DEBT_REPAY: 'Trả nợ công',
  DEBT_INTEREST: 'Lãi nợ công',
  TRANSFER_DEBIT: 'Chuyển đi',
  TRANSFER_CREDIT: 'Tiếp nhận',
  PRODUCTION_INPUT: 'Vật tư sản xuất lô',
  PRODUCTION_OUTPUT: 'Thành phẩm lô',
};

function formatUtcShort(ts: number): string {
  return new Date(ts).toISOString().replace('T', ' ').slice(5, 19) + 'Z';
}

function formatSignedFp(val: number): string {
  const formatted = fpFormat(val as never, 2);
  return val > 0 ? `+${formatted}` : formatted;
}

type Phase03TabKey = 'ledger' | 'budget' | 'facilities';

export interface EconomyLedgerPanelProps {
  readonly room: MatchRoomSummary;
  readonly match: FilteredClientMatchView;
  readonly economy: RoomEconomyResponse | null;
  readonly loading: boolean;
  readonly error: string | null;
  readonly busy: boolean;
  readonly initialRegionId?: string | null;
  readonly onRefresh: () => void;
  readonly onSetTaxRate: (taxRateBps: number) => void;
  readonly onCancelJob: (jobId: string) => void;
  readonly onUpdateBudgetPolicy: (targetTaxRateBps: number, allocations: BudgetAllocation) => void;
  readonly onManageCredit: (action: 'DRAW' | 'REPAY', amountFp: number) => void;
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

export function EconomyLedgerPanel({
  room,
  match,
  economy,
  loading,
  error,
  busy,
  initialRegionId,
  onRefresh,
  onSetTaxRate,
  onCancelJob,
  onUpdateBudgetPolicy,
  onManageCredit,
  onQueueConstruction,
  onCancelConstruction,
  onQueueProduction,
  onCancelProduction,
  onToggleFacilityPause,
}: EconomyLedgerPanelProps) {
  const [activeTab, setActiveTab] = useState<Phase03TabKey>(initialRegionId ? 'facilities' : 'ledger');
  const [ledgerResourceFilter, setLedgerResourceFilter] = useState<ExtendedResourceType | 'ALL'>('ALL');

  const isActive = room.status === 'ACTIVE';
  const forecast = economy?.forecast ?? null;
  const legacyLedger: readonly EconomicLedgerEntry[] = economy?.ledger ?? match.economicLedger ?? [];
  const phase03 = economy?.phase03 ?? null;

  const ownScheduledJobs: Job[] = Object.values(match.jobs)
    .filter((j) => j.ownerNationId === room.viewerNationId && j.status === 'SCHEDULED')
    .sort((a, b) => (a.completesAtUtc as number) - (b.completesAtUtc as number));

  const filteredPhase03Ledger = phase03
    ? ledgerResourceFilter === 'ALL'
      ? phase03.ledger
      : phase03.ledger.filter((e) => e.resource === ledgerResourceFilter)
    : [];

  return (
    <section
      aria-label="Kinh tế Quốc gia, Ngân sách & Nhà máy — Giai đoạn 03"
      data-testid="economy-ledger-panel"
      className="border border-[#D9D6CC] bg-[#FFFFFF]"
    >
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#E6E3DA] px-5 py-4">
        <div>
          <p className="flex items-center gap-1.5 text-xs font-medium text-[#2B4C3F]">
            <Coins className="h-3.5 w-3.5" />
            <span>
              Kho, thu chi và năng lực xây dựng của phe bạn
            </span>
          </p>
          <h2 className="mt-0.5 text-lg font-semibold text-[#171B20]">
            Sổ cái và kế hoạch sản xuất
          </h2>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {forecast && (
            <span className="border border-[#D9D6CC] bg-[#FAFAF7] px-2.5 py-1 font-mono text-[11px] text-[#545B66] tabular-nums">
              {forecast.controlledRegionCount} vùng · {forecast.activeUnitCount} đơn vị · Chu kỳ kế:{' '}
              {formatUtcShort(forecast.nextSettlementUtc as number)}
            </span>
          )}
          <button
            type="button"
            data-testid="refresh-economy-btn"
            disabled={loading}
            onClick={onRefresh}
            className="inline-flex items-center gap-1.5 whitespace-nowrap border border-[#D9D6CC] bg-[#F6F5F0] px-3 py-1.5 text-xs font-medium text-[#171B20] hover:bg-[#EBE8DF] disabled:opacity-60"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
            <span>Cập nhật kinh tế</span>
          </button>
        </div>
      </div>

      {/* Phase 03 Tab Navigation (only shown when Phase 03 state exists) */}
      {phase03 && (
        <div
          role="tablist"
          aria-label="Phân hệ Kinh tế Giai đoạn 03"
          className="flex flex-wrap items-center gap-1.5 border-b border-[#E6E3DA] bg-[#FAFAF7] px-5 py-2.5"
        >
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'ledger'}
            data-testid="p03-tab-ledger"
            onClick={() => setActiveTab('ledger')}
            className={`inline-flex items-center gap-1.5 whitespace-nowrap border px-3 py-1.5 text-xs font-semibold transition-colors ${
              activeTab === 'ledger'
                ? 'border-[#2B4C3F] bg-[#2B4C3F] text-[#FFFFFF]'
                : 'border-[#D9D6CC] bg-[#FFFFFF] text-[#171B20] hover:bg-[#EDF3F0]'
            }`}
          >
            <ReceiptText className="h-3.5 w-3.5" />
            <span>Sổ cái 8 Tài nguyên</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'budget'}
            data-testid="p03-tab-budget"
            onClick={() => setActiveTab('budget')}
            className={`inline-flex items-center gap-1.5 whitespace-nowrap border px-3 py-1.5 text-xs font-semibold transition-colors ${
              activeTab === 'budget'
                ? 'border-[#2B4C3F] bg-[#2B4C3F] text-[#FFFFFF]'
                : 'border-[#D9D6CC] bg-[#FFFFFF] text-[#171B20] hover:bg-[#EDF3F0]'
            }`}
          >
            <Landmark className="h-3.5 w-3.5" />
            <span>
              Ngân sách &amp; Dân sự
              {phase03.fiscalForecast24h.warnings.length > 0
                ? ` (${phase03.fiscalForecast24h.warnings.length})`
                : ''}
            </span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'facilities'}
            data-testid="p03-tab-facilities"
            onClick={() => setActiveTab('facilities')}
            className={`inline-flex items-center gap-1.5 whitespace-nowrap border px-3 py-1.5 text-xs font-semibold transition-colors ${
              activeTab === 'facilities'
                ? 'border-[#2B4C3F] bg-[#2B4C3F] text-[#FFFFFF]'
                : 'border-[#D9D6CC] bg-[#FFFFFF] text-[#171B20] hover:bg-[#EDF3F0]'
            }`}
          >
            <Building2 className="h-3.5 w-3.5" />
            <span>
              Công trình &amp; Nhà máy ({phase03.facilities.length})
            </span>
          </button>
        </div>
      )}

      <div className="space-y-5 p-5">
        {error && (
          <div
            role="alert"
            className="flex items-center gap-2 border border-[#E5B8AF] bg-[#FDF2F0] px-4 py-2.5 text-xs text-[#9A3B26]"
          >
            <AlertTriangle className="h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {loading && !forecast ? (
          <p className="py-4 text-xs text-[#6E7681]">Đang tải dữ liệu sổ cái kinh tế từ máy chủ...</p>
        ) : phase03 ? (
          <>
            {/* TAB 1: P03-01 8-Resource Stock / Flow / Capacity, Reconciliation, Reservations & Ledger */}
            {activeTab === 'ledger' && (
              <div data-testid="p03-ledger-tab" className="space-y-5">
                <div className="grid grid-cols-1 gap-5 xl:grid-cols-[1.8fr_1fr]">
                  {/* 8-Resource Table */}
                  <div className="border border-[#E6E3DA] bg-[#FAFAF7] p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2 pb-2.5">
                      <h3 className="text-xs font-semibold uppercase tracking-wide text-[#171B20]">
                        Kho · Dòng chảy · Sức chứa 8 Tài nguyên ({forecast?.nationName ?? phase03.nationId})
                      </h3>
                      <span
                        data-testid="p03-reconciliation-status"
                        className={`inline-flex items-center gap-1 font-mono text-[11px] font-semibold ${
                          phase03.reconciliation.allReconciled ? 'text-[#214235]' : 'text-[#9A3B26]'
                        }`}
                      >
                        {phase03.reconciliation.allReconciled ? (
                          <CheckCircle2 className="h-3.5 w-3.5" />
                        ) : (
                          <ShieldAlert className="h-3.5 w-3.5" />
                        )}
                        <span>
                          Đối soát {phase03.reconciliation.rows.filter((r) => r.reconciled).length}/8:{' '}
                          {phase03.reconciliation.allReconciled ? 'Khớp tuyệt đối' : 'Sai lệch'}
                        </span>
                      </span>
                    </div>

                    <div className="overflow-x-auto">
                      <table className="w-full border-collapse text-left text-xs">
                        <thead>
                          <tr className="border-b border-[#D9D6CC] text-[#545B66]">
                            <th className="whitespace-nowrap py-1.5 pr-3 font-medium">Tài nguyên</th>
                            <th className="whitespace-nowrap px-2 py-1.5 text-right font-medium">Khả dụng</th>
                            <th className="whitespace-nowrap px-2 py-1.5 text-right font-medium">Tạm giữ</th>
                            <th className="whitespace-nowrap px-2 py-1.5 text-right font-medium">Trần kho</th>
                            <th className="whitespace-nowrap px-2 py-1.5 text-right font-medium">Thu / ngày</th>
                            <th className="whitespace-nowrap px-2 py-1.5 text-right font-medium">Chi / ngày</th>
                            <th className="whitespace-nowrap pl-2 py-1.5 text-right font-medium">Ròng / ngày</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-[#ECE8DF]">
                          {EXTENDED_RESOURCE_ORDER.map((resKey) => {
                            const avail = phase03.stock.available[resKey];
                            const reserved = phase03.stock.reserved[resKey];
                            const cap = phase03.stock.storageCaps[resKey];
                            const gross = phase03.dailyGross[resKey];
                            const upkeep = phase03.dailyUpkeep[resKey];
                            const net = phase03.dailyNetSigned[resKey] as number;
                            const fillPct = Math.min(
                              100,
                              Math.round(((avail as number) / Math.max(1, cap as number)) * 100)
                            );
                            return (
                              <tr key={resKey} data-testid={`p03-resource-row-${resKey}`}>
                                <td className="whitespace-nowrap py-2 pr-3 font-medium text-[#171B20]">
                                  {EXTENDED_RESOURCE_LABELS[resKey]}
                                </td>
                                <td className="whitespace-nowrap px-2 py-2 text-right font-mono font-semibold tabular-nums text-[#171B20]">
                                  {fpFormat(avail, 1)}
                                </td>
                                <td
                                  data-testid={`p03-reserved-${resKey}`}
                                  className={`whitespace-nowrap px-2 py-2 text-right font-mono tabular-nums ${
                                    (reserved as number) > 0 ? 'font-semibold text-[#8C5214]' : 'text-[#6E7681]'
                                  }`}
                                >
                                  {fpFormat(reserved, 1)}
                                </td>
                                <td className="whitespace-nowrap px-2 py-2 text-right font-mono tabular-nums text-[#545B66]">
                                  {fpFormat(cap, 0)} <span className="text-[10px]">({fillPct}%)</span>
                                </td>
                                <td className="whitespace-nowrap px-2 py-2 text-right font-mono tabular-nums text-[#214235]">
                                  +{fpFormat(gross, 1)}
                                </td>
                                <td
                                  className={`whitespace-nowrap px-2 py-2 text-right font-mono tabular-nums ${
                                    (upkeep as number) > 0 ? 'text-[#9A3B26]' : 'text-[#6E7681]'
                                  }`}
                                >
                                  {(upkeep as number) > 0 ? `-${fpFormat(upkeep, 1)}` : '0.0'}
                                </td>
                                <td
                                  className={`whitespace-nowrap pl-2 py-2 text-right font-mono font-semibold tabular-nums ${
                                    net >= 0 ? 'text-[#214235]' : 'text-[#9A3B26]'
                                  }`}
                                >
                                  {formatSignedFp(net)}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  {/* Right Column: Active Reservations + Legacy Scheduled Jobs */}
                  <div className="space-y-4">
                    <div className="border border-[#E6E3DA] bg-[#FAFAF7] p-4">
                      <h3 className="text-xs font-semibold uppercase tracking-wide text-[#171B20]">
                        Khoản Tạm giữ Đang hiệu lực ({phase03.activeReservations.length})
                      </h3>
                      <p className="mt-1 text-[11px] text-[#545B66]">
                        Mọi công trình và đơn sản xuất đều tạm giữ tài nguyên trước khi chạy để chống chi tiêu trùng lặp.
                      </p>
                      {phase03.activeReservations.length === 0 ? (
                        <p className="mt-2 text-xs text-[#6E7681]">
                          Không có khoản tạm giữ nào đang mở. Chuyển sang tab Công trình &amp; Nhà máy để đặt lệnh.
                        </p>
                      ) : (
                        <ul className="mt-2.5 max-h-44 space-y-2 overflow-y-auto">
                          {phase03.activeReservations.map((r) => (
                            <li
                              key={r.reservationId}
                              data-testid={`reservation-item-${r.reservationId}`}
                              className="border border-[#D9D6CC] bg-[#FFFFFF] px-2.5 py-2 text-xs"
                            >
                              <div className="flex items-center justify-between gap-2">
                                <span className="font-mono font-semibold text-[#171B20]">{r.refType}</span>
                                <span className="font-mono text-[10px] text-[#545B66]">{r.refId}</span>
                              </div>
                              <p className="mt-0.5 font-mono text-[10px] text-[#6E7681]">
                                {r.reservationId} · Tạo lúc {formatUtcShort(r.createdAtUtc as number)}
                              </p>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>

                    {/* Legacy Scheduled Jobs (keeps P02 map infrastructure jobs cancellable) */}
                    <div className="border border-[#E6E3DA] bg-[#FAFAF7] p-4">
                      <h3 className="text-xs font-semibold uppercase tracking-wide text-[#171B20]">
                        Dự án Bản đồ Đang chờ ({ownScheduledJobs.length})
                      </h3>
                      {ownScheduledJobs.length === 0 ? (
                        <p className="mt-1.5 text-[11px] text-[#6E7681]">
                          Chọn vùng thuộc phe bạn trên bản đồ để đặt lịch dự án hạ tầng.
                        </p>
                      ) : (
                        <ul className="mt-2 space-y-2">
                          {ownScheduledJobs.map((job) => (
                            <li
                              key={job.jobId}
                              data-testid={`scheduled-job-${job.jobId}`}
                              className="flex flex-wrap items-center justify-between gap-2 border border-[#D9D6CC] bg-[#FFFFFF] px-2.5 py-2 text-xs"
                            >
                              <div>
                                <p className="font-mono font-semibold text-[#171B20]">{job.kind}</p>
                                <p className="font-mono text-[10px] text-[#545B66]">
                                  {job.jobId} · Hạn: {formatUtcShort(job.completesAtUtc as number)}
                                </p>
                              </div>
                              <button
                                type="button"
                                data-testid={`cancel-job-btn-${job.jobId}`}
                                disabled={!isActive || busy}
                                onClick={() => onCancelJob(job.jobId)}
                                className="inline-flex items-center gap-1 border border-[#9A3B26] bg-[#FFFFFF] px-2.5 py-1 text-[11px] font-semibold text-[#9A3B26] hover:bg-[#FDF2F0] disabled:opacity-50"
                              >
                                <XCircle className="h-3.5 w-3.5" />
                                <span>Hủy (Hoàn 80%)</span>
                              </button>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  </div>
                </div>

                {/* Debit / Credit Ledger Table (8-Resource, Viewer-Filtered) */}
                <div className="border border-[#E6E3DA] bg-[#FAFAF7] p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2 pb-2.5">
                    <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-[#171B20]">
                      <ReceiptText className="h-3.5 w-3.5 text-[#2B4C3F]" />
                      <span>Sổ cái Ghi Nợ / Ghi Có Riêng ({filteredPhase03Ledger.length})</span>
                    </h3>
                    <div className="flex flex-wrap items-center gap-2 text-xs">
                      <label htmlFor="p03-ledger-filter" className="text-[11px] text-[#545B66]">
                        Lọc tài nguyên:
                      </label>
                      <select
                        id="p03-ledger-filter"
                        data-testid="p03-ledger-filter"
                        value={ledgerResourceFilter}
                        onChange={(e) =>
                          setLedgerResourceFilter(e.target.value as ExtendedResourceType | 'ALL')
                        }
                        className="border border-[#D9D6CC] bg-[#FFFFFF] px-2 py-1 text-xs text-[#171B20]"
                      >
                        <option value="ALL">Tất cả 8 tài nguyên</option>
                        {EXTENDED_RESOURCE_ORDER.map((r) => (
                          <option key={r} value={r}>
                            {EXTENDED_RESOURCE_LABELS[r]}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  {filteredPhase03Ledger.length === 0 ? (
                    <p className="py-3 text-xs text-[#6E7681]">
                      Chưa phát sinh bút toán nào cho bộ lọc hiện tại. Mọi giao dịch tạm giữ, xây dựng, sản xuất, vay/trả nợ và thu thuế sẽ xuất hiện tại đây với mã <code>txn_...</code>.
                    </p>
                  ) : (
                    <div className="max-h-64 overflow-x-auto overflow-y-auto border border-[#E6E3DA] bg-[#FFFFFF]">
                      <table className="w-full border-collapse text-left text-xs">
                        <thead className="sticky top-0 bg-[#F6F5F0]">
                          <tr className="border-b border-[#D9D6CC] text-[#545B66]">
                            <th className="whitespace-nowrap px-2.5 py-1.5 font-medium">Mã bút toán</th>
                            <th className="whitespace-nowrap px-2 py-1.5 font-medium">Nghiệp vụ</th>
                            <th className="whitespace-nowrap px-2 py-1.5 font-medium">Tài nguyên</th>
                            <th className="whitespace-nowrap px-2 py-1.5 text-right font-medium">Biến động</th>
                            <th className="whitespace-nowrap px-2 py-1.5 text-right font-medium">Khả dụng sau</th>
                            <th className="whitespace-nowrap px-2 py-1.5 font-medium">Tài khoản Nguồn → Đích</th>
                            <th className="whitespace-nowrap px-2.5 py-1.5 text-right font-medium">UTC</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-[#F0EDE5]">
                          {[...filteredPhase03Ledger].reverse().map((entry) => (
                            <tr key={entry.transactionId} data-testid={`p03-ledger-entry-${entry.kind}`}>
                              <td className="whitespace-nowrap px-2.5 py-1.5 font-mono text-[11px] text-[#171B20]">
                                {entry.transactionId}
                              </td>
                              <td className="whitespace-nowrap px-2 py-1.5 font-medium text-[#171B20]">
                                {EXTENDED_LEDGER_KIND_LABEL[entry.kind]}
                              </td>
                              <td className="whitespace-nowrap px-2 py-1.5 text-[11px] text-[#545B66]">
                                {EXTENDED_RESOURCE_LABELS[entry.resource]}
                              </td>
                              <td
                                className={`whitespace-nowrap px-2 py-1.5 text-right font-mono font-semibold tabular-nums ${
                                  entry.direction === 'CREDIT' ? 'text-[#214235]' : 'text-[#9A3B26]'
                                }`}
                              >
                                {entry.direction === 'CREDIT' ? '+' : '-'}
                                {fpFormat(entry.amountFp, 2)}
                              </td>
                              <td className="whitespace-nowrap px-2 py-1.5 text-right font-mono tabular-nums text-[#171B20]">
                                {fpFormat(entry.availableAfterFp, 2)}
                              </td>
                              <td className="whitespace-nowrap px-2 py-1.5 font-mono text-[11px] text-[#545B66]">
                                {entry.sourceAccount} → {entry.destinationAccount}
                              </td>
                              <td className="whitespace-nowrap px-2.5 py-1.5 text-right font-mono text-[11px] text-[#6E7681] tabular-nums">
                                {formatUtcShort(entry.occurredAtUtc as number)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* TAB 2: P03-02 Budget, Laffer Curve, Delayed Tax, 4-Sector Allocation & Bounded Credit */}
            {activeTab === 'budget' && (
              <Phase03BudgetTab
                room={room}
                match={match}
                report={phase03}
                busy={busy}
                onUpdateBudgetPolicy={onUpdateBudgetPolicy}
                onManageCredit={onManageCredit}
              />
            )}

            {/* TAB 3: P03-03 8 Facility Types, Construction Queue & Production Queue */}
            {activeTab === 'facilities' && (
              <Phase03FacilitiesTab
                room={room}
                match={match}
                report={phase03}
                busy={busy}
                initialRegionId={initialRegionId}
                onQueueConstruction={onQueueConstruction}
                onCancelConstruction={onCancelConstruction}
                onQueueProduction={onQueueProduction}
                onCancelProduction={onCancelProduction}
                onToggleFacilityPause={onToggleFacilityPause}
              />
            )}
          </>
        ) : forecast ? (
          /* Legacy fallback for older pre-Phase-03 SQLite rooms */
          <div className="space-y-5">
            <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1.6fr_1fr]">
              <div className="border border-[#E6E3DA] bg-[#FAFAF7] p-4">
                <h3 className="pb-2.5 text-xs font-semibold uppercase tracking-wide text-[#171B20]">
                  Cán cân 5 Tài nguyên ({forecast.nationName})
                </h3>
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse text-left text-xs">
                    <thead>
                      <tr className="border-b border-[#D9D6CC] text-[#545B66]">
                        <th className="whitespace-nowrap py-1.5 pr-3 font-medium">Tài nguyên</th>
                        <th className="whitespace-nowrap px-2 py-1.5 text-right font-medium">Tồn kho / Trần kho</th>
                        <th className="whitespace-nowrap px-2 py-1.5 text-right font-medium">Thu / ngày</th>
                        <th className="whitespace-nowrap px-2 py-1.5 text-right font-medium">Duy trì / ngày</th>
                        <th className="whitespace-nowrap pl-2 py-1.5 text-right font-medium">Ròng / ngày</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#ECE8DF]">
                      {LEGACY_RESOURCE_META.map(({ key, label }) => {
                        const bal = forecast.currentBalance[key];
                        const cap = forecast.stockpileCaps[key];
                        const gross = forecast.grossDaily[key];
                        const upkeep = forecast.upkeepDaily[key];
                        const net = forecast.netDailySigned[key] as number;
                        return (
                          <tr key={key} data-testid={`economy-row-${key}`}>
                            <td className="whitespace-nowrap py-2 pr-3 font-medium text-[#171B20]">{label}</td>
                            <td className="whitespace-nowrap px-2 py-2 text-right font-mono tabular-nums text-[#171B20]">
                              {fpFormat(bal, 1)} / {fpFormat(cap, 0)}
                            </td>
                            <td className="whitespace-nowrap px-2 py-2 text-right font-mono tabular-nums text-[#214235]">
                              +{fpFormat(gross, 2)}
                            </td>
                            <td className="whitespace-nowrap px-2 py-2 text-right font-mono tabular-nums text-[#9A3B26]">
                              {(upkeep as number) > 0 ? `-${fpFormat(upkeep, 2)}` : '0.00'}
                            </td>
                            <td
                              className={`whitespace-nowrap pl-2 py-2 text-right font-mono font-semibold tabular-nums ${
                                net >= 0 ? 'text-[#214235]' : 'text-[#9A3B26]'
                              }`}
                            >
                              {formatSignedFp(net)}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="border border-[#E6E3DA] bg-[#FAFAF7] p-4">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-[#171B20]">
                    Thuế suất Tài khóa (Phòng cũ)
                  </h3>
                  <span data-testid="current-tax-rate" className="font-mono text-xs font-bold text-[#2B4C3F]">
                    {(forecast.taxRateBps / 100).toFixed(0)}%
                  </span>
                </div>
                <div className="mt-3 grid grid-cols-4 gap-1.5">
                  {TAX_PRESETS_BPS.map((bps) => {
                    const selected = forecast.taxRateBps === bps;
                    return (
                      <button
                        key={bps}
                        type="button"
                        data-testid={`tax-rate-${bps}`}
                        disabled={!isActive || busy || selected}
                        onClick={() => onSetTaxRate(bps)}
                        className={`border py-1.5 font-mono text-xs font-semibold ${
                          selected
                            ? 'border-[#2B4C3F] bg-[#2B4C3F] text-[#FFFFFF]'
                            : 'border-[#D9D6CC] bg-[#FFFFFF] text-[#171B20]'
                        }`}
                      >
                        {bps / 100}%
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            {legacyLedger.length > 0 && (
              <div className="border border-[#E6E3DA] bg-[#FAFAF7] p-4">
                <h3 className="pb-2 text-xs font-semibold uppercase tracking-wide text-[#171B20]">
                  Sổ cái Giao dịch Cũ ({legacyLedger.length})
                </h3>
                <div className="max-h-48 overflow-x-auto overflow-y-auto border border-[#E6E3DA] bg-[#FFFFFF]">
                  <table className="w-full border-collapse text-left text-xs">
                    <tbody className="divide-y divide-[#F0EDE5]">
                      {[...legacyLedger].reverse().map((entry) => (
                        <tr key={entry.transactionId}>
                          <td className="whitespace-nowrap px-2.5 py-1.5 font-mono text-[11px]">
                            {entry.transactionId}
                          </td>
                          <td className="whitespace-nowrap px-2 py-1.5">
                            {LEGACY_LEDGER_KIND_LABEL[entry.kind]}
                          </td>
                          <td className="whitespace-nowrap px-2 py-1.5 font-mono text-[11px]">{entry.resource}</td>
                          <td className="whitespace-nowrap px-2 py-1.5 text-right font-mono">
                            {entry.direction === 'CREDIT' ? '+' : '-'}
                            {fpFormat(entry.amountFp, 2)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        ) : (
          <p className="py-4 text-xs text-[#6E7681]">Không có dữ liệu kinh tế cho phòng đấu này.</p>
        )}
      </div>
    </section>
  );
}
