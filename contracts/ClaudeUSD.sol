// SPDX-License-Identifier: MIT
pragma solidity ^0.8.8;

contract ClaudeUSD {
    string public name = "ClaudeUSD";
    string public symbol = "CUSD";
    uint256 public totalSupply = 9999;

    mapping(address => uint256) public balances;

    constructor() {
        balances[msg.sender] = totalSupply;
    }

    function transfer(address to, uint256 amount) public{
        require(balances[msg.sender] >= amount, "Insufficient balance");
        balances[msg.sender] -=amount;
        balances[to] += amount;
    }
}