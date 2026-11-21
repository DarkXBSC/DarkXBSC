// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";

/// @notice Creator-authored project links. Peer-chain claims are not bridge proofs.
contract TigerRegistry is Ownable2Step {
    struct Project { address creator; address token; uint256 peerChain; address peerToken; string metadataURI; bool attested; }
    mapping(bytes32 => Project) private projects;
    bytes32[] private ids;
    event ProjectRegistered(bytes32 indexed id, address indexed creator, address indexed token, uint256 peerChain, address peerToken, string metadataURI);
    event ProjectUpdated(bytes32 indexed id, uint256 peerChain, address peerToken, string metadataURI);
    event Attested(bytes32 indexed id, bool attested);
    error InvalidProject(); error Unauthorized();
    constructor(address initialOwner) Ownable(initialOwner) {}
    function register(address token, uint256 peerChain, address peerToken, string calldata uri) external returns(bytes32 id) {
        if(token.code.length == 0 || bytes(uri).length > 4096 || ((peerChain == 0) != (peerToken == address(0))) || peerChain == block.chainid) revert InvalidProject();
        id = keccak256(abi.encode(block.chainid, msg.sender, token));
        if(projects[id].creator != address(0)) revert InvalidProject();
        projects[id] = Project(msg.sender, token, peerChain, peerToken, uri, false); ids.push(id);
        emit ProjectRegistered(id,msg.sender,token,peerChain,peerToken,uri);
    }
    function update(bytes32 id,uint256 peerChain,address peerToken,string calldata uri) external {
        Project storage p=projects[id]; if(p.creator!=msg.sender) revert Unauthorized();
        if(bytes(uri).length>4096 || ((peerChain==0)!=(peerToken==address(0))) || peerChain==block.chainid) revert InvalidProject();
        p.peerChain=peerChain;p.peerToken=peerToken;p.metadataURI=uri;p.attested=false;
        emit ProjectUpdated(id,peerChain,peerToken,uri);
    }
    function attest(bytes32 id,bool value) external onlyOwner { if(projects[id].creator==address(0)) revert InvalidProject();projects[id].attested=value;emit Attested(id,value); }
    function project(bytes32 id) external view returns(Project memory){return projects[id];}
    function count() external view returns(uint256){return ids.length;}
    function page(uint256 offset,uint256 limit) external view returns(bytes32[] memory out){
        if(limit>100) limit=100;if(offset>=ids.length) return new bytes32[](0);
        uint256 n=ids.length-offset;if(n>limit)n=limit;out=new bytes32[](n);for(uint256 i;i<n;++i)out[i]=ids[offset+i];
    }
}
