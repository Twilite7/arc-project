// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

// I define ERC-8004 ValidationRegistry for property verification checks
interface IERC8004Validation {
    function getValidationStatus(bytes32 requestHash) external view returns (
        address validator,
        uint256 agentId,
        uint8   score,
        uint8   status,
        string  memory tags,
        uint256 timestamp
    );
}

interface IERC8183 {
    function createJob(address,address,uint256,string calldata,address) external returns (uint256);
    function fund(uint256,bytes calldata) external;
    function claimRefund(uint256) external;
    function jobs(uint256) external view returns (
        uint256 id,
        address client,
        address provider,
        address evaluator,
        string memory description,
        uint256 budget,
        uint256 expiredAt,
        uint8   status,
        address hook,
        bytes32 deliverable
    );
}

// ERC-8183 job status codes
// Open=0 Funded=1 Submitted=2 Completed=3 Rejected=4 Expired=5
uint8 constant JOB_COMPLETED = 3;
uint8 constant JOB_REJECTED  = 4;
uint8 constant JOB_EXPIRED   = 5;

struct Property {
    string location;
    string latitude;
    string longitude;
    string size;
    uint256 price;
    string description;
    bytes32 docsHash;
    bytes sellerSig;
    uint8 status;
    address[] previousOwners;
}

interface IPropertyRegistry {
    function getProperty(uint256 tokenId) external view returns (Property memory);
    function ownerOf(uint256 tokenId) external view returns (address);
    function updateStatus(uint256 tokenId, uint8 status) external;
    function transferProperty(uint256 tokenId, address from, address to) external;
    function isVerified(uint256 tokenId) external view returns (bool);
}

// Security assumptions:
//   - Admin (owner) is trusted: acts as ERC-8183 evaluator and escrow admin
//   - ERC-8183 auto-refunds client on reject() and auto-pays provider on complete()
//   - USDC held in escrow until fundJob moves it to ERC-8183
//   - After complete(), ERC-8183 pays seller directly — escrow only transfers NFT
//   - After reject(), ERC-8183 refunds escrow — escrow then refunds buyer
contract PropertyEscrow8183 is Ownable, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    address public constant USDC    = 0x3600000000000000000000000000000000000000;
    address public constant ERC8183 = 0x0747EEf0706327138c69792bF28Cd525089e4583;
    uint256 public constant MAX_PRICE   = 1_000_000_000 * 1e6;
    uint256 public constant DEAL_EXPIRY = 7 days;

    IPropertyRegistry public immutable registry;

    mapping(uint256 => uint256) public tokenToJob;
    mapping(uint256 => address) public tokenToBuyer;
    mapping(uint256 => uint256) public tokenToPrice;
    mapping(uint256 => bool)    public activeDeal;
    // I track whether the seller has funded the ERC-8183 job
    mapping(uint256 => bool)    public jobFunded;

    event DealCreated(uint256 indexed tokenId, uint256 indexed jobId, address buyer, address seller, uint256 price);
    event JobFunded(uint256 indexed tokenId, uint256 indexed jobId);
    event DealReleased(uint256 indexed tokenId, uint256 indexed jobId, address buyer, address seller);
    event DealRejected(uint256 indexed tokenId, uint256 indexed jobId, string reason);
    event DealExpired(uint256 indexed tokenId, uint256 indexed jobId, address buyer);

    constructor(address _registry) Ownable(msg.sender) {
        require(_registry != address(0), "Invalid registry");
        registry = IPropertyRegistry(_registry);
    }

    // ─── Step 1: Buyer ───────────────────────────────────────────
    // I atomically pull USDC from buyer, create the ERC-8183 job, and fund it.
    // Seller only needs to call submitDeliverable() when ready.
    function buyNow(uint256 tokenId) external nonReentrant whenNotPaused {
        require(!activeDeal[tokenId], "Deal already active");

        Property memory prop = registry.getProperty(tokenId);
        uint256 price  = prop.price;
        uint8   status = prop.status;
        address seller = registry.ownerOf(tokenId);

        require(status == 0,                     "Property not available");
        require(seller != msg.sender,            "Seller cannot buy own property");
        require(price > 0 && price <= MAX_PRICE, "Invalid price");
        require(registry.isVerified(tokenId),    "Property not verified by platform");

        // I pull USDC from buyer into this contract
        IERC20(USDC).safeTransferFrom(msg.sender, address(this), price);

        // I create ERC-8183 job: this contract=client, seller=provider, admin=evaluator
        uint256 expiredAt = block.timestamp + DEAL_EXPIRY;
        uint256 jobId = IERC8183(ERC8183).createJob(
            seller,
            owner(),
            expiredAt,
            string(abi.encodePacked("Zeno Estate property #", _toString(tokenId))),
            address(0)
        );

        // I fund the job immediately — price passed in optParams, no setBudget needed
        IERC20(USDC).forceApprove(ERC8183, price);
        IERC8183(ERC8183).fund(jobId, abi.encode(price));

        tokenToJob[tokenId]   = jobId;
        tokenToBuyer[tokenId] = msg.sender;
        tokenToPrice[tokenId] = price;
        activeDeal[tokenId]   = true;
        jobFunded[tokenId]    = true;
        registry.updateStatus(tokenId, 1);
        emit DealCreated(tokenId, jobId, msg.sender, seller, price);
        emit JobFunded(tokenId, jobId);
    }

        // ─── Step 3: Admin — Release ─────────────────────────────────
    // Admin calls complete() on ERC-8183 first (pays seller automatically),
    // then calls this to transfer the NFT to buyer.
    function releaseDeal(uint256 tokenId) external onlyOwner whenNotPaused {
        require(activeDeal[tokenId],  "No active deal");
        require(jobFunded[tokenId],   "Job not funded");

        uint256 jobId  = tokenToJob[tokenId];
        address buyer  = tokenToBuyer[tokenId];
        address seller = registry.ownerOf(tokenId);

        // I verify ERC-8183 job is Completed — admin must have called complete() first
        (,,,,,,,uint8 jobStatus,,) = IERC8183(ERC8183).jobs(jobId);
        require(jobStatus == JOB_COMPLETED, "ERC-8183 job not completed");

        // I clear state before external calls
        _clearDeal(tokenId);

        // I transfer NFT — ERC-8183 already paid seller on complete()
        registry.transferProperty(tokenId, seller, buyer);

        emit DealReleased(tokenId, jobId, buyer, seller);
    }

    // ─── Step 3: Admin — Reject ──────────────────────────────────
    // Admin calls reject() on ERC-8183 first (auto-refunds escrow),
    // then calls this to refund buyer from escrow balance.
    // If job not yet funded, USDC is still in escrow — refund directly.
    function rejectDeal(uint256 tokenId, string calldata reason) external onlyOwner {
        require(activeDeal[tokenId], "No active deal");
        require(bytes(reason).length > 0 && bytes(reason).length <= 200, "Invalid reason");

        uint256 jobId = tokenToJob[tokenId];
        uint256 price = tokenToPrice[tokenId];
        address buyer = tokenToBuyer[tokenId];

        if (jobFunded[tokenId]) {
            // I verify ERC-8183 job is Rejected — admin must have called reject() first
            // reject() auto-refunds escrow so our balance is restored
            (,,,,,,,uint8 jobStatus,,) = IERC8183(ERC8183).jobs(jobId);
            require(jobStatus == JOB_REJECTED, "ERC-8183 job not rejected");
        }

        // I clear state before transfers
        _clearDeal(tokenId);

        // I refund buyer from escrow balance and restore property
        IERC20(USDC).safeTransfer(buyer, price);
        registry.updateStatus(tokenId, 0);

        emit DealRejected(tokenId, jobId, reason);
    }

    // ─── Expiry recovery ─────────────────────────────────────────
    // I let the buyer or admin recover funds after the ERC-8183 job expires.
    function claimExpired(uint256 tokenId) external nonReentrant {
        require(activeDeal[tokenId], "No active deal");
        require(
            msg.sender == tokenToBuyer[tokenId] || msg.sender == owner(),
            "Only buyer or admin"
        );

        uint256 jobId = tokenToJob[tokenId];
        uint256 price = tokenToPrice[tokenId];
        address buyer = tokenToBuyer[tokenId];

        (,,,,,, uint256 expiredAt, uint8 jobStatus,,) = IERC8183(ERC8183).jobs(jobId);
        require(
            jobStatus == JOB_EXPIRED || block.timestamp > expiredAt,
            "Deal not yet expired"
        );

        bool wasFunded = jobFunded[tokenId];
        _clearDeal(tokenId);

        // I pull USDC back from ERC-8183 if the job was funded before expiry
        // claimRefund is valid on Expired jobs and returns funds to the client (this contract)
        if (wasFunded) {
            IERC8183(ERC8183).claimRefund(jobId);
        }

        // I refund buyer from escrow balance and restore property
        IERC20(USDC).safeTransfer(buyer, price);
        registry.updateStatus(tokenId, 0);

        emit DealExpired(tokenId, jobId, buyer);
    }

    function pause()   external onlyOwner { _pause(); }
    function unpause() external onlyOwner { _unpause(); }

    function _clearDeal(uint256 tokenId) internal {
        activeDeal[tokenId]   = false;
        jobFunded[tokenId]    = false;
        tokenToJob[tokenId]   = 0;
        tokenToBuyer[tokenId] = address(0);
        tokenToPrice[tokenId] = 0;
    }

    function _toString(uint256 value) internal pure returns (string memory) {
        if (value == 0) return "0";
        uint256 temp = value;
        uint256 digits;
        while (temp != 0) { digits++; temp /= 10; }
        bytes memory buffer = new bytes(digits);
        while (value != 0) {
            digits--;
            buffer[digits] = bytes1(uint8(48 + (value % 10)));
            value /= 10;
        }
        return string(buffer);
    }
}
