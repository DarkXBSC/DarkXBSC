// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {VaultBaseV3} from "./flap/VaultBaseV3.sol";
import {VaultFactoryBaseV2} from "./flap/VaultFactoryBaseV2.sol";
import {IVaultFactoryDividendV23, IVaultFactoryValidationV2} from "./flap/IVaultFactory.sol";
import {VaultUISchema, VaultDataSchema, VaultMethodSchema, FieldDescriptor, ApproveAction} from "./flap/IVaultSchemasV1.sol";

/// @notice One quote asset and one issuer per Flap token. Amounts are in quote base units.
contract TigerCommissionVault is VaultBaseV3, ReentrancyGuard, EIP712 {
    using SafeERC20 for IERC20;
    address public constant AGENT_ID = 0x60B9262456dE011F7d15a54CdD8c48bAaa8B022F;
    bytes32 private constant ENTRY_TYPEHASH = keccak256("CommissionEntry(bytes32 brief,address author,string caption)");
    address public immutable issuer;
    address public immutable token;
    address public immutable asset;
    uint16 public immutable shareBps;
    uint256 public reserved;
    uint256 public authorsPaid;
    uint256 public issuerPaid;

    struct Budget { uint256 amount; uint64 deadline; uint64 settledBlock; address author; bytes32 captionHash; }
    mapping(bytes32 => Budget) public budgets;
    event Opened(bytes32 indexed brief, uint256 amount, uint64 deadline);
    event Awarded(bytes32 indexed brief, address indexed author, bytes32 captionHash, uint256 amount);
    event Released(bytes32 indexed brief, uint256 amount);
    event IssuerPaid(address indexed issuer, uint256 amount);
    error Unauthorized(); error InvalidTerms(); error InsufficientFunds(); error Closed(); error TransferFailed();

    constructor(address token_, address asset_, address issuer_, uint16 share_) EIP712("Dark Paid Work","1") {
        if (token_==address(0) || issuer_==address(0) || share_==0 || share_>10000) revert InvalidTerms();
        token=token_; asset=asset_; issuer=issuer_; shareBps=share_;
    }
    receive() external payable {}
    modifier onlyIssuer(){if(msg.sender!=issuer) revert Unauthorized();_;}
    function vaultQuoteToken() public view override returns(address){return asset;}
    function description() public pure override returns(string memory){return "Flap tax for Agent ID public-interest commissions";}
    function vaultUISchema() public pure override returns(VaultUISchema memory s){
        s.vaultType="Dark Agent Commissions"; s.description="Net tax allocated to Agent ID work, in quote base units.";
        s.methods=new VaultMethodSchema[](1);
        s.methods[0].name="available";s.methods[0].description="Available commission budget and issuer share";
        s.methods[0].inputs=new FieldDescriptor[](0); s.methods[0].approvals=new ApproveAction[](0);
        s.methods[0].outputs=new FieldDescriptor[](2);
        s.methods[0].outputs[0]=FieldDescriptor("giving","uint256","Uncommitted public-interest amount",0);
        s.methods[0].outputs[1]=FieldDescriptor("creator","uint256","Available issuer share",0);
    }
    function balance() public view returns(uint256){return asset==address(0)?address(this).balance:IERC20(asset).balanceOf(address(this));}
    function available() public view returns(uint256 giving,uint256 creator){
        uint256 gross=balance()+authorsPaid+issuerPaid;
        uint256 allocation=Math.mulDiv(gross,shareBps,10000);
        uint256 used=reserved+authorsPaid;
        giving=allocation>used?allocation-used:0;
        uint256 remainder=gross-allocation;
        creator=remainder>issuerPaid?remainder-issuerPaid:0;
    }
    function open(bytes32 brief,uint256 amount,uint64 deadline) external onlyIssuer nonReentrant {
        if(brief==bytes32(0)||amount==0||budgets[brief].amount!=0||deadline<=block.timestamp||deadline>block.timestamp+90 days)revert InvalidTerms();
        (uint256 uncommitted,)=available();if(amount>uncommitted)revert InsufficientFunds();
        budgets[brief]=Budget(amount,deadline,0,address(0),0);reserved+=amount;emit Opened(brief,amount,deadline);
    }
    function award(bytes32 brief,address author,string calldata caption,bytes calldata signature) external onlyIssuer nonReentrant {
        Budget storage b=budgets[brief];
        if(b.amount==0||b.settledBlock!=0||block.timestamp>=b.deadline)revert Closed();
        bytes32 work=keccak256(bytes(caption));
        bytes32 digest=_hashTypedDataV4(keccak256(abi.encode(ENTRY_TYPEHASH,brief,author,work)));
        if(author==address(0)||author==address(this)||ECDSA.recover(digest,signature)!=author||IERC20(AGENT_ID).balanceOf(author)==0)revert Unauthorized();
        b.author=author;b.captionHash=work;b.settledBlock=uint64(block.number);
        reserved-=b.amount;authorsPaid+=b.amount;
        _send(author,b.amount);emit Awarded(brief,author,work,b.amount);
    }
    function expire(bytes32 brief) external nonReentrant {
        Budget storage b=budgets[brief];
        if(b.amount==0||b.settledBlock!=0||block.timestamp<b.deadline)revert Closed();
        b.settledBlock=uint64(block.number);reserved-=b.amount;emit Released(brief,b.amount);
    }
    function withdrawIssuer(uint256 amount) external onlyIssuer nonReentrant{
        (,uint256 due)=available();if(amount==0||amount>due||balance()<amount+reserved)revert InsufficientFunds();
        issuerPaid+=amount;_send(issuer,amount);emit IssuerPaid(issuer,amount);
    }
    function _send(address recipient,uint256 amount) private {
        if(asset==address(0)){
            (bool ok,)=payable(recipient).call{value:amount}("");if(!ok)revert TransferFailed();
        }else{
            IERC20 quote=IERC20(asset);uint256 beforeBalance=quote.balanceOf(recipient);uint256 beforeVault=quote.balanceOf(address(this));
            quote.safeTransfer(recipient,amount);
            if(quote.balanceOf(recipient)!=beforeBalance+amount||quote.balanceOf(address(this))+amount!=beforeVault)revert TransferFailed();
        }
    }
}
contract TigerCommissionFactory is VaultFactoryBaseV2, IVaultFactoryDividendV23 {
    mapping(address=>address) public vaultOf;
    event Created(address indexed token,address indexed vault,address indexed issuer,uint16 shareBps);
    function factorySpecVersion() public pure override returns(string memory){return "v2.3";}
    function isQuoteTokenSupported(address quote) public view override returns(bool){return quote==address(0)||quote.code.length>0;}
    function newVault(address token,address quote,address creator,bytes calldata data) external override returns(address vault){
        if(msg.sender!=_getVaultPortal())revert OnlyVaultPortal();
        require(vaultOf[token]==address(0)&&isQuoteTokenSupported(quote)&&data.length==32,"Invalid vault");
        uint16 share=abi.decode(data,(uint16));
        vault=address(new TigerCommissionVault(token,quote,creator,share));
        vaultOf[token]=vault;emit Created(token,vault,creator,share);
    }
    function _validateBeforeLaunch(IVaultFactoryValidationV2.LaunchValidationDataV1 memory p) internal view override returns(bool,string memory){
        return isQuoteTokenSupported(p.quoteToken)&&p.vaultBps>0?(true,""):(false,"A funded tax route is required");
    }
    function resolveDividendToken(address predictedToken,uint8,bytes calldata) external pure override returns(address){return predictedToken;}
    function vaultDataSchema() public pure override returns(VaultDataSchema memory s){
        s.description="Share of received quote revenue reserved for commissions (1 to 10000 bps).";
        s.fields=new FieldDescriptor[](1);s.fields[0]=FieldDescriptor("shareBps","uint16","Commission share, basis points",0);
    }
}
