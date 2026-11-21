// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";
import {VaultBaseV3} from "./flap/VaultBaseV3.sol";
import {VaultFactoryBaseV2} from "./flap/VaultFactoryBaseV2.sol";
import {IVaultFactoryDividendV23,IVaultFactoryValidationV2} from "./flap/IVaultFactory.sol";
import {VaultUISchema,VaultMethodSchema,VaultDataSchema,FieldDescriptor,ApproveAction} from "./flap/IVaultSchemasV1.sol";

/// @notice Records per-token tax revenue in the selected quote asset.
contract TigerReserve is VaultBaseV3, ReentrancyGuard {
    using SafeERC20 for IERC20;
    address public immutable taxToken;
    address public immutable dev;
    address public immutable quoteToken;
    uint256 public accountedQuote;
    uint256 public totalRevenue;
    bool public paused;
    event Revenue(uint256 amount,uint256 total);
    event Withdrawn(address indexed actor,address indexed recipient,uint256 amount);
    event Rescued(address indexed actor,address indexed asset,address indexed recipient,uint256 amount);
    event Resumed(address indexed actor);
    error Unauthorized();error InvalidParameter();error TransferFailed();error Paused();
    modifier authority(){if(msg.sender!=dev&&msg.sender!=_getGuardian())revert Unauthorized();_;}
    constructor(address token,address quote,address creator){if(token==address(0)||creator==address(0)||(quote!=address(0)&&quote.code.length==0))revert InvalidParameter();taxToken=token;quoteToken=quote;dev=creator;}
    receive() external payable {_sync();}
    function vaultQuoteToken() public view override returns(address){return quoteToken;}
    function _balance() private view returns(uint256){return quoteToken==address(0)?address(this).balance:IERC20(quoteToken).balanceOf(address(this));}
    function _sync() private {uint256 current=_balance();if(current>accountedQuote){uint256 delta=current-accountedQuote;accountedQuote=current;totalRevenue+=delta;emit Revenue(delta,totalRevenue);}else if(current<accountedQuote){accountedQuote=current;}}
    function sync() external {_sync();}
    function withdraw(uint256 amount,address recipient) external authority nonReentrant {if(paused)revert Paused();_sync();if(recipient==address(0)||recipient==address(this)||amount==0||amount>accountedQuote)revert InvalidParameter();accountedQuote-=amount;_send(quoteToken,recipient,amount);accountedQuote=_balance();emit Withdrawn(msg.sender,recipient,amount);}
    function rescue(address asset) external authority nonReentrant {_sync();paused=true;uint256 amount=asset==address(0)?address(this).balance:IERC20(asset).balanceOf(address(this));if(asset==quoteToken)accountedQuote=0;_send(asset,dev,amount);accountedQuote=_balance();emit Rescued(msg.sender,asset,dev,amount);}
    function resume() external authority {_sync();paused=false;emit Resumed(msg.sender);}
    function _send(address asset,address to,uint256 amount) private {if(amount==0)return;if(asset==address(0)){(bool ok,)=to.call{value:amount}("");if(!ok)revert TransferFailed();}else IERC20(asset).safeTransfer(to,amount);}
    function description() public view override returns(string memory){return string.concat(paused?"Dark reserve paused. ":"Dark reserve active. ","Accounted quote units: ",Strings.toString(accountedQuote));}
    function vaultUISchema() public pure override returns(VaultUISchema memory s){
        s.vaultType="Dark Reserve";s.description=unicode"记录本币金库收到的底池资产及累计收入。";s.methods=new VaultMethodSchema[](5);
        for(uint256 i;i<5;i++){s.methods[i].inputs=new FieldDescriptor[](0);s.methods[i].outputs=new FieldDescriptor[](0);s.methods[i].approvals=new ApproveAction[](0);}
        s.methods[0].name="accountedQuote";s.methods[0].description=unicode"已记账底池资产（最小单位；精度以底池为准）";s.methods[0].outputs=new FieldDescriptor[](1);s.methods[0].outputs[0]=FieldDescriptor("amount","uint256",unicode"资产最小单位",0);
        s.methods[1].name="sync";s.methods[1].description=unicode"同步新增收入，任何人可调用";s.methods[1].isWriteMethod=true;
        s.methods[2].name="withdraw";s.methods[2].description=unicode"按指定金额和收款地址支取底池资产";s.methods[2].isWriteMethod=true;s.methods[2].inputs=new FieldDescriptor[](2);s.methods[2].inputs[0]=FieldDescriptor("amount","uint256",unicode"底池资产最小单位",0);s.methods[2].inputs[1]=FieldDescriptor("recipient","address",unicode"收款地址",0);
        s.methods[3].name="rescue";s.methods[3].description=unicode"将所选资产的全部余额转给固定的创建者地址，并暂停普通支取";s.methods[3].isWriteMethod=true;s.methods[3].inputs=new FieldDescriptor[](1);s.methods[3].inputs[0]=FieldDescriptor("asset","address",unicode"零地址表示原生币",0);
        s.methods[4].name="resume";s.methods[4].description=unicode"恢复普通支取";s.methods[4].isWriteMethod=true;
    }
}
contract TigerReserveFactory is VaultFactoryBaseV2,IVaultFactoryDividendV23 {
    mapping(address=>address) public vaultOf;
    event ReserveCreated(address indexed token,address indexed vault,address indexed creator,address quoteToken);
    error InvalidParameters();
    function factorySpecVersion() public pure override returns(string memory){return "v2.3";}
    function isQuoteTokenSupported(address quote) public view override returns(bool){return quote==address(0)||quote.code.length>0;}
    function newVault(address taxToken,address quoteToken,address creator,bytes calldata data) external override returns(address vault){
        if(msg.sender!=_getVaultPortal())revert OnlyVaultPortal();
        if(taxToken==address(0)||creator==address(0)||vaultOf[taxToken]!=address(0)||!isQuoteTokenSupported(quoteToken)||data.length!=0)revert InvalidParameters();
        // The taxToken is only predicted here; do not call it before Flap deploys it.
        vault=address(new TigerReserve(taxToken,quoteToken,creator));vaultOf[taxToken]=vault;emit ReserveCreated(taxToken,vault,creator,quoteToken);
    }
    function _validateBeforeLaunch(IVaultFactoryValidationV2.LaunchValidationDataV1 memory p) internal view override returns(bool,string memory){return isQuoteTokenSupported(p.quoteToken)?(true,""):(false,"Quote token has no code");}
    function resolveDividendToken(address predictedToken,uint8,bytes calldata) external pure override returns(address){return predictedToken;}
    function vaultDataSchema() public pure override returns(VaultDataSchema memory s){s.description=unicode"为每枚代币创建独立的税收金库，以所选底池资产记账。无需额外参数。";s.fields=new FieldDescriptor[](0);s.isArray=false;}
}
