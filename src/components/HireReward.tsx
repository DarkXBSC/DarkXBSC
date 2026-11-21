import { useEffect, useState } from "react";
import { rpc } from "../lib/chain";
import { PAY_NETWORK } from "../lib/agent-pay";
import { Link } from "react-router-dom";
import {
  Contract,
  formatUnits,
  Interface,
  isAddress,
  id,
  getAddress,
} from "ethers";
import { useApp } from "../lib/context";
import { api, errors, type Brief, type Reward } from "../lib/hire";
type Info = {
  token: string;
  vault: string;
  asset: string;
  owner: string;
  share: number;
  decimals: number;
  available: string;
  creator: string;
  symbol: string;
};
export function RewardFields({
  token,
  setToken,
  amount,
  setAmount,
}: {
  token: string;
  setToken: (v: string) => void;
  amount: string;
  setAmount: (v: string) => void;
}) {
  const { t, account, connect, transact } = useApp(),
    [info, setInfo] = useState<Info | null>(null),
    [err, setErr] = useState(""),
    [again, refresh] = useState(0),
    [busy, wait] = useState(false);
  useEffect(() => {
    let live = true;
    setInfo(null);
    setErr("");
    if (isAddress(token))
      api<Info>("reward-info/" + token)
        .then((r) => {
          if (live) setInfo(r);
        })
        .catch((e) => {
          if (live) setErr(errors(e, t));
        });
    return () => {
      live = false;
    };
  }, [token, again]);
  return (
    <fieldset className="reward-fields">
      <legend>{t("Flap tax budget", "Flap 税收预算")}</legend>
      <label>
        {t("Token contract on BSC", "BSC 代币合约")}
        <input
          value={token}
          placeholder="0x…"
          required
          pattern="0x[a-fA-F0-9]{40}"
          onChange={(e) => setToken(e.target.value.trim())}
        />
      </label>
      {info && (
        <p>
          {t("Available for briefs", "可用公益预算")}{" "}
          <strong>
            {formatUnits(info.available, info.decimals)} {info.symbol}
          </strong>{" "}
          · {info.share / 100}% {t("of net receipts", "的实收税额")}
        </p>
      )}
      <label>
        {t("Reward for the selected work", "选中作品的报酬")}
        {info ? " · " + info.symbol : ""}
        <input
          required
          inputMode="decimal"
          placeholder="0.00"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
        />
      </label>
      <small>
        {t(
          "The issuer locks this amount for 30 days. Selection pays the signed author in one BSC transaction.",
          "发行人锁定这笔预算 30 天。选稿和付款在同一笔 BSC 交易里完成。",
        )}
      </small>
      {info && (
        <details>
          <summary>{t("Issuer share", "发行人余额")}</summary>
          <p>
            {formatUnits(info.creator, info.decimals)} {info.symbol}
          </p>
          <button
            className="hire-btn"
            type="button"
            disabled={
              busy ||
              BigInt(info.creator) === 0n ||
              (!!account && account.toLowerCase() !== info.owner.toLowerCase())
            }
            onClick={async () => {
              if (!account) {
                await connect();
                return;
              }
              wait(true);
              try {
                await transact(
                  "bsc",
                  {
                    to: info.vault,
                    data: new Interface([
                      "function withdrawIssuer(uint256)",
                    ]).encodeFunctionData("withdrawIssuer", [info.creator]),
                  },
                  t("Withdraw issuer share", "提取发行人余额"),
                );
                refresh((n) => n + 1);
              } catch (e) {
                setErr(errors(e, t));
              } finally {
                wait(false);
              }
            }}
          >
            {t("Withdraw issuer share", "提取发行人余额")}
          </button>
        </details>
      )}
      {err && <p role="alert">{err}</p>}
      <Link className="hire-text" to="/app/launch?route=commission">
        {t("Launch with a commission budget", "发行支持公益委托的代币")}
      </Link>
    </fieldset>
  );
}
export function RewardAction({
  brief,
  kind,
  entry,
  onUpdate,
}: {
  brief: Brief;
  kind: "award" | "fund" | "expire";
  entry?: { id: string; line: string; handle: string };
  onUpdate: () => void;
}) {
  const { t, account, connect, transact, config } = useApp(),
    [busy, wait] = useState(false),
    [err, fail] = useState(""),
    [hash, setHash] = useState("");
  const r = brief.reward!;
  const label =
    kind === "award"
      ? t("Select and pay", "选稿并付款")
      : kind === "fund"
        ? t("Lock reward and publish", "锁定报酬并公开委托")
        : t("Return budget to giving", "退回公益余额");
  const wrong =
    kind !== "expire" &&
    !!account &&
    account.toLowerCase() !== r.owner.toLowerCase();
  return (
    <div className="reward-action">
      <button
        type="button"
        className="hire-btn"
        disabled={busy || wrong || !!hash}
        title={
          wrong ? t("Use the issuer wallet", "请使用发行人钱包") : undefined
        }
        onClick={async () => {
          if (!account) {
            await connect();
            return;
          }
          wait(true);
          fail("");
          try {
            const tx = await api<{ to: string; data: string }>(
              "reward-action/" +
                brief.id +
                "?" +
                new URLSearchParams({ kind, entry: entry?.id || "" }),
            );
            if (tx.to.toLowerCase() !== r.vault.toLowerCase())
              throw Error("REWARD_STATE");
            const factory =
              config?.chains.bsc.contracts.commissionFactory?.address;
            if (!factory || r.key !== id(brief.id)) throw Error("REWARD_STATE");
            const chain = rpc("bsc");
            if (
              getAddress(
                await new Contract(
                  factory,
                  ["function vaultOf(address) view returns(address)"],
                  chain,
                ).vaultOf(r.token),
              ) !== getAddress(tx.to)
            )
              throw Error("REWARD_STATE");
            const decoded = new Interface([
              "function open(bytes32,uint256,uint64)",
              "function award(bytes32,address,string,bytes)",
              "function expire(bytes32)",
            ]).parseTransaction({ data: tx.data });
            if (
              !decoded ||
              decoded.name !==
                { fund: "open", award: "award", expire: "expire" }[kind] ||
              decoded.args[0] !== r.key
            )
              throw Error("REWARD_STATE");
            if (
              kind === "fund" &&
              (decoded.args[1] !== BigInt(r.amount) ||
                decoded.args[2] !== BigInt(r.deadline))
            )
              throw Error("REWARD_STATE");
            if (kind === "award") {
              if (!entry || decoded.args[2] !== entry.line)
                throw Error("REWARD_STATE");
              const current = await new Contract(
                PAY_NETWORK.agentId,
                ["function handleOf(address) view returns(string)"],
                chain,
              ).handleOf(decoded.args[1]);
              if (current + ".ai" !== entry.handle)
                throw Error("HIRE_ID_REQUIRED");
            }
            const receipt = await transact(
              "bsc",
              { to: tx.to, data: tx.data },
              label + " · " + r.display + " " + r.symbol,
            );
            setHash(receipt.hash);
            const fresh = await api<Reward>("reward/" + brief.id);
            if (fresh.state !== r.state) onUpdate();
          } catch (e) {
            fail(errors(e, t));
          } finally {
            wait(false);
          }
        }}
      >
        {busy ? t("Waiting for wallet…", "等待钱包确认…") : label}
        {kind === "award" ? " · " + r.display + " " + r.symbol : ""}
      </button>
      {wrong && <small>{t("Use issuer wallet", "请切换发行人钱包")}</small>}
      {hash && (
        <a
          className="hire-text"
          href={"https://bscscan.com/tx/" + hash}
          target="_blank"
          rel="noreferrer"
        >
          {t("Transaction sent · view receipt", "交易已提交 · 查看回执")}
        </a>
      )}
      {err && <small role="alert">{err}</small>}
    </div>
  );
}
export function RewardSummary({
  brief,
  onUpdate,
}: {
  brief: Brief;
  onUpdate: () => void;
}) {
  const { t } = useApp(),
    r = brief.reward;
  const [err, setErr] = useState("");
  useEffect(() => {
    if (!r || !["open", "funding"].includes(r.state)) return;
    let live = true;
    const poll = () => {
      api<Reward>("reward/" + brief.id)
        .then((v) => {
          if (live) {
            setErr("");
            if (v?.state !== r.state || v?.tx !== r.tx) onUpdate();
          }
        })
        .catch((e) => {
          if (live) setErr(errors(e, t));
        });
    };
    const timer = setInterval(poll, 6000);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [brief.id, r?.state, r?.tx]);
  if (!r) return null;
  const expired = r.deadline <= Date.now() / 1000;
  const status =
    r.state === "paid"
      ? t("Paid to author", "已付给作者")
      : r.state === "released"
        ? t("Returned to giving budget", "已退回公益余额")
        : r.state === "conflict"
          ? t("On-chain terms differ", "链上条款不一致")
          : expired
            ? t("Expired", "已到期")
            : r.state === "open"
              ? t("Reward locked", "报酬已锁定")
              : t("Awaiting issuer funding", "待发行人锁款");
  return (
    <section className="reward-summary">
      <div>
        <strong>
          {r.display} {r.symbol}
        </strong>
        <p>
          {status} · {t("Deadline", "截止")}{" "}
          {new Date(r.deadline * 1000).toLocaleString()}
        </p>
        <a
          className="hire-text"
          href={"https://bscscan.com/address/" + r.vault}
          target="_blank"
          rel="noreferrer"
        >
          {t("Commission vault", "查看委托金库")}
        </a>
      </div>
      {r.state === "funding" && !expired && (
        <RewardAction kind="fund" brief={brief} onUpdate={onUpdate} />
      )}
      {r.state === "open" && expired && (
        <RewardAction kind="expire" brief={brief} onUpdate={onUpdate} />
      )}
      {r.tx && (
        <a
          className="hire-btn"
          href={"https://bscscan.com/tx/" + r.tx}
          target="_blank"
          rel="noreferrer"
        >
          {t("View receipt", "查看链上回执")}
        </a>
      )}
      {err && <small role="alert">{err}</small>}
    </section>
  );
}
