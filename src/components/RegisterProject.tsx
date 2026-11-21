import { ChevronDown } from "lucide-react";
import { useState } from "react";
import { AbiCoder, Interface, isAddress, keccak256 } from "ethers";
import { useApp } from "../lib/context";
import {
  abi,
  asset,
  Chain,
  chainInfo,
  Contract,
  errorCode,
  publicUrl,
  rpc,
  ZeroAddress,
} from "../lib/chain";
import { CopyText } from "./Frame";

export default function RegisterProject({
  chain,
  onSaved,
}: {
  chain: Chain;
  onSaved: () => void;
}) {
  const app = useApp(),
    { t, config, account, busy, setMessage } = app;
  const [open, setOpen] = useState(false),
    [token, setToken] = useState(""),
    [uri, setUri] = useState(""),
    [projectId, setProjectId] = useState("");
  const deployment = config?.chains[chain].contracts.registry;
  async function save() {
    if (!account) return setMessage("CONNECT_WALLET");
    if (!deployment) return setMessage("REGISTRY_NOT_DEPLOYED");
    try {
      if (!isAddress(token) || (uri && !publicUrl(uri)))
        throw Error("INVALID_PROJECT");
      await asset(chain, token);
      const id = keccak256(
        AbiCoder.defaultAbiCoder().encode(
          ["uint256", "address", "address"],
          [chainInfo[chain].id, account, token],
        ),
      );
      const a = await abi("TigerRegistry"),
        c = new Contract(deployment.address, a, rpc(chain));
      const existing = await c.project(id);
      const args = [existing.peerChain, existing.peerToken, uri];
      const data = new Interface(a).encodeFunctionData(
        existing.creator === ZeroAddress ? "register" : "update",
        [existing.creator === ZeroAddress ? token : id, ...args],
      );
      await app.transact(
        chain,
        { to: deployment.address, data },
        "Register project identity",
      );
      setProjectId(id);
      onSaved();
    } catch (e) {
      setMessage(errorCode(e));
    }
  }
  return (
    <section className="project-registration">
      <button
        className="text-button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        {t("Register or update a project", "登记或更新项目")}
        <ChevronDown
          size={15}
          style={{ transform: open ? "rotate(180deg)" : undefined }}
        />
      </button>
      {open && (
        <>
          <p>
            {t(
              "Register a BSC token or update its metadata. Anyone can make a creator claim; registration alone is not an ownership proof or endorsement.",
              "登记 BSC 代币或更新其元数据。任何人都能自行声明，登记本身不是所有权证明或官方背书。",
            )}
          </p>
          <label>
            {t("Token on this network", "当前网络代币")}
            <input
              value={token}
              onChange={(e) => {
                setToken(e.target.value);
                setProjectId("");
              }}
              placeholder="0x…"
            />
          </label>
          <label>
            {t("Metadata URI (optional)", "Metadata URI（可选）")}
            <input
              value={uri}
              onChange={(e) => setUri(e.target.value)}
              placeholder="ipfs://…"
            />
          </label>
          <button
            className="button"
            disabled={busy || !deployment}
            onClick={() => void save()}
          >
            {t("Save through my wallet", "通过我的钱包保存")}
          </button>
          {projectId && <CopyText value={projectId} />}
          <p>
            {t(
              "Updating your entry removes any prior attestation. Linking tokens does not bridge funds or synchronize market prices.",
              "更新登记会清除此前的核对标记。关联代币不会跨链转移资金或同步市场价格。",
            )}
          </p>
        </>
      )}
    </section>
  );
}
