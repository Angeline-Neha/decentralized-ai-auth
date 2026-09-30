import { formatEther } from "ethers";
import { Hammer, Link2, Lock, Pencil, Trash2, Unlink } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { TamperField, VerifyBlock, VerifyResult } from "../lib/api";
import { copy } from "../lib/format";

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
  ok: { border: "border-emerald-500/50", badge: "bg-emerald-500/20 text-emerald-300 border-emerald-500/40", label: "VALID" },
  tampered: { border: "border-red-500/70 bg-red-950/30", badge: "bg-red-500/25 text-red-200 border-red-500/60", label: "TAMPERED" },
  "broken-link": { border: "border-amber-500/70 bg-amber-950/20", badge: "bg-amber-500/25 text-amber-200 border-amber-500/60", label: "BROKEN LINK" },
} as const;

function Row({ label, hashed, bad, children }: { label: string; hashed?: boolean; bad?: boolean; children: React.ReactNode }) {
  return (
    <div className={`flex items-start justify-between gap-3 border-b border-white/5 py-1 last:border-0 ${bad ? "text-red-300" : ""}`}>
      <span className="shrink-0 text-[10px] uppercase tracking-wide text-console-muted">
        {hashed && <span title="Included in the block hash">#</span>} {label}
      </span>
      <span className="min-w-0 break-all text-right font-mono text-[11px]">{children}</span>
    </div>
  );
}

function HashBox({ label, value, tone }: { label: string; value: string; tone: "neutral" | "good" | "bad" | "warn" }) {
  const color = { neutral: "text-slate-300", good: "text-emerald-300", bad: "text-red-300", warn: "text-amber-300" }[tone];
  return (
    <button type="button" onClick={() => copy(value)} title="Click to copy" className="block w-full rounded border border-console-border bg-black/40 p-1.5 text-left">
      <div className="text-[9px] uppercase tracking-wider text-console-muted">{label}</div>
      <div className={`break-all font-mono text-[10px] leading-tight ${color}`}>{value}</div>
    </button>
  );
}

function Connector({ status }: { status: "ok" | "tampered" | "broken-link" | "pending" }) {
  const bad = status === "tampered" || status === "broken-link";
  return (
    <div className="flex w-16 shrink-0 flex-col items-center justify-center gap-1 text-[9px] font-semibold uppercase">
      <div className={`h-0.5 w-full ${bad ? "border-t-2 border-dashed border-red-500" : "bg-emerald-500/60"}`} />
      {bad ? <Unlink className="h-5 w-5 text-red-400" /> : <Link2 className={`h-5 w-5 ${status === "pending" ? "text-console-muted" : "text-emerald-400"}`} />}
      <span className={bad ? "text-red-400" : "text-console-muted"}>{bad ? "broken" : "prev →"}</span>
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
    <div className={`panel w-[350px] shrink-0 border-2 p-3 transition ${st.border}`}>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span className={`rounded border px-2 py-0.5 font-mono text-xs font-bold ${st.badge}`}>Block #{b.index + 1}</span>
        <span className={`rounded border px-1.5 py-0.5 text-[10px] font-bold ${st.badge}`}>{st.label}</span>
        <span className="ml-auto rounded bg-white/10 px-1.5 py-0.5 text-[10px] font-semibold">{b.outcome ?? `code ${b.code}`}</span>
      </div>

      <div className="rounded bg-black/30 px-2">
        <Row label="Timestamp">{fmtTime(b.timestamp)}</Row>
        <Row label="Block height" hashed bad={bad("block_number")}>
          #{b.blockNumber}
        </Row>
        <Row label="Intent nonce">{b.nonce ?? "—"}</Row>
        <Row label="Grant" hashed bad={bad("grant_id")}>
          #{b.grantId}
        </Row>
        <Row label="Action" hashed bad={bad("action_id") || bad("action_name")}>
          {b.actionName ?? short(b.actionId, 6)}
        </Row>
        <Row label="Amount" hashed bad={bad("amount")}>
          {fmtAmount(b.amount)}
        </Row>
        <Row label="Code" hashed bad={bad("code") || bad("outcome")}>
          {b.code}
        </Row>
        <Row label="Params hash" hashed bad={bad("params_hash")}>
          {short(b.paramsHash, 6)}
        </Row>
        <Row label="Tx">{short(b.txHash, 6)}</Row>
      </div>

      {b.onChain && (
        <div className="mt-2 rounded border border-red-500/40 bg-red-950/40 p-2 text-[10px]">
          <div className="mb-1 font-bold uppercase text-red-300">On-chain record says</div>
          {Object.entries(b.onChain).map(([k, v]) => (
            <div key={k} className="flex justify-between gap-2 font-mono">
              <span className="text-red-300">{k}</span>
              <span className="break-all text-right text-emerald-300">{k === "amount" ? fmtAmount(v) : short(v, 8)}</span>
            </div>
          ))}
        </div>
      )}

      <div className="mt-2 space-y-1.5">
        <HashBox label="Previous hash" value={b.prevHash} tone={b.status === "broken-link" ? "warn" : "neutral"} />
        <HashBox label="Hash (stored)" value={b.head} tone={b.status === "ok" ? "good" : "bad"} />
        {!b.hashOk && <HashBox label="Hash it should be (recomputed)" value={b.recomputedHead} tone="warn" />}
      </div>

      {b.reasons.length > 0 && <ul className="mt-2 space-y-0.5 text-[10px] text-red-300">{b.reasons.map((r) => <li key={r}>• {r}</li>)}</ul>}

      {editing ? (
        <div className="mt-3 space-y-2 rounded-lg border border-amber-500/50 bg-black/60 p-2">
          <div className="text-[11px] font-semibold text-amber-300">Edit Block #{b.index + 1} (off-chain copy)</div>
          <div className="grid grid-cols-2 gap-2">
            {EDIT_FIELDS.map((f) => (
              <label key={f.key} className={f.key === "action_id" || f.key === "params_hash" || f.key === "head" ? "col-span-2" : ""}>
                <span className="text-[9px] uppercase text-console-muted">
                  {f.hashed ? "# " : ""}
                  {f.label}
                </span>
                <input
                  className="input mt-0.5 !px-2 !py-1 text-[11px]"
                  value={draft[f.key] ?? ""}
                  onChange={(e) => setDraft((d) => ({ ...d, [f.key]: e.target.value }))}
                />
              </label>
            ))}
          </div>
          <div className="flex gap-2">
            <button type="button" className="btn-danger !px-3 !py-1 text-xs" disabled={busy} onClick={apply}>
              Apply tamper
            </button>
            <button type="button" className="btn-ghost !px-3 !py-1 text-xs" onClick={() => setEditing(false)}>
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="mt-3 flex flex-wrap gap-1.5">
          <button type="button" className="btn-ghost flex items-center gap-1 !px-2 !py-1 text-[11px]" onClick={open} disabled={busy}>
            <Pencil className="h-3 w-3" /> Tamper
          </button>
          <button
            type="button"
            className="btn-ghost flex items-center gap-1 !px-2 !py-1 text-[11px]"
            disabled={busy}
            onClick={() => onRemine(b.index, "one")}
            title="Attacker recomputes this block's hash so it looks self-consistent"
          >
            <Hammer className="h-3 w-3" /> Re-mine
          </button>
          <button
            type="button"
            className="btn-ghost flex items-center gap-1 !px-2 !py-1 text-[11px]"
            disabled={busy}
            onClick={() => onRemine(b.index, "all")}
            title="Attacker recomputes this block and every block after it"
          >
            <Hammer className="h-3 w-3" /> Re-mine all after
          </button>
          <button type="button" className="btn-ghost flex items-center gap-1 !px-2 !py-1 text-[11px] hover:!border-red-500/60" disabled={busy} onClick={() => onDelete(b.index)}>
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
      <div className="panel w-[350px] shrink-0 border-2 border-cyan-500/60 p-3">
        <div className="mb-2 flex items-center gap-2">
          <span className="rounded border border-cyan-500/50 bg-cyan-500/20 px-2 py-0.5 font-mono text-xs font-bold text-cyan-300">Block #0</span>
          <span className="rounded border border-cyan-500/50 px-1.5 py-0.5 text-[10px] font-bold text-cyan-300">GENESIS</span>
          <Lock className="ml-auto h-3.5 w-3.5 text-cyan-300" />
        </div>
        <div className="rounded bg-black/30 px-2">
          <Row label="Timestamp">{fmtTime(g.deployed?.timestamp)}</Row>
          <Row label="Block height">{g.deployed ? `#${g.deployed.blockNumber}` : "—"}</Row>
          <Row label="Nonce">0</Row>
          <Row label="Info">AgentGuard deployed</Row>
          <Row label="Contract">{short(g.address, 8)}</Row>
          <Row label="Chain id">{g.chainId}</Row>
        </div>
        <div className="mt-2 space-y-1.5">
          <HashBox label="Previous hash" value={ZERO} tone="neutral" />
          <HashBox label="Hash H₀ (genesis head)" value={g.head} tone="good" />
        </div>
        <p className="mt-2 text-[10px] text-console-muted">Every block hashes the previous block's hash, starting from H₀. The latest hash is also stored in the contract as <code>auditHead</code>.</p>
      </div>

      {data.blocks.map((b) => (
        <div key={b.index} className="flex items-stretch">
          <Connector status={b.status === "ok" ? "ok" : b.status} />
          <BlockCard b={b} busy={busy} onTamper={onTamper} onRemine={onRemine} onDelete={onDelete} />
        </div>
      ))}

      {data.missing.map((m) => (
        <div key={`missing-${m}`} className="ml-3 flex w-40 shrink-0 items-center justify-center rounded-xl border-2 border-dashed border-red-500/60 p-3 text-center text-xs text-red-300">
          Block #{m + 1} was deleted from the local copy
        </div>
      ))}

      {/* Next block slot */}
      <Connector status={locked ? "tampered" : "pending"} />
      <div className={`panel flex w-[300px] shrink-0 flex-col justify-center gap-2 border-2 border-dashed p-4 text-center ${locked ? "border-red-500/60" : "border-console-border"}`}>
        {locked ? (
          <>
            <div className="text-sm font-bold text-red-300">⛔ Chain locked</div>
            <p className="text-[11px] text-red-200/80">The gateway refuses to append Block #{count + 1} on top of a tampered chain (HTTP 423).</p>
          </>
        ) : (
          <>
            <div className="text-sm font-semibold text-slate-200">Block #{count + 1}</div>
            <p className="break-all font-mono text-[10px] text-console-muted">will link to {short(last?.head ?? g.head, 8)}</p>
          </>
        )}
        <button type="button" className="btn-primary flex items-center justify-center gap-1.5 !py-1.5 text-xs" disabled={mining} onClick={onMine}>
          <Hammer className="h-3.5 w-3.5" />
          {mining ? "Mining…" : locked ? "Try to mine a block" : "Mine next blocks (agent: normal day)"}
        </button>
        {mineNote && <p className={`text-[11px] ${mineNote.includes("refused") ? "text-red-300" : "text-emerald-300"}`}>{mineNote}</p>}
        {data.rejections.slice(0, 2).map((r) => (
          <p key={r.at + (r.action ?? "")} className="rounded bg-red-950/50 p-1.5 text-left text-[10px] text-red-200">
            ⛔ {fmtTime(r.at)} · {r.action ?? "block"} refused
          </p>
        ))}
      </div>
    </div>
  );
}
