// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/access/Ownable2Step.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

// I define only the ERC-8004 ValidationRegistry functions we call
interface IERC8004Validation {
    function validationRequest(
        address validator,
        uint256 agentId,
        string calldata uri,
        bytes32 requestHash
    ) external;

    function getValidationStatus(bytes32 requestHash) external view returns (
        address validator,
        uint256 agentId,
        uint8   score,
        uint8   status,
        string  memory tags,
        uint256 timestamp
    );
}

interface IERC8004Identity {
    function ownerOf(uint256 agentId) external view returns (address);
}

contract PropertyRegistry is ERC721, Ownable2Step, Pausable {

    using ECDSA for bytes32;
    using SafeERC20 for IERC20;

    // I use Arc native USDC for all platform fees
    address public constant USDC = 0x3600000000000000000000000000000000000000;
    // I point to ERC-8004 ValidationRegistry and IdentityRegistry on Arc Testnet
    address public constant VALIDATION_REGISTRY = 0x8004Cb1BF31DAf7788923b405b754f57acEB4272;
    address public constant IDENTITY_REGISTRY   = 0x8004A818BFB912233c491871b3d84c89A494BD9e;
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

    // I store ERC-8004 validation request hashes per token
    // This is the key linking a property to its ERC-8004 validation
    mapping(uint256 => bytes32) public validationRequestHashes;
    // I prevent the same documents from being listed twice
    mapping(bytes32 => bool) public usedDocsHashes;

    address public escrowContract;
    bool public escrowLocked;

    address public pendingEscrow;
    uint256 public pendingEscrowValidAfter;
    uint256 public constant ESCROW_UPDATE_DELAY = 48 hours;

    // I store platform fee config — both fees default to 0
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
    event VerificationRequested(uint256 indexed tokenId, address indexed seller, bytes32 requestHash);
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

    function setFees(
        uint256 _listingFee,
        uint256 _verificationFee,
        address _feeRecipient
    ) external onlyOwner {
        require(_listingFee <= MAX_FEE,      "Listing fee exceeds maximum");
        require(_verificationFee <= MAX_FEE, "Verification fee exceeds maximum");
        if (_listingFee > 0 || _verificationFee > 0) {
            require(_feeRecipient != address(0), "Fee recipient required");
        }
        listingFee      = _listingFee;
        verificationFee = _verificationFee;
        feeRecipient    = _feeRecipient;
        emit FeesUpdated(_listingFee, _verificationFee, _feeRecipient);
    }

    function setEscrowContract(address _escrow) external onlyOwner {
        require(!escrowLocked, "Escrow already set");
        require(_escrow != address(0), "Invalid escrow address");
        escrowContract = _escrow;
        escrowLocked = true;
        emit EscrowContractSet(_escrow);
    }

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

        require(price > 0,                         "Price must be greater than zero");
        require(price <= 1_000_000 * 10**6,        "Price exceeds maximum of 1M USDC");
        require(bytes(location).length > 0 &&
                bytes(location).length <= 200,      "Invalid location length");
        require(bytes(latitude).length > 0 &&
                bytes(latitude).length <= 20,       "Invalid latitude length");
        require(bytes(longitude).length > 0 &&
                bytes(longitude).length <= 20,      "Invalid longitude length");
        require(bytes(size).length > 0 &&
                bytes(size).length <= 50,           "Invalid size length");
        require(bytes(description).length <= 1000, "Description too long");
        require(docsHash != bytes32(0),             "Docs hash required");
        require(!usedDocsHashes[docsHash],           "Documents already used in another listing");
        require(sellerSig.length == 65,              "Seller signature required");

        bytes32 messageHash = keccak256(abi.encodePacked(
            location, latitude, longitude, size, price, docsHash
        ));
        bytes32 ethHash = MessageHashUtils.toEthSignedMessageHash(messageHash);
        address recovered = ECDSA.recover(ethHash, sellerSig);
        require(recovered == msg.sender, "Invalid seller signature");

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

        _safeMint(msg.sender, tokenId);
        usedDocsHashes[docsHash] = true;

        // I collect listing fee after minting — 0 by default
        if (listingFee > 0) {
            IERC20(USDC).safeTransferFrom(msg.sender, feeRecipient, listingFee);
        }

        emit PropertyListed(tokenId, msg.sender, location);
        return tokenId;
    }

    // ─── ERC-8004 Verification ────────────────────────────────────

    // I let the seller request property verification via ERC-8004 ValidationRegistry.
    // Seller must have registered an ERC-8004 identity (agentId) beforehand.
    // Flow:
    //   1. Seller calls ERC-8004 validationRequest(admin, agentId, docsURI, requestHash) directly
    //   2. Seller calls recordValidationRequest() here to store the hash on-chain
    //   3. Admin calls ERC-8004 validationResponse() directly to approve or reject
    //   4. buyNow checks isVerified() which reads stored hash from ERC-8004
    // The requestHash MUST be keccak256(tokenId, seller, docsHash) — derived from
    // the immutable docsHash committed at listProperty time, not a mutable URI.
    // This binds each validation to specific documents for a specific property,
    // preventing reuse of an approval across different listings.
    function recordValidationRequest(
        uint256 tokenId,
        uint256 agentId,
        bytes32 requestHash
    ) external tokenExists(tokenId) {
        require(ownerOf(tokenId) == msg.sender, "Only property owner");
        require(requestHash != bytes32(0),       "Invalid request hash");

        // I verify the agentId is owned by the seller — prevents using someone else's identity
        require(
            IERC8004Identity(IDENTITY_REGISTRY).ownerOf(agentId) == msg.sender,
            "Agent ID not owned by seller"
        );

        // I enforce the canonical hash formula using the on-chain docsHash
        // Seller cannot forge this because docsHash was committed at listProperty
        bytes32 expected = keccak256(
            abi.encodePacked(tokenId, msg.sender, properties[tokenId].docsHash)
        );
        require(requestHash == expected, "Hash must encode tokenId, seller, and docsHash");

        // I verify this hash exists in ERC-8004 and was submitted to our platform admin
        // and that the agentId in the request matches the seller's agent
        try IERC8004Validation(VALIDATION_REGISTRY).getValidationStatus(requestHash)
            returns (address validator, uint256 requestAgentId, uint8, uint8, string memory, uint256)
        {
            require(validator == owner(),       "Validator must be platform admin");
            require(requestAgentId == agentId,  "Agent ID mismatch in ERC-8004 request");
        } catch {
            revert("Request hash not found in ERC-8004");
        }

        // I allow re-verification only if previous attempt was rejected (score == 0)
        bytes32 existing = validationRequestHashes[tokenId];
        if (existing != bytes32(0)) {
            try IERC8004Validation(VALIDATION_REGISTRY).getValidationStatus(existing)
                returns (address, uint256, uint8 score, uint8, string memory, uint256)
            {
                require(score == 0, "Already verified or pending");
            } catch {
                // I allow re-record if ERC-8004 has no status for the existing hash
            }
        }

        // I collect verification fee — 0 by default
        if (verificationFee > 0) {
            require(feeRecipient != address(0), "Fee recipient not set");
            IERC20(USDC).safeTransferFrom(msg.sender, feeRecipient, verificationFee);
        }

        validationRequestHashes[tokenId] = requestHash;
        emit VerificationRequested(tokenId, msg.sender, requestHash);
    }

    // I return whether a property has been verified via ERC-8004
    function isVerified(uint256 tokenId) external view tokenExists(tokenId) returns (bool) {
        bytes32 requestHash = validationRequestHashes[tokenId];
        if (requestHash == bytes32(0)) return false;
        try IERC8004Validation(VALIDATION_REGISTRY).getValidationStatus(requestHash)
            returns (address, uint256, uint8 score, uint8, string memory, uint256)
        {
            return score > 0;
        } catch {
            return false;
        }
    }

    // ─── Transfer guard ───────────────────────────────────────────

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
