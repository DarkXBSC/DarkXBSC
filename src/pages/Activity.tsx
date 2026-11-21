import { useState } from "react";
import { ArrowRight, RefreshCw } from "lucide-react";
import { useApp } from "../lib/context";
import { PageTitle, CopyText } from "../components/Frame";
import { Chain, rpc, chainInfo, errorCode } from "../lib/chain";
export default function Activity() {
  const { t, activities, recover, setMessage, submissions, reconcile } =
    useApp();
  const [recoveryHash, setRecoveryHash] = useState("");
  const [hash, setHash] = useState(""),
    [chain, setChain] = useState<Chain>("bsc"),
    [found, setFound] = useState<any>(null);
  async function lookup() {
    try {
      if (!/^0x[\da-fA-F]{64}$/.test(hash)) throw Error("INVALID_HASH");
      const r = await rpc(chain).getTransactionReceipt(hash);
      setFound(
        r
          ? {
              status: r.status,
              block: r.blockNumber,
              from: r.from,
              to: r.to,
              hash: r.hash,
            }
          : null,
      );
      if (!r)
        setMessage(
          t(
            "Receipt is not yet available. Do not repeat a pending launch.",
            "尚无回执，不要重复发起待确认的发行。",
          ),
        );
    } catch (e) {
      setMessage(errorCode(e));
    }
  }
  return (
    <>
      <PageTitle
        title={t("Activity", "交易记录")}
        description={t(
          "Transactions sent from this browser, plus receipt recovery by hash.",
          "当前浏览器发送的交易，以及按哈希恢复回执查询。",
        )}
      />
      {submissions
        .filter((x) => !x.hash)
        .map((x) => (
          <section className="recovery-form" key={x.id}>
            <h2>{t("CHECK THE WALLET.", "核对钱包提交。")}</h2>
            <p>
              {t(
                "The wallet response was interrupted. New transactions from this account are paused. Find this transaction in your wallet and supply its hash; Dark will verify the account, target, data, value and nonce.",
                "钱包响应中断，同账户的新交易已暂停。请在钱包中找到这笔交易并提供哈希，Dark 将核对账户、目标、数据、金额和 nonce。",
              )}
            </p>
            <p>
              {x.label} · {x.chain.toUpperCase()} · Nonce {x.nonce}
            </p>
            <CopyText value={x.account} />
            <CopyText value={x.to} />
            <label>
              {t("Wallet transaction hash", "钱包交易哈希")}
              <input
                value={recoveryHash}
                onChange={(e) => setRecoveryHash(e.target.value)}
                placeholder="0x…"
              />
            </label>
            <button
              className="button"
              onClick={() => void reconcile(x, recoveryHash)}
            >
              {t("Verify the original submission", "核对原始提交")}
            </button>
          </section>
        ))}
      <section className="activity-list">
        {activities.length === 0 ? (
          <div className="empty">
            <h2>{t("No wallet transactions yet.", "尚无钱包交易。")}</h2>
            <p>
              {t(
                "Infrastructure deployment receipts are listed in Contracts. Your own transactions appear here after broadcast.",
                "基础设施部署回执列在合约页，你的交易会在广播后显示于此。",
              )}
            </p>
          </div>
        ) : (
          activities.map((a) => (
            <article key={a.hash}>
              <div>
                <h3>{a.label}</h3>
                <span className="mono">
                  {a.chain.toUpperCase()} / {new Date(a.at).toLocaleString()}
                </span>
              </div>
              <span>
                {a.status === "confirmed"
                  ? t("Confirmed", "已确认")
                  : a.status === "failed"
                    ? t("Reverted", "已回滚")
                    : t("Pending", "待确认")}
              </span>
              <a
                href={chainInfo[a.chain].explorer + "/tx/" + a.hash}
                target="_blank"
                rel="noreferrer"
              >
                {t("Receipt", "回执")}
                <ArrowRight size={15} />
              </a>
              <button onClick={() => void recover(a)}>
                <RefreshCw size={15} />
                {t("Refresh", "刷新")}
              </button>
              <CopyText value={a.hash} />
            </article>
          ))
        )}
      </section>
      <section className="recovery-form">
        <h2>{t("RECOVER A RECEIPT.", "恢复回执查询。")}</h2>
        <div className="field-row">
          <label>
            {t("Network", "网络")}
            <select
              value={chain}
              onChange={(e) => {
                setChain(e.target.value as Chain);
                setFound(null);
              }}
            >
              <option value="bsc">BSC</option>
              {activities.some((a) => a.chain === "robinhood") && (
                <option value="robinhood">Robinhood · archive</option>
              )}
            </select>
          </label>
          <label>
            {t("Transaction hash", "交易哈希")}
            <input
              value={hash}
              onChange={(e) => {
                setHash(e.target.value);
                setFound(null);
              }}
              placeholder="0x…"
            />
          </label>
        </div>
        <button className="button" onClick={() => void lookup()}>
          {t("Read receipt", "读取回执")}
          <ArrowRight size={15} />
        </button>
        {found && (
          <dl>
            <div>
              <dt>{t("Status", "状态")}</dt>
              <dd>
                {found.status === 1
                  ? t("Success", "成功")
                  : t("Reverted", "已回滚")}
              </dd>
            </div>
            <div>
              <dt>{t("Block", "区块")}</dt>
              <dd>{found.block}</dd>
            </div>
            <div>
              <dt>{t("From", "发送者")}</dt>
              <dd>
                <CopyText value={found.from} />
              </dd>
            </div>
            <div>
              <dt>{t("To", "目标")}</dt>
              <dd>
                <CopyText value={found.to || "Contract creation"} />
              </dd>
            </div>
          </dl>
        )}
      </section>
    </>
  );
}
