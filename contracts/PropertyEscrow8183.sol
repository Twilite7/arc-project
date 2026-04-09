// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

interface IERC8183 {
    function createJob(address,address,uint256,string calldata,address) external returns (uint256);
    function fund(uint256,bytes calldata) external;
    function submit(uint256,bytes32,bytes calldata) external;
    function complete(uint256,bytes32,bytes calldata) external;
    function reject(uint256,bytes32,bytes calldata) external;
    function jobs(uint256) external view returns (uint256,address,address,address,string memory,uint256,uint256,uint8,address,bytes32);
}

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

contract PropertyEscrow8183 is Ownable, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // I use Arc native USDC as the payment token
    address public constant USDC    = 0x3600000000000000000000000000000000000000;
    // I use ERC-8183 for job lifecycle tracking only — not for USDC custody
    address public constant ERC8183 = 0x0747EEf0706327138c69792bF28Cd525089e4583;
    uint256 public constant MAX_PRICE   = 1_000_000_000 * 1e6;
    uint256 public constant DEAL_EXPIRY = 7 days;

    IPropertyRegistry public immutable registry;

    mapping(uint256 => uint256)  public tokenToJob;
    mapping(uint256 => address)  public tokenToBuyer;
    mapping(uint256 => uint256)  public tokenToPrice;
    mapping(uint256 => bool)     public activeDeal;

    event DealCreated(uint256 indexed tokenId, uint256 indexed jobId, address buyer, address seller, uint256 price);
    event DealReleased(uint256 indexed tokenId, uint256 indexed jobId, address buyer, address seller);
    event DealRejected(uint256 indexed tokenId, uint256 indexed jobId, string reason);

    constructor(address _registry) Ownable(msg.sender) {
        require(_registry != address(0), "Invalid registry");
        registry = IPropertyRegistry(_registry);
    }

    // I let the buyer atomically: pull USDC into this contract, create ERC-8183 job for tracking
    function buyNow(uint256 tokenId) external nonReentrant whenNotPaused {
        require(!activeDeal[tokenId], "Deal already active");

        Property memory prop = registry.getProperty(tokenId);
        uint256 price  = prop.price;
        uint8   status = prop.status;
        address seller = registry.ownerOf(tokenId);

        require(status == 0,                     "Property not available");
        require(seller != msg.sender,            "Seller cannot buy own property");
        require(price > 0 && price <= MAX_PRICE, "Invalid price");

        // I pull USDC from buyer into this contract — we hold it, not ERC-8183
        IERC20(USDC).safeTransferFrom(msg.sender, address(this), price);

        // I create ERC-8183 job for lifecycle tracking: escrow=client, seller=provider, admin=evaluator
        uint256 expiredAt = block.timestamp + DEAL_EXPIRY;
        uint256 jobId = IERC8183(ERC8183).createJob(
            seller,
            owner(),
            expiredAt,
            string(abi.encodePacked("Zeno Estate property #", _toString(tokenId))),
            address(0)
        );

        // I record deal state and mark property in-escrow
        tokenToJob[tokenId]   = jobId;
        tokenToBuyer[tokenId] = msg.sender;
        tokenToPrice[tokenId] = price;
        activeDeal[tokenId]   = true;
        registry.updateStatus(tokenId, 1);

        emit DealCreated(tokenId, jobId, msg.sender, seller, price);
    }

    // I let the seller signal readiness for transfer — recorded via event
    // ERC-8183 submit is provider-only and cannot be called by the escrow contract
    event DeliverableSubmitted(uint256 indexed tokenId, uint256 indexed jobId, address seller);

    function submitDeliverable(uint256 tokenId) external {
        require(activeDeal[tokenId], "No active deal");
        require(registry.ownerOf(tokenId) == msg.sender, "Only seller can submit");
        emit DeliverableSubmitted(tokenId, tokenToJob[tokenId], msg.sender);
    }

    // I let the admin release: pay seller from our USDC balance, transfer NFT to buyer
    function releaseDeal(uint256 tokenId) external onlyOwner whenNotPaused {
        require(activeDeal[tokenId], "No active deal");

        uint256 jobId  = tokenToJob[tokenId];
        address buyer  = tokenToBuyer[tokenId];
        uint256 price  = tokenToPrice[tokenId];
        address seller = registry.ownerOf(tokenId);

        // I mark ERC-8183 job complete for audit trail
        IERC8183(ERC8183).complete(jobId, keccak256(bytes("property-transfer-approved")), "");

        // I pay seller directly from this contract
        IERC20(USDC).safeTransfer(seller, price);

        // I transfer NFT — transferProperty also sets status to Sold
        registry.transferProperty(tokenId, seller, buyer);

        _clearDeal(tokenId);

        emit DealReleased(tokenId, jobId, buyer, seller);
    }

    // I let the admin reject: refund buyer from our USDC balance
    function rejectDeal(uint256 tokenId, string calldata reason) external onlyOwner {
        require(activeDeal[tokenId], "No active deal");
        require(bytes(reason).length > 0 && bytes(reason).length <= 200, "Invalid reason");

        uint256 jobId = tokenToJob[tokenId];
        uint256 price = tokenToPrice[tokenId];
        address buyer = tokenToBuyer[tokenId];

        // I mark ERC-8183 job rejected for audit trail
        IERC8183(ERC8183).reject(jobId, keccak256(bytes(reason)), "");

        // I refund buyer directly from this contract
        IERC20(USDC).safeTransfer(buyer, price);

        // I restore property to available
        registry.updateStatus(tokenId, 0);

        _clearDeal(tokenId);

        emit DealRejected(tokenId, jobId, reason);
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
