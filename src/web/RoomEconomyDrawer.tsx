import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import {
  asFixedPoint, CommandPayload, ConstructionOrderIdSchema, FacilityIdSchema,
  FilteredClientMatchView, JobIdSchema, MatchRoomSummary, NationId,
  ProductionOrderIdSchema, RegionIdSchema,
} from '../contracts';
import { EconomyLedgerPanel } from './EconomyLedgerPanel';
import { fetchRoomEconomy, RoomEconomyResponse } from './roomApi';

export type RoomCommandFactory = (nationId: NationId, nonce: string) => CommandPayload;

export function RoomEconomyDrawer({ token, room, match, regionId, commandBusy, onClose, onSubmit }: {
  readonly token: string;
  readonly room: MatchRoomSummary;
  readonly match: FilteredClientMatchView;
  readonly regionId: string | null;
  readonly commandBusy: boolean;
  readonly onClose: () => void;
  readonly onSubmit: (makePayload: RoomCommandFactory) => Promise<unknown>;
}) {
  const [report, setReport] = useState<RoomEconomyResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [readError, setReadError] = useState<string | null>(null);
  const [commandError, setCommandError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const { matchId, viewerNationId } = room;

  useEffect(() => {
    const request = new AbortController();
    setLoading(true);
    setReadError(null);
    fetchRoomEconomy(token, matchId, request.signal)
      .then((data) => {
        if (request.signal.aborted) return;
        if (data.matchId !== matchId || data.nationId !== viewerNationId) {
          throw new Error('Báo cáo kinh tế không khớp với phe trong phòng hiện tại.');
        }
        setReport((previous) => previous && previous.version > data.version ? previous : data);
      })
      .catch((error: unknown) => {
        if (!request.signal.aborted) {
          setReadError(error instanceof Error ? error.message : 'Không tải được dữ liệu kinh tế.');
        }
      })
      .finally(() => {
        if (!request.signal.aborted) setLoading(false);
      });
    return () => request.abort();
  }, [token, matchId, viewerNationId, match.version, refreshKey]);

  const submit = async (makePayload: RoomCommandFactory) => {
    setCommandError(null);
    try {
      await onSubmit(makePayload);
      setRefreshKey((value) => value + 1);
    } catch (error) {
      setCommandError(error instanceof Error ? error.message : 'Máy chủ từ chối lệnh.');
    }
  };

  return (
    <aside aria-label="Kinh tế chiến dịch" data-testid="room-economy-drawer"
      className="absolute inset-y-0 right-0 z-50 flex w-full max-w-4xl flex-col border-l border-[#3C4957] bg-[#18212A] shadow-2xl">
      <header className="flex shrink-0 items-center justify-between border-b border-[#3C4957] px-4 py-2 text-[#EFE9DC]">
        <h2 className="font-display text-sm font-semibold tracking-wide">Kinh tế chiến dịch</h2>
        <button type="button" onClick={onClose} aria-label="Đóng kinh tế"
          className="grid min-h-11 min-w-11 place-items-center border border-[#3C4957] hover:bg-[#283745]">
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </header>
      <div className="min-h-0 flex-1 overflow-auto overscroll-contain">
        <EconomyLedgerPanel
          room={room} match={match} economy={report} loading={loading}
          error={commandError ?? readError} busy={commandBusy || loading} initialRegionId={regionId}
          onRefresh={() => setRefreshKey((value) => value + 1)}
          onSetTaxRate={(taxRateBps) => void submit((nationId) => ({ type: 'SET_TAX_RATE', nationId, taxRateBps }))}
          onCancelJob={(jobId) => void submit((nationId) => ({ type: 'CANCEL_JOB', nationId, jobId: JobIdSchema.parse(jobId) }))}
          onUpdateBudgetPolicy={(targetTaxRateBps, allocations) => void submit((nationId) => ({
            type: 'UPDATE_BUDGET_POLICY', nationId, targetTaxRateBps, allocations,
          }))}
          onManageCredit={(action, amountFp) => void submit((nationId) => ({
            type: 'MANAGE_CREDIT', nationId, action, amountFp: asFixedPoint(amountFp),
          }))}
          onQueueConstruction={(targetRegionId, facilityType, targetFacilityId) => void submit((nationId, nonce) => ({
            type: 'QUEUE_CONSTRUCTION', nationId, orderId: ConstructionOrderIdSchema.parse(`con_${nonce}`),
            regionId: RegionIdSchema.parse(targetRegionId), facilityType,
            targetFacilityId: targetFacilityId ? FacilityIdSchema.parse(targetFacilityId) : null,
          }))}
          onCancelConstruction={(orderId) => void submit((nationId) => ({
            type: 'CANCEL_CONSTRUCTION', nationId, orderId: ConstructionOrderIdSchema.parse(orderId),
          }))}
          onQueueProduction={(facilityId, batchCount) => void submit((nationId, nonce) => ({
            type: 'QUEUE_PRODUCTION', nationId, orderId: ProductionOrderIdSchema.parse(`prd_${nonce}`),
            facilityId: FacilityIdSchema.parse(facilityId), batchCount,
          }))}
          onCancelProduction={(orderId) => void submit((nationId) => ({
            type: 'CANCEL_PRODUCTION', nationId, orderId: ProductionOrderIdSchema.parse(orderId),
          }))}
          onToggleFacilityPause={(facilityId, paused) => void submit((nationId) => ({
            type: 'TOGGLE_FACILITY_PAUSE', nationId, facilityId: FacilityIdSchema.parse(facilityId), paused,
          }))}
        />
      </div>
    </aside>
  );
}
