// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

interface IERC8183 {
    function createJob(
        address provider,
        address evaluator,
        uint256 expiredAt,
        string calldata description,
        address hook
    ) external returns (uint256 jobId);
    function fund(uint256 jobId, bytes calldata optParams) external;
    function submit(uint256 jobId, bytes32 deliverable, bytes calldata optParams) external;
    function complete(uint256 jobId, bytes32 reason, bytes calldata optParams) external;
    function reject(uint256 jobId, bytes32 reason, bytes calldata optParams) external;
    function getJob(uint256 jobId) external view returns (
        uint256 id,
        address client,
        address provider,
        address evaluator,
        string memory description,
        uint256 budget,
        uint256 expiredAt,
        uint8 status,
        address hook
    );
}

interface IPropertyRegistry {
    function getProperty(uint256 tokenId) external view returns (
        string memory location,
        string memory latitude,
        string memory longitude,
        string memory size,
        uint256 price,
        string memory description,
        bytes32 docsHash,
        bytes memory sellerSig,
        uint8 status,
        address[] memory previousOwners
    );
    function ownerOf(uint256 tokenId) external view returns (address);
    function updateStatus(uint256 tokenId, uint8 status) external;
    function transferProperty(uint256 tokenId, address from, address to) external;
}

contract PropertyEscrow8183 is Ownable, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // I use Arc native USDC as the payment token
    address public constant USDC    = 0x3600000000000000000000000000000000000000;
    // I point to Arc Testnet ERC-8183 reference implementation
    address public constant ERC8183 = 0x0747EEf0706327138c69792bF28Cd525089e4583;
    // I cap prices at 1 billion USDC to prevent overflow
    uint256 public constant MAX_PRICE   = 1_000_000_000 * 1e6;
    // I expire jobs after 7 days matching the previous escrow convention
    uint256 public constant DEAL_EXPIRY = 7 days;

    IPropertyRegistry public immutable registry;

    // I map tokenId -> ERC-8183 jobId for admin lookups
    mapping(uint256 => uint256) public tokenToJob;
    // I map tokenId -> buyer address for NFT transfer on release
    mapping(uint256 => address) public tokenToBuyer;
    // I track active deals to prevent double-buying
    mapping(uint256 => bool)    public activeDeal;

    event DealCreated(uint256 indexed tokenId, uint256 indexed jobId, address buyer, address seller, uint256 price);
    event DealReleased(uint256 indexed tokenId, uint256 indexed jobId, address buyer, address seller);
    event DealRejected(uint256 indexed tokenId, uint256 indexed jobId, string reason);

    constructor(address _registry) Ownable(msg.sender) {
        require(_registry != address(0), "Invalid registry");
        registry = IPropertyRegistry(_registry);
    }

    // I let the buyer purchase atomically: pull USDC, create job, fund with price, submit
    function buyNow(uint256 tokenId) external nonReentrant whenNotPaused {
        require(!activeDeal[tokenId], "Deal already active");

        (,,,, uint256 price,,,,uint8 status,) = registry.getProperty(tokenId);
        address seller = registry.ownerOf(tokenId);

        require(status == 0,                     "Property not available");
        require(seller != msg.sender,            "Seller cannot buy own property");
        require(price > 0 && price <= MAX_PRICE, "Invalid price");

        // I pull USDC from buyer into this contract then approve ERC-8183 to pull it
        IERC20(USDC).safeTransferFrom(msg.sender, address(this), price);
        IERC20(USDC).forceApprove(ERC8183, price);

        // I create job: seller=provider, platform admin=evaluator
        uint256 expiredAt = block.timestamp + DEAL_EXPIRY;
        uint256 jobId = IERC8183(ERC8183).createJob(
            seller,
            owner(),
            expiredAt,
            string(abi.encodePacked("Zeno Estate property #", _toString(tokenId))),
            address(0)
        );

        // I fund with price encoded in optParams — setBudget not required by ERC-8183
        bytes memory encodedPrice = abi.encode(price);
        IERC8183(ERC8183).fund(jobId, encodedPrice);

        // I submit deliverable: keccak256(tokenId, buyer, seller)
        bytes32 deliverable = keccak256(abi.encodePacked(tokenId, msg.sender, seller));
        IERC8183(ERC8183).submit(jobId, deliverable, "");

        // I record deal state and mark property as in-escrow in the registry
        tokenToJob[tokenId]   = jobId;
        tokenToBuyer[tokenId] = msg.sender;
        activeDeal[tokenId]   = true;
        registry.updateStatus(tokenId, 1);

        emit DealCreated(tokenId, jobId, msg.sender, seller, price);
    }

    // I let the admin release a deal: ERC-8183 pays seller, registry transfers NFT
    function releaseDeal(uint256 tokenId) external onlyOwner whenNotPaused {
        require(activeDeal[tokenId], "No active deal");

        uint256 jobId  = tokenToJob[tokenId];
        address buyer  = tokenToBuyer[tokenId];
        address seller = registry.ownerOf(tokenId);

        // I complete the ERC-8183 job — USDC released to seller by ERC-8183
        IERC8183(ERC8183).complete(jobId, keccak256(bytes("property-transfer-approved")), "");

        // I transfer NFT — transferProperty also sets status to Sold internally
        registry.transferProperty(tokenId, seller, buyer);

        _clearDeal(tokenId);

        emit DealReleased(tokenId, jobId, buyer, seller);
    }

    // I let the admin reject a deal: ERC-8183 refunds buyer automatically
    function rejectDeal(uint256 tokenId, string calldata reason) external onlyOwner {
        require(activeDeal[tokenId], "No active deal");
        require(bytes(reason).length > 0 && bytes(reason).length <= 200, "Invalid reason");

        uint256 jobId = tokenToJob[tokenId];

        // I reject via ERC-8183 — buyer refund handled by ERC-8183, not us
        IERC8183(ERC8183).reject(jobId, keccak256(bytes(reason)), "");

        // I restore property to Available
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
