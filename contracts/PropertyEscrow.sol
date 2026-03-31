// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable2Step.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
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
    function attachBuyerSig(uint256 tokenId, bytes memory buyerSig) external;
    function transferProperty(uint256 tokenId, address from, address to) external;
}

contract PropertyEscrow is Ownable2Step, ReentrancyGuard, Pausable {

    using ECDSA for bytes32;
    using SafeERC20 for IERC20;

    enum DealStatus { Open, Completed, Cancelled }

    struct Deal {
        uint256 tokenId;
        address seller;
        address buyer;
        uint256 amount;      // in XUSD (6 decimals)
        bool buyerSigned;
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
    event BuyerSigned(uint256 indexed dealId, address indexed buyer);
    event DealCompleted(uint256 indexed dealId, uint256 indexed tokenId, address indexed buyer);
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

    modifier onlyDealBuyer(uint256 dealId) {
        require(deals[dealId].buyer == msg.sender, "Not the buyer");
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

        // I verify buyer has approved enough XUSD before any state changes
        uint256 price = prop.price;
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
            buyerSigned: false,
            status: DealStatus.Open,
            createdAt: block.timestamp
        });

        tokenToDeal[tokenId] = dealId;
        activeDeal[tokenId] = true;
        totalEscrowedFunds += price;

        // INTERACTIONS — token transfer and registry update last
        // I use SafeERC20 to handle non-standard ERC20 return values
        paymentToken.safeTransferFrom(msg.sender, address(this), price);
        registry.updateStatus(tokenId, IPropertyRegistry.Status.InEscrow);

        emit DealOpened(dealId, tokenId, msg.sender, price);
        return dealId;
    }

    // ─── Step 2: Buyer signs to finalise ──────────────────────────
    // I verify the buyer's cryptographic signature before transferring ownership
    function buyerSign(uint256 dealId, bytes memory buyerSig)
        external dealExists(dealId) onlyDealBuyer(dealId) whenNotPaused nonReentrant {

        Deal storage deal = deals[dealId];

        // CHECKS
        require(deal.status == DealStatus.Open, "Deal not open");
        require(!deal.buyerSigned, "Already signed");
        require(block.timestamp <= deal.createdAt + dealExpiry, "Deal expired");

        // I verify buyer signed the exact deal parameters
        bytes32 messageHash = keccak256(abi.encodePacked(
            dealId, deal.tokenId, deal.seller, msg.sender, deal.amount
        ));
        bytes32 ethHash = MessageHashUtils.toEthSignedMessageHash(messageHash);
        address recovered = ECDSA.recover(ethHash, buyerSig);
        require(recovered == msg.sender, "Invalid buyer signature");

        // EFFECTS
        deal.buyerSigned = true;
        registry.attachBuyerSig(deal.tokenId, buyerSig);

        emit BuyerSigned(dealId, msg.sender);
        _finalizeDeal(dealId);
    }

    // ─── Internal: finalise with strict CEI ───────────────────────
    function _finalizeDeal(uint256 dealId) internal {
        Deal storage deal = deals[dealId];

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

        emit DealCompleted(dealId, deal.tokenId, deal.buyer);
        emit FundsQueued(dealId, deal.seller, sellerAmount);
    }

    // ─── Pull payment ─────────────────────────────────────────────
    // I send XUSD to the caller — effects before interactions
    function withdrawFunds() external nonReentrant {
        uint256 amount = pendingWithdrawals[msg.sender];
        require(amount > 0, "No funds to withdraw");

        // EFFECTS before INTERACTIONS
        pendingWithdrawals[msg.sender] = 0;

        paymentToken.safeTransfer(msg.sender, amount);

        emit FundsWithdrawn(msg.sender, amount);
    }

    // ─── Cancel deal ──────────────────────────────────────────────
    // I only allow cancel before buyer has deposited
    // Once buyNow is called XUSD is locked — use expireDeal for refunds
    function cancelDeal(uint256 dealId)
        external dealExists(dealId) onlyDealSeller(dealId) nonReentrant whenNotPaused {
        Deal storage deal = deals[dealId];

        // CHECKS
        require(deal.status == DealStatus.Open, "Deal not open");
        require(deal.buyer == address(0), "Buyer already deposited");

        // EFFECTS
        deal.status = DealStatus.Cancelled;
        activeDeal[deal.tokenId] = false;

        // INTERACTIONS
        registry.updateStatus(deal.tokenId, IPropertyRegistry.Status.Available);
        emit DealCancelled(dealId, "Cancelled by seller");
    }

    // ─── Expire deal ──────────────────────────────────────────────
    // I refund buyer via pull payment after expiry — no direct push
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
            // I queue refund via pull — buyer calls withdrawFunds()
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
