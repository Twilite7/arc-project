// SPDX-License-Identifier: MIT
pragma solidity ^0.8.8;

contract XylemUSD {
    // Metadata
    string public name = "XylemUSD";
    string public symbol = "XUSD";
    uint8 public decimals = 6;

    // Ownership
    address public owner;

    // Supply and balances
    uint256 public totalSupply;
    mapping(address => uint256) private _balances;
    mapping(address => mapping(address => uint256)) private _allowances;

    // Events
    event Transfer(address indexed from, address indexed to, uint256 amount);
    event Approval(address indexed owner, address indexed spender, uint256 amount);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    // Modifier
    modifier onlyOwner() {
        require(msg.sender == owner, "Not owner");
        _;
    }

    // Constructor
    constructor() {
        owner = msg.sender;
        totalSupply = 9999 * 10 ** 6;
        _balances[msg.sender] = totalSupply;
        emit Transfer(address(0), msg.sender, totalSupply);
    }

    // ─── Ownership ───────────────────────────────────────────────

    // I allow the owner to transfer ownership to a new address
    function transferOwnership(address newOwner) public onlyOwner {
        require(newOwner != address(0), "New owner is zero address");
        emit OwnershipTransferred(owner, newOwner);
        owner = newOwner;
    }

    // ─── Read functions ──────────────────────────────────────────

    function balanceOf(address account) public view returns (uint256) {
        return _balances[account];
    }

    function allowance(address _owner, address spender) public view returns (uint256) {
        return _allowances[_owner][spender];
    }

    // ─── Write functions ─────────────────────────────────────────

    function transfer(address to, uint256 amount) public returns (bool) {
        require(_balances[msg.sender] >= amount, "Insufficient balance");
        require(to != address(0), "Transfer to zero address");
        _balances[msg.sender] -= amount;
        _balances[to] += amount;
        emit Transfer(msg.sender, to, amount);
        return true;
    }

    // I set allowance directly — use increaseAllowance/decreaseAllowance
    // to avoid the frontrunning double-spend vulnerability
    function approve(address spender, uint256 amount) public returns (bool) {
        require(spender != address(0), "Approve to zero address");
        _allowances[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    // I safely increase allowance without frontrunning risk
    function increaseAllowance(address spender, uint256 addedValue) public returns (bool) {
        require(spender != address(0), "Approve to zero address");
        _allowances[msg.sender][spender] += addedValue;
        emit Approval(msg.sender, spender, _allowances[msg.sender][spender]);
        return true;
    }

    // I safely decrease allowance without frontrunning risk
    function decreaseAllowance(address spender, uint256 subtractedValue) public returns (bool) {
        require(spender != address(0), "Approve to zero address");
        require(_allowances[msg.sender][spender] >= subtractedValue, "Allowance below zero");
        _allowances[msg.sender][spender] -= subtractedValue;
        emit Approval(msg.sender, spender, _allowances[msg.sender][spender]);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) public returns (bool) {
        require(_balances[from] >= amount, "Insufficient balance");
        require(_allowances[from][msg.sender] >= amount, "Allowance exceeded");
        require(to != address(0), "Transfer to zero address");
        _allowances[from][msg.sender] -= amount;
        _balances[from] -= amount;
        _balances[to] += amount;
        emit Transfer(from, to, amount);
        // I emit Approval so indexers track the updated allowance
        emit Approval(from, msg.sender, _allowances[from][msg.sender]);
        return true;
    }

    // ─── Owner only ──────────────────────────────────────────────

    function mint(address to, uint256 amount) public onlyOwner {
        require(to != address(0), "Mint to zero address");
        totalSupply += amount;
        _balances[to] += amount;
        emit Transfer(address(0), to, amount);
    }

    // ─── Anyone can burn their own tokens ────────────────────────

    function burn(uint256 amount) public {
        require(_balances[msg.sender] >= amount, "Insufficient balance");
        _balances[msg.sender] -= amount;
        totalSupply -= amount;
        emit Transfer(msg.sender, address(0), amount);
    }
}
