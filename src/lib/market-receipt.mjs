const hash = /^0x[0-9a-f]{64}$/i;
const amount = /^(?:0|[1-9]\d*)(?:\.\d{1,18})?$/;

export function firstReceipt(ledger, token) {
  if (
    ledger?.chainId !== 56 ||
    ledger.rail !== "railgun-tax" ||
    ledger.token?.toLowerCase() !== token.toLowerCase() ||
    !hash.test(ledger.creation) ||
    !Array.isArray(ledger.batches)
  )
    return null;
  return (
    ledger.batches.find(
      (b) =>
        b.seq === 1 &&
        b.stage === "confirmed" &&
        Number.isSafeInteger(b.block) &&
        b.block > 0 &&
        hash.test(b.hash) &&
        typeof b.net === "string" &&
        amount.test(b.net) &&
        /[1-9]/.test(b.net),
    ) || null
  );
}

export function receiptPaths(address) {
  const token = address.toLowerCase();
  return {
    chart: "/app/explore?chain=bsc&token=" + token + "&receipt=1",
    image: "/receipts/bsc/" + token + "/1.png",
  };
}
