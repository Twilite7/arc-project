// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/access/Ownable2Step.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";

contract PropertyRegistry is ERC721, Ownable2Step, Pausable {

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

    uint256 public tokenCount;
    mapping(uint256 => Property) public properties;
    mapping(address => bool) public verifiedListers;
    address public escrowContract;
    bool public escrowLocked;

    event PropertyListed(uint256 indexed tokenId, address indexed seller, string location);
    event StatusUpdated(uint256 indexed tokenId, Status status);
    event PropertyTransferred(uint256 indexed tokenId, address indexed from, address indexed to);
    event VerifiedListerUpdated(address indexed lister, bool status);
    event EscrowContractSet(address indexed escrow);

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

    // Admin: pause/unpause
    function pause() external onlyOwner { _pause(); }
    function unpause() external onlyOwner { _unpause(); }

    // Admin: set escrow contract — locked after first set
    function setEscrowContract(address _escrow) external onlyOwner {
        require(!escrowLocked, "Escrow already set");
        require(_escrow != address(0), "Invalid escrow address");
        escrowContract = _escrow;
        escrowLocked = true;
        emit EscrowContractSet(_escrow);
    }

    // I allow owner to update escrow after initial lock — for contract upgrades
    function updateEscrowContract(address _escrow) external onlyOwner {
        require(_escrow != address(0), "Invalid escrow address");

        escrowContract = _escrow;
        emit EscrowContractSet(_escrow);
    }


    // Admin: add or remove verified listers
    function setVerifiedLister(address lister, bool status) external onlyOwner {
        require(lister != address(0), "Invalid address");
        verifiedListers[lister] = status;
        emit VerifiedListerUpdated(lister, status);
    }

    // List a new property — mints a token
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
        require(price > 0, "Price must be greater than zero");
        require(bytes(location).length > 0, "Location required");
        require(bytes(latitude).length > 0, "Latitude required");
        require(bytes(longitude).length > 0, "Longitude required");
        require(docsHash != bytes32(0), "Docs hash required");

        // Verify seller signature on-chain
        bytes32 messageHash = keccak256(abi.encodePacked(
            location, latitude, longitude, size, price, docsHash
        ));
        bytes32 ethHash = MessageHashUtils.toEthSignedMessageHash(messageHash);
        address recovered = ECDSA.recover(ethHash, sellerSig);
        require(recovered == msg.sender, "Invalid seller signature");

        tokenCount++;
        uint256 tokenId = tokenCount;

        // Assign fields individually — avoids dynamic array struct issues
        properties[tokenId].location = location;
        properties[tokenId].latitude = latitude;
        properties[tokenId].longitude = longitude;
        properties[tokenId].size = size;
        properties[tokenId].price = price;
        properties[tokenId].description = description;
        properties[tokenId].docsHash = docsHash;
        properties[tokenId].sellerSig = sellerSig;
        properties[tokenId].status = Status.Available;

        _safeMint(msg.sender, tokenId);
        emit PropertyListed(tokenId, msg.sender, location);

        return tokenId;
    }

    // Block ALL direct ERC-721 transfers — must go through escrow
    function _update(address to, uint256 tokenId, address auth)
        internal override returns (address) {
        address from = _ownerOf(tokenId);
        // Allow minting (from == 0) but block all transfers not from escrow
        if (from != address(0) && msg.sender != escrowContract) {
            revert("Use escrow to transfer property");
        }
        return super._update(to, tokenId, auth);
    }

    // Called by escrow when buyer signs
    function attachBuyerSig(uint256 tokenId, bytes memory buyerSig)
        external onlyEscrow tokenExists(tokenId) {
        require(buyerSig.length > 0, "Invalid buyer signature");
        properties[tokenId].buyerSig = buyerSig;
    }

    // Called by escrow to update property status
    function updateStatus(uint256 tokenId, Status newStatus)
        external onlyEscrow tokenExists(tokenId) {
        properties[tokenId].status = newStatus;
        emit StatusUpdated(tokenId, newStatus);
    }

    // Called by escrow to finalize ownership transfer
    function transferProperty(uint256 tokenId, address from, address to)
        external onlyEscrow tokenExists(tokenId) {
        require(from != address(0) && to != address(0), "Invalid addresses");
        require(ownerOf(tokenId) == from, "From is not owner");
        properties[tokenId].previousOwners.push(from);
        properties[tokenId].status = Status.Sold;
        _transfer(from, to, tokenId);
        emit PropertyTransferred(tokenId, from, to);
    }

    // Read full property
    function getProperty(uint256 tokenId)
        external view tokenExists(tokenId) returns (Property memory) {
        return properties[tokenId];
    }

    // Read ownership history
    function getPreviousOwners(uint256 tokenId)
        external view tokenExists(tokenId) returns (address[] memory) {
        return properties[tokenId].previousOwners;
    }

    // Expose escrowContract for verification
    function getEscrowContract() external view returns (address) {
        return escrowContract;
    }
}
