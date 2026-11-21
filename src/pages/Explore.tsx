import RegisterProject from "../components/RegisterProject";
import { useEffect, useState, useRef } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, RefreshCw, Search } from "lucide-react";
import { useApp } from "../lib/context";
import { PageTitle, CopyText } from "../components/Frame";
import {
  Chain,
  Contract,
  rpc,
  abi,
  asset,
  publicUrl,
  errorCode,
} from "../lib/chain";
type Token = {
  id?: string;
  chain: Chain;
  address: string;
  name: string;
  symbol: string;
  decimals: number;
  supply: string;
  image?: string;
  creator?: string;
  peerChain?: string;
  peerToken?: string;
  attested?: boolean;
};
async function withImage(chain: Chain, address: string, metadataURI = "") {
  const data = await asset(chain, address),
    c = new Contract(
      address,
      [
        "function logo() view returns(string)",
        "function tokenURI() view returns(string)",
        "function meta() view returns(string)",
      ],
      rpc(chain),
    );
  let image = "";
  if (metadataURI) {
    try {
      const url = metadataURI.startsWith("ipfs://")
        ? "/api/metadata/" + metadataURI.slice(7)
        : publicUrl(metadataURI);
      const m = await fetch(url, { signal: AbortSignal.timeout(5000) }).then(
        (r) => r.json(),
      );
      image = publicUrl(m.image || "");
    } catch {}
  }
  if (image) return { ...data, chain, image };
  try {
    image = publicUrl(await c.logo());
  } catch {
    for (const method of ["tokenURI", "meta"]) {
      try {
        const raw = await c[method]();
        const uri =
          raw.startsWith("ipfs://") || raw.startsWith("https://")
            ? raw
            : "ipfs://" + raw;
        const r = await fetch(publicUrl(uri), {
          signal: AbortSignal.timeout(5000),
        });
        const m = await r.json();
        image = publicUrl(m.image || "");
        break;
      } catch {}
    }
  }
  return { ...data, chain, image };
}
export default function Explore() {
  const { t, config, setMessage } = useApp();
  const generation = useRef(0);
  const chain: Chain = "bsc";
  const [rows, setRows] = useState<Token[]>([]),
    [selected, setSelected] = useState<Token | null>(null),
    [loading, setLoading] = useState(false),
    [error, setError] = useState(""),
    [query, setQuery] = useState(""),
    [lookup, setLookup] = useState("");
  async function load() {
    if (!config) return;
    const gen = ++generation.current;
    setLoading(true);
    setError("");
    try {
      const d = config.chains[chain].contracts.registry;
      if (!d) {
        setRows([]);
        return;
      }
      const c = new Contract(d.address, await abi("TigerRegistry"), rpc(chain));
      const count = Number(await c.count());
      const ids = await c.page(Math.max(0, count - 50), 50);
      const tokens: Token[] = [];
      for (const id of ids) {
        const p = await c.project(id);
        try {
          const token = await withImage(chain, p.token, p.metadataURI);
          tokens.push({
            ...token,
            id,
            creator: p.creator,
            peerChain: String(p.peerChain),
            peerToken: p.peerToken,
            attested: p.attested,
          });
        } catch {
          setError(
            t(
              "Some registered assets could not be read. Retry to refresh them.",
              "部分登记资产读取失败，请刷新重试。",
            ),
          );
        }
      }
      if (gen !== generation.current) return;
      setRows(tokens.reverse());
      setSelected(tokens[0] || null);
    } catch {
      setError(
        t(
          "Could not read the registry. Retry to refresh the list.",
          "无法读取登记簿，请重试刷新。",
        ),
      );
    } finally {
      if (gen === generation.current) setLoading(false);
    }
  }
  useEffect(() => {
    void load();
  }, [config, chain]);
  async function search() {
    setLoading(true);
    try {
      const token = await withImage(chain, lookup.trim());
      setSelected(token);
      setError("");
    } catch (e) {
      setMessage(errorCode(e));
    } finally {
      setLoading(false);
    }
  }
  const filtered = rows.filter((r) =>
    (r.name + r.symbol + r.address).toLowerCase().includes(query.toLowerCase()),
  );
  return (
    <>
      <PageTitle
        title={t("BSC registry", "BSC 登记簿")}
        description={t(
          "Projects registered in the new Dark ecosystem. Every address can be inspected onchain.",
          "全新 Dark 生态的项目登记，每个地址都可以在链上核对。",
        )}
        aside={
          <Link className="button primary" to="/app/launch">
            {t("Launch a token", "发行代币")}
            <ArrowRight size={16} />
          </Link>
        }
      />
      <div className="directory-toolbar">
        <b>BSC</b>
        <label className="search">
          <Search size={16} />
          <input
            aria-label={t("Filter projects", "筛选项目")}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("Name, symbol or address", "名称、代码或地址")}
          />
        </label>
        <button
          className="text-button"
          onClick={() => void load()}
          disabled={loading}
        >
          <RefreshCw size={15} className={loading ? "spinning" : ""} />
          {t("Refresh", "刷新")}
        </button>
      </div>
      <div className="market-layout">
        <section>
          <div className="list-heading">
            <span>{t("PROJECT / NETWORK", "项目 / 网络")}</span>
            <span>{t("REGISTRATION", "登记")}</span>
          </div>
          {error ? (
            <div className="empty">
              <p>{error}</p>
              <button onClick={() => void load()}>{t("Retry", "重试")}</button>
            </div>
          ) : loading && rows.length === 0 ? (
            <div className="empty">
              {t("Reading chain state…", "正在读取链上数据…")}
            </div>
          ) : filtered.length === 0 ? (
            <div className="empty">
              <h2>{t("No matching projects", "没有匹配的项目")}</h2>
              <p>
                {rows.length
                  ? t("Try another search or filter.", "请更换搜索词或筛选条件。")
                  : t("No projects have been registered yet.", "登记簿中暂无项目。")}
              </p>
              <Link to="/app/launch">
                {t("Create a project", "创建项目")}
                <ArrowRight size={15} />
              </Link>
            </div>
          ) : (
            filtered.map((r) => (
              <button
                key={r.id}
                className={
                  "market-row " + (selected?.id === r.id ? "selected" : "")
                }
                onMouseEnter={() => setSelected(r)}
                onFocus={() => setSelected(r)}
                onClick={() => setSelected(r)}
              >
                <div>
                  {r.image ? (
                    <img
                      src={r.image}
                      alt=""
                      onError={(e) =>
                        (e.currentTarget.style.visibility = "hidden")
                      }
                    />
                  ) : (
                    <span className="token-initial">
                      {r.symbol.slice(0, 2)}
                    </span>
                  )}
                  <span>
                    <strong>{r.name}</strong>
                    <small>
                      {r.symbol} / {r.chain.toUpperCase()}
                    </small>
                  </span>
                </div>
                <span>
                  {r.attested
                    ? t("Attested", "已核对")
                    : t("Creator claim", "创建者登记")}
                  <ArrowRight size={16} />
                </span>
              </button>
            ))
          )}
          <form
            className="lookup"
            onSubmit={(e) => {
              e.preventDefault();
              void search();
            }}
          >
            <h3>{t("Look up any token", "查询代币")}</h3>
            <p>
              {t(
                "An address lookup does not register or endorse a token.",
                "地址查询不代表项目登记或认可。",
              )}
            </p>
            <div>
              <input
                aria-label={t("Token address", "代币地址")}
                value={lookup}
                onChange={(e) => setLookup(e.target.value)}
                placeholder="0x…"
                required
              />
              <button className="button" disabled={loading}>
                {t("Inspect", "查看")}
              </button>
            </div>
          </form>
          <RegisterProject chain={chain} onSaved={() => void load()} />
        </section>
        <aside className="token-preview" key={selected?.address || "empty"}>
          {selected ? (
            <>
              <div className="preview-art">
                {selected.image ? (
                  <img src={selected.image} alt={selected.name} />
                ) : (
                  <span>{selected.symbol.slice(0, 3)}</span>
                )}
              </div>
              <span className="mono">
                {selected.chain.toUpperCase()} / {selected.symbol}
              </span>
              <h2>{selected.name}</h2>
              <CopyText value={selected.address} />
              <dl>
                <div>
                  <dt>{t("Total supply", "总供应量")}</dt>
                  <dd>
                    {Number(selected.supply).toLocaleString("en-US", {
                      maximumFractionDigits: 3,
                    })}
                  </dd>
                </div>
                <div>
                  <dt>{t("Decimals", "精度")}</dt>
                  <dd>{selected.decimals}</dd>
                </div>
              </dl>
              <a
                className="button primary"
                href={
                  config?.chains[selected.chain].explorer +
                  "/address/" +
                  selected.address
                }
                target="_blank"
                rel="noreferrer"
              >
                {t("View on explorer", "在浏览器查看")}
                <ArrowRight size={16} />
              </a>
              <Link
                to={
                  "/app/otc?chain=" +
                  selected.chain +
                  "&token=" +
                  selected.address
                }
              >
                {t("Create an OTC quote", "创建 OTC 报价")}
                <ArrowRight size={15} />
              </Link>
              <p className="muted">
                {t(
                  "Third-party assets are independent from Dark. Inspect their contracts and launch details.",
                  "第三方资产独立于 Dark，请核对其合约和发行信息。",
                )}
              </p>
            </>
          ) : (
            <>
              <div className="preview-art placeholder-art">
                <div />
                <div />
                <div />
              </div>
              <h2>{t("A closer look.", "看得更清楚。")}</h2>
              <p>
                {t(
                  "Choose a project or look up a token address to inspect its metadata.",
                  "选择项目或查询代币地址，查看链上资料及真实头像。",
                )}
              </p>
            </>
          )}
        </aside>
      </div>
    </>
  );
}
