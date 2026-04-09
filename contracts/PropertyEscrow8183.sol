// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

// I define only the ERC-8183 functions this contract calls or reads
interface IERC8183 {
    function createJob(address,address,uint256,string calldata,address) external returns (uint256);
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

// I define ERC-8183 job status codes matching the reference implementation
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
}

// Security assumptions:
//   - Admin (owner) is trusted: can call complete/reject on ERC-8183 and release/reject here
//   - ERC-8183 proxy implementation is trusted not to reorder jobs() return fields
//   - USDC at 0x3600... is the canonical Arc native stablecoin
//   - Seller is the NFT owner at time of buyNow; transferProperty enforces this again
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

    event DealCreated(uint256 indexed tokenId, uint256 indexed jobId, address buyer, address seller, uint256 price);
    event DealReleased(uint256 indexed tokenId, uint256 indexed jobId, address buyer, address seller);
    event DealRejected(uint256 indexed tokenId, uint256 indexed jobId, string reason);
    event DealExpired(uint256 indexed tokenId, uint256 indexed jobId, address buyer);

    constructor(address _registry) Ownable(msg.sender) {
        require(_registry != address(0), "Invalid registry");
        registry = IPropertyRegistry(_registry);
    }

    // ─── Buyer ────────────────────────────────────────────────────
    // I atomically pull USDC into this contract and create an ERC-8183 job.
    // After this call the seller must:
    //   1. Call setBudget(jobId, price, "0x") directly on ERC-8183 (provider-only)
    //   2. Call submit(jobId, deliverable, "0x") directly on ERC-8183 (provider-only)
    // Then the admin must:
    //   3. Call complete(jobId, reason, "0x") directly on ERC-8183 (evaluator-only)
    //   4. Call releaseDeal(tokenId) on this contract
    function buyNow(uint256 tokenId) external nonReentrant whenNotPaused {
        require(!activeDeal[tokenId], "Deal already active");

        Property memory prop = registry.getProperty(tokenId);
        uint256 price  = prop.price;
        uint8   status = prop.status;
        address seller = registry.ownerOf(tokenId);

        require(status == 0,                     "Property not available");
        require(seller != msg.sender,            "Seller cannot buy own property");
        require(price > 0 && price <= MAX_PRICE, "Invalid price");

        // I pull USDC from buyer — held here, not in ERC-8183
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

        // I write state after external calls that can revert (createJob)
        // safeTransferFrom already completed — if createJob reverts the whole tx reverts
        tokenToJob[tokenId]   = jobId;
        tokenToBuyer[tokenId] = msg.sender;
        tokenToPrice[tokenId] = price;
        activeDeal[tokenId]   = true;
        registry.updateStatus(tokenId, 1);

        emit DealCreated(tokenId, jobId, msg.sender, seller, price);
    }

    // ─── Admin ────────────────────────────────────────────────────
    // I release funds and transfer NFT only after ERC-8183 job is Completed.
    // Admin must call complete() on ERC-8183 first (evaluator-only there).
    // Note: admin trust assumption — admin controls both complete() and releaseDeal().
    function releaseDeal(uint256 tokenId) external onlyOwner whenNotPaused {
        require(activeDeal[tokenId], "No active deal");

        uint256 jobId  = tokenToJob[tokenId];
        address buyer  = tokenToBuyer[tokenId];
        uint256 price  = tokenToPrice[tokenId];
        address seller = registry.ownerOf(tokenId);

        // I verify ERC-8183 job reached Completed state — this is the binding gate
        (,,,,,, uint256 expiredAt, uint8 jobStatus,,) = IERC8183(ERC8183).jobs(jobId);
        require(jobStatus == JOB_COMPLETED, "ERC-8183 job not completed");
        require(block.timestamp <= expiredAt + 30 days, "Deal window closed");

        // I clear state before transfers to prevent reentrancy
        _clearDeal(tokenId);

        // I pay seller then transfer NFT
        IERC20(USDC).safeTransfer(seller, price);
        registry.transferProperty(tokenId, seller, buyer);

        emit DealReleased(tokenId, jobId, buyer, seller);
    }

    // I reject the deal only after ERC-8183 job is Rejected.
    // Admin must call reject() on ERC-8183 first (evaluator-only there).
    function rejectDeal(uint256 tokenId, string calldata reason) external onlyOwner {
        require(activeDeal[tokenId], "No active deal");
        require(bytes(reason).length > 0 && bytes(reason).length <= 200, "Invalid reason");

        uint256 jobId = tokenToJob[tokenId];
        uint256 price = tokenToPrice[tokenId];
        address buyer = tokenToBuyer[tokenId];

        // I verify ERC-8183 job reached Rejected state
        (,,,,,,,uint8 jobStatus,,) = IERC8183(ERC8183).jobs(jobId);
        require(jobStatus == JOB_REJECTED, "ERC-8183 job not rejected");

        // I clear state before transfers
        _clearDeal(tokenId);

        // I refund buyer and restore property to available
        IERC20(USDC).safeTransfer(buyer, price);
        registry.updateStatus(tokenId, 0);

        emit DealRejected(tokenId, jobId, reason);
    }

    // ─── Expiry recovery ──────────────────────────────────────────
    // I let only the buyer or admin trigger a refund once the ERC-8183 job has expired.
    // This prevents USDC being permanently stuck if neither party acts within 7 days.
    function claimExpired(uint256 tokenId) external nonReentrant {
        require(
            msg.sender == tokenToBuyer[tokenId] || msg.sender == owner(),
            "Only buyer or admin"
        );
        require(activeDeal[tokenId], "No active deal");

        uint256 jobId = tokenToJob[tokenId];
        uint256 price = tokenToPrice[tokenId];
        address buyer = tokenToBuyer[tokenId];

        (,,,,,, uint256 expiredAt, uint8 jobStatus,,) = IERC8183(ERC8183).jobs(jobId);
        require(
            jobStatus == JOB_EXPIRED || block.timestamp > expiredAt,
            "Deal not yet expired"
        );

        // I clear state before transfers
        _clearDeal(tokenId);

        // I refund buyer and restore property to available
        IERC20(USDC).safeTransfer(buyer, price);
        registry.updateStatus(tokenId, 0);

        emit DealExpired(tokenId, jobId, buyer);
    }

    function pause()   external onlyOwner { _pause(); }
    function unpause() external onlyOwner { _unpause(); }

    function _clearDeal(uint256 tokenId) internal {
        activeDeal[tokenId]   = false;
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
