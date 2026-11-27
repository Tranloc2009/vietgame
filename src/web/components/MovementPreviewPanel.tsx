import { useState } from 'react';
import { Region, RegionId, UnitId } from '../../contracts';
import type { MovementPreview } from '../roomApi';

export type LoadMovementPreview = (
  unitId: UnitId,
  destinationId: RegionId
) => Promise<MovementPreview>;

export function MovementPreviewPanel({ unitId, originId, destinations, load }: {
  readonly unitId: UnitId;
  readonly originId: RegionId;
  readonly destinations: readonly Region[];
  readonly load: LoadMovementPreview;
}) {
  const [destinationId, setDestinationId] = useState<RegionId | ''>('');
  const [pending, setPending] = useState(false);
  const [preview, setPreview] = useState<MovementPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const destinationAvailable = destinations.some((region) => region.regionId === destinationId);
  const matchingPreview = preview?.originId === originId && destinationAvailable &&
    preview.regions.slice(1).every(({ id }) => destinations.some((region) => region.regionId === id))
    ? preview : null;

  async function requestPreview() {
    if (!destinationId || !destinationAvailable || pending) return;
    setPending(true);
    setError(null);
    setPreview(null);
    try {
      const result = await load(unitId, destinationId);
      if (result.originId !== originId) {
        setError('Vị trí đơn vị đã đổi. Hãy xem lại sau khi bản đồ đồng bộ.');
        return;
      }
      setPreview(result);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Không thể xem trước tuyến.');
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="mt-2 grid gap-1.5 border-t border-[#2B3540] pt-2">
      <label className="grid gap-1 text-[#E0D7C6]">
        Đích trong vùng kiểm soát
        <select
          value={destinationAvailable ? destinationId : ''}
          disabled={pending || destinations.length === 0}
          onChange={(event) => {
            const selected = destinations.find((region) => region.regionId === event.target.value);
            setDestinationId(selected?.regionId ?? '');
            setPreview(null);
            setError(null);
          }}
          className="min-h-10 w-full border border-[#526775] bg-[#17212A] px-2 text-[#F4EBDC]"
        >
          <option value="">Chọn khu vực</option>
          {destinations.map((region) => (
            <option key={region.regionId} value={region.regionId}>{region.name}</option>
          ))}
        </select>
      </label>
      <button
        type="button"
        onClick={() => void requestPreview()}
        disabled={!destinationAvailable || pending}
        className="min-h-10 border border-[#C6A15B] bg-[#2E2A20] px-2 text-[#F4EBDC] disabled:opacity-60"
      >
        {pending ? 'Đang tính tuyến…' : 'Xem trước tuyến'}
      </button>
      {!destinations.length && <p className="text-[#A8B2BC]">Chưa có đích cùng phe.</p>}
      {error && <p role="alert" className="text-[#FFC09F]">{error}</p>}
      {matchingPreview && (
        <div role="status" className="grid gap-1 text-[#F4EBDC]">
          <p>Thời gian dự kiến: {Math.ceil(matchingPreview.durationMs / 60_000)} phút</p>
          <p>Đến khoảng {new Date(matchingPreview.estimatedArrivalUtc).toLocaleString('vi-VN')}</p>
          <p>{matchingPreview.regions.map((region) => region.name).join(' → ')}</p>
          <p className="text-[#A8B2BC]">Chưa gửi lệnh di chuyển.</p>
        </div>
      )}
    </div>
  );
}
