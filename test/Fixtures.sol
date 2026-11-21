// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
contract TestToken is ERC20 {uint8 private immutable units;uint256 public tax;constructor(string memory n,uint8 d)ERC20(n,n){units=d;_mint(msg.sender,1_000_000*10**d);}function decimals()public view override returns(uint8){return units;}function setTax(uint256 t)external{tax=t;}function _update(address f,address t,uint256 v)internal override{if(f!=address(0)&&t!=address(0)&&tax>0){uint256 fee=v*tax/10000;super._update(f,address(0),fee);super._update(f,t,v-fee);}else super._update(f,t,v);}}
contract TestAgent {mapping(address=>uint256)public balanceOf;function grant(address a)external{balanceOf[a]=1;}}
contract ContractMaker {address immutable owner;constructor(address a){owner=a;}function isValidSignature(bytes32 hash,bytes calldata sig)external view returns(bytes4){return ECDSA.recover(hash,sig)==owner?bytes4(0x1626ba7e):bytes4(0xffffffff);}function approve(address token,address spender,uint256 amount)external{require(msg.sender==owner);IERC20(token).approve(spender,amount);}}
