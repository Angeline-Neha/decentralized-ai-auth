import { actionId, buildActionTree, StandardMerkleTree } from "@agentguard/shared/merkle";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { fetchGrant, fetchProof } from "../lib/api";
import { AbiCoder, keccak256 } from "ethers";
import clsx from "clsx";
import { CopyHash, Notice, PageHeader, Section } from "../components/ui";

export function MerkleVisualizerPage() {
  const [grantId, setGrantId] = useState(1);
  const [selectedAction, setSelectedAction] = useState("read_calendar");
  const [customAction, setCustomAction] = useState("");
  const [testMode, setTestMode] = useState<"whitelisted" | "custom">("whitelisted");

  const grantQ = useQuery({
    queryKey: ["grant-merkle", grantId],
    queryFn: () => fetchGrant(grantId),
    refetchInterval: 5000,
  });

  const actions = useMemo(() => grantQ.data?.manifest?.actions ?? ["read_calendar", "send_email", "pay_invoice"], [grantQ.data]);

  const tree = useMemo(() => {
    if (!actions.length) return null;
    try {
      return buildActionTree(actions);
    } catch {
      return null;
    }
  }, [actions]);

  const activeActionName = testMode === "whitelisted" ? selectedAction : (customAction || "transfer_funds");

  const proofQ = useQuery({
    queryKey: ["proof", grantId, activeActionName],
    queryFn: () => fetchProof(grantId, activeActionName),
    enabled: !!grantQ.data && testMode === "whitelisted" && actions.includes(activeActionName),
  });

  // Calculate leaf hash according to OpenZeppelin standard:
  // Leaf = keccak256(bytes.concat(keccak256(abi.encode(actionId))))
  const leafData = useMemo(() => {
    if (!activeActionName) return null;
    try {
      const aId = actionId(activeActionName);
      const encoded = AbiCoder.defaultAbiCoder().encode(["bytes32"], [aId]);
      const leafHash = keccak256(keccak256(encoded));
      return { actionId: aId, encoded, leafHash };
    } catch {
      return null;
    }
  }, [activeActionName]);

  // Proof list
  const proofList = useMemo(() => {
    if (testMode === "whitelisted" && proofQ.data?.proofs?.[0]?.proof) {
      return proofQ.data.proofs[0].proof;
    }
    if (testMode === "whitelisted" && tree && actions.includes(activeActionName)) {
      try {
        return tree.getProof([actionId(activeActionName)]);
      } catch {
        return [];
      }
    }
    return [];
  }, [testMode, proofQ.data, tree, actions, activeActionName]);

  const proofSet = useMemo(() => new Set(proofList.map((p) => p.toLowerCase())), [proofList]);

  // Verification simulation
  const verificationResult = useMemo(() => {
    if (!tree || !leafData) return null;
    if (testMode === "custom" || !actions.includes(activeActionName)) {
      return {
        valid: false,
        computedRoot: "0x0000000000000000000000000000000000000000000000000000000000000000",
        expectedRoot: tree.root,
        error: `Action "${activeActionName}" is not included in the Grant #${grantId} manifest leaves. Cannot construct valid inclusion proof.`,
      };
    }
    try {
      const isValid = StandardMerkleTree.verify(
        tree.root,
        ["bytes32"],
        [leafData.actionId],
        proofList,
      );
      return {
        valid: isValid,
        computedRoot: tree.root,
        expectedRoot: tree.root,
        error: null,
      };
    } catch (e: any) {
      return {
        valid: false,
        computedRoot: "Invalid Proof",
        expectedRoot: tree.root,
        error: e?.message ?? "Proof verification failed",
      };
    }
  }, [tree, leafData, testMode, actions, activeActionName, proofList, grantId]);

  // Build tree nodes for graphic rendering
  const treeNodes = useMemo(() => {
    if (!tree) return [];
    return actions.map((name, idx) => {
      const aId = actionId(name);
      const encoded = AbiCoder.defaultAbiCoder().encode(["bytes32"], [aId]);
      const leafHash = keccak256(keccak256(encoded));
      return {
        name,
        actionId: aId,
        hash: leafHash,
        isTarget: name === activeActionName,
        isSibling: proofSet.has(leafHash.toLowerCase()),
        index: idx,
      };
    });
  }, [tree, actions, activeActionName, proofSet]);

  const valid = !!verificationResult?.valid;

  return (
    <div className="space-y-12">
      <PageHeader
        title="Merkle proof"
        lead="The contract stores one hash for a grant's whole list of allowed actions. To use an action, the agent must prove it is in that list without revealing the rest."
        actions={
          <label className="flex items-center gap-2 text-sm font-semibold">
            Grant
            <input className="input w-20 text-center" type="number" min={1} value={grantId} onChange={(e) => setGrantId(Number(e.target.value))} />
          </label>
        }
      />

      {/* What is being tested */}
      <section aria-label="Choose an action to test" className="space-y-4">
        <div role="tablist" aria-label="Test mode" className="inline-flex border border-line">
          {([["whitelisted", "Allowed action"], ["custom", "Unauthorized action"]] as const).map(([mode, label]) => (
            <button
              key={mode}
              type="button"
              role="tab"
              aria-selected={testMode === mode}
              onClick={() => {
                setTestMode(mode);
                if (mode === "custom" && !customAction) setCustomAction("transfer_funds");
              }}
              className={clsx("px-4 py-2 text-sm font-semibold transition-colors", testMode === mode ? (mode === "custom" ? "bg-bad text-white" : "bg-ox-600 text-white") : "bg-card text-mute hover:text-ink")}
            >
              {label}
            </button>
          ))}
        </div>

        {testMode === "whitelisted" ? (
          <div className="flex flex-wrap gap-2">
            {actions.map((act) => (
              <button
                key={act}
                type="button"
                aria-pressed={selectedAction === act}
                onClick={() => setSelectedAction(act)}
                className={clsx("border px-3 py-1.5 font-mono text-sm transition-colors", selectedAction === act ? "border-ox-600 bg-ox-50 font-medium text-ox-700" : "border-line bg-card text-mute hover:border-ox-500")}
              >
                {act}
              </button>
            ))}
          </div>
        ) : (
          <div className="flex flex-wrap gap-2">
            <input className="input max-w-sm flex-1" placeholder="e.g. drain_vault" value={customAction} onChange={(e) => setCustomAction(e.target.value)} />
            {["transfer_funds", "drain_escrow", "delegate_admin"].map((preset) => (
              <button key={preset} type="button" onClick={() => setCustomAction(preset)} className="btn-ghost btn-sm font-mono">
                {preset}
              </button>
            ))}
          </div>
        )}
      </section>

      {tree && (
        <div className="grid gap-14 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
          {/* The tree */}
          <Section title="The tree" meta={`${actions.length} leaves · ${proofList.length} sibling${proofList.length === 1 ? "" : "s"} needed`}>
            <div className="mt-5 border border-line bg-card p-4">
              <svg viewBox="0 0 540 230" className="h-auto w-full" role="img" aria-label="Merkle tree of allowed actions">
                <g fill="none" stroke="#C9BDBC" strokeWidth="2">
                  <path d="M 270 45 C 270 80, 150 80, 150 105" />
                  <path d="M 270 45 C 270 80, 390 80, 390 105" />
                  <path d="M 150 135 C 150 155, 90 160, 90 175" strokeWidth="1.5" />
                  <path d="M 150 135 C 150 155, 270 160, 270 175" strokeWidth="1.5" />
                  <path d="M 390 135 C 390 155, 450 160, 450 175" strokeWidth="1.5" />
                </g>

                <g transform="translate(180, 10)">
                  <rect width="180" height="38" fill="#440A0E" />
                  <text x="90" y="16" textAnchor="middle" fill="#ECD5D3" fontSize="9" fontWeight="600">ON-CHAIN ROOT</text>
                  <text x="90" y="30" textAnchor="middle" fill="#fff" fontSize="10.5" fontFamily="IBM Plex Mono, monospace">
                    {tree.root.slice(0, 8)}…{tree.root.slice(-6)}
                  </text>
                </g>

                {[65, 305].map((x) => (
                  <g key={x} transform={`translate(${x}, 105)`}>
                    <rect width="170" height="30" fill="#FBFAF9" stroke="#DCD3D2" />
                    <text x="85" y="13" textAnchor="middle" fill="#75676A" fontSize="9" fontWeight="600">Branch hash</text>
                    <text x="85" y="24" textAnchor="middle" fill="#75676A" fontSize="8" fontFamily="IBM Plex Mono, monospace">keccak256(left, right)</text>
                  </g>
                ))}

                {treeNodes.slice(0, 3).map((node, i) => {
                  const x = [10, 190, 370][i] ?? 10 + i * 180;
                  const isSelected = node.name === activeActionName;
                  const isSibling = proofSet.has(node.hash.toLowerCase());
                  const fill = isSelected ? "#E1EEE7" : isSibling ? "#F7EBD6" : "#FBFAF9";
                  const stroke = isSelected ? "#2C5A45" : isSibling ? "#9A5B0C" : "#DCD3D2";
                  const tag = isSelected ? "TARGET" : isSibling ? "SIBLING" : "";
                  return (
                    <g key={node.name} transform={`translate(${x}, 175)`}>
                      <rect width="160" height="46" fill={fill} stroke={stroke} strokeWidth={isSelected || isSibling ? 2 : 1} />
                      <text x="10" y="17" fill="#1E1517" fontSize="10.5" fontWeight="600" fontFamily="IBM Plex Mono, monospace">{node.name}</text>
                      {tag && <text x="150" y="16" textAnchor="end" fill={stroke} fontSize="8.5" fontWeight="700">{tag}</text>}
                      <text x="10" y="31" fill="#75676A" fontSize="8" fontFamily="IBM Plex Mono, monospace">id {node.actionId.slice(0, 12)}…</text>
                      <text x="10" y="41" fill="#75676A" fontSize="8" fontFamily="IBM Plex Mono, monospace">leaf {node.hash.slice(0, 12)}…</text>
                    </g>
                  );
                })}
              </svg>
              <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-xs text-mute">
                <span><i className="mr-1.5 inline-block h-2.5 w-2.5 bg-ok align-middle" />Action being proven</span>
                <span><i className="mr-1.5 inline-block h-2.5 w-2.5 bg-warn align-middle" />Sibling hash in the proof</span>
                <span><i className="mr-1.5 inline-block h-2.5 w-2.5 bg-ox-700 align-middle" />Root stored on-chain</span>
              </div>
            </div>

            <details className="group mt-6 border-t border-line pt-4">
              <summary className="cursor-pointer text-sm font-semibold text-ox-600">How each hash is computed</summary>
              <ol className="mt-3 space-y-1.5 break-all font-mono text-xs leading-relaxed text-mute">
                <li>action id = keccak256("{activeActionName}")</li>
                <li>leaf = keccak256(keccak256(abi.encode(action id)))</li>
                <li>parent = keccak256(min(a, b) ‖ max(a, b))</li>
              </ol>
            </details>
          </Section>

          {/* The check */}
          <Section title="Verification" meta={<span className={valid ? "font-semibold text-ok" : "font-semibold text-bad"}>{valid ? "Authorized" : "Rejected"}</span>}>
            <ol className="mt-5 space-y-6">
              <li className="flex gap-4">
                <span className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center bg-ox-600 text-xs font-bold text-white">1</span>
                <div className="min-w-0">
                  <p className="font-semibold">Hash the action</p>
                  <p className="text-sm text-mute">"{activeActionName}" becomes a leaf.</p>
                  <p className="mt-1.5 break-all font-mono text-xs">{leafData?.leafHash ?? "—"}</p>
                </div>
              </li>
              <li className="flex gap-4">
                <span className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center bg-ox-600 text-xs font-bold text-white">2</span>
                <div className="min-w-0 flex-1">
                  <p className="font-semibold">Fold in the sibling hashes</p>
                  {proofList.length === 0 ? (
                    <p className="text-sm text-bad">No proof exists. This action is not in the tree.</p>
                  ) : (
                    <ul className="mt-2 space-y-1.5">
                      {proofList.map((sib, i) => (
                        <li key={sib} className="flex items-baseline gap-3 bg-[#F7EBD6] px-3 py-1.5">
                          <span className="text-xs font-semibold text-warn">#{i + 1}</span>
                          <CopyHash value={sib} className="break-all border-transparent text-left" />
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </li>
              <li className="flex gap-4">
                <span className={clsx("mt-0.5 grid h-6 w-6 shrink-0 place-items-center text-xs font-bold text-white", valid ? "bg-ok" : "bg-bad")}>3</span>
                <div className="min-w-0 flex-1">
                  <p className="font-semibold">Compare with the on-chain root</p>
                  <dl className="mt-2 space-y-2 text-xs">
                    <div>
                      <dt className="text-mute">Computed</dt>
                      <dd className="break-all font-mono">{valid ? tree.root : "0x" + "0".repeat(64)}</dd>
                    </div>
                    <div>
                      <dt className="text-mute">Stored in the contract</dt>
                      <dd className="break-all font-mono">{tree.root}</dd>
                    </div>
                  </dl>
                  <p className={clsx("mt-3 text-sm font-semibold", valid ? "text-ok" : "text-bad")}>
                    {valid ? "They match. The action is authorized." : "They differ. The contract would revert this call."}
                  </p>
                  {verificationResult?.error && <div className="mt-2"><Notice tone="bad">{verificationResult.error}</Notice></div>}
                </div>
              </li>
            </ol>
          </Section>
        </div>
      )}

      <details className="border-t border-line pt-5">
        <summary className="cursor-pointer text-sm font-semibold text-ox-600">Why use a Merkle tree for this?</summary>
        <ul className="mt-3 max-w-[70ch] list-disc space-y-2 pl-5 text-sm leading-relaxed text-mute">
          <li><b className="text-ink">Constant storage.</b> One 32-byte root covers any number of actions.</li>
          <li><b className="text-ink">Cheap checks.</b> A proof needs about log₂ N hashes, so on-chain verification stays inexpensive.</li>
          <li><b className="text-ink">Least privilege.</b> An action that was never listed, such as a prompt-injected fund drain, has no valid proof and fails.</li>
        </ul>
      </details>
    </div>
  );
}
