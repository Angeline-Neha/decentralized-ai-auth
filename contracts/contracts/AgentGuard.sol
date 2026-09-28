// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {MerkleProof} from "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title AgentGuard
 * @notice On-chain policy enforcement for AI agents. The agent holds only a keypair.
 *         It signs EIP-712 "intents"; anyone (normally a relayer/gateway) submits them.
 *         The contract checks the owner's policy and either executes or records a denial.
 *
 * Design rules:
 *  - Policy violations by a VALIDLY SIGNED intent do NOT revert. They emit Denied, add a
 *    strike, and may freeze the grant. (A revert would roll back the strike.)
 *  - Unattributable failures (bad signature, stale nonce, expired deadline) DO revert and
 *    add no strike, so nobody can grief an agent into a freeze by replaying old signatures.
 *  - Every outcome is appended to a single hash-chain (auditHead) for tamper evidence.
 */
contract AgentGuard is EIP712, ReentrancyGuard {
    // ───────────────────────────── Types ─────────────────────────────

    enum Status { Active, Frozen, Revoked }

    /// @dev 0 = executed. Non-zero values are denial reasons (also used as audit code).
    enum Reason {
        None,
        Frozen,
        Revoked,
        Expired,
        ActionNotAllowed,
        OverCap,
        RateLimit,
        OverBudget,
        InsufficientEscrow,
        DelegationInvalid
    }

    struct GrantParams {
        address agent;
        bytes32 actionsRoot;        // Merkle root of allowed actionIds
        uint256 perCallCap;         // max amount per single intent
        uint256 totalBudget;        // lifetime spend limit
        uint32 maxCallsPerWindow;   // rate limit
        uint64 windowSeconds;       // rate-limit window length
        uint64 expiry;              // grant dies at this timestamp
        uint256 approvalThreshold;  // Phase 2: amounts above this need owner approval
        uint32 maxStrikes;          // circuit breaker trips at this many strikes
    }

    struct Grant {
        address owner;
        address agent;
        uint256 parentId;           // 0 = root grant
        bytes32 actionsRoot;
        uint256 perCallCap;
        uint256 totalBudget;
        uint256 spent;
        uint256 escrow;             // ETH held for this grant
        uint256 approvalThreshold;
        uint64 windowSeconds;
        uint64 windowStart;
        uint64 expiry;
        uint32 maxCallsPerWindow;
        uint32 callsInWindow;
        uint32 strikes;
        uint32 maxStrikes;
        uint8 depth;                // 0 = root grant
        Status status;
    }

    /// @dev What the agent signs. `paramsHash` commits to off-chain request details
    ///      (e.g. the email body) without putting them on-chain.
    struct Intent {
        uint256 grantId;
        bytes32 actionId;           // keccak256(bytes(actionName))
        address payee;              // address(0) = no ETH transfer (metered/off-chain action)
        uint256 amount;             // spend accounted against caps/budget (wei)
        bytes32 paramsHash;
        uint256 nonce;
        uint256 deadline;           // intent is invalid after this timestamp
    }

    enum PendingStatus { None, Pending, Approved, Rejected }

    /// @dev A high-value intent parked until the owner approves or rejects it.
    struct Pending {
        uint256 grantId;
        uint256 nonce;
        bytes32 actionId;
        address payee;
        uint256 amount;
        bytes32 paramsHash;
        uint64 expiresAt;
        PendingStatus status;
    }

    /// @dev Policy for a sub-grant. Must be a subset of the parent's (checked in delegate()).
    struct Policy {
        bytes32 actionsRoot;
        uint256 perCallCap;
        uint256 totalBudget;
        uint32 maxCallsPerWindow;
        uint64 windowSeconds;
        uint64 expiry;
        uint256 approvalThreshold;
        uint32 maxStrikes;
    }

    /// @dev Signed by the PARENT agent. Nonce comes from the parent grant's nonce sequence.
    struct Delegation {
        uint256 parentId;
        address childAgent;
        Policy policy;
        uint256 escrowShare;        // ETH carved out of the parent's escrow
        uint256 nonce;
        uint256 deadline;
    }

    // ───────────────────────────── Storage ─────────────────────────────

    bytes32 public constant INTENT_TYPEHASH = keccak256(
        "Intent(uint256 grantId,bytes32 actionId,address payee,uint256 amount,bytes32 paramsHash,uint256 nonce,uint256 deadline)"
    );

    uint256 public nextGrantId = 1;
    mapping(uint256 => Grant) private grants;
    mapping(uint256 => uint256) public nonces; // grantId => next expected nonce

    bytes32 public auditHead;   // head of the tamper-evident hash chain
    uint256 public auditCount;

    uint8 public constant MAX_DEPTH = 3;                 // root = depth 0
    uint64 public constant APPROVAL_WINDOW = 1 days;

    // Audit codes 1..9 are Reason values; 0 = executed. These are lifecycle codes.
    uint8 public constant CODE_PENDING = 100;
    uint8 public constant CODE_APPROVED = 101;
    uint8 public constant CODE_REJECTED = 102;
    uint8 public constant CODE_DELEGATED = 103;

    bytes32 public constant POLICY_TYPEHASH = keccak256(
        "Policy(bytes32 actionsRoot,uint256 perCallCap,uint256 totalBudget,uint32 maxCallsPerWindow,uint64 windowSeconds,uint64 expiry,uint256 approvalThreshold,uint32 maxStrikes)"
    );
    bytes32 public constant DELEGATION_TYPEHASH = keccak256(
        "Delegation(uint256 parentId,address childAgent,Policy policy,uint256 escrowShare,uint256 nonce,uint256 deadline)Policy(bytes32 actionsRoot,uint256 perCallCap,uint256 totalBudget,uint32 maxCallsPerWindow,uint64 windowSeconds,uint64 expiry,uint256 approvalThreshold,uint32 maxStrikes)"
    );

    uint256 public nextPendingId = 1;
    mapping(uint256 => Pending) private pendings;

    // ───────────────────────────── Events ─────────────────────────────

    event GrantCreated(
        uint256 indexed grantId,
        address indexed owner,
        address indexed agent,
        bytes32 actionsRoot,
        uint256 escrow,
        uint64 expiry
    );
    event Executed(
        uint256 indexed grantId,
        uint256 indexed nonce,
        bytes32 indexed actionId,
        address payee,
        uint256 amount
    );
    event Denied(
        uint256 indexed grantId,
        uint256 indexed nonce,
        bytes32 indexed actionId,
        Reason reason,
        uint32 strikes
    );
    event Frozen(uint256 indexed grantId);
    event Unfrozen(uint256 indexed grantId);
    event Revoked(uint256 indexed grantId, uint256 refunded);
    event ToppedUp(uint256 indexed grantId, uint256 amount);
    event PendingCreated(
        uint256 indexed pendingId,
        uint256 indexed grantId,
        uint256 nonce,
        bytes32 indexed actionId,
        address payee,
        uint256 amount,
        uint64 expiresAt
    );
    event PendingApproved(uint256 indexed pendingId);
    event PendingRejected(uint256 indexed pendingId);
    event Delegated(
        uint256 indexed parentId,
        uint256 indexed childId,
        address indexed childAgent,
        uint256 budget,
        uint256 escrowShare
    );
    event AuditAppended(
        uint256 indexed index,
        uint256 indexed grantId,
        bytes32 actionId,
        uint256 amount,
        bytes32 paramsHash,
        uint8 code,
        bytes32 head
    );

    // ───────────────────────────── Errors ─────────────────────────────

    error GrantNotFound();
    error NotGrantOwner();
    error InvalidParams();
    error WrongStatus();
    error BadSignature();
    error BadNonce();
    error IntentExpired();
    error PaymentFailed();
    error ApprovalExpired();
    error ApprovalBlocked(Reason reason);

    // ───────────────────────────── Constructor ─────────────────────────────

    constructor() EIP712("AgentGuard", "1") {}

    // ───────────────────────────── Owner functions ─────────────────────────────

    /// @notice Create a grant for an agent. Any ETH sent becomes the grant's escrow.
    function createGrant(GrantParams calldata p) external payable returns (uint256 id) {
        if (
            p.agent == address(0) ||
            p.expiry <= block.timestamp ||
            p.maxStrikes == 0 ||
            p.maxCallsPerWindow == 0 ||
            p.windowSeconds == 0
        ) revert InvalidParams();

        id = nextGrantId++;
        Grant storage g = grants[id];
        g.owner = msg.sender;
        g.agent = p.agent;
        g.actionsRoot = p.actionsRoot;
        g.perCallCap = p.perCallCap;
        g.totalBudget = p.totalBudget;
        g.escrow = msg.value;
        g.approvalThreshold = p.approvalThreshold;
        g.windowSeconds = p.windowSeconds;
        g.expiry = p.expiry;
        g.maxCallsPerWindow = p.maxCallsPerWindow;
        g.maxStrikes = p.maxStrikes;
        g.status = Status.Active;

        emit GrantCreated(id, msg.sender, p.agent, p.actionsRoot, msg.value, p.expiry);
    }

    function topUp(uint256 grantId) external payable {
        Grant storage g = _ownedGrant(grantId);
        if (g.status == Status.Revoked) revert WrongStatus();
        g.escrow += msg.value;
        emit ToppedUp(grantId, msg.value);
    }

    /// @notice Instant kill switch. Refunds remaining escrow to the owner.
    function revoke(uint256 grantId) external nonReentrant {
        Grant storage g = _ownedGrant(grantId);
        if (g.status == Status.Revoked) revert WrongStatus();

        g.status = Status.Revoked;
        uint256 refund = g.escrow;
        g.escrow = 0;
        emit Revoked(grantId, refund);

        if (refund > 0) {
            (bool ok, ) = msg.sender.call{value: refund}("");
            if (!ok) revert PaymentFailed();
        }
    }

    /// @notice Owner clears strikes and re-activates a frozen grant.
    function unfreeze(uint256 grantId) external {
        Grant storage g = _ownedGrant(grantId);
        if (g.status != Status.Frozen) revert WrongStatus();
        g.status = Status.Active;
        g.strikes = 0;
        emit Unfrozen(grantId);
    }

    // ───────────────────────────── Agent intents ─────────────────────────────

    /**
     * @notice Submit an agent-signed intent. Callable by anyone (relayer). The signature,
     *         not msg.sender, authenticates the agent.
     * @param proofs proofs[k] = Merkle proof of the action against the k-th grant up the
     *               delegation chain (0 = this grant, 1 = its parent, ...).
     */
    function execute(
        Intent calldata i,
        bytes calldata sig,
        bytes32[][] calldata proofs
    ) external nonReentrant returns (Reason) {
        Grant storage g = grants[i.grantId];
        if (g.owner == address(0)) revert GrantNotFound();

        // 1. Unattributable failures revert (no strike, no state change).
        if (i.deadline < block.timestamp) revert IntentExpired();
        if (_signer(i, sig) != g.agent) revert BadSignature();
        if (i.nonce != nonces[i.grantId]) revert BadNonce();

        // 2. Consume the nonce even if the intent is denied, so it can never be replayed.
        nonces[i.grantId] = i.nonce + 1;

        // 3. Evaluate policy.
        (Reason r, bool strike) = _evaluate(g, i, proofs);

        if (r != Reason.None) {
            if (strike) _addStrike(i.grantId, g);
            emit Denied(i.grantId, i.nonce, i.actionId, r, g.strikes);
            _appendAudit(i.grantId, i.actionId, i.amount, i.paramsHash, uint8(r));
            return r;
        }

        // 4. Accepted: count toward the rate limit (parked intents count too, so a
        //    compromised agent cannot spam the approval queue).
        _countCall(g);

        // 5a. High-value: park for owner approval instead of executing.
        if (i.amount > g.approvalThreshold) {
            _park(i);
            return Reason.None;
        }

        // 5b. Execute (effects first, ETH transfer last).
        _settle(g, i.payee, i.amount);

        emit Executed(i.grantId, i.nonce, i.actionId, i.payee, i.amount);
        _appendAudit(i.grantId, i.actionId, i.amount, i.paramsHash, 0);
        return Reason.None;
    }

    // ───────────────────────────── Approval queue ─────────────────────────────

    /// @notice Owner approves a parked intent. Policy is re-checked at approval time.
    function approve(uint256 pendingId) external nonReentrant {
        Pending storage pd = pendings[pendingId];
        if (pd.status != PendingStatus.Pending) revert WrongStatus();
        Grant storage g = _ownedGrant(pd.grantId);
        if (block.timestamp > pd.expiresAt) revert ApprovalExpired();

        Reason r = _chainReason(pd.grantId);
        if (r == Reason.None && g.spent + pd.amount > g.totalBudget) r = Reason.OverBudget;
        if (r == Reason.None && pd.payee != address(0) && pd.amount > g.escrow) {
            r = Reason.InsufficientEscrow;
        }
        if (r != Reason.None) revert ApprovalBlocked(r);

        pd.status = PendingStatus.Approved;
        _settle(g, pd.payee, pd.amount);

        emit PendingApproved(pendingId);
        emit Executed(pd.grantId, pd.nonce, pd.actionId, pd.payee, pd.amount);
        _appendAudit(pd.grantId, pd.actionId, pd.amount, pd.paramsHash, CODE_APPROVED);
    }

    function reject(uint256 pendingId) external {
        Pending storage pd = pendings[pendingId];
        if (pd.status != PendingStatus.Pending) revert WrongStatus();
        _ownedGrant(pd.grantId);

        pd.status = PendingStatus.Rejected;
        emit PendingRejected(pendingId);
        _appendAudit(pd.grantId, pd.actionId, pd.amount, pd.paramsHash, CODE_REJECTED);
    }

    // ───────────────────────────── Sub-delegation ─────────────────────────────

    /**
     * @notice A parent agent creates a strictly narrower sub-grant for a child agent.
     *         Callable by anyone (relayer); the PARENT agent's EIP-712 signature authorises it.
     *         A validly signed but over-broad delegation is denied (with a strike), not reverted.
     * @return childId new grant id, or 0 if denied
     */
    function delegate(Delegation calldata d, bytes calldata sig) external returns (uint256 childId) {
        Grant storage p = grants[d.parentId];
        if (p.owner == address(0)) revert GrantNotFound();

        if (d.deadline < block.timestamp) revert IntentExpired();
        if (_delegationSigner(d, sig) != p.agent) revert BadSignature();
        if (d.nonce != nonces[d.parentId]) revert BadNonce();
        nonces[d.parentId] = d.nonce + 1;

        Reason r = _chainReason(d.parentId);
        bool strike;
        if (r == Reason.None && !_delegationValid(p, d)) {
            r = Reason.DelegationInvalid;
            strike = true;
        }
        if (r != Reason.None) {
            if (strike) _addStrike(d.parentId, p);
            emit Denied(d.parentId, d.nonce, bytes32(0), r, p.strikes);
            _appendAudit(d.parentId, bytes32(0), d.policy.totalBudget, bytes32(0), uint8(r));
            return 0;
        }
        return _createChild(p, d);
    }

    function getPending(uint256 pendingId) external view returns (Pending memory) {
        return pendings[pendingId];
    }

    // ───────────────────────────── Views ─────────────────────────────

    function getGrant(uint256 grantId) external view returns (Grant memory) {
        return grants[grantId];
    }

    /// @notice EIP-712 digest for an intent. Useful for cross-checking off-chain signers.
    function hashIntent(Intent calldata i) external view returns (bytes32) {
        return _digest(i);
    }

    function domainSeparator() external view returns (bytes32) {
        return _domainSeparatorV4();
    }

    // ───────────────────────────── Internals ─────────────────────────────

    function _ownedGrant(uint256 grantId) internal view returns (Grant storage g) {
        g = grants[grantId];
        if (g.owner == address(0)) revert GrantNotFound();
        if (g.owner != msg.sender) revert NotGrantOwner();
    }

    function _digest(Intent calldata i) internal view returns (bytes32) {
        return _hashTypedDataV4(
            keccak256(
                abi.encode(
                    INTENT_TYPEHASH,
                    i.grantId,
                    i.actionId,
                    i.payee,
                    i.amount,
                    i.paramsHash,
                    i.nonce,
                    i.deadline
                )
            )
        );
    }

    function _signer(Intent calldata i, bytes calldata sig) internal view returns (address) {
        (address recovered, ECDSA.RecoverError err, ) = ECDSA.tryRecover(_digest(i), sig);
        if (err != ECDSA.RecoverError.NoError) revert BadSignature();
        return recovered;
    }

    /// @dev Returns (reason, shouldStrike). Order matters: cheap state checks first, then
    ///      checks that indicate agent misbehaviour (which earn strikes).
    function _evaluate(
        Grant storage g,
        Intent calldata i,
        bytes32[][] calldata proofs
    ) internal view returns (Reason, bool) {
        Reason chain = _chainReason(i.grantId);
        if (chain != Reason.None) return (chain, false);

        if (!_actionAllowed(g, i.actionId, proofs)) return (Reason.ActionNotAllowed, true);
        if (i.amount > g.perCallCap) return (Reason.OverCap, true);

        uint32 calls = block.timestamp >= uint256(g.windowStart) + g.windowSeconds
            ? 0
            : g.callsInWindow;
        if (calls >= g.maxCallsPerWindow) return (Reason.RateLimit, true);

        if (g.spent + i.amount > g.totalBudget) return (Reason.OverBudget, true);

        // Not the agent's fault, so no strike.
        if (i.payee != address(0) && i.amount > g.escrow) return (Reason.InsufficientEscrow, false);

        return (Reason.None, false);
    }

    /// @dev Leaf format matches @openzeppelin/merkle-tree StandardMerkleTree with ["bytes32"]:
    ///      keccak256(bytes.concat(keccak256(abi.encode(actionId)))). The double hash prevents
    ///      second-preimage attacks (an internal node can never be mistaken for a leaf).
    function _actionAllowed(
        Grant storage g,
        bytes32 actionId,
        bytes32[][] calldata proofs
    ) internal view returns (bool) {
        if (proofs.length < uint256(g.depth) + 1) return false;
        bytes32 leaf = keccak256(bytes.concat(keccak256(abi.encode(actionId))));
        Grant storage cur = g;
        // The action must be whitelisted by this grant AND every ancestor (intersection).
        for (uint256 k = 0; k <= g.depth; k++) {
            if (!MerkleProof.verifyCalldata(proofs[k], cur.actionsRoot, leaf)) return false;
            cur = grants[cur.parentId];
        }
        return true;
    }

    /// @dev Walks the grant and all its ancestors; any dead link kills the whole subtree.
    function _chainReason(uint256 grantId) internal view returns (Reason) {
        uint256 id = grantId;
        while (id != 0) {
            Grant storage g = grants[id];
            if (g.status == Status.Revoked) return Reason.Revoked;
            if (g.status == Status.Frozen) return Reason.Frozen;
            if (block.timestamp >= g.expiry) return Reason.Expired;
            id = g.parentId;
        }
        return Reason.None;
    }

    function _countCall(Grant storage g) internal {
        if (block.timestamp >= uint256(g.windowStart) + g.windowSeconds) {
            g.windowStart = uint64(block.timestamp);
            g.callsInWindow = 0;
        }
        g.callsInWindow += 1;
    }

    /// @dev Effects, then the ETH transfer (checks-effects-interactions).
    function _settle(Grant storage g, address payee, uint256 amount) internal {
        g.spent += amount;
        if (payee != address(0) && amount > 0) {
            g.escrow -= amount;
            (bool ok, ) = payee.call{value: amount}("");
            if (!ok) revert PaymentFailed();
        }
    }

    function _park(Intent calldata i) internal {
        uint256 pid = nextPendingId++;
        uint64 expiresAt = uint64(block.timestamp + APPROVAL_WINDOW);
        pendings[pid] = Pending({
            grantId: i.grantId,
            nonce: i.nonce,
            actionId: i.actionId,
            payee: i.payee,
            amount: i.amount,
            paramsHash: i.paramsHash,
            expiresAt: expiresAt,
            status: PendingStatus.Pending
        });
        emit PendingCreated(pid, i.grantId, i.nonce, i.actionId, i.payee, i.amount, expiresAt);
        _appendAudit(i.grantId, i.actionId, i.amount, i.paramsHash, CODE_PENDING);
    }

    function _hashPolicy(Policy calldata q) internal pure returns (bytes32) {
        return keccak256(
            abi.encode(
                POLICY_TYPEHASH,
                q.actionsRoot,
                q.perCallCap,
                q.totalBudget,
                q.maxCallsPerWindow,
                q.windowSeconds,
                q.expiry,
                q.approvalThreshold,
                q.maxStrikes
            )
        );
    }

    function _delegationSigner(Delegation calldata d, bytes calldata sig) internal view returns (address) {
        bytes32 digest = _hashTypedDataV4(
            keccak256(
                abi.encode(
                    DELEGATION_TYPEHASH,
                    d.parentId,
                    d.childAgent,
                    _hashPolicy(d.policy),
                    d.escrowShare,
                    d.nonce,
                    d.deadline
                )
            )
        );
        (address recovered, ECDSA.RecoverError err, ) = ECDSA.tryRecover(digest, sig);
        if (err != ECDSA.RecoverError.NoError) revert BadSignature();
        return recovered;
    }

    /// @dev Attenuation rules: a child can only be narrower than its parent.
    function _delegationValid(Grant storage p, Delegation calldata d) internal view returns (bool) {
        Policy calldata q = d.policy;
        if (d.childAgent == address(0) || q.maxStrikes == 0 || q.maxCallsPerWindow == 0 || q.windowSeconds == 0) {
            return false;
        }
        if (p.depth + 1 > MAX_DEPTH) return false;
        if (q.perCallCap > p.perCallCap) return false;
        if (q.expiry > p.expiry || q.expiry <= block.timestamp) return false;
        if (q.approvalThreshold > p.approvalThreshold) return false;
        if (q.totalBudget > p.totalBudget - p.spent) return false;
        if (d.escrowShare > p.escrow) return false;
        return true;
    }

    /// @dev Carves budget and escrow out of the parent, so the subtree can never spend
    ///      more than the parent was allowed.
    function _createChild(Grant storage p, Delegation calldata d) internal returns (uint256 childId) {
        Policy calldata q = d.policy;
        childId = nextGrantId++;
        Grant storage c = grants[childId];
        c.owner = p.owner;
        c.agent = d.childAgent;
        c.parentId = d.parentId;
        c.depth = p.depth + 1;
        c.actionsRoot = q.actionsRoot;
        c.perCallCap = q.perCallCap;
        c.totalBudget = q.totalBudget;
        c.escrow = d.escrowShare;
        c.approvalThreshold = q.approvalThreshold;
        c.windowSeconds = q.windowSeconds;
        c.expiry = q.expiry;
        c.maxCallsPerWindow = q.maxCallsPerWindow;
        c.maxStrikes = q.maxStrikes;
        c.status = Status.Active;

        p.spent += q.totalBudget;
        p.escrow -= d.escrowShare;

        emit Delegated(d.parentId, childId, d.childAgent, q.totalBudget, d.escrowShare);
        _appendAudit(childId, bytes32(0), q.totalBudget, bytes32(d.parentId), CODE_DELEGATED);
    }

    function _addStrike(uint256 grantId, Grant storage g) internal {
        g.strikes += 1;
        if (g.strikes >= g.maxStrikes) {
            g.status = Status.Frozen;
            emit Frozen(grantId);
        }
    }

    function _appendAudit(
        uint256 grantId,
        bytes32 actionId,
        uint256 amount,
        bytes32 paramsHash,
        uint8 code
    ) internal {
        auditHead = keccak256(
            abi.encode(auditHead, grantId, actionId, amount, paramsHash, code, block.number)
        );
        emit AuditAppended(auditCount, grantId, actionId, amount, paramsHash, code, auditHead);
        auditCount++;
    }
}
