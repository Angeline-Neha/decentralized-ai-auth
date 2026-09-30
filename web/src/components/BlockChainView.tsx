import { formatEther } from "ethers";
import { Hammer, Link2, Lock, Pencil, Trash2, Unlink } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { TamperField, VerifyBlock, VerifyResult } from "../lib/api";
import { CopyHash } from "./ui";

const ZERO = "0x" + "0".repeat(64);

function fmtAmount(raw?: string | null) {
  if (raw === undefined || raw === null || raw === "") return "0 ETH";
  try {
    const b = BigInt(raw);
    return b === 0n ? "0 ETH" : `${formatEther(b)} ETH`;
  } catch {
    return `${raw} wei`;
  }
}
function fmtTime(ts?: number | null) {
  return ts ? new Date(ts * 1000).toLocaleString() : "—";
}
const short = (h?: string | null, n = 10) => (!h ? "—" : h.length <= n * 2 + 2 ? h : `${h.slice(0, n + 2)}…${h.slice(-6)}`);

/** Which stored fields are covered by the hash (editing one of these breaks the hash). */
const EDIT_FIELDS: Array<{ key: TamperField; label: string; hashed: boolean; read: (b: VerifyBlock) => string }> = [
  { key: "amount", label: "Amount (wei)", hashed: true, read: (b) => b.amount },
  { key: "code", label: "Outcome code", hashed: true, read: (b) => String(b.code) },
  { key: "grant_id", label: "Grant id", hashed: true, read: (b) => String(b.grantId) },
  { key: "block_number", label: "Block height", hashed: true, read: (b) => String(b.blockNumber) },
  { key: "action_id", label: "Action id (bytes32)", hashed: true, read: (b) => b.actionId },
  { key: "params_hash", label: "Params hash (bytes32)", hashed: true, read: (b) => b.paramsHash },
  { key: "action_name", label: "Action name (display)", hashed: false, read: (b) => b.actionName ?? "" },
  { key: "head", label: "Hash (this block)", hashed: true, read: (b) => b.head },
];

const STYLE = {
  ok: { border: "border-t-ok", badge: "bg-[#E1EEE7] text-ok", label: "Valid" },
  tampered: { border: "border-t-bad bg-[#FBE4E5]", badge: "bg-bad text-white", label: "Tampered" },
  "broken-link": { border: "border-t-warn bg-[#F7EBD6]/60", badge: "bg-warn text-white", label: "Broken link" },
} as const;

function Row({ label, hashed, bad, children }: { label: string; hashed?: boolean; bad?: boolean; children: React.ReactNode }) {
  return (
    <div className={`flex items-start justify-between gap-3 border-b border-line py-1.5 last:border-0 ${bad ? "font-semibold text-bad" : ""}`}>
      <span className="shrink-0 text-xs text-mute">
        {label}
        {hashed && <span title="Included in the block hash" className="ml-1 text-ox-500">#</span>}
      </span>
      <span className="min-w-0 break-all text-right font-mono text-xs">{children}</span>
    </div>
  );
}

function HashBox({ label, value, tone }: { label: string; value: string; tone: "neutral" | "good" | "bad" | "warn" }) {
  const color = { neutral: "text-ink", good: "text-ok", bad: "text-bad", warn: "text-warn" }[tone];
  return (
    <div className="bg-sunk px-2.5 py-1.5">
      <div className="text-[11px] text-mute">{label}</div>
      <CopyHash value={value} label={value} className={`block break-all border-transparent text-left text-[11px] leading-snug ${color}`} />
    </div>
  );
}

function Connector({ status }: { status: "ok" | "tampered" | "broken-link" | "pending" }) {
  const bad = status === "tampered" || status === "broken-link";
  return (
    <div className="flex w-16 shrink-0 flex-col items-center justify-center gap-1.5 text-[11px] font-semibold">
      <div className={`h-0.5 w-full ${bad ? "border-t-2 border-dashed border-bad" : status === "pending" ? "bg-line" : "bg-ok"}`} />
      {bad ? <Unlink className="h-5 w-5 text-bad" /> : <Link2 className={`h-5 w-5 ${status === "pending" ? "text-mute" : "text-ok"}`} />}
      <span className={bad ? "text-bad" : "text-mute"}>{bad ? "broken" : "prev"}</span>
    </div>
  );
}

function BlockCard({
  b,
  busy,
  onTamper,
  onRemine,
  onDelete,
}: {
  b: VerifyBlock;
  busy: boolean;
  onTamper: (index: number, fields: Partial<Record<TamperField, string>>) => void;
  onRemine: (index: number, mode: "one" | "all") => void;
  onDelete: (index: number) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const st = STYLE[b.status];
  const bad = (k: string) => b.diffs.includes(k);

  function open() {
    setDraft(Object.fromEntries(EDIT_FIELDS.map((f) => [f.key, f.read(b)])));
    setEditing(true);
  }
  function apply() {
    const changed: Partial<Record<TamperField, string>> = {};
    for (const f of EDIT_FIELDS) if (draft[f.key] !== undefined && draft[f.key] !== f.read(b)) changed[f.key] = draft[f.key];
    if (Object.keys(changed).length) onTamper(b.index, changed);
    setEditing(false);
  }

  return (
    <div className={`w-[350px] shrink-0 border border-t-4 border-line bg-card p-4 transition-colors ${st.border}`}>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <span className="font-mono text-base font-semibold">Block #{b.index + 1}</span>
        <span className={`px-1.5 py-0.5 text-[11px] font-semibold ${st.badge}`}>{st.label}</span>
        <span className="ml-auto bg-sunk px-1.5 py-0.5 text-[11px] font-semibold">{b.outcome ?? `code ${b.code}`}</span>
      </div>

      <div>
        <Row label="Time">{fmtTime(b.timestamp)}</Row>
        <Row label="Height" hashed bad={bad("block_number")}>#{b.blockNumber}</Row>
        <Row label="Nonce">{b.nonce ?? "—"}</Row>
        <Row label="Grant" hashed bad={bad("grant_id")}>#{b.grantId}</Row>
        <Row label="Action" hashed bad={bad("action_id") || bad("action_name")}>{b.actionName ?? short(b.actionId, 6)}</Row>
        <Row label="Amount" hashed bad={bad("amount")}>{fmtAmount(b.amount)}</Row>
        <Row label="Code" hashed bad={bad("code") || bad("outcome")}>{b.code}</Row>
        <Row label="Params" hashed bad={bad("params_hash")}>{short(b.paramsHash, 6)}</Row>
        <Row label="Tx">{short(b.txHash, 6)}</Row>
      </div>

      {b.onChain && (
        <div className="mt-3 border-l-4 border-bad bg-[#FBE4E5] p-3 text-xs">
          <div className="mb-1 font-semibold text-[#7A1219]">The on-chain record says</div>
          {Object.entries(b.onChain).map(([k, v]) => (
            <div key={k} className="flex justify-between gap-2 font-mono">
              <span className="text-[#7A1219]">{k}</span>
              <span className="break-all text-right text-ok">{k === "amount" ? fmtAmount(v) : short(v, 8)}</span>
            </div>
          ))}
        </div>
      )}

      <div className="mt-3 space-y-1.5">
        <HashBox label="Previous hash" value={b.prevHash} tone={b.status === "broken-link" ? "warn" : "neutral"} />
        <HashBox label="Hash (stored)" value={b.head} tone={b.status === "ok" ? "good" : "bad"} />
        {!b.hashOk && <HashBox label="Hash it should be (recomputed)" value={b.recomputedHead} tone="warn" />}
      </div>

      {b.reasons.length > 0 && (
        <ul className="mt-3 space-y-0.5 text-xs text-bad">
          {b.reasons.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
      )}

      {editing ? (
        <div className="mt-4 space-y-3 border border-warn bg-[#F7EBD6]/50 p-3">
          <div className="text-xs font-semibold text-warn">Edit block #{b.index + 1} (off-chain copy)</div>
          <div className="grid grid-cols-2 gap-2">
            {EDIT_FIELDS.map((f) => (
              <label key={f.key} className={f.key === "action_id" || f.key === "params_hash" || f.key === "head" ? "col-span-2" : ""}>
                <span className="text-[11px] text-mute">
                  {f.label}
                  {f.hashed ? " #" : ""}
                </span>
                <input className="input mt-0.5 !px-2 !py-1 text-xs" value={draft[f.key] ?? ""} onChange={(e) => setDraft((d) => ({ ...d, [f.key]: e.target.value }))} />
              </label>
            ))}
          </div>
          <div className="flex gap-2">
            <button type="button" className="btn-danger btn-sm" disabled={busy} onClick={apply}>
              Apply tamper
            </button>
            <button type="button" className="btn-ghost btn-sm" onClick={() => setEditing(false)}>
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="mt-4 flex flex-wrap gap-1.5">
          <button type="button" className="btn-ghost btn-sm" onClick={open} disabled={busy}>
            <Pencil className="h-3 w-3" /> Tamper
          </button>
          <button type="button" className="btn-ghost btn-sm" disabled={busy} onClick={() => onRemine(b.index, "one")} title="Attacker recomputes this block's hash so it looks self-consistent">
            <Hammer className="h-3 w-3" /> Re-mine
          </button>
          <button type="button" className="btn-ghost btn-sm" disabled={busy} onClick={() => onRemine(b.index, "all")} title="Attacker recomputes this block and every block after it">
            <Hammer className="h-3 w-3" /> Re-mine all after
          </button>
          <button type="button" className="btn-ghost btn-sm hover:!border-bad hover:!text-bad" disabled={busy} onClick={() => onDelete(b.index)} aria-label={`Delete block ${b.index + 1}`} title="Delete this block">
            <Trash2 className="h-3 w-3" />
          </button>
        </div>
      )}
    </div>
  );
}

export function BlockChainView({
  data,
  busy,
  mining,
  mineNote,
  onTamper,
  onRemine,
  onDelete,
  onMine,
}: {
  data: VerifyResult;
  busy: boolean;
  mining: boolean;
  mineNote: string | null;
  onTamper: (index: number, fields: Partial<Record<TamperField, string>>) => void;
  onRemine: (index: number, mode: "one" | "all") => void;
  onDelete: (index: number) => void;
  onMine: () => void;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const count = data.blocks.length;
  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTo({ left: el.scrollWidth, behavior: "smooth" });
  }, [count]);

  const last = data.blocks[data.blocks.length - 1];
  const g = data.genesis;
  const locked = !data.valid;

  return (
    <div ref={scroller} className="flex items-stretch overflow-x-auto pb-4">
      {/* Genesis */}
      <div className="w-[350px] shrink-0 border border-t-4 border-line border-t-ox-600 bg-card p-4">
        <div className="mb-3 flex items-center gap-2">
          <span className="font-mono text-base font-semibold">Block #0</span>
          <span className="bg-ox-600 px-1.5 py-0.5 text-[11px] font-semibold text-white">Genesis</span>
          <Lock className="ml-auto h-3.5 w-3.5 text-ox-600" />
        </div>
        <div>
          <Row label="Time">{fmtTime(g.deployed?.timestamp)}</Row>
          <Row label="Height">{g.deployed ? `#${g.deployed.blockNumber}` : "—"}</Row>
          <Row label="Nonce">0</Row>
          <Row label="Info">AgentGuard deployed</Row>
          <Row label="Contract">{short(g.address, 8)}</Row>
          <Row label="Chain id">{g.chainId}</Row>
        </div>
        <div className="mt-3 space-y-1.5">
          <HashBox label="Previous hash" value={ZERO} tone="neutral" />
          <HashBox label="Hash H₀ (genesis head)" value={g.head} tone="good" />
        </div>
        <p className="mt-3 text-xs leading-relaxed text-mute">
          Each block hashes the one before it, starting from H₀. The latest hash is also stored in the contract as <code className="mono-chip">auditHead</code>.
        </p>
      </div>

      {data.blocks.map((b) => (
        <div key={b.index} className="flex items-stretch">
          <Connector status={b.status === "ok" ? "ok" : b.status} />
          <BlockCard b={b} busy={busy} onTamper={onTamper} onRemine={onRemine} onDelete={onDelete} />
        </div>
      ))}

      {data.missing.map((m) => (
        <div key={`missing-${m}`} className="ml-3 flex w-40 shrink-0 items-center justify-center border-2 border-dashed border-bad p-3 text-center text-xs font-semibold text-bad">
          Block #{m + 1} was deleted from the local copy
        </div>
      ))}

      {/* Next block slot */}
      <Connector status={locked ? "tampered" : "pending"} />
      <div className={`flex w-[300px] shrink-0 flex-col justify-center gap-3 border-2 border-dashed p-5 text-center ${locked ? "border-bad" : "border-line"}`}>
        {locked ? (
          <>
            <div className="text-sm font-semibold text-bad">Chain locked</div>
            <p className="text-xs leading-relaxed text-mute">The gateway refuses to append block #{count + 1} on top of a tampered chain (HTTP 423).</p>
          </>
        ) : (
          <>
            <div className="text-sm font-semibold">Block #{count + 1}</div>
            <p className="break-all font-mono text-xs text-mute">will link to {short(last?.head ?? g.head, 8)}</p>
          </>
        )}
        <button type="button" className="btn-primary btn-sm justify-center" disabled={mining} onClick={onMine}>
          <Hammer className="h-3.5 w-3.5" />
          {mining ? "Mining…" : locked ? "Try to mine a block" : "Mine next blocks"}
        </button>
        {mineNote && <p className={`text-xs font-semibold ${mineNote.includes("refused") ? "text-bad" : "text-ok"}`}>{mineNote}</p>}
        {data.rejections.slice(0, 2).map((r) => (
          <p key={r.at + (r.action ?? "")} className="bg-[#FBE4E5] p-2 text-left text-xs text-[#7A1219]">
            {fmtTime(r.at)} · {r.action ?? "block"} refused
          </p>
        ))}
      </div>
    </div>
  );
}
