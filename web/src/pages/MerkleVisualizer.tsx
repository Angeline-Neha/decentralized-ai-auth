import { actionId, buildActionTree, StandardMerkleTree } from "@agentguard/shared/merkle";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { fetchGrant, fetchProof } from "../lib/api";
import { AbiCoder, keccak256 } from "ethers";

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

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col justify-between gap-4 md:flex-row md:items-center">
        <div>
          <div className="flex items-center gap-2">
            <span className="rounded bg-emerald-500/10 px-2 py-0.5 text-xs font-semibold text-emerald-400 border border-emerald-500/30">
              Cryptographic Policy
            </span>
            <h2 className="text-xl font-bold tracking-tight text-slate-100">Merkle Proof Visualizer</h2>
          </div>
          <p className="mt-1 text-sm text-console-muted">
            Interactive zero-knowledge inclusion proof verification for agent capability manifests
          </p>
        </div>

        {/* Grant Selector */}
        <div className="flex items-center gap-3">
          <label className="text-xs font-semibold uppercase tracking-wider text-console-muted">Grant ID</label>
          <input
            className="input w-24 text-center font-mono"
            type="number"
            min={1}
            value={grantId}
            onChange={(e) => setGrantId(Number(e.target.value))}
          />
        </div>
      </div>

      {/* Overview Cards */}
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="panel p-4">
          <div className="text-xs uppercase font-semibold text-console-muted">On-Chain Root (Storage)</div>
          <div className="mt-1 break-all font-mono text-xs text-cyan-300">
            {tree ? tree.root : "No manifest loaded"}
          </div>
          <p className="mt-2 text-[11px] text-console-muted">
            Single 32-byte hash committed to smart contract (O(1) storage)
          </p>
        </div>

        <div className="panel p-4">
          <div className="text-xs uppercase font-semibold text-console-muted">Manifest Actions (Leaves)</div>
          <div className="mt-1 font-mono text-lg font-bold text-slate-200">
            {actions.length} Authorized Actions
          </div>
          <div className="mt-2 flex flex-wrap gap-1">
            {actions.map((a) => (
              <span key={a} className="rounded bg-slate-800 px-1.5 py-0.5 font-mono text-[10px] text-slate-300">
                {a}
              </span>
            ))}
          </div>
        </div>

        <div className="panel p-4">
          <div className="text-xs uppercase font-semibold text-console-muted">Proof Complexity</div>
          <div className="mt-1 font-mono text-lg font-bold text-amber-400">
            {proofList.length} Sibling Hashes (O(log₂ N))
          </div>
          <p className="mt-2 text-[11px] text-console-muted">
            Proves membership without revealing other unauthorized capabilities
          </p>
        </div>
      </div>

      {/* Action Selector & Tamper Test */}
      <div className="panel p-4">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <h3 className="text-sm font-semibold text-slate-200">Select Capability to Verify</h3>
            <p className="text-xs text-console-muted">
              Choose an authorized action from the manifest or test an unauthorized capability
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="flex rounded-lg border border-console-border bg-black/40 p-1">
              <button
                type="button"
                onClick={() => setTestMode("whitelisted")}
                className={`rounded px-3 py-1 text-xs font-medium transition ${
                  testMode === "whitelisted" ? "bg-emerald-500/20 text-emerald-300 font-bold" : "text-console-muted hover:text-slate-200"
                }`}
              >
                Whitelisted Action
              </button>
              <button
                type="button"
                onClick={() => {
                  setTestMode("custom");
                  if (!customAction) setCustomAction("transfer_funds");
                }}
                className={`rounded px-3 py-1 text-xs font-medium transition ${
                  testMode === "custom" ? "bg-red-500/20 text-red-300 font-bold" : "text-console-muted hover:text-slate-200"
                }`}
              >
                Test Unauthorized Action
              </button>
            </div>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-3">
          {testMode === "whitelisted" ? (
            <div className="flex flex-wrap gap-2">
              {actions.map((act) => (
                <button
                  key={act}
                  type="button"
                  onClick={() => setSelectedAction(act)}
                  className={`rounded-lg border px-3 py-1.5 font-mono text-xs transition ${
                    selectedAction === act
                      ? "border-emerald-500 bg-emerald-500/15 text-emerald-200 font-semibold shadow-sm"
                      : "border-console-border bg-slate-900/60 text-slate-300 hover:border-slate-600"
                  }`}
                >
                  {act}
                </button>
              ))}
            </div>
          ) : (
            <div className="flex w-full flex-wrap gap-2">
              <input
                type="text"
                placeholder="e.g. transfer_funds, drain_vault, execute_shell"
                value={customAction}
                onChange={(e) => setCustomAction(e.target.value)}
                className="input flex-1 font-mono text-sm"
              />
              <div className="flex gap-2">
                {["transfer_funds", "drain_escrow", "delegate_admin"].map((preset) => (
                  <button
                    key={preset}
                    type="button"
                    onClick={() => setCustomAction(preset)}
                    className="btn-ghost text-xs font-mono"
                  >
                    +{preset}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Main Visualizer Area */}
      {tree && (
        <div className="grid gap-6 lg:grid-cols-12">
          {/* Left Column: Interactive Visual Tree Diagram */}
          <div className="panel p-5 lg:col-span-7 flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-semibold text-slate-200">Merkle Tree Architecture</h3>
                  <p className="text-xs text-console-muted">Binary hash tree computed over manifest action identifiers</p>
                </div>
                <div className="flex items-center gap-3 text-[11px]">
                  <span className="flex items-center gap-1.5">
                    <span className="h-2.5 w-2.5 rounded-full bg-emerald-400 inline-block" /> Target Leaf
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="h-2.5 w-2.5 rounded-full bg-amber-400 inline-block" /> Sibling Proof
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="h-2.5 w-2.5 rounded-full bg-cyan-400 inline-block" /> Root
                  </span>
                </div>
              </div>

              {/* Clean SVG-Based Hierarchical Merkle Tree */}
              <div className="mt-5 rounded-xl border border-console-border bg-black/40 p-4">
                <svg viewBox="0 0 540 230" className="w-full h-auto">
                  {/* Connectors from Root (270, 42) to Branches (150, 115) and (390, 115) */}
                  <path d="M 270 45 C 270 80, 150 80, 150 105" fill="none" stroke="#475569" strokeWidth="2" />
                  <path d="M 270 45 C 270 80, 390 80, 390 105" fill="none" stroke="#475569" strokeWidth="2" />

                  {/* Connectors from Branches to Leaves */}
                  <path d="M 150 135 C 150 155, 90 160, 90 175" fill="none" stroke="#475569" strokeWidth="1.5" />
                  <path d="M 150 135 C 150 155, 220 160, 220 175" fill="none" stroke="#475569" strokeWidth="1.5" />
                  <path d="M 390 135 C 390 155, 450 160, 450 175" fill="none" stroke="#475569" strokeWidth="1.5" />

                  {/* Root Node Box */}
                  <g transform="translate(180, 10)">
                    <rect width="180" height="38" rx="6" fill="#083344" stroke="#06b6d4" strokeWidth="1.5" />
                    <text x="90" y="16" textAnchor="middle" fill="#22d3ee" fontSize="9" fontWeight="bold" letterSpacing="0.5">
                      ON-CHAIN ACTIONSROOT
                    </text>
                    <text x="90" y="29" textAnchor="middle" fill="#e2e8f0" fontSize="10" fontFamily="monospace">
                      {tree.root.slice(0, 8)}…{tree.root.slice(-6)}
                    </text>
                  </g>

                  {/* Intermediate Branch Left */}
                  <g transform="translate(65, 105)">
                    <rect width="170" height="30" rx="5" fill="#0f172a" stroke="#334155" strokeWidth="1" />
                    <text x="85" y="15" textAnchor="middle" fill="#94a3b8" fontSize="8">
                      Internal Branch Hash
                    </text>
                    <text x="85" y="24" textAnchor="middle" fill="#64748b" fontSize="7.5" fontFamily="monospace">
                      keccak256(Left || Right)
                    </text>
                  </g>

                  {/* Intermediate Branch Right */}
                  <g transform="translate(305, 105)">
                    <rect width="170" height="30" rx="5" fill="#0f172a" stroke="#334155" strokeWidth="1" />
                    <text x="85" y="15" textAnchor="middle" fill="#94a3b8" fontSize="8">
                      Internal Branch Hash
                    </text>
                    <text x="85" y="24" textAnchor="middle" fill="#64748b" fontSize="7.5" fontFamily="monospace">
                      keccak256(Left || Right)
                    </text>
                  </g>

                  {/* Leaf Nodes */}
                  {treeNodes.slice(0, 3).map((node, i) => {
                    const xPositions = [10, 140, 370];
                    const x = xPositions[i] ?? 10 + i * 160;
                    const isSelected = node.name === activeActionName;
                    const isSibling = proofSet.has(node.hash.toLowerCase());

                    let strokeColor = "#334155";
                    let fillColor = "#0f172a";
                    let tagText = "";
                    let tagFill = "";

                    if (isSelected) {
                      strokeColor = "#10b981";
                      fillColor = "#064e3b";
                      tagText = "TARGET";
                      tagFill = "#34d399";
                    } else if (isSibling) {
                      strokeColor = "#f59e0b";
                      fillColor = "#451a03";
                      tagText = "SIBLING";
                      tagFill = "#fbbf24";
                    }

                    return (
                      <g key={node.name} transform={`translate(${x}, 175)`} className="cursor-pointer">
                        <rect width="160" height="46" rx="5" fill={fillColor} stroke={strokeColor} strokeWidth="1.5" />
                        <text x="10" y="16" fill="#f8fafc" fontSize="10" fontWeight="bold">
                          {node.name}
                        </text>
                        {tagText && (
                          <text x="150" y="15" textAnchor="end" fill={tagFill} fontSize="8" fontWeight="bold">
                            {tagText}
                          </text>
                        )}
                        <text x="10" y="29" fill="#94a3b8" fontSize="8" fontFamily="monospace">
                          ID: {node.actionId.slice(0, 10)}…
                        </text>
                        <text x="10" y="39" fill="#64748b" fontSize="7.5" fontFamily="monospace">
                          Leaf: {node.hash.slice(0, 12)}…
                        </text>
                      </g>
                    );
                  })}
                </svg>
              </div>
            </div>

            {/* Cryptographic Formula Breakdown */}
            <div className="mt-4 rounded-lg border border-console-border bg-black/20 p-3 text-xs">
              <div className="font-semibold text-slate-300">Mathematical leaf computation:</div>
              <div className="mt-1 font-mono text-[11px] text-emerald-400 break-all">
                1. a_i = keccak256(UTF8("{activeActionName}"))
              </div>
              <div className="font-mono text-[11px] text-emerald-400 break-all">
                2. Leaf = keccak256(keccak256(abi.encode(a_i)))
              </div>
              <div className="font-mono text-[11px] text-emerald-400 break-all">
                3. Parent = keccak256(min(Node_A, Node_B) || max(Node_A, Node_B))
              </div>
            </div>
          </div>

          {/* Right Column: Step-by-Step On-Chain Verification & Sibling Proofs */}
          <div className="space-y-4 lg:col-span-5 min-w-0">
            {/* Proof Path Breakdown Panel */}
            <div className="panel p-5 min-w-0">
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-sm font-semibold text-slate-200">On-Chain Verification Trace</h3>
                <span
                  className={`shrink-0 rounded px-2 py-0.5 text-xs font-bold ${
                    verificationResult?.valid
                      ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/40"
                      : "bg-red-500/20 text-red-300 border border-red-500/40"
                  }`}
                >
                  {verificationResult?.valid ? "✅ PROOF VALID (AUTHORIZED)" : "❌ PROOF INVALID (REVERTED)"}
                </span>
              </div>

              <p className="mt-1 text-xs text-console-muted">
                Simulating OpenZeppelin <code className="text-slate-300">MerkleProof.verify(proof, root, leaf)</code>
              </p>

              {/* Step by Step Breakdown */}
              <div className="mt-4 space-y-3 min-w-0">
                {/* Step 1: Leaf Hash */}
                <div className="rounded border border-console-border bg-slate-900/70 p-3 text-xs min-w-0">
                  <div className="flex items-center justify-between font-semibold text-slate-300">
                    <span>Step 1: Compute Target Leaf Hash</span>
                    <span className="font-mono text-[10px] text-emerald-400">keccak256</span>
                  </div>
                  <div className="mt-1 font-mono text-[11px] break-all text-slate-400">
                    Action: <span className="text-slate-200 font-bold">"{activeActionName}"</span>
                  </div>
                  <div className="mt-1 font-mono text-[10px] break-all text-emerald-300/90 leading-relaxed">
                    Leaf: {leafData?.leafHash ?? "—"}
                  </div>
                </div>

                {/* Step 2: Sibling Proof Path */}
                <div className="rounded border border-console-border bg-slate-900/70 p-3 text-xs min-w-0">
                  <div className="flex items-center justify-between font-semibold text-slate-300">
                    <span>Step 2: Fold Sibling Proof Path</span>
                    <span className="font-mono text-[10px] text-amber-400">{proofList.length} sibling(s)</span>
                  </div>
                  {proofList.length === 0 ? (
                    <div className="mt-2 text-xs text-red-300 font-mono">
                      No sibling proofs available. Action not present in tree.
                    </div>
                  ) : (
                    <div className="mt-2 space-y-1.5">
                      {proofList.map((sib, i) => (
                        <div
                          key={sib}
                          className="flex flex-col gap-0.5 rounded bg-amber-500/10 p-2 font-mono text-[10px] text-amber-200 border border-amber-500/30"
                        >
                          <span className="font-bold text-amber-300">Sibling #{i + 1}</span>
                          <span className="break-all text-amber-100/90 leading-tight">{sib}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Step 3: Root Comparison */}
                <div
                  className={`rounded border p-3 text-xs min-w-0 ${
                    verificationResult?.valid
                      ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-200"
                      : "border-red-500/40 bg-red-500/10 text-red-200"
                  }`}
                >
                  <div className="font-semibold text-slate-200">
                    Step 3: Root Equality Check
                  </div>
                  <div className="mt-2 font-mono text-[10px] space-y-2 min-w-0">
                    <div className="rounded bg-black/30 p-2 border border-console-border min-w-0">
                      <div className="text-[9px] uppercase text-console-muted">Computed Root</div>
                      <div className="mt-0.5 break-all text-slate-200 leading-tight">
                        {verificationResult?.valid ? tree.root : "0x0000000000000000000000000000000000000000000000000000000000000000"}
                      </div>
                    </div>
                    <div className="rounded bg-black/30 p-2 border border-console-border min-w-0">
                      <div className="text-[9px] uppercase text-console-muted">Expected Root (On-Chain)</div>
                      <div className="mt-0.5 break-all text-cyan-300 leading-tight">
                        {tree.root}
                      </div>
                    </div>
                  </div>
                  {verificationResult?.error && (
                    <div className="mt-2 rounded bg-red-950/80 p-2 text-[11px] text-red-200 border border-red-800 break-words">
                      {verificationResult.error}
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Academic Viva Context */}
            <div className="panel p-4 text-xs text-console-muted">
              <h4 className="font-semibold text-slate-300">Why Merkle Trees for Agent Sandboxing?</h4>
              <ul className="mt-2 list-disc space-y-1 pl-4">
                <li>
                  <strong className="text-slate-300">Constant Storage Cost (O(1)):</strong> Storing a single 32-byte root allows thousands of permissioned actions without bloat.
                </li>
                <li>
                  <strong className="text-slate-300">Sublinear Verification (O(log N)):</strong> Inclusion is proven on-chain with minimal gas.
                </li>
                <li>
                  <strong className="text-slate-300">Least Privilege:</strong> Unlisted actions like prompt-injected fund drains fail proof validation instantly at the gateway or contract.
                </li>
              </ul>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
