// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {SignatureChecker} from "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";
import {MerkleProof} from "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";

/// @notice UNDEPLOYED candidate. Push payments; recipients never call claim().
/// @dev Base cannot directly read a BSC NFT. A trusted attestor checks BSC and signs
/// short leases. Owner-approved Merkle roots and budgets constrain each operator.
/// Transfers are PUBLIC. Receipt refs must be random, never hashes of X handles.
contract DarkPayoutVault is Ownable2Step, ReentrancyGuard, EIP712 {
    using SafeERC20 for IERC20;
    IERC20 public immutable usdc;
    address public immutable dev;
    address public attestor;
    uint256 public attestorEpoch;
    bool public paused;
    bytes32 public constant LEASE_TYPEHASH = keccak256("AgentLease(address agent,uint256 epoch,uint256 attestorEpoch,uint256 issuedAt,uint256 validUntil)");

    struct Agent { uint256 dailyCap; uint256 epoch; uint256 until; }
    struct Campaign { bytes32 root; uint256 cap; uint256 spent; uint256 perPaymentCap; uint256 deadline; bool closed; }
    struct Payment { uint256 index; address recipient; uint256 amount; bytes32 receiptRef; bytes32[] proof; }
    mapping(address => Agent) public agents;
    mapping(address => mapping(uint256 => uint256)) public spentPerDay;
    mapping(bytes32 => Campaign) public campaigns;
    mapping(bytes32 => mapping(uint256 => bool)) public paid;
    error Invalid(); error NotAuthorized(); error BudgetExceeded(); error AlreadyPaid(); error Inactive();
    event AgentConfigured(address indexed agent, uint256 cap, uint256 epoch);
    event LeaseActivated(address indexed agent, uint256 validUntil);
    event CampaignOpened(bytes32 indexed id, bytes32 root, uint256 cap, uint256 deadline);
    event Paid(bytes32 indexed campaign, uint256 indexed index, address indexed recipient, uint256 amount, bytes32 receiptRef);
    event Rescue(address indexed asset, uint256 amount);

    constructor(address token, address admin, address verifier)
        Ownable(admin) EIP712("DarkPayoutVault", "1") {
        if (token.code.length == 0 || verifier == address(0) || IERC20Metadata(token).decimals() != 6) revert Invalid();
        usdc = IERC20(token);
        dev = admin;
        attestor = verifier;
    }
    function configureAgent(address agent, uint256 dailyCap) external onlyOwner {
        if (agent == address(0)) revert Invalid();
        Agent storage a = agents[agent];
        a.dailyCap = dailyCap;
        ++a.epoch;
        a.until = 0;
        emit AgentConfigured(agent, dailyCap, a.epoch);
    }
    function setAttestor(address verifier) external onlyOwner {
        if (verifier == address(0)) revert Invalid();
        attestor = verifier;
        ++attestorEpoch;
    }
    // Existing leases are invalidated by rotating the attestor epoch.
    mapping(address => uint256) public leaseAttestorEpoch;
    function activateLease(address agent, uint256 issuedAt, uint256 validUntil, bytes calldata signature) external {
        Agent storage a = agents[agent];
        if (a.dailyCap == 0 || issuedAt > block.timestamp || validUntil <= block.timestamp ||
            validUntil <= issuedAt || validUntil - issuedAt > 600) revert Invalid();
        bytes32 hash = _hashTypedDataV4(keccak256(abi.encode(LEASE_TYPEHASH, agent, a.epoch, attestorEpoch, issuedAt, validUntil)));
        if (!SignatureChecker.isValidSignatureNow(attestor, hash, signature)) revert NotAuthorized();
        a.until = validUntil;
        leaseAttestorEpoch[agent] = attestorEpoch;
        emit LeaseActivated(agent, validUntil);
    }
    function openCampaign(bytes32 id, bytes32 root, uint256 cap, uint256 perPaymentCap, uint256 deadline) external onlyOwner {
        if (id == bytes32(0) || root == bytes32(0) || campaigns[id].root != bytes32(0) ||
            cap == 0 || perPaymentCap == 0 || perPaymentCap > cap || deadline <= block.timestamp) revert Invalid();
        campaigns[id] = Campaign(root, cap, 0, perPaymentCap, deadline, false);
        emit CampaignOpened(id, root, cap, deadline);
    }
    function closeCampaign(bytes32 id) external onlyOwner { campaigns[id].closed = true; }
    function setPaused(bool value) external onlyOwner { paused = value; }
    function paymentLeaf(bytes32 id, uint256 index, address recipient, uint256 amount, bytes32 receiptRef) public pure returns (bytes32) {
        return keccak256(bytes.concat(keccak256(abi.encode(id, index, recipient, amount, receiptRef))));
    }
    function payBatch(bytes32 id, Payment[] calldata payments) external nonReentrant {
        Agent storage a = agents[msg.sender];
        Campaign storage c = campaigns[id];
        if (paused || c.root == bytes32(0) || c.closed || c.deadline <= block.timestamp) revert Inactive();
        if (a.dailyCap == 0 || a.until <= block.timestamp || leaseAttestorEpoch[msg.sender] != attestorEpoch) revert NotAuthorized();
        if (payments.length == 0 || payments.length > 50) revert Invalid();
        uint256 day = block.timestamp / 1 days;
        for (uint256 i; i < payments.length; ++i) {
            Payment calldata p = payments[i];
            if (p.recipient == address(0) || p.recipient == address(this) || p.amount == 0 || p.receiptRef == bytes32(0)) revert Invalid();
            if (paid[id][p.index]) revert AlreadyPaid();
            if (!MerkleProof.verifyCalldata(p.proof, c.root, paymentLeaf(id, p.index, p.recipient, p.amount, p.receiptRef))) revert NotAuthorized();
            if (p.amount > c.perPaymentCap || c.spent + p.amount > c.cap || spentPerDay[msg.sender][day] + p.amount > a.dailyCap) revert BudgetExceeded();
            paid[id][p.index] = true;
            c.spent += p.amount;
            spentPerDay[msg.sender][day] += p.amount;
            uint256 beforeBalance = usdc.balanceOf(p.recipient);
            usdc.safeTransfer(p.recipient, p.amount);
            if (usdc.balanceOf(p.recipient) - beforeBalance != p.amount) revert Invalid();
            emit Paid(id, p.index, p.recipient, p.amount, p.receiptRef);
        }
    }
    /// @notice Explicit dev rescue authority: entire chosen token balance goes to
    /// the immutable dev; payouts pause. Approved commitments may become unfunded.
    function rescue(address asset) external nonReentrant {
        if (msg.sender != dev) revert NotAuthorized();
        paused = true;
        uint256 amount = IERC20(asset).balanceOf(address(this));
        IERC20(asset).safeTransfer(dev, amount);
        emit Rescue(asset, amount);
    }
}
