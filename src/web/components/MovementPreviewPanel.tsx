import { useState } from 'react';
import { Region, RegionId, UnitId } from '../../contracts';
import type { MovementPreview } from '../roomApi';

export type LoadMovementPreview = (
  unitId: UnitId,
  destinationId: RegionId
) => Promise<MovementPreview>;

export type SendMarch = (unitId:UnitId, destinationId:RegionId | null)=>Promise<unknown>;
export function MovementPreviewPanel({ unitId, originId, destinations, load,send,march }: {
  readonly send?: SendMarch;
  readonly march?: readonly {regionId:RegionId;dueUtc:number}[];
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

  async function issue(target:RegionId|null){
    if(!send||pending)return;
    setPending(true);setError(null);
    try{await send(unitId,target);setPreview(null);}
    catch(cause){setError(cause instanceof Error?cause.message:'Không gửi được lệnh.');}
    finally{setPending(false);}
  }
  if(march?.length){
    const last=march[march.length-1];
    return <div className="grid gap-2 py-2" role="status">
      <p>Đang hành quân tới {destinations.find(r=>r.regionId===last.regionId)?.name??last.regionId}</p>
      <p>{march.length} chặng còn lại · Đến {new Date(last.dueUtc).toLocaleTimeString('vi-VN')}</p>
      <button type="button" disabled={pending} onClick={()=>void issue(null)}>Dừng ở vùng hiện tại</button>
      {error&&<p role="alert">{error}</p>}
    </div>;
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
          {send && <button type="button" className="min-h-10 border border-[#C6A15B]" disabled={pending} onClick={()=>{ if(destinationId) void issue(destinationId); }}>Ra lệnh hành quân</button>}
        </div>
      )}
    </div>
  );
}


