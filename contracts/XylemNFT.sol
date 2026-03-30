// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

contract XylemNFT is ERC721, Ownable, ReentrancyGuard {
    uint256 public constant MAX_SUPPLY = 100;
    uint256 public constant MINT_PRICE = 0.0001 ether;
    uint256 public totalSupply;
    string private _baseTokenURI;
    mapping(address => bool) public whitelist;

    // Events
    event Whitelisted(address indexed wallet, bool status);
    event Withdrawn(address indexed to, uint256 amount);

    constructor(string memory baseURI) ERC721("XylemNFT", "XNFT") Ownable(msg.sender) {
        _baseTokenURI = baseURI;
    }

    // ─── Whitelist ───────────────────────────────────────────────

    function addToWhitelist(address wallet) external onlyOwner {
        require(wallet != address(0), "Zero address");
        whitelist[wallet] = true;
        emit Whitelisted(wallet, true);
    }

    function removeFromWhitelist(address wallet) external onlyOwner {
        whitelist[wallet] = false;
        emit Whitelisted(wallet, false);
    }

    // I batch whitelist to save gas for large drops
    function addToWhitelistBatch(address[] calldata wallets) external onlyOwner {
        for (uint256 i = 0; i < wallets.length; i++) {
            require(wallets[i] != address(0), "Zero address in batch");
            whitelist[wallets[i]] = true;
            emit Whitelisted(wallets[i], true);
        }
    }

    // ─── Mint ────────────────────────────────────────────────────

    // I use nonReentrant to block _safeMint callback reentrancy attacks
    function mint() external payable nonReentrant {
        require(whitelist[msg.sender], "Not whitelisted");
        require(msg.value == MINT_PRICE, "Wrong ETH amount");
        require(totalSupply < MAX_SUPPLY, "Sold out");
        totalSupply++;
        _safeMint(msg.sender, totalSupply);
    }

    // ─── Withdraw ────────────────────────────────────────────────

    // I use low-level call instead of transfer() to support smart contract owners
    function withdraw() external onlyOwner {
        uint256 balance = address(this).balance;
        require(balance > 0, "Nothing to withdraw");
        (bool ok, ) = payable(owner()).call{value: balance}("");
        require(ok, "Withdraw failed");
        emit Withdrawn(owner(), balance);
    }

    // ─── Internal ────────────────────────────────────────────────

    function _baseURI() internal view override returns (string memory) {
        return _baseTokenURI;
    }
}
