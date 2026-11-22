import { Contract, Interface, ZeroAddress, hexlify, randomBytes, type Log } from "ethers";
import { abi, rpc, units, type Config } from "./chain";
import { bindXTax } from "./tax-route";
import type { LaunchForm, Preview } from "./launch";

export async function ponsFeeSchedule(config: Config) {
  const factory = new Contract(config.protocols.pons.factory, await abi("PonsFactoryV2"), rpc("robinhood"));
  const [fee, maximum] = await Promise.all([factory.launchFee(), factory.maxCreatorTaxBps()]);
  return { fee: BigInt(fee), maximum: BigInt(maximum) };
}

async function ponsTerms(config: Config, account: string) {
  const provider = rpc("robinhood");
  const factory = new Contract(config.protocols.pons.factory, await abi("PonsFactoryV2"), provider);
  const [id, enabled, allowed, preset, schedule, economics] = await Promise.all([
    provider.send("eth_chainId", []), factory.launchEnabled(), factory.canLaunch(account),
    factory.getLaunchConfig(0), ponsFeeSchedule(config),
    factory.previewLaunchEconomics(0, ZeroAddress),
  ]);
  if (Number(id) !== 4663) throw Error("PONS_WRONG_NETWORK");
  if (!enabled || !preset.enabled) throw Error("PONS_PAUSED");
  if (!allowed) throw Error("PONS_WALLET_INELIGIBLE");
  return { ...schedule, economics: String(economics) };
}

export async function checkPonsFunding(config: Config, account: string, tax: number, firstBuy: string) {
  const [terms, balance] = await Promise.all([ponsTerms(config, account), rpc("robinhood").getBalance(account)]);
  if (BigInt(tax) > terms.maximum) throw Error("PONS_TAX_LIMIT");
  if (balance <= terms.fee + units(firstBuy, 18)) throw Error("PONS_ETH_REQUIRED");
  return terms;
}

export async function preparePons(
  form: LaunchForm, config: Config, account: string, tax: number, fingerprint: string, payTicket?: string,
): Promise<Preview> {
  if (!["x","wallet"].includes(form.route) || form.quote !== ZeroAddress) throw Error("PONS_WALLET_ROUTE");
  const terms = await checkPonsFunding(config, account, tax, form.firstBuy);
  const provider = rpc("robinhood");
  const buy = units(form.firstBuy, 18);
  const value = terms.fee + buy;
  const target = buy ? config.protocols.pons.launchAndBuy : config.protocols.pons.factory;
  const interfaceName = buy ? "PonsLaunchAndBuyV2" : "PonsFactoryV2";
  const iface = new Interface(await abi(interfaceName));
  const method = buy ? "launchAndBuy" : "launchToken";
  const create = iface.getFunction(method, buy ? undefined : [null, 0n, ZeroAddress]);
  if (!create) throw Error("ABI_UNAVAILABLE");
  const salt=hexlify(randomBytes(32));
  if(form.route==="x" && !tax) throw Error("RESERVE_REQUIRES_TAX");
  const recipient=form.route==="x" ? await bindXTax(form.social,payTicket,salt,null,ZeroAddress,form.nomination,form.disclosure,form.beneficiaryKey,4663,{issuer:account}) : form.creator;
  const params = {
    name: form.name.trim(), symbol: form.symbol.trim(),
    logo: form.image.replace(/^https:\/\/flap\.mypinata\.cloud\/ipfs\//, "ipfs://"),
    description: form.description, socials: { twitter: form.twitter, website: form.website, telegram: "", discord: "", farcaster: "" },
    creatorFeeRecipient: recipient, creatorTaxBps: tax, buybackEnabled: false,
    expectedEconomics: terms.economics, salt,
  };
  const encode = (min: bigint) => iface.encodeFunctionData(create,
    buy ? [params, 0, ZeroAddress, buy, min, account, []] : [params, 0, ZeroAddress]);
  const simulate = async (data: string) => iface.decodeFunctionResult(create,
    await provider.call({ from: account, to: target, data, value }));
  let data = encode(buy ? 1n : 0n);
  let result = await simulate(data);
  let minimum = 0n;
  if (buy) {
    minimum = BigInt(result.tokensOut) * 99n / 100n;
    if (!minimum) throw Error("PONS_FIRST_BUY_TOO_SMALL");
    data = encode(minimum);
    result = await simulate(data);
  }
  const predicted = String(result.token);
  if (predicted === ZeroAddress || await provider.getCode(predicted) !== "0x") throw Error("PREDICTION_MISMATCH");
  const [gas, fees, balance] = await Promise.all([
    provider.estimateGas({ from: account, to: target, data, value }), provider.getFeeData(), provider.getBalance(account),
  ]);
  const price = fees.maxFeePerGas ?? fees.gasPrice;
  if (price === null) throw Error("FEE_ESTIMATE_UNAVAILABLE");
  const networkFee = gas * 120n / 100n * price;
  if (balance < value + networkFee) throw Error("PONS_ETH_REQUIRED");
  return {
    chain: "robinhood", request: { to: target, data, value: value.toString() },
    account, fingerprint, predicted, createdAt: Date.now(), label: form.name + " / " + form.symbol,
    gas: gas.toString(), networkFee: networkFee.toString(), firstBuy: form.firstBuy,
    quoteSymbol: "ETH", payTicket, params: {...params, beneficiary:recipient}, interfaceName, method, resultTypes: create.outputs.map(o => o.type),
    pons: { fee: terms.fee.toString(), minimum: minimum.toString(), curve: String(result.curve) },
  };
}

export async function confirmPonsCreation(config: Config, preview: Preview, logs: readonly Log[]) {
  const factory = config.protocols.pons.factory.toLowerCase();
  const iface = new Interface(await abi("PonsFactoryV2"));
  const matched = logs.some(log => {
    if (log.address.toLowerCase() !== factory) return false;
    const event = iface.parseLog(log);
    return event?.name === "TokenLaunched" && event.args.token === preview.predicted &&
      event.args.curve === preview.pons?.curve && event.args.deployer === preview.account;
  });
  if (!matched) throw Error("LAUNCH_ADDRESS_NOT_CONFIRMED");
}
