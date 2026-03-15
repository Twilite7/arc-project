// SPDX-License-Identifier: MIT
pragma solidity ^0.8.8;

contract ClaudeUSD {
    string public name = "ClaudeUSD";
    string public symbol = "CUSD";
    uint256 public totalSupply = 9999;

    mapping(address => uint256) public balances;
    mapping(address => mapping(address => uint256)) public allowances;

    constructor() {
        balances[msg.sender] = totalSupply;
    }

    function transfer(address to, uint256 amount) public {
        require(balances[msg.sender] >= amount, "Insufficient balance");
        balances[msg.sender] -=amount;
        balances[to] += amount;
    }

    function approve(address spender, uint256 amount) public {
        allowances[msg.sender][spender] = amount;
    }

    function transferFrom(address from, address to, uint256 amount) public {
        require (balances[from] >= amount, "Insufficient balance");
        require(allowances[from][msg.sender] >= amount, "Not approved");
        allowances[from][msg.sender] -= amount;
        balances[from] -= amount;
        balances[to] += amount;
    }
}