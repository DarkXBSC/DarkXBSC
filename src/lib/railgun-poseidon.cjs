// Shield notes only need Poseidon from circomlibjs. Avoid loading its unrelated
// web3 providers and contract deployment tooling in the browser worker.
module.exports = {
  poseidon: require("@railgun-community/circomlibjs/src/poseidon.js"),
};
