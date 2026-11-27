import { useState } from "react";
import {
  FilteredClientMatchView,
  MatchRoomSummary,
  TreatyIdSchema,
} from "../contracts";
import type { RoomCommandFactory } from "./RoomEconomyDrawer";

const labels = {
  PROPOSED: "Chờ phản hồi",
  ACTIVE: "Có hiệu lực",
  TERMINATED: "Đã kết thúc",
  EXPIRED: "Hết hạn",
};
export function DiplomacyDrawer({
  match,
  room,
  busy,
  submit,
  close,
}: {
  match: FilteredClientMatchView;
  room: MatchRoomSummary;
  busy: boolean;
  submit: (cmd: RoomCommandFactory) => Promise<unknown>;
  close: () => void;
}) {
  const [error, setError] = useState("");
  const own = room.viewerNationId;
  const other =
    room.viewerSlot === "NORTH" ? room.slots.SOUTH : room.slots.NORTH;
  const pending = Object.values(match.treaties).find(
    (t) =>
      t.kind === "SHARED_INTEL" &&
      [t.proposerNationId, t.targetNationId].some((id) => id === own) &&
      ["PROPOSED", "ACTIVE"].includes(t.status) &&
      (t.expiresAtUtc === null || t.expiresAtUtc > match.currentUtc),
  );
  const disabled = busy || room.status !== "ACTIVE";
  async function send(fn: RoomCommandFactory) {
    setError("");
    try {
      await submit(fn);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Không gửi được yêu cầu.");
    }
  }
  const news = match.events
    .filter(
      (e) =>
        e.payload.type === "INTEL_PACT_STATUS" ||
        (e.payload.type === "TREATY_PROPOSED" &&
          e.payload.kind === "SHARED_INTEL"),
    )
    .slice()
    .reverse();
  return (
    <aside
      aria-label="Ngoại giao"
      className="absolute left-2 bottom-2 z-50 max-h-[64%] w-[min(360px,96%)] overflow-auto border border-[#667257] bg-[#17212a] p-3 text-sm text-[#eee7d8] sm:bottom-auto sm:top-3"
    >
      <header className="flex items-center justify-between border-b border-[#57614f] pb-2">
        <h2>Ngoại giao</h2>
        <button aria-label="Đóng ngoại giao" onClick={close}>
          Đóng
        </button>
      </header>
      <h3 className="mt-3 font-semibold">
        {match.nations[other.nationId]?.name}
      </h3>
      <p className="my-2 text-xs">
        Chia sẻ vùng quan sát giữa hai phe. Mỗi phe giữ kín tiếp tế và lệnh hành
        quân.
      </p>
      {pending ? (
        <div>
          <p>{labels[pending.status]}</p>
          {pending.status === "PROPOSED" && pending.targetNationId === own && (
            <button
              className="m-1 border p-2"
              disabled={disabled}
              onClick={() =>
                void send(() => ({
                  type: "UPDATE_INTEL_PACT",
                  treatyId: pending.treatyId,
                  decision: "ACCEPT",
                }))
              }
            >
              Chấp nhận
            </button>
          )}
          <button
            className="m-1 border p-2"
            disabled={disabled}
            onClick={() =>
              void send(() => ({
                type: "UPDATE_INTEL_PACT",
                treatyId: pending.treatyId,
                decision: "END",
              }))
            }
          >
            {pending.status === "ACTIVE"
              ? "Chấm dứt hiệp ước"
              : pending.targetNationId === own
                ? "Từ chối"
                : "Rút đề nghị"}
          </button>
        </div>
      ) : (
        <button
          className="border p-2"
          disabled={disabled}
          onClick={() =>
            void send((nationId, nonce) => ({
              type: "PROPOSE_TREATY",
              treatyId: TreatyIdSchema.parse("trt_" + nonce),
              proposerNationId: nationId,
              targetNationId: other.nationId,
              kind: "SHARED_INTEL",
              durationDays: 1,
            }))
          }
        >
          Đề nghị chia sẻ tình báo · 1 ngày
        </button>
      )}
      {error && <p role="alert">{error}</p>}
      <h3 className="mt-4 border-b border-[#57614f] pb-1">Tin ngoại giao</h3>
      {news.length === 0 ? (
        <p className="my-2 text-xs">Chưa có sự kiện ngoại giao.</p>
      ) : (
        <ol>
          {news.map((e) => (
            <li
              className="border-b border-[#37443d] py-2 text-xs"
              key={e.eventId}
            >
              <time>{new Date(e.occurredAtUtc).toLocaleString("vi-VN")}</time>
              <p>
                {e.payload.type === "TREATY_PROPOSED"
                  ? match.nations[e.payload.proposerNationId]?.name +
                    " gửi đề nghị chia sẻ tình báo."
                  : e.payload.type === "INTEL_PACT_STATUS"
                    ? "Hiệp ước chia sẻ tình báo · " + labels[e.payload.status]
                    : ""}
              </p>
            </li>
          ))}
        </ol>
      )}
    </aside>
  );
}
