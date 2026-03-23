// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

contract ClaudeNFT is ERC721, Ownable {
    uint256 public constant MAX_SUPPLY = 100;
    uint256 public constant MINT_PRICE = 0.0001 ether;
    uint256 public totalSupply;
    string private _baseTokenURI;

    mapping(address => bool) public whitelist;

    constructor(string memory baseURI) ERC721("ClaudeNFT", "CNFT") Ownable(msg.sender) {
        _baseTokenURI = baseURI;
    }

    function addToWhitelist(address wallet) external onlyOwner {
        whitelist[wallet] = true;
    }

    function removeFromWhitelist(address wallet) external onlyOwner {
        whitelist[wallet] = false;
    }

    function mint() external payable {
        require(whitelist[msg.sender], "Not whitelisted");
        require(msg.value == MINT_PRICE, "Wrong ETH amount");
        require(totalSupply < MAX_SUPPLY, "Sold out");
        totalSupply++;
        _safeMint(msg.sender, totalSupply);
    }

    function withdraw() external onlyOwner {
        uint256 balance = address(this).balance;
        require(balance > 0, "Nothing to withdraw");
        payable(owner()).transfer(balance);
    }

    function _baseURI() internal view override returns (string memory) {
        return _baseTokenURI;
    }
}
