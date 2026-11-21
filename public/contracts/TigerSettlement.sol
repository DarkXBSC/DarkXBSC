// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {SignatureChecker} from "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";
interface IAgentID { function balanceOf(address account) external view returns(uint256); }

/// @notice Private EIP-712 quotes; settlement is public onchain. No custody or privileged withdrawals.
contract TigerSettlement is EIP712, ReentrancyGuard {
    using SafeERC20 for IERC20;
    struct Order { address maker; address taker; address sellToken; address buyToken; uint256 sellAmount; uint256 buyAmount; uint256 expiry; uint256 nonce; bool agentOnly; }
    bytes32 public constant ORDER_TYPEHASH=keccak256("Order(address maker,address taker,address sellToken,address buyToken,uint256 sellAmount,uint256 buyAmount,uint256 expiry,uint256 nonce,bool agentOnly)");
    address public immutable feeRecipient;
    uint16 public constant FEE_BPS=30;
    address public immutable agentRegistry;
    mapping(address=>mapping(uint256=>bool)) public nonceUsed;
    event Settled(bytes32 indexed orderHash,address indexed maker,address indexed taker,address sellToken,address buyToken,uint256 sellAmount,uint256 received,uint256 buyAmount,uint256 fee);
    event Cancelled(address indexed maker,uint256 indexed nonce);
    error InvalidOrder();error SignatureInvalid();error AgentRequired();error UnsupportedQuoteToken();error InsufficientReceived();
    constructor(address recipient,address registry) EIP712("TigerSettlement","1") {if(recipient==address(0))revert InvalidOrder();if(registry!=address(0)&&registry.code.length==0)revert InvalidOrder();feeRecipient=recipient;agentRegistry=registry;}
    function hashOrder(Order calldata o) public view returns(bytes32){return _hashTypedDataV4(keccak256(abi.encode(ORDER_TYPEHASH,o.maker,o.taker,o.sellToken,o.buyToken,o.sellAmount,o.buyAmount,o.expiry,o.nonce,o.agentOnly)));}
    function eligible(address account) public view returns(bool){if(agentRegistry==address(0))return false;try IAgentID(agentRegistry).balanceOf(account) returns(uint256 n){return n>0;}catch{return false;}}
    function feeFor(uint256 amount) public pure returns(uint256){return amount*FEE_BPS/10000;}
    function cancel(uint256 nonce) external {nonceUsed[msg.sender][nonce]=true;emit Cancelled(msg.sender,nonce);}
    function settle(Order calldata o,bytes calldata signature,uint256 minReceived) external nonReentrant {
        if(o.maker==address(0)||o.maker==msg.sender||o.sellToken==o.buyToken||o.sellToken.code.length==0||o.buyToken.code.length==0||o.sellAmount==0||o.buyAmount==0||block.timestamp>=o.expiry||nonceUsed[o.maker][o.nonce]||(o.taker!=address(0)&&o.taker!=msg.sender))revert InvalidOrder();
        bytes32 digest=hashOrder(o);if(!SignatureChecker.isValidSignatureNow(o.maker,digest,signature))revert SignatureInvalid();
        if(o.agentOnly&&(!eligible(o.maker)||!eligible(msg.sender)))revert AgentRequired();
        nonceUsed[o.maker][o.nonce]=true;
        uint256 beforeSell=IERC20(o.sellToken).balanceOf(msg.sender);
        IERC20(o.sellToken).safeTransferFrom(o.maker,msg.sender,o.sellAmount);
        uint256 received=IERC20(o.sellToken).balanceOf(msg.sender)-beforeSell;if(received==0||received<minReceived)revert InsufficientReceived();
        uint256 fee=feeFor(o.buyAmount);
        _payExact(o.buyToken,msg.sender,o.maker,o.buyAmount);
        if(fee>0)_payExact(o.buyToken,msg.sender,feeRecipient,fee);
        emit Settled(digest,o.maker,msg.sender,o.sellToken,o.buyToken,o.sellAmount,received,o.buyAmount,fee);
    }
    function _payExact(address token,address from,address to,uint256 amount) private {
        // A fee recipient may itself be the taker: retaining its fee is equivalent to paying itself.
        if(from==to)return;
        uint256 beforeBalance=IERC20(token).balanceOf(to);IERC20(token).safeTransferFrom(from,to,amount);
        if(IERC20(token).balanceOf(to)-beforeBalance!=amount)revert UnsupportedQuoteToken();
    }
}
