import {
  bindXTax,
  payBeneficiary,
  BSC_USDT,
  type TaxRoute,
  type BeneficiaryDisclosure,
} from "./tax-route";
import {
  Interface,
  keccak256,
  toUtf8Bytes,
  TransactionRequest,
  AbiCoder,
  isAddress,
} from "ethers";
import { abi, Config, Contract, rpc, ZeroAddress, units, erc20 } from "./chain";
export type LaunchForm = {
  chain: "bsc";
  name: string;
  symbol: string;
  description: string;
  image: string;
  cid: string;
  buyTax: string;
  sellTax: string;
  taxDays: string;
  firstBuy: string;
  quote: string;
  route: TaxRoute;
  social: string;
  disclosure?: BeneficiaryDisclosure;
  nomination?: string;
  commissionShare?: string;
  creator: string;
  website: string;
  twitter: string;
};
export type Preview = {
  request: { to: string; data: string; value: string };
  chain: "bsc";
  account: string;
  fingerprint: string;
  gas: string;
  networkFee: string;
  predicted: string;
  createdAt: number;
  label: string;
  quoteSymbol: string;
  firstBuy: string;
  params: any;
  verifiedSquare?: { profile: string; proof: string };
  payTicket?: string;
  squarePayProfile?: string;
  interfaceName: string;
  method: string;
  resultTypes: string[];
};
export function fingerprint(form: LaunchForm) {
  return keccak256(toUtf8Bytes(JSON.stringify(form)));
}
export function bps(value: string) {
  if (!/^\d+(\.\d{1,2})?$/.test(value)) throw Error("INVALID_TAX");
  const n = Math.round(Number(value) * 100);
  if (n < 0 || n > 10000) throw Error("INVALID_TAX");
  return n;
}
export async function prepare(
  form: LaunchForm,
  config: Config,
  account: string,
  progress: (s: string) => void,
  payTicket?: string,
): Promise<Preview> {
  if (
    !form.name.trim() ||
    !form.symbol.trim() ||
    toUtf8Bytes(form.name).length > 64 ||
    toUtf8Bytes(form.symbol).length > 16
  )
    throw Error("INVALID_TOKEN_NAME");
  if (!form.cid || !form.image) throw Error("UPLOAD_IMAGE_FIRST");
  const buyTax = bps(form.buyTax),
    sellTax = bps(form.sellTax);
  if (
    !["x", "binance", "square", "wallet", "reserve", "commission"].includes(
      form.route,
    )
  )
    throw Error("INVALID_TAX_ROUTE");
  if (
    form.route === "wallet" &&
    (!isAddress(form.creator) || form.creator === ZeroAddress)
  )
    throw Error("INVALID_ADDRESS");
  if (form.chain !== "bsc") throw Error("BSC_ONLY");
  const p = rpc("bsc");
  let to = "",
    data = "",
    value = 0n,
    predicted = "",
    params: any = {},
    interfaceName = "",
    method = "",
    resultTypes: string[] = [],
    symbol = "";
  const portal = new Contract(
    config.protocols.flap.portal,
    await abi("IPortal"),
    p,
  );
  const cfg = await portal.getQuoteTokenConfiguration(form.quote);
  if (Number(cfg.enabled) === 0) throw Error("QUOTE_DISABLED");
  let decimals = 18;
  symbol = "BNB";
  if (form.quote !== ZeroAddress) {
    const c = new Contract(form.quote, erc20, p);
    [decimals, symbol] = await Promise.all([c.decimals(), c.symbol()]);
    decimals = Number(decimals);
  }
  const quoteAmt = units(form.firstBuy, decimals);
  const taxed = buyTax > 0 || sellTax > 0;
  if (form.route !== "wallet" && !taxed) throw Error("RESERVE_REQUIRES_TAX");
  if (!taxed) throw Error("ZERO_TAX_UNAVAILABLE");
  if (form.route === "x" && !payTicket) throw Error("X_TAX_CHECK_REQUIRED");
  let recipient = form.creator || account;
  let squarePayProfile: string | undefined;
  let verifiedSquare: Preview["verifiedSquare"];
  if (form.route === "square") {
    const res = await fetch("/api/giving/square-post", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ post: form.social.trim() }),
    });
    const route = await res.json();
    if (!res.ok) throw Error(route.error);
    if (
      route.rail !== "square-wallet" ||
      route.chainId !== 56 ||
      !isAddress(route.address) ||
      route.address === ZeroAddress
    )
      throw Error("POST_PAYOUT_NOT_BOUND");
    verifiedSquare = { profile: route.profile, proof: route.proof };
    recipient = route.address;
  }
  if (form.route === "binance") {
    if (form.quote.toLowerCase() !== BSC_USDT.toLowerCase())
      throw Error("BINANCE_USDT_REQUIRED");
    if (!payTicket) throw Error("RECIPIENT_CHANGED");
    const res = await fetch("/api/giving/bind", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        recipient: form.social.trim(),
        ticket: payTicket,
      }),
    });
    const result = await res.json();
    if (!res.ok) throw Error(result.error);
    if (result.ticket !== payTicket) throw Error("RECIPIENT_CHANGED");
    recipient = payBeneficiary(result, form.quote);
    squarePayProfile = result.profile;
  }
  progress("MINING_SALT");
  const r = await fetch("/api/flap/salt", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ taxed }),
  });
  if (!r.ok) throw Error("SALT_MINING_FAILED");
  const mined = await r.json();
  predicted = mined.predicted;
  if (form.route === "x") {
    recipient = await bindXTax(
      form.social,
      payTicket,
      mined.salt,
      predicted,
      form.quote,
      form.nomination,
      form.disclosure,
    );
  }
  if ((await p.getCode(predicted)) !== "0x") throw Error("SALT_ALREADY_USED");
  if (
    !/^\d+$/.test(form.taxDays) ||
    Number(form.taxDays) > 3650 ||
    (taxed && Number(form.taxDays) < 1)
  )
    throw Error("INVALID_TAX_DURATION");
  const base = {
    name: form.name.trim(),
    symbol: form.symbol.trim(),
    meta: form.cid,
    dexThresh: 1,
    salt: mined.salt,
    migratorType: 1,
    quoteToken: form.quote,
    quoteAmt,
    permitData: "0x",
    extensionID: "0x" + "0".repeat(64),
    extensionData: "0x",
    dexId: Number(cfg.dexId),
    lpFeeProfile: 0,
    buyTaxRate: buyTax,
    sellTaxRate: sellTax,
    taxDuration: taxed ? Number(form.taxDays) * 86400 : 0,
    antiFarmerDuration: 0,
    mktBps: taxed ? 10000 : 0,
    deflationBps: 0,
    dividendBps: 0,
    lpBps: 0,
    minimumShareBalance: 0,
    dividendToken: form.quote,
    commissionReceiver: ZeroAddress,
    tokenVersion: taxed ? 6 : 2,
  };
  if (form.route === "reserve" || form.route === "commission") {
    const factory =
      config.chains.bsc.contracts[
        form.route === "commission" ? "commissionFactory" : "reserveFactory"
      ]?.address;
    if (!factory) throw Error("FACTORY_NOT_DEPLOYED");
    const share =
      form.route === "commission" ? bps(form.commissionShare || "") : 0;
    if (form.route === "commission" && share === 0)
      throw Error("COMMISSION_SHARE_REQUIRED");
    to = config.protocols.flap.vaultPortal;
    params = {
      ...base,
      vaultFactory: factory,
      vaultData:
        form.route === "commission"
          ? AbiCoder.defaultAbiCoder().encode(["uint16"], [share])
          : "0x",
    };
    interfaceName = "IVaultPortal";
    method = "newTokenV6WithVault";
  } else {
    to = config.protocols.flap.portal;
    params = { ...base, beneficiary: recipient };
    interfaceName = "IPortal";
    method = "newTokenV6";
  }
  if (form.quote !== ZeroAddress && quoteAmt > 0n) {
    const q = new Contract(form.quote, erc20, p);
    if ((await q.allowance(account, to)) < quoteAmt)
      throw Error("APPROVE_QUOTE_FIRST");
  }
  value = form.quote === ZeroAddress ? quoteAmt : 0n;
  data = new Interface(await abi(interfaceName)).encodeFunctionData(method, [
    params,
  ]);
  resultTypes = ["address"];
  progress("SIMULATING");
  const request = { from: account, to, data, value };
  const result = await p.call(request);
  const decoded = AbiCoder.defaultAbiCoder().decode(resultTypes, result);
  if (predicted && predicted.toLowerCase() !== decoded[0].toLowerCase())
    throw Error("PREDICTION_MISMATCH");
  predicted = decoded[0];
  const gas = await p.estimateGas(request);
  const fees = await p.getFeeData();
  if (fees.gasPrice === null) throw Error("FEE_ESTIMATE_UNAVAILABLE");
  return {
    request: { to, data, value: value.toString() },
    chain: form.chain,
    account,
    fingerprint: fingerprint(form),
    verifiedSquare,
    payTicket,
    squarePayProfile,
    gas: gas.toString(),
    networkFee: (gas * fees.gasPrice).toString(),
    predicted,
    createdAt: Date.now(),
    label: form.name + " / " + form.symbol,
    quoteSymbol: symbol,
    firstBuy: form.firstBuy,
    params: JSON.parse(
      JSON.stringify(params, (_, v) =>
        typeof v === "bigint" ? v.toString() : v,
      ),
    ),
    interfaceName,
    method,
    resultTypes,
  };
}
