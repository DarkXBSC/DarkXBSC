import { useState } from "react";
import { Interface, isAddress } from "ethers";
import { useApp } from "../lib/context";
import { PageTitle, CopyText } from "../components/Frame";
import { Contract, rpc, abi, errorCode, ZeroAddress } from "../lib/chain";
export default function Admin() {
  const app = useApp(),
    { t, config, account, busy, setMessage } = app;
  const [address, setAddress] = useState(""),
    [state, setState] = useState<any>(null),
    [amount, setAmount] = useState(""),
    [recipient, setRecipient] = useState(""),
    [asset, setAsset] = useState(ZeroAddress),
    [id, setId] = useState("");
  async function inspect() {
    try {
      if (!isAddress(address)) throw Error("INVALID_ADDRESS");
      const c = new Contract(address, await abi("TigerReserve"), rpc("bsc"));
      const [dev, token, quote, accounted, paused] = await Promise.all([
        c.dev(),
        c.taxToken(),
        c.vaultQuoteToken(),
        c.accountedQuote(),
        c.paused(),
      ]);
      setState({ dev, token, quote, accounted: String(accounted), paused });
    } catch (e) {
      setState(null);
      setMessage(errorCode(e));
    }
  }
  async function write(method: string, args: any[]) {
    try {
      const i = new Interface(await abi("TigerReserve"));
      await app.transact(
        "bsc",
        { to: address, data: i.encodeFunctionData(method, args) },
        "Reserve " + method,
      );
      await inspect();
    } catch (e) {
      setMessage(errorCode(e));
    }
  }
  async function attest(value: boolean) {
    try {
      const d = config?.chains.bsc.contracts.registry;
      if (!d) throw Error("REGISTRY_NOT_DEPLOYED");
      await app.transact(
        "bsc",
        {
          to: d.address,
          data: new Interface(await abi("TigerRegistry")).encodeFunctionData(
            "attest",
            [id, value],
          ),
        },
        "Update registry attestation",
      );
    } catch (e) {
      setMessage(errorCode(e));
    }
  }
  return (
    <>
      <PageTitle
        title={t("Contract administration", "合约管理")}
        description={t(
          "On-chain administration signed by the authorized wallet. This page does not hold a deployment key.",
          "由有权限的钱包签署链上管理操作，此页不持有部署私钥。",
        )}
      />
      <div className="trade-layout">
        <section>
          <h2>{t("Reserve controls", "储备金库管理")}</h2>
          <label>
            {t("Vault address", "金库地址")}
            <input
              value={address}
              onChange={(e) => {
                setAddress(e.target.value);
                setState(null);
              }}
              placeholder="0x…"
            />
          </label>
          <button className="button" onClick={() => void inspect()}>
            {t("Inspect interfaces", "读取接口状态")}
          </button>
          {state && (
            <>
              <dl>
                <div>
                  <dt>Dev</dt>
                  <dd>
                    <CopyText value={state.dev} />
                  </dd>
                </div>
                <div>
                  <dt>{t("Tax token", "税币")}</dt>
                  <dd>
                    <CopyText value={state.token} />
                  </dd>
                </div>
                <div>
                  <dt>{t("Quote asset", "底池资产")}</dt>
                  <dd>
                    <CopyText value={state.quote} />
                  </dd>
                </div>
                <div>
                  <dt>{t("Accounted units", "记账最小单位")}</dt>
                  <dd>{state.accounted}</dd>
                </div>
                <div>
                  <dt>{t("Paused", "暂停")}</dt>
                  <dd>{String(state.paused)}</dd>
                </div>
              </dl>
              <p>
                {t(
                  "Only the vault creator or Flap Guardian can perform privileged operations. The contract is the authority.",
                  "只有金库创建者或 Flap Guardian 可以执行权限操作，以合约检查为准。",
                )}
              </p>
              <label>
                {t(
                  "Withdrawal amount (raw smallest units)",
                  "支取数量（最小单位整数）",
                )}
                <input
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                />
              </label>
              <label>
                {t("Withdrawal recipient", "支取接收方")}
                <input
                  value={recipient}
                  onChange={(e) => setRecipient(e.target.value)}
                  placeholder="0x…"
                />
              </label>
              <div className="form-actions">
                <button
                  className="button"
                  disabled={busy}
                  onClick={() => void write("sync", [])}
                >
                  {t("Sync revenue", "同步收入")}
                </button>
                <button
                  className="button primary"
                  disabled={busy}
                  onClick={() => void write("withdraw", [amount, recipient])}
                >
                  {t("Withdraw", "支取")}
                </button>
              </div>
              <label>
                {t(
                  "Rescue asset (zero = native)",
                  "救援资产（零地址为原生币）",
                )}
                <input
                  value={asset}
                  onChange={(e) => setAsset(e.target.value)}
                />
              </label>
              <p className="note">
                {t(
                  "Rescue moves the whole selected asset balance to the immutable creator and pauses withdrawals. This is immediate.",
                  "救援会立即将所选资产的全部余额转给不可变的创建者地址，并暂停普通支取。",
                )}
              </p>
              <div className="form-actions">
                <button
                  className="button"
                  disabled={busy}
                  onClick={() => void write("resume", [])}
                >
                  {t("Resume withdrawals", "恢复支取")}
                </button>
                <button
                  className="button danger"
                  disabled={busy}
                  onClick={() => void write("rescue", [asset])}
                >
                  {t("Rescue all selected assets", "救援全部指定资产")}
                </button>
              </div>
            </>
          )}
        </section>
        <aside className="reading-aside">
          <h3>{t("Registry attestations", "项目登记核对")}</h3>
          <p>
            {t(
              "Only the registry owner can set an attestation. It does not provide a price or solvency guarantee.",
              "只有登记簿所有者可以设置核对状态，核对不提供价格或偿付保证。",
            )}
          </p>
          <label>
            {t("Project ID", "项目编号")}
            <input
              value={id}
              onChange={(e) => setId(e.target.value)}
              placeholder="0x…"
            />
          </label>
          <div className="form-actions">
            <button
              className="button"
              disabled={busy}
              onClick={() => void attest(false)}
            >
              {t("Remove", "移除")}
            </button>
            <button
              className="button"
              disabled={busy}
              onClick={() => void attest(true)}
            >
              {t("Attest", "核对")}
            </button>
          </div>
        </aside>
      </div>
    </>
  );
}
