// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @notice Hash-time locks for negotiated inventory exchange, not a bridge or price peg.
contract TigerInventory is ReentrancyGuard {
    using SafeERC20 for IERC20;
    struct Lock { address sender;address recipient;address token;uint256 amount;bytes32 secretHash;uint64 expiry;uint8 state; }
    mapping(bytes32=>Lock) public locks;
    event Locked(bytes32 indexed id,address indexed sender,address indexed recipient,address token,uint256 amount,bytes32 secretHash,uint64 expiry);
    event Claimed(bytes32 indexed id,bytes32 secret);event Refunded(bytes32 indexed id);
    error InvalidLock();error TransferFailed();error TransferTaxUnsupported();
    function lock(address token,address recipient,uint256 amount,bytes32 secretHash,uint64 expiry,bytes32 salt) external payable nonReentrant returns(bytes32 id){
        if(recipient==address(0)||recipient==msg.sender||amount==0||secretHash==bytes32(0)||expiry<block.timestamp+10 minutes||expiry>block.timestamp+30 days)revert InvalidLock();
        id=keccak256(abi.encode(block.chainid,address(this),msg.sender,token,recipient,amount,secretHash,expiry,salt));
        if(locks[id].state!=0)revert InvalidLock();
        locks[id]=Lock(msg.sender,recipient,token,amount,secretHash,expiry,1);
        if(token==address(0)){if(msg.value!=amount)revert InvalidLock();}
        else {if(msg.value!=0||token.code.length==0)revert InvalidLock();uint256 beforeBalance=IERC20(token).balanceOf(address(this));IERC20(token).safeTransferFrom(msg.sender,address(this),amount);if(IERC20(token).balanceOf(address(this))-beforeBalance!=amount)revert TransferTaxUnsupported();}
        emit Locked(id,msg.sender,recipient,token,amount,secretHash,expiry);
    }
    function claim(bytes32 id,bytes32 secret) external nonReentrant {Lock storage l=locks[id];if(l.state!=1||block.timestamp>=l.expiry||keccak256(abi.encodePacked(secret))!=l.secretHash)revert InvalidLock();l.state=2;_send(l.token,l.recipient,l.amount);emit Claimed(id,secret);}
    function refund(bytes32 id) external nonReentrant {Lock storage l=locks[id];if(l.state!=1||block.timestamp<l.expiry)revert InvalidLock();l.state=3;_send(l.token,l.sender,l.amount);emit Refunded(id);}
    function _send(address token,address recipient,uint256 amount) private {if(token==address(0)){(bool ok,)=recipient.call{value:amount}("");if(!ok)revert TransferFailed();}else{uint256 beforeBalance=IERC20(token).balanceOf(recipient);IERC20(token).safeTransfer(recipient,amount);if(IERC20(token).balanceOf(recipient)-beforeBalance!=amount)revert TransferTaxUnsupported();}}
}
