// Official @railgun-community/shared-models 8.2.3 network-config;
// BSC deployed code and fees checked, 2026-11-24.
export const railgunNetworks = {
  bsc: {
    id: 56,
    name: "BSC",
    native: "BNB",
    proxy: "0x590162bf4b50f6576a459b75309ee21d92178a10",
    relay: "0xF82d00fC51F730F42A00F85E74895a2849ffF2Dd",
    wrapped: "0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c",
    assets: [
      {
        symbol: "USDT",
        address: "0x55d398326f99059ff775485246999027b3197955",
        decimals: 18,
      },
      {
        symbol: "USDC",
        address: "0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d",
        decimals: 18,
      },
      {
        symbol: "WBNB",
        address: "0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c",
        decimals: 18,
      },
    ],
  },
};
export function railgunNetwork(chain) {
  if (!Object.hasOwn(railgunNetworks, chain))
    throw Error("RAILGUN_NETWORK_UNSUPPORTED");
  return railgunNetworks[chain];
}
export function shieldAmounts(amount, feeBps) {
  if (amount <= 0n || amount >= 2n ** 120n) throw Error("INVALID_AMOUNT");
  if (feeBps < 0n || feeBps >= 10000n) throw Error("RAILGUN_FEE_UNAVAILABLE");
  const fee = (amount * feeBps) / 10000n;
  return { fee, receive: amount - fee };
}
export const railgunAbi = [
  "function shieldFee() view returns(uint120)",
  "function unshieldFee() view returns(uint120)",
  "function getFee(uint136 amount,bool inclusive,uint120 bps) pure returns(uint120,uint120)",
  "function tokenBlocklist(address) view returns(bool)",
  "function shield(((bytes32 npk,(uint8 tokenType,address tokenAddress,uint256 tokenSubID) token,uint120 value) preimage,(bytes32[3] encryptedBundle,bytes32 shieldKey) ciphertext)[] _shieldRequests)",
  "event Shield(uint256 treeNumber,uint256 startPosition,(bytes32 npk,(uint8 tokenType,address tokenAddress,uint256 tokenSubID) token,uint120 value)[] commitments,(bytes32[3] encryptedBundle,bytes32 shieldKey)[] shieldCiphertext,uint256[] fees)",
];
