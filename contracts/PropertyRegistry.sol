// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/access/Ownable2Step.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract PropertyRegistry is ERC721, Ownable2Step, Pausable {

    using ECDSA for bytes32;
    using SafeERC20 for IERC20;

    // I use Arc native USDC for all platform fees
    address public constant USDC = 0x3600000000000000000000000000000000000000;
    // I cap fees at 500 USDC to prevent admin griefing listers
    uint256 public constant MAX_FEE = 500 * 1e6;

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
        Status status;
        address[] previousOwners;
    }

    uint256 public tokenCount;
    mapping(uint256 => Property) public properties;
    mapping(address => bool) public verifiedListers;
    // I track verification status and pending requests separately
    mapping(uint256 => bool) public verified;
    mapping(uint256 => bool) public verificationPending;

    address public escrowContract;
    bool public escrowLocked;

    // I track pending escrow update separately from initial set
    address public pendingEscrow;
    uint256 public pendingEscrowValidAfter;
    uint256 public constant ESCROW_UPDATE_DELAY = 48 hours;

    // I store platform fee config — both fees default to 0 until admin sets them
    uint256 public listingFee;
    uint256 public verificationFee;
    address public feeRecipient;

    event PropertyListed(uint256 indexed tokenId, address indexed seller, string location);
    event StatusUpdated(uint256 indexed tokenId, Status status);
    event PropertyTransferred(uint256 indexed tokenId, address indexed from, address indexed to);
    event VerifiedListerUpdated(address indexed lister, bool status);
    event EscrowContractSet(address indexed escrow);
    event EscrowUpdateProposed(address indexed proposed, uint256 validAfter);
    event EscrowContractUpdated(address indexed oldEscrow, address indexed newEscrow);
    event VerificationRequested(uint256 indexed tokenId, address indexed seller);
    event PropertyVerified(uint256 indexed tokenId);
    event FeesUpdated(uint256 listingFee, uint256 verificationFee, address feeRecipient);

    modifier onlyVerifiedLister() {
        require(verifiedListers[msg.sender], "Not a verified lister");
        _;
    }

    modifier onlyEscrow() {
        require(msg.sender == escrowContract, "Only escrow contract");
        _;
    }

    modifier tokenExists(uint256 tokenId) {
        require(tokenId > 0 && tokenId <= tokenCount, "Token does not exist");
        _;
    }

    constructor() ERC721("PropertyRegistry", "PROP") Ownable(msg.sender) {}

    // ─── Admin ────────────────────────────────────────────────────

    function pause() external onlyOwner { _pause(); }
    function unpause() external onlyOwner { _unpause(); }

    // I set platform fees — both listing and verification fee capped at MAX_FEE
    // feeRecipient must be non-zero if either fee is non-zero
    function setFees(
        uint256 _listingFee,
        uint256 _verificationFee,
        address _feeRecipient
    ) external onlyOwner {
        require(_listingFee <= MAX_FEE, "Listing fee exceeds maximum");
        require(_verificationFee <= MAX_FEE, "Verification fee exceeds maximum");
        if (_listingFee > 0 || _verificationFee > 0) {
            require(_feeRecipient != address(0), "Fee recipient required");
        }
        listingFee     = _listingFee;
        verificationFee = _verificationFee;
        feeRecipient   = _feeRecipient;
        emit FeesUpdated(_listingFee, _verificationFee, _feeRecipient);
    }

    // I mark a property as verified — only after seller has paid verification fee
    function verifyProperty(uint256 tokenId) external onlyOwner tokenExists(tokenId) {
        require(verificationPending[tokenId], "No verification request for this token");
        verificationPending[tokenId] = false;
        verified[tokenId] = true;
        emit PropertyVerified(tokenId);
    }

    // I lock escrow after first set — use proposeEscrowUpdate for upgrades
    function setEscrowContract(address _escrow) external onlyOwner {
        require(!escrowLocked, "Escrow already set");
        require(_escrow != address(0), "Invalid escrow address");
        escrowContract = _escrow;
        escrowLocked = true;
        emit EscrowContractSet(_escrow);
    }

    // I enforce a 48-hour timelock on escrow updates to prevent instant hijack
    function proposeEscrowUpdate(address _escrow) external onlyOwner {
        require(_escrow != address(0), "Invalid escrow address");
        require(_escrow != escrowContract, "Same as current escrow");
        pendingEscrow = _escrow;
        pendingEscrowValidAfter = block.timestamp + ESCROW_UPDATE_DELAY;
        emit EscrowUpdateProposed(_escrow, pendingEscrowValidAfter);
    }

    function executeEscrowUpdate() external onlyOwner {
        require(pendingEscrow != address(0), "No pending escrow update");
        require(block.timestamp >= pendingEscrowValidAfter, "Timelock not expired");
        address old = escrowContract;
        escrowContract = pendingEscrow;
        pendingEscrow = address(0);
        pendingEscrowValidAfter = 0;
        emit EscrowContractUpdated(old, escrowContract);
    }

    function cancelEscrowUpdate() external onlyOwner {
        require(pendingEscrow != address(0), "No pending escrow update");
        pendingEscrow = address(0);
        pendingEscrowValidAfter = 0;
    }

    function setVerifiedLister(address lister, bool status) external onlyOwner {
        require(lister != address(0), "Invalid address");
        verifiedListers[lister] = status;
        emit VerifiedListerUpdated(lister, status);
    }

    // ─── List property ────────────────────────────────────────────

    function listProperty(
        string memory location,
        string memory latitude,
        string memory longitude,
        string memory size,
        uint256 price,
        string memory description,
        bytes32 docsHash,
        bytes memory sellerSig
    ) external onlyVerifiedLister whenNotPaused returns (uint256) {

        // CHECKS
        require(price > 0, "Price must be greater than zero");
        require(price <= 1_000_000 * 10**6, "Price exceeds maximum of 1M USDC");
        require(bytes(location).length > 0 && bytes(location).length <= 200, "Invalid location length");
        require(bytes(latitude).length > 0 && bytes(latitude).length <= 20, "Invalid latitude length");
        require(bytes(longitude).length > 0 && bytes(longitude).length <= 20, "Invalid longitude length");
        require(bytes(size).length > 0 && bytes(size).length <= 50, "Invalid size length");
        require(bytes(description).length <= 1000, "Description too long");
        require(docsHash != bytes32(0), "Docs hash required");

        // I verify seller signed the exact listing parameters on-chain
        bytes32 messageHash = keccak256(abi.encodePacked(
            location, latitude, longitude, size, price, docsHash
        ));
        bytes32 ethHash = MessageHashUtils.toEthSignedMessageHash(messageHash);
        address recovered = ECDSA.recover(ethHash, sellerSig);
        require(recovered == msg.sender, "Invalid seller signature");

        // EFFECTS
        tokenCount++;
        uint256 tokenId = tokenCount;

        properties[tokenId].location    = location;
        properties[tokenId].latitude    = latitude;
        properties[tokenId].longitude   = longitude;
        properties[tokenId].size        = size;
        properties[tokenId].price       = price;
        properties[tokenId].description = description;
        properties[tokenId].docsHash    = docsHash;
        properties[tokenId].sellerSig   = sellerSig;
        properties[tokenId].status      = Status.Available;

        // INTERACTIONS
        _safeMint(msg.sender, tokenId);

        // I collect listing fee after minting — fee is optional (0 by default)
        if (listingFee > 0) {
            IERC20(USDC).safeTransferFrom(msg.sender, feeRecipient, listingFee);
        }

        emit PropertyListed(tokenId, msg.sender, location);
        return tokenId;
    }

    // ─── Verification ─────────────────────────────────────────────

    // I let the seller request verification by paying the verification fee
    // Admin reviews off-chain documents and calls verifyProperty if approved
    function requestVerification(uint256 tokenId) external tokenExists(tokenId) {
        require(ownerOf(tokenId) == msg.sender,  "Only property owner can request");
        require(!verified[tokenId],               "Already verified");
        require(!verificationPending[tokenId],    "Verification already pending");

        // I collect verification fee — fee is optional (0 by default)
        if (verificationFee > 0) {
            require(feeRecipient != address(0), "Fee recipient not set");
            IERC20(USDC).safeTransferFrom(msg.sender, feeRecipient, verificationFee);
        }

        verificationPending[tokenId] = true;
        emit VerificationRequested(tokenId, msg.sender);
    }

    // ─── Transfer guard ───────────────────────────────────────────

    // I block all direct ERC-721 transfers — must go through escrow
    function _update(address to, uint256 tokenId, address auth)
        internal override returns (address) {
        address from = _ownerOf(tokenId);
        if (from != address(0) && _msgSender() != escrowContract) {
            revert("Use escrow to transfer property");
        }
        return super._update(to, tokenId, auth);
    }

    // ─── Escrow-only functions ────────────────────────────────────

    function updateStatus(uint256 tokenId, Status newStatus)
        external onlyEscrow tokenExists(tokenId) {
        properties[tokenId].status = newStatus;
        emit StatusUpdated(tokenId, newStatus);
    }

    function transferProperty(uint256 tokenId, address from, address to)
        external onlyEscrow tokenExists(tokenId) {
        require(from != address(0) && to != address(0), "Invalid addresses");
        require(ownerOf(tokenId) == from, "From is not current owner");
        properties[tokenId].previousOwners.push(from);
        properties[tokenId].status = Status.Sold;
        _transfer(from, to, tokenId);
        emit PropertyTransferred(tokenId, from, to);
    }

    // ─── Read functions ───────────────────────────────────────────

    function getProperty(uint256 tokenId)
        external view tokenExists(tokenId) returns (Property memory) {
        return properties[tokenId];
    }

    function getPreviousOwners(uint256 tokenId)
        external view tokenExists(tokenId) returns (address[] memory) {
        return properties[tokenId].previousOwners;
    }

    function getEscrowContract() external view returns (address) {
        return escrowContract;
    }
}
