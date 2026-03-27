// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable2Step.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";

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

    enum DealStatus { Open, Completed, Cancelled }

    struct Deal {
        uint256 tokenId;
        address seller;
        address buyer;
        uint256 amount;
        bool buyerSigned;
        bool sellerConfirmed;
        DealStatus status;
        uint256 createdAt;
    }

    uint256 public dealCount;

    // Internal accounting — never use address(this).balance
    // Protects against force-feed ETH attacks
    uint256 public totalEscrowedFunds;

    mapping(uint256 => Deal) public deals;
    mapping(uint256 => uint256) public tokenToDeal;
    mapping(uint256 => bool) public activeDeal;

    // Pull payment pattern — safer than push
    // Seller withdraws their funds instead of contract pushing ETH
    mapping(address => uint256) public pendingWithdrawals;

    IPropertyRegistry public immutable registry;
    uint256 public dealExpiry = 7 days;
    uint256 public platformFeeBps;
    address public feeRecipient;

    event DealOpened(uint256 indexed dealId, uint256 indexed tokenId, address indexed seller, uint256 amount);
    event BuyerDeposited(uint256 indexed dealId, address indexed buyer);
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
        uint256 _platformFeeBps,
        address _feeRecipient
    ) Ownable(msg.sender) {
        require(_registry != address(0), "Invalid registry address");
        require(_platformFeeBps <= 1000, "Fee too high, max 10%");
        require(_feeRecipient != address(0), "Invalid fee recipient");
        registry = IPropertyRegistry(_registry);
        platformFeeBps = _platformFeeBps;
        feeRecipient = _feeRecipient;
    }

    // Admin: pause/unpause
    function pause() external onlyOwner { _pause(); }
    function unpause() external onlyOwner { _unpause(); }

    // Admin: update deal expiry within safe bounds
    function setDealExpiry(uint256 newExpiry) external onlyOwner {
        require(newExpiry >= 1 days && newExpiry <= 30 days, "Out of range");
        dealExpiry = newExpiry;
        emit DealExpiryUpdated(newExpiry);
    }

    // Admin: update platform fee
    function setPlatformFee(uint256 feeBps, address recipient) external onlyOwner {
        require(feeBps <= 1000, "Fee too high");
        require(recipient != address(0), "Invalid recipient");
        platformFeeBps = feeBps;
        feeRecipient = recipient;
        emit PlatformFeeUpdated(feeBps, recipient);
    }

    // Step 1 — Seller opens a deal
    function openDeal(uint256 tokenId)
        external whenNotPaused returns (uint256) {
        require(registry.ownerOf(tokenId) == msg.sender, "Not the property owner");
        require(!activeDeal[tokenId], "Active deal exists for this token");
        require(
            registry.getEscrowContract() == address(this),
            "This contract is not set as escrow on registry"
        );

        IPropertyRegistry.Property memory prop = registry.getProperty(tokenId);
        require(prop.status == IPropertyRegistry.Status.Available, "Property not available");
        require(prop.price > 0, "Invalid price");

        dealCount++;
        uint256 dealId = dealCount;

        deals[dealId] = Deal({
            tokenId: tokenId,
            seller: msg.sender,
            buyer: address(0),
            amount: prop.price,
            buyerSigned: false,
            sellerConfirmed: true,
            status: DealStatus.Open,
            createdAt: block.timestamp
        });

        tokenToDeal[tokenId] = dealId;
        activeDeal[tokenId] = true;

        registry.updateStatus(tokenId, IPropertyRegistry.Status.InEscrow);

        emit DealOpened(dealId, tokenId, msg.sender, prop.price);
        return dealId;
    }

    // Step 2 — Buyer deposits exact ETH
    // Uses internal accounting — not address(this).balance
    function deposit(uint256 dealId)
        external payable dealExists(dealId) whenNotPaused nonReentrant {
        Deal storage deal = deals[dealId];
        require(deal.status == DealStatus.Open, "Deal not open");
        require(deal.buyer == address(0), "Buyer already deposited");
        require(msg.value == deal.amount, "Wrong ETH amount");
        require(msg.sender != deal.seller, "Seller cannot be buyer");
        require(block.timestamp <= deal.createdAt + dealExpiry, "Deal expired");

        deal.buyer = msg.sender;
        totalEscrowedFunds += msg.value;

        emit BuyerDeposited(dealId, msg.sender);
    }

    // Step 3 — Buyer signs to confirm
    function buyerSign(uint256 dealId, bytes memory buyerSig)
        external dealExists(dealId) onlyDealBuyer(dealId) whenNotPaused nonReentrant {
        Deal storage deal = deals[dealId];
        require(deal.status == DealStatus.Open, "Deal not open");
        require(!deal.buyerSigned, "Already signed");
        require(block.timestamp <= deal.createdAt + dealExpiry, "Deal expired");

        // Verify buyer signature
        bytes32 messageHash = keccak256(abi.encodePacked(
            dealId, deal.tokenId, deal.seller, msg.sender, deal.amount
        ));
        bytes32 ethHash = MessageHashUtils.toEthSignedMessageHash(messageHash);
        address recovered = ECDSA.recover(ethHash, buyerSig);
        require(recovered == msg.sender, "Invalid buyer signature");

        deal.buyerSigned = true;
        registry.attachBuyerSig(deal.tokenId, buyerSig);

        emit BuyerSigned(dealId, msg.sender);
        _finalizeDeal(dealId);
    }

    // Internal — finalize with pull payment pattern
    // Checks → Effects → Interactions strictly enforced
    function _finalizeDeal(uint256 dealId) internal {
        Deal storage deal = deals[dealId];
        require(deal.sellerConfirmed && deal.buyerSigned, "Not fully signed");

        // CHECKS — all validations above

        // EFFECTS — update all state before any external interaction
        deal.status = DealStatus.Completed;
        activeDeal[deal.tokenId] = false;

        uint256 totalAmount = deal.amount;
        deal.amount = 0;
        totalEscrowedFunds -= totalAmount;

        uint256 fee = (totalAmount * platformFeeBps) / 10000;
        uint256 sellerAmount = totalAmount - fee;

        // Queue payments via pull pattern — no direct ETH push
        pendingWithdrawals[deal.seller] += sellerAmount;
        if (fee > 0) {
            pendingWithdrawals[feeRecipient] += fee;
        }

        // INTERACTIONS — external calls last
        registry.transferProperty(deal.tokenId, deal.seller, deal.buyer);

        emit DealCompleted(dealId, deal.tokenId, deal.buyer);
        emit FundsQueued(dealId, deal.seller, sellerAmount);
    }

    // Pull payment — seller/fee recipient withdraws their own funds
    function withdrawFunds() external nonReentrant {
        uint256 amount = pendingWithdrawals[msg.sender];
        require(amount > 0, "No funds to withdraw");

        // EFFECTS before INTERACTIONS
        pendingWithdrawals[msg.sender] = 0;

        (bool sent, ) = payable(msg.sender).call{value: amount}("");
        require(sent, "Withdrawal failed");

        emit FundsWithdrawn(msg.sender, amount);
    }

    // Cancel deal — seller only, before buyer deposits
    function cancelDeal(uint256 dealId)
        external dealExists(dealId) onlyDealSeller(dealId) nonReentrant whenNotPaused {
        Deal storage deal = deals[dealId];
        require(deal.status == DealStatus.Open, "Deal not open");
        require(deal.buyer == address(0), "Buyer already deposited");

        deal.status = DealStatus.Cancelled;
        activeDeal[deal.tokenId] = false;

        registry.updateStatus(deal.tokenId, IPropertyRegistry.Status.Available);
        emit DealCancelled(dealId, "Cancelled by seller");
    }

    // Expire deal — either party triggers after expiry, buyer gets refund
    function expireDeal(uint256 dealId)
        external dealExists(dealId) nonReentrant {
        Deal storage deal = deals[dealId];
        require(deal.status == DealStatus.Open, "Deal not open");
        require(
            msg.sender == deal.seller || msg.sender == deal.buyer,
            "Not a party to this deal"
        );
        require(block.timestamp > deal.createdAt + dealExpiry, "Not yet expired");

        // EFFECTS first
        deal.status = DealStatus.Cancelled;
        activeDeal[deal.tokenId] = false;

        uint256 refundAmount = deal.amount;
        deal.amount = 0;

        if (refundAmount > 0) {
            totalEscrowedFunds -= refundAmount;
        }

        registry.updateStatus(deal.tokenId, IPropertyRegistry.Status.Available);

        emit DealCancelled(dealId, "Deal expired");

        // INTERACTIONS last — refund buyer if they deposited
        if (deal.buyer != address(0) && refundAmount > 0) {
            (bool sent, ) = payable(deal.buyer).call{value: refundAmount}("");
            require(sent, "Refund failed");
        }
    }

    // Read deal by ID
    function getDeal(uint256 dealId)
        external view dealExists(dealId) returns (Deal memory) {
        return deals[dealId];
    }

    // Read deal by token — preserves history after completion
    function getDealByToken(uint256 tokenId)
        external view returns (Deal memory) {
        uint256 dealId = tokenToDeal[tokenId];
        require(dealId != 0, "No deal found for this token");
        return deals[dealId];
    }

    // Check if token has active deal
    function hasActiveDeal(uint256 tokenId) external view returns (bool) {
        return activeDeal[tokenId];
    }

    // Check pending withdrawal for an address
    function getPendingWithdrawal(address account) external view returns (uint256) {
        return pendingWithdrawals[account];
    }
}
