// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable2Step.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

interface IPropertyRegistry {
    enum Status { Available, InEscrow, Sold }

    struct Property {
        string location;
        string latitude;
        string longitude;
        string size;
        uint256 price;
        string description;
        bytes32 docsHash;
        bytes sellerSig;
        bytes buyerSig;
        Status status;
        address[] previousOwners;
    }

    function getProperty(uint256 tokenId) external view returns (Property memory);
    function ownerOf(uint256 tokenId) external view returns (address);
    function getEscrowContract() external view returns (address);
    function updateStatus(uint256 tokenId, IPropertyRegistry.Status status) external;
    function transferProperty(uint256 tokenId, address from, address to) external;
}

contract PropertyEscrow is Ownable2Step, ReentrancyGuard, Pausable {

    using SafeERC20 for IERC20;

    enum DealStatus { Open, Completed, Cancelled }

    struct Deal {
        uint256 tokenId;
        address seller;
        address buyer;
        uint256 amount;       // in XUSD (6 decimals)
        DealStatus status;
        uint256 createdAt;
    }

    uint256 public dealCount;

    // I track escrowed XUSD internally — never rely on token.balanceOf(this)
    // Protects against direct token transfers bypassing accounting
    uint256 public totalEscrowedFunds;

    mapping(uint256 => Deal) public deals;
    mapping(uint256 => uint256) public tokenToDeal;
    mapping(uint256 => bool) public activeDeal;

    // I use pull payment pattern — recipients withdraw their own funds
    mapping(address => uint256) public pendingWithdrawals;

    IPropertyRegistry public immutable registry;
    IERC20 public immutable paymentToken;  // XylemUSD (XUSD)

    uint256 public dealExpiry = 7 days;
    uint256 public platformFeeBps;
    address public feeRecipient;

    event DealOpened(uint256 indexed dealId, uint256 indexed tokenId, address indexed buyer, uint256 amount);
    event DealReleased(uint256 indexed dealId, uint256 indexed tokenId, address indexed buyer);
    event DealRejected(uint256 indexed dealId, string reason);
    event DealCancelled(uint256 indexed dealId, string reason);
    event FundsQueued(uint256 indexed dealId, address indexed seller, uint256 amount);
    event FundsWithdrawn(address indexed recipient, uint256 amount);
    event DealExpiryUpdated(uint256 newExpiry);
    event PlatformFeeUpdated(uint256 feeBps, address indexed recipient);

    modifier dealExists(uint256 dealId) {
        require(dealId > 0 && dealId <= dealCount, "Deal does not exist");
        _;
    }

    modifier onlyDealSeller(uint256 dealId) {
        require(deals[dealId].seller == msg.sender, "Not the seller");
        _;
    }

    constructor(
        address _registry,
        address _paymentToken,
        uint256 _platformFeeBps,
        address _feeRecipient
    ) Ownable(msg.sender) {
        require(_registry != address(0), "Invalid registry address");
        require(_paymentToken != address(0), "Invalid payment token");
        require(_platformFeeBps <= 1000, "Fee too high, max 10%");
        require(_feeRecipient != address(0), "Invalid fee recipient");
        registry = IPropertyRegistry(_registry);
        paymentToken = IERC20(_paymentToken);
        platformFeeBps = _platformFeeBps;
        feeRecipient = _feeRecipient;
    }

    // ─── Admin ────────────────────────────────────────────────────

    function pause() external onlyOwner { _pause(); }
    function unpause() external onlyOwner { _unpause(); }

    function setDealExpiry(uint256 newExpiry) external onlyOwner {
        require(newExpiry >= 1 days && newExpiry <= 30 days, "Out of range");
        dealExpiry = newExpiry;
        emit DealExpiryUpdated(newExpiry);
    }

    function setPlatformFee(uint256 feeBps, address recipient) external onlyOwner {
        require(feeBps <= 1000, "Fee too high");
        require(recipient != address(0), "Invalid recipient");
        platformFeeBps = feeBps;
        feeRecipient = recipient;
        emit PlatformFeeUpdated(feeBps, recipient);
    }

    // ─── Step 1: Buyer initiates purchase ─────────────────────────
    // I pull XUSD from buyer via transferFrom — buyer must approve first
    // Deal opens and funds are escrowed atomically in one transaction
    function buyNow(uint256 tokenId)
        external whenNotPaused nonReentrant returns (uint256) {

        // CHECKS
        require(!activeDeal[tokenId], "Active deal exists for this token");
        require(
            registry.getEscrowContract() == address(this),
            "This contract is not the registered escrow"
        );

        IPropertyRegistry.Property memory prop = registry.getProperty(tokenId);
        address seller = registry.ownerOf(tokenId);

        require(prop.status == IPropertyRegistry.Status.Available, "Property not available");
        require(prop.price > 0, "Invalid price");
        require(msg.sender != seller, "Seller cannot buy own property");

        uint256 price = prop.price;

        // I verify buyer has approved enough XUSD before any state changes
        require(
            paymentToken.allowance(msg.sender, address(this)) >= price,
            "Insufficient XUSD allowance, approve first"
        );

        // EFFECTS — all state changes before external token transfer
        dealCount++;
        uint256 dealId = dealCount;

        deals[dealId] = Deal({
            tokenId: tokenId,
            seller: seller,
            buyer: msg.sender,
            amount: price,
            status: DealStatus.Open,
            createdAt: block.timestamp
        });

        tokenToDeal[tokenId] = dealId;
        activeDeal[tokenId] = true;
        totalEscrowedFunds += price;

        // INTERACTIONS — token transfer and registry update last
        paymentToken.safeTransferFrom(msg.sender, address(this), price);
        registry.updateStatus(tokenId, IPropertyRegistry.Status.InEscrow);

        emit DealOpened(dealId, tokenId, msg.sender, price);
        return dealId;
    }

    // ─── Step 2: Platform releases deal after off-chain verification ──
    // I only allow the platform owner to release — this is the trust anchor
    // Admin verifies legal docs, title deed, and KYC before calling this
    function releaseDeal(uint256 dealId)
        external dealExists(dealId) onlyOwner nonReentrant whenNotPaused {

        Deal storage deal = deals[dealId];

        // CHECKS
        require(deal.status == DealStatus.Open, "Deal not open");
        require(block.timestamp <= deal.createdAt + dealExpiry, "Deal expired");

        // EFFECTS — all state before external calls
        deal.status = DealStatus.Completed;
        activeDeal[deal.tokenId] = false;

        uint256 totalAmount = deal.amount;
        deal.amount = 0;
        totalEscrowedFunds -= totalAmount;

        uint256 fee = (totalAmount * platformFeeBps) / 10000;
        uint256 sellerAmount = totalAmount - fee;

        // I queue XUSD for pull withdrawal — no direct push
        pendingWithdrawals[deal.seller] += sellerAmount;
        if (fee > 0) {
            pendingWithdrawals[feeRecipient] += fee;
        }

        // INTERACTIONS — external calls strictly last
        registry.transferProperty(deal.tokenId, deal.seller, deal.buyer);

        emit DealReleased(dealId, deal.tokenId, deal.buyer);
        emit FundsQueued(dealId, deal.seller, sellerAmount);
    }

    // ─── Platform rejects deal — refunds buyer ────────────────────
    // I call this if off-chain verification fails (bad title, fraud, etc.)
    // Buyer gets full refund, property returns to Available
    function rejectDeal(uint256 dealId, string calldata reason)
        external dealExists(dealId) onlyOwner nonReentrant whenNotPaused {

        Deal storage deal = deals[dealId];

        // CHECKS
        require(deal.status == DealStatus.Open, "Deal not open");

        // EFFECTS
        deal.status = DealStatus.Cancelled;
        activeDeal[deal.tokenId] = false;

        uint256 refundAmount = deal.amount;
        deal.amount = 0;

        if (refundAmount > 0) {
            totalEscrowedFunds -= refundAmount;
            // I queue refund via pull — buyer calls withdrawFunds()
            pendingWithdrawals[deal.buyer] += refundAmount;
        }

        // INTERACTIONS
        registry.updateStatus(deal.tokenId, IPropertyRegistry.Status.Available);

        emit DealRejected(dealId, reason);
        emit DealCancelled(dealId, reason);
    }

    // ─── Pull payment ─────────────────────────────────────────────
    function withdrawFunds() external nonReentrant {
        uint256 amount = pendingWithdrawals[msg.sender];
        require(amount > 0, "No funds to withdraw");

        // EFFECTS before INTERACTIONS
        pendingWithdrawals[msg.sender] = 0;

        paymentToken.safeTransfer(msg.sender, amount);

        emit FundsWithdrawn(msg.sender, amount);
    }

    // ─── Expire deal ──────────────────────────────────────────────
    // I allow either party to trigger expiry after the deadline
    // Protects buyer if admin never acts — full refund via pull payment
    function expireDeal(uint256 dealId)
        external dealExists(dealId) nonReentrant {
        Deal storage deal = deals[dealId];

        // CHECKS
        require(deal.status == DealStatus.Open, "Deal not open");
        require(
            msg.sender == deal.seller || msg.sender == deal.buyer,
            "Not a party to this deal"
        );
        require(block.timestamp > deal.createdAt + dealExpiry, "Not yet expired");

        // EFFECTS
        deal.status = DealStatus.Cancelled;
        activeDeal[deal.tokenId] = false;

        uint256 refundAmount = deal.amount;
        deal.amount = 0;

        if (refundAmount > 0) {
            totalEscrowedFunds -= refundAmount;
            pendingWithdrawals[deal.buyer] += refundAmount;
        }

        // INTERACTIONS
        registry.updateStatus(deal.tokenId, IPropertyRegistry.Status.Available);
        emit DealCancelled(dealId, "Deal expired");
    }

    // ─── Read functions ───────────────────────────────────────────

    function getDeal(uint256 dealId)
        external view dealExists(dealId) returns (Deal memory) {
        return deals[dealId];
    }

    function getDealByToken(uint256 tokenId)
        external view returns (Deal memory) {
        uint256 dealId = tokenToDeal[tokenId];
        require(dealId != 0, "No deal found for this token");
        return deals[dealId];
    }

    function hasActiveDeal(uint256 tokenId) external view returns (bool) {
        return activeDeal[tokenId];
    }

    function getPendingWithdrawal(address account) external view returns (uint256) {
        return pendingWithdrawals[account];
    }
}
