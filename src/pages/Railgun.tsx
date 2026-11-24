import { useEffect, useRef, useState } from "react";
import { Contract, Interface, formatUnits } from "ethers";
import { Link } from "react-router-dom";
import { useApp } from "../lib/context";
import { chainInfo, erc20, errorCode, rpc, units } from "../lib/chain";
import {
  railgunNetwork,
  railgunAbi,
  shieldAmounts,
} from "../lib/railgun-config.mjs";
import { CopyText } from "../components/Frame";
import "../railgun.css";

const network = railgunNetwork("bsc");
const assets = [
  { symbol: "BNB", address: network.wrapped, decimals: 18 },
  ...network.assets,
];
const explorer = chainInfo.bsc.explorer;
type Call = { to: string; data: string; value: string; npk: string };
type Review = {
  call: Call;
  amount: bigint;
  net: bigint;
  fee: bigint;
  rate: bigint;
  account: string;
  approved: bigint;
};
const messages: Record<string, [string, string]> = {
  INVALID_RAILGUN_ADDRESS: [
    "Enter the full 0zk receive address from a RAILGUN wallet.",
    "请填写 RAILGUN 钱包提供的完整 0zk 收款地址。",
  ],
  RAILGUN_ADDRESS_NETWORK: [
    "This 0zk address is for another network.",
    "此 0zk 地址指定了其他网络。",
  ],
  INVALID_AMOUNT: [
    "Enter a positive amount within token precision.",
    "请输入有效的正数金额。",
  ],
  INSUFFICIENT_BALANCE: [
    "Wallet balance is below the deposit amount.",
    "钱包余额低于存入金额。",
  ],
  INSUFFICIENT_FUNDS: [
    "Check the token balance and BNB for gas.",
    "请核对资产余额与支付 Gas 的 BNB。",
  ],
  RAILGUN_ASSET_UNSUPPORTED: [
    "This asset is unavailable for shielding.",
    "隐私池目前不支持此资产。",
  ],
  RAILGUN_NOTE_FAILED: [
    "Could not encrypt the deposit. Check the receive address and retry.",
    "无法加密存入凭据，请核对收款地址并重试。",
  ],
  REJECTED: ["Wallet request declined.", "已取消钱包请求。"],
  REVIEW_AGAIN: [
    "Wallet, fee or allowance changed. Preview the deposit again.",
    "账户、费率或授权已变化，请重新预览。",
  ],
  RECEIPT_PENDING: [
    "Check this transaction in Activity before retrying.",
    "请先到交易记录核对这笔提交。",
  ],
  RECEIPT_MISMATCH: [
    "Transaction mined. Check the Shield event in the explorer before any further deposit.",
    "交易已上链。请在浏览器核对 Shield 事件后再操作。",
  ],
  RECOVER_PREVIOUS_TRANSACTION: [
    "Recover the pending transaction in Activity first.",
    "请先到交易记录恢复待确认的交易。",
  ],
};
function encryptedCall(
  address: string,
  token: string,
  amount: bigint,
  native: boolean,
): Promise<Call> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(
      new URL("../lib/railgun.worker.ts", import.meta.url),
      { type: "module" },
    );
    const finish = () => {
      clearTimeout(timer);
      worker.terminate();
    };
    const timer = window.setTimeout(() => {
      finish();
      reject(Error("RAILGUN_NOTE_FAILED"));
    }, 45000);
    worker.onmessage = ({ data }) => {
      finish();
      data.result ? resolve(data.result) : reject(Error(data.error));
    };
    worker.onerror = () => {
      finish();
      reject(Error("RAILGUN_NOTE_FAILED"));
    };
    worker.postMessage({
      chain: "bsc",
      address,
      token,
      amount: String(amount),
      native,
    });
  });
}

export default function Railgun() {
  const { t, account, connect, transact, busy, signer, setMessage } = useApp();
  const [symbol, setSymbol] = useState("BNB"),
    [amount, setAmount] = useState(""),
    [address, setAddress] = useState("");
  const [review, setReview] = useState<Review | null>(null),
    [error, setError] = useState(""),
    [working, setWorking] = useState(false);
  const [receipt, setReceipt] = useState<{
    hash: string;
    net: string;
    symbol: string;
  } | null>(null);
  const inFlight = useRef(false),
    epoch = useRef(0);
  const asset = assets.find((a) => a.symbol === symbol)!,
    native = symbol === "BNB",
    output = native ? "WBNB" : symbol;
  const reset = () => {
    ++epoch.current;
    setMessage("");
    setReview(null);
    setError("");
    setReceipt(null);
  };
  useEffect(() => {
    reset();
    return () => {
      ++epoch.current;
    };
  }, [account]);
  async function quote(raw: bigint) {
    const provider = rpc("bsc");
    const pool = new Contract(network.proxy, railgunAbi, provider);
    const token = new Contract(asset.address, erc20, provider);
    const [rate, blocked, balance, approved] = await Promise.all([
      pool.shieldFee(),
      pool.tokenBlocklist(asset.address),
      native ? provider.getBalance(account) : token.balanceOf(account),
      native ? Promise.resolve(raw) : token.allowance(account, network.proxy),
    ]);
    if (blocked) throw Error("RAILGUN_ASSET_UNSUPPORTED");
    if (balance < raw) throw Error("INSUFFICIENT_BALANCE");
    const [net, fee] = await pool.getFee(raw, true, rate);
    return {
      rate: BigInt(rate),
      net: BigInt(net),
      fee: BigInt(fee),
      approved: BigInt(approved),
    };
  }
  async function action() {
    if (inFlight.current || busy) return;
    if (!account) {
      await connect();
      return;
    }
    inFlight.current = true;
    setWorking(true);
    setError("");
    const version = epoch.current;
    try {
      if (!review) {
        const raw = units(amount.trim(), asset.decimals);
        shieldAmounts(raw, 0n);
        if (!/^0zk1[a-z0-9]{123}$/.test(address.trim()))
          throw Error("INVALID_RAILGUN_ADDRESS");
        const call = await encryptedCall(
          address.trim(),
          asset.address,
          raw,
          native,
        );
        const state = await quote(raw);
        if (epoch.current === version)
          setReview({ call, amount: raw, account, ...state });
        return;
      }
      const who = await signer("bsc");
      if (
        epoch.current !== version ||
        (await who.getAddress()).toLowerCase() !== review.account.toLowerCase()
      )
        throw Error("REVIEW_AGAIN");
      const current = await quote(review.amount);
      const approveNeeded = review.approved < review.amount;
      if (
        epoch.current !== version ||
        current.rate !== review.rate ||
        (!native && current.approved !== review.approved)
      ) {
        setReview(null);
        throw Error("REVIEW_AGAIN");
      }
      if (approveNeeded) {
        const allowance = review.approved > 0n ? 0n : review.amount;
        const data = new Interface(erc20).encodeFunctionData("approve", [
          network.proxy,
          allowance,
        ]);
        await transact(
          "bsc",
          { to: asset.address, data },
          "RAILGUN · " + symbol + " approval",
        );
        const state = await quote(review.amount);
        if (version === epoch.current) setReview({ ...review, ...state });
        return;
      }
      const { to, data, value, npk } = review.call;
      const mined = await transact(
        "bsc",
        { to, data, value },
        "RAILGUN · " + symbol + " shield",
      );
      setReview(null);
      const iface = new Interface(railgunAbi);
      for (const log of mined.logs) {
        if (log.address.toLowerCase() !== network.proxy) continue;
        const event = iface.parseLog(log);
        const note = event?.name === "Shield" && event.args.commitments[0];
        if (
          note &&
          note.npk === npk &&
          note.token.tokenAddress.toLowerCase() ===
            asset.address.toLowerCase() &&
          note.value + event!.args.fees[0] === review.amount
        ) {
          if (version === epoch.current) {
            setReceipt({
              hash: mined.hash,
              net: formatUnits(note.value, asset.decimals),
              symbol: output,
            });
            setAmount("");
            setAddress("");
          }
          return;
        }
      }
      throw Error("RECEIPT_MISMATCH");
    } catch (e) {
      if (epoch.current === version) setError(errorCode(e));
    } finally {
      inFlight.current = false;
      setWorking(false);
    }
  }
  const locked = working || busy;
  const submit = !account
    ? t("Connect wallet", "连接钱包")
    : !review
      ? t("Preview deposit", "预览存入")
      : review.approved < review.amount
        ? review.approved > 0n
          ? t("Reset previous allowance", "清零旧授权")
          : t("Approve exact amount", "授权本次金额")
        : t("Confirm deposit in wallet", "在钱包确认存入");
  return (
    <section className="rail-desk">
      <header>
        <small>RAILGUN · BNB SMART CHAIN</small>
        <h1>{t("Shield funds", "隐私存入")}</h1>
        <p>
          {t(
            "Deposit from a BSC wallet into a private RAILGUN balance.",
            "从 BSC 钱包存入资产，由持有对应 0zk 钱包的用户接收。",
          )}
        </p>
      </header>
      <div className="rail-columns">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void action();
          }}
        >
          <fieldset disabled={locked}>
            <label>
              {t("Asset", "存入资产")}
              <select
                value={symbol}
                onChange={(e) => {
                  reset();
                  setSymbol(e.target.value);
                }}
              >
                {assets.map((a) => (
                  <option key={a.symbol}>{a.symbol}</option>
                ))}
              </select>
            </label>
            <label>
              {t("Amount", "存入金额")}
              <input
                inputMode="decimal"
                placeholder="0.00"
                value={amount}
                onChange={(e) => {
                  reset();
                  setAmount(e.target.value);
                }}
              />
            </label>
            <label>
              {t("Private receive address", "隐私收款地址")}
              <textarea
                rows={3}
                spellCheck={false}
                autoComplete="off"
                value={address}
                placeholder="0zk1…"
                onChange={(e) => {
                  reset();
                  setAddress(e.target.value);
                }}
              />
            </label>
          </fieldset>
          {review && (
            <dl className="rail-review">
              <div>
                <dt>{t("From", "付款钱包")}</dt>
                <dd>{review.account}</dd>
              </div>
              <div>
                <dt>
                  {t("Protocol fee", "协议费")} ({Number(review.rate) / 100}%)
                </dt>
                <dd>
                  {formatUnits(review.fee, asset.decimals)} {output}
                </dd>
              </div>
              <div>
                <dt>{t("Private balance receives", "预计存入隐私余额")}</dt>
                <dd>
                  {formatUnits(review.net, asset.decimals)} {output}
                </dd>
              </div>
            </dl>
          )}
          <button
            disabled={
              locked || (!!account && (!amount.trim() || !address.trim()))
            }
            className="bags-action"
          >
            {locked ? t("Processing…", "处理中…") : submit}
          </button>
          <div aria-live="polite">
            {error ? (
              <p role="alert">
                {messages[error]
                  ? t(...messages[error])
                  : t(
                      "Operation could not finish. Check your wallet and transaction history.",
                      "操作未完成，请核对钱包与交易记录。",
                    )}{" "}
                <code>{error}</code>
              </p>
            ) : null}
            {receipt && (
              <p>
                <strong>
                  {t("Shield confirmed", "隐私存入已确认")} · {receipt.net}{" "}
                  {receipt.symbol}
                </strong>
                <br />
                <a
                  href={explorer + "/tx/" + receipt.hash}
                  target="_blank"
                  rel="noreferrer"
                >
                  {t("View deposit receipt", "查看存入回执")}
                </a>
              </p>
            )}
          </div>
        </form>
        <aside>
          <h2>{t("Your private balance", "你的隐私余额")}</h2>
          <p>
            {t(
              "Copy a BSC-compatible 0zk receive address from a RAILGUN wallet. Use that wallet to view, privately send or withdraw the funds.",
              "从支持 BSC 的 RAILGUN 钱包复制 0zk 收款地址。在该钱包查看余额、私密转账或提取。",
            )}
          </p>
          <a
            href="https://railgun.org/wallets"
            target="_blank"
            rel="noreferrer"
          >
            {t("Find a compatible wallet", "查看兼容钱包")}
          </a>
          <p>
            {t(
              "The deposit wallet, token and amount are public. The receive address is encrypted in your browser. BNB arrives as WBNB. Leave BNB for gas.",
              "存入钱包、币种和金额在链上公开。0zk 收款地址在浏览器内加密。存入 BNB 后收到 WBNB，请预留 BNB 支付 Gas。",
            )}
          </p>
          <p>
            {t(
              "Your wallet shows when the deposit can be spent after its PPOI checks.",
              "隐私钱包会显示 PPOI 检查状态以及资金何时可以使用。",
            )}
          </p>
          <Link to="/app/activity">{t("Transaction history", "交易记录")}</Link>
          <details>
            <summary>{t("BSC contracts", "BSC 合约")}</summary>
            {[
              [network.proxy, "RAILGUN"],
              [network.relay, "BNB RelayAdapt"],
            ].map(([a, n]) => (
              <div key={a}>
                <a
                  href={explorer + "/address/" + a + "#code"}
                  target="_blank"
                  rel="noreferrer"
                >
                  {n}
                </a>
                <CopyText value={a} />
              </div>
            ))}
          </details>
        </aside>
      </div>
    </section>
  );
}
