import BinanceRecipientCheck from "../components/BinanceRecipientCheck";
import {
  BSC_USDT,
  type TaxRoute,
  bindXTax,
  checkRecipient,
  type RecipientCheck,
} from "../lib/tax-route";
import { Link, useSearchParams } from "react-router-dom";
import { useEffect, useRef, useState } from "react";
import {
  ArrowRight,
  Globe2,
  Pencil,
  Wallet,
  Vault,
  BadgeCheck,
  Layers,
  Info,
  Upload,
  Check,
} from "lucide-react";
import { Interface, formatEther, isAddress } from "ethers";
import { useApp } from "../lib/context";
import "../bags-launch.css";
import { CopyText } from "../components/Frame";
import {
  Chain,
  Contract,
  rpc,
  abi,
  erc20,
  units,
  ZeroAddress,
  publicUrl,
  errorCode,
  short,
  approveExact,
} from "../lib/chain";
import { LaunchForm, Preview, prepare, fingerprint } from "../lib/launch";
type Quote = {
  address: string;
  symbol: string;
  name: string;
  decimals: number;
  logoUrl: string;
  category: string;
};
const blank: LaunchForm = {
  chain: "bsc",
  name: "",
  symbol: "",
  description: "",
  image: "",
  cid: "",
  buyTax: "1",
  sellTax: "1",
  taxDays: "365",
  firstBuy: "0",
  quote: ZeroAddress,
  route: "wallet",
  commissionShare: "",
  social: "",
  creator: "",
  website: "",
  twitter: "",
};
export default function Launch() {
  const [params] = useSearchParams();
  return <LaunchFormView key={params.toString()} />;
}
function LaunchFormView() {
  const app = useApp(),
    { t, config, account, busy, setMessage } = app;
  const [search] = useSearchParams();
  const nomination = search.get("nomination") || undefined;
  const [nominationTitle, setNominationTitle] = useState("");
  useEffect(() => {
    if (!nomination) return;
    const abort = new AbortController();
    fetch("/api/giving/nominations/" + encodeURIComponent(nomination), {
      signal: abort.signal,
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((r) => {
        if (r && !abort.signal.aborted) setNominationTitle(r.title);
      })
      .catch(() => {});
    return () => abort.abort();
  }, [nomination]);
  const requestedRoute = nomination ? "x" : search.get("route");
  const preset: TaxRoute | null =
    requestedRoute === "commission"
      ? "commission"
      : requestedRoute === "square" || requestedRoute === "binance"
        ? "binance"
        : requestedRoute === "square-wallet"
          ? "square"
          : requestedRoute === "x"
            ? "x"
            : null;
  const [payCheck, setPayCheck] = useState<RecipientCheck | null>(null);
  const [xEnabled, setXEnabled] = useState<boolean | null>(null);
  const [xCanCheck, setXCanCheck] = useState(false);
  const [xIdentityProvider, setXIdentityProvider] = useState("");
  const [poolConversion, setPoolConversion] = useState(false);
  const [gasSponsored, setGasSponsored] = useState(false);
  const [xMaximum, setXMaximum] = useState("");
  const [showSettlement, setShowSettlement] = useState(false);
  const [xRetry, setXRetry] = useState(0);
  const [xMinimum, setXMinimum] = useState("");
  const [xConsent, setXConsent] = useState(false);
  const [xChecking, setXChecking] = useState(false);
  const [merchant, setMerchant] = useState<boolean | null>(null);
  useEffect(() => {
    fetch("/api/giving/capabilities")
      .then((r) => r.json())
      .then((r) => {
        setMerchant(r.uid === true);
        setXEnabled(r.xTax === true);
        setXCanCheck(r.xCheck === true || r.xTax === true);
        setXIdentityProvider(
          r.xIdentityProvider === "FxEmbed" ? "FxEmbed" : "X API",
        );
        setXMinimum(String(r.xMin ?? ""));
        setXMaximum(String(r.xMax ?? ""));
        setGasSponsored(r.xGasSponsored === true);
        setPoolConversion(r.xPoolConversion === true);
      })
      .catch(() => {
        setMerchant(false);
        setXEnabled(false);
      });
  }, []);
  const [form, setForm] = useState<LaunchForm>(() => {
      const initial = {
        ...blank,
        nomination,
        route: preset ?? blank.route,
        quote: preset === "binance" ? BSC_USDT : ZeroAddress,
      };
      try {
        const draft = JSON.parse(
          localStorage.getItem("tiger-genesis:draft") || "{}",
        );
        if (draft.chain && draft.chain !== "bsc")
          return {
            ...initial,
            name: draft.name || "",
            symbol: draft.symbol || "",
            description: draft.description || "",
            website: draft.website || "",
            twitter: draft.twitter || "",
          };
        const route =
          preset ??
          ([
            "x",
            "binance",
            "square",
            "reserve",
            "wallet",
            "commission",
          ].includes(draft.route)
            ? draft.route
            : draft.reserve === true
              ? "reserve"
              : blank.route);
        const savedQuote = isAddress(draft.quote) ? draft.quote : null;
        const defaultQuote = route === "binance" ? BSC_USDT : ZeroAddress;
        const quote =
          preset === "binance" ? BSC_USDT : (savedQuote ?? defaultQuote);
        return {
          ...initial,
          ...draft,
          chain: "bsc",
          route,
          quote,
          social: "",
          nomination,
          firstBuy:
            savedQuote?.toLowerCase() === quote.toLowerCase()
              ? (draft.firstBuy ?? "0")
              : "0",
        };
      } catch {
        return initial;
      }
    }),
    [file, setFile] = useState<File | null>(null),
    [localImage, setLocalImage] = useState(""),
    [quotes, setQuotes] = useState<Quote[]>([]),
    [quoteStatus, setQuoteStatus] = useState<"loading" | "ready" | "error">(
      "loading",
    ),
    [quoteRetry, setQuoteRetry] = useState(0),
    [filter, setFilter] = useState("all"),
    [q, setQ] = useState(""),
    [working, setWorking] = useState(""),
    [preview, setPreview] = useState<Preview | null>(null),
    [completed, setCompleted] = useState<{
      token: string;
      hash: string;
      chain: Chain;
    } | null>(null),
    [pending, setPending] = useState(false);
  const stablePool = form.route === "x" || form.route === "binance";
  const compatiblePool =
    !stablePool ||
    form.quote.toLowerCase() === BSC_USDT.toLowerCase() ||
    (form.route === "x" && poolConversion);
  useEffect(() => {
    if (
      form.route !== "x" ||
      !compatiblePool ||
      !xCanCheck ||
      !xConsent ||
      (!nomination && !/^@?[a-z0-9_]{1,15}$/i.test(form.social.trim()))
    ) {
      setXChecking(false);
      return;
    }
    let active = true;
    setXChecking(true);
    void checkRecipient(form.social, "x", nomination).then((result) => {
      if (active) {
        setPayCheck(result);
        setXChecking(false);
      }
    });
    return () => {
      active = false;
    };
  }, [
    form.route,
    form.social,
    nomination,
    compatiblePool,
    xCanCheck,
    xConsent,
    xRetry,
  ]);
  const payReady =
    payCheck?.state === "READY" &&
    payCheck.input === (nomination || form.social) &&
    !!payCheck.ticket;
  const generation = useRef(0);
  const update = (key: keyof LaunchForm, value: any) => {
    if (key === "social") {
      setPayCheck(null);
      setXConsent(false);
    }
    if (["description", "website", "twitter"].includes(key))
      generation.current++;
    setForm((f) => ({
      ...f,
      [key]: value,
      ...(["description", "website", "twitter"].includes(key)
        ? { cid: "", image: "" }
        : {}),
    }));
    setPreview(null);
  };
  useEffect(() => {
    const { social, nomination, ...draft } = form;
    localStorage.setItem("tiger-genesis:draft", JSON.stringify(draft));
  }, [form]);
  useEffect(() => {
    if (account && (!form.creator || form.route !== "wallet"))
      update("creator", account);
  }, [account, form.route]);
  useEffect(() => {
    if (localImage) return () => URL.revokeObjectURL(localImage);
  }, [localImage]);
  useEffect(() => {
    const abort = new AbortController();
    setQuoteStatus("loading");
    fetch("/api/flap/quotes", { signal: abort.signal })
      .then(async (response) => {
        if (!response.ok) throw Error("QUOTE_DIRECTORY_UNAVAILABLE");
        const data = await response.json();
        const items = data.chains?.find(
          (chain: { chainId: number }) => chain.chainId === 56,
        )?.quoteTokens;
        if (!Array.isArray(items)) throw Error("QUOTE_DIRECTORY_UNAVAILABLE");
        if (!abort.signal.aborted) {
          setQuotes(items);
          setQuoteStatus("ready");
        }
      })
      .catch(() => {
        if (!abort.signal.aborted) setQuoteStatus("error");
      });
    return () => abort.abort();
  }, [quoteRetry]);
  function changeRoute(route: TaxRoute) {
    if (nomination || route === form.route) return;
    setPayCheck(null);
    setXConsent(false);
    setShowSettlement(false);
    setFilter("all");
    setQ("");
    setForm((f) => ({
      ...f,
      route,
      social: "",
      ...(route === "binance" &&
      f.quote.toLowerCase() !== BSC_USDT.toLowerCase()
        ? { quote: BSC_USDT, firstBuy: "0" }
        : {}),
    }));
    setPreview(null);
  }
  function selectPool(address: string) {
    if (address.toLowerCase() === form.quote.toLowerCase()) return;
    setForm((f) => ({ ...f, quote: address, firstBuy: "0" }));
    setPayCheck(null);
    setXConsent(false);
    setPreview(null);
  }
  async function choose(file: File | undefined) {
    const gen = ++generation.current;
    setPreview(null);
    setFile(null);
    setLocalImage("");
    setForm((f) => ({ ...f, cid: "", image: "" }));
    if (!file) {
      setFile(null);
      setLocalImage("");
      return;
    }
    if (
      file.size > 2_500_000 ||
      !["image/png", "image/jpeg", "image/webp"].includes(file.type)
    ) {
      setMessage(
        t(
          "Use PNG, JPEG or WebP, up to 2.5 MB.",
          "请使用不超过 2.5 MB 的 PNG、JPEG 或 WebP 图片。",
        ),
      );
      return;
    }
    try {
      const bitmap = await createImageBitmap(file);
      if (bitmap.width > 8192 || bitmap.height > 8192) throw Error();
      bitmap.close();
      if (gen !== generation.current) return;
      setFile(file);
      setLocalImage(URL.createObjectURL(file));
    } catch {
      setMessage(
        t(
          "This image could not be decoded. Choose another file.",
          "无法读取这张图片，请更换文件。",
        ),
      );
    }
  }
  async function upload() {
    if (!account) return setMessage("CONNECT_WALLET");
    if (!file && !form.cid) return;
    const gen = generation.current;
    setWorking("UPLOADING");
    try {
      let cid = form.cid;
      if (!cid) {
        const body = new FormData();
        body.set("image", file!);
        body.set("creator", account);
        body.set("description", form.description);
        body.set("website", form.website);
        body.set("twitter", form.twitter);
        const r = await fetch("/api/upload", { method: "POST", body });
        const data = await r.json();
        if (!r.ok) throw Error("UPLOAD_FAILED");
        cid = data.cid;
        if (gen !== generation.current) return;
        setForm((f) => ({ ...f, cid }));
      }
      const meta = await fetch("/api/metadata/" + cid, {
        signal: AbortSignal.timeout(20000),
      }).then((r) => {
        if (!r.ok) throw Error("METADATA_UNAVAILABLE");
        return r.json();
      });
      const image = publicUrl(meta.image || "");
      if (!image) throw Error("METADATA_IMAGE_MISSING");
      if (gen !== generation.current) return;
      setForm((f) => ({ ...f, cid, image }));
      setMessage(
        t(
          "Image and metadata pinned to Flap IPFS.",
          "图片和 metadata 已保存到 Flap IPFS。",
        ),
      );
    } catch (e) {
      setMessage(errorCode(e));
    } finally {
      setWorking("");
    }
  }
  async function check() {
    if (!config || !account) return setMessage("CONNECT_WALLET");
    if (form.route === "wallet" && !isAddress(form.creator))
      return setMessage("INVALID_ADDRESS");
    setWorking("PREPARING");
    try {
      const p = await prepare(
        form,
        config,
        account,
        setWorking,
        ["binance", "x"].includes(form.route) && payReady
          ? payCheck?.ticket
          : undefined,
      );
      setPreview(p);
      window.scrollTo(0, 0);
    } catch (e) {
      setMessage(errorCode(e));
    } finally {
      setWorking("");
    }
  }
  async function approve() {
    if (!config || form.chain !== "bsc" || form.quote === ZeroAddress) return;
    try {
      const c = new Contract(form.quote, erc20, rpc("bsc")),
        decimals = Number(await c.decimals()),
        amount = units(form.firstBuy, decimals),
        to =
          form.route === "reserve" || form.route === "commission"
            ? config.protocols.flap.vaultPortal
            : config.protocols.flap.portal;
      await approveExact(
        "bsc",
        form.quote,
        to,
        amount,
        app.transact,
        "Approve launch quote",
      );
    } catch (e) {
      setMessage(errorCode(e));
    }
  }
  async function launch() {
    if (!preview || !config) return;
    if (
      preview.fingerprint !== fingerprint(form) ||
      preview.account !== account ||
      Date.now() - preview.createdAt > 300000
    ) {
      setPreview(null);
      return setMessage(
        t(
          "Preview expired or parameters changed. Simulate again.",
          "预览已过期或参数已改变，请重新模拟。",
        ),
      );
    }
    setPending(true);
    try {
      if (form.route === "x" || form.route === "binance") {
        const checked = await checkRecipient(
          form.social,
          form.route,
          nomination,
        );
        if (
          checked.state !== "READY" ||
          checked.ticket !== preview.payTicket ||
          (form.route === "x" &&
            (await bindXTax(
              form.social,
              checked.ticket,
              preview.params.salt,
              preview.predicted,
              form.quote,
              nomination,
            )) !== preview.params.beneficiary)
        ) {
          setPreview(null);
          setPayCheck(null);
          throw Error("RECIPIENT_CHANGED");
        }
      }
      const receipt = await app.transact(
        preview.chain,
        { ...preview.request, value: BigInt(preview.request.value) },
        "Launch " + preview.label,
      );
      const code = await rpc(preview.chain).getCode(preview.predicted);
      if (code === "0x") throw Error("LAUNCH_ADDRESS_NOT_CONFIRMED");
      const token = new Contract(preview.predicted, erc20, rpc(preview.chain));
      if (
        (await token.name()) !== form.name.trim() ||
        (await token.symbol()) !== form.symbol.trim()
      )
        throw Error("LAUNCH_METADATA_MISMATCH");
      setCompleted({
        token: preview.predicted,
        hash: receipt.hash,
        chain: preview.chain,
      });
      setMessage(
        t(
          "Token creation confirmed. Register it to display it in the new Dark directory.",
          "代币创建已确认，登记后即可显示在新 Dark 目录中。",
        ),
      );
    } catch (e: any) {
      setMessage(errorCode(e));
      if (!e?.submitted) setPending(false);
    }
  }
  async function register() {
    if (!completed || !config) return;
    const d = config.chains[completed.chain].contracts.registry;
    if (!d) return setMessage("REGISTRY_NOT_DEPLOYED");
    try {
      const i = new Interface(await abi("TigerRegistry"));
      await app.transact(
        completed.chain,
        {
          to: d.address,
          data: i.encodeFunctionData("register", [
            completed.token,
            0,
            ZeroAddress,
            "ipfs://" + form.cid,
          ]),
        },
        "Register " + form.symbol,
      );
    } catch (e) {
      setMessage(errorCode(e));
    }
  }
  const selectedQuote = quotes.find(
    (x) => x.address.toLowerCase() === form.quote.toLowerCase(),
  );
  const channels = [
    {
      id: "x",
      label: t("X Money", "X Money"),
      full: t("X Money giving", "X Money 公益"),
      icon: <XBrand />,
    },
    {
      id: "binance",
      label: t("Binance Pay", "币安 Pay"),
      full: t("Square post / Binance UID", "广场帖子 / 币安 UID"),
      icon: <BnbMark />,
    },
    {
      id: "square",
      label: t("Signed wallet", "签名钱包"),
      full: t("Signed Square wallet", "已签名的广场钱包"),
      icon: <BadgeCheck />,
    },
    {
      id: "commission",
      label: t("Agent work", "公益委托"),
      full: t("Agent tax commissions", "Agent 公益委托"),
      icon: <BadgeCheck />,
    },
    {
      id: "reserve",
      label: t("Reserve", "储备金库"),
      full: t("Dark reserve", "Dark 储备金库"),
      icon: <Vault />,
    },
    {
      id: "wallet",
      label: t("BSC wallet", "BSC 钱包"),
      full: t("BSC wallet", "BSC 钱包"),
      icon: <Wallet />,
    },
  ] as const;
  const availableQuotes = quotes.filter(
    (x) =>
      (filter === "all" || x.category === filter) &&
      (x.symbol + x.name + x.address)
        .toLowerCase()
        .includes(q.trim().toLowerCase()),
  );
  const quoteLabel =
    selectedQuote?.symbol ||
    (form.quote === ZeroAddress ? "BNB" : short(form.quote));
  const needsRecipient = stablePool || form.route === "square";
  const canPreview =
    (form.route !== "commission" ||
      (Number(form.commissionShare) > 0 &&
        Number(form.commissionShare) <= 100)) &&
    !!form.name.trim() &&
    !!form.symbol.trim() &&
    !!form.cid &&
    !!form.image &&
    !!selectedQuote &&
    compatiblePool &&
    (!stablePool || payReady) &&
    (form.route !== "x" || xConsent) &&
    (form.route !== "square" || !!form.social.trim());
  const art = localImage || form.image;
  const shareHint =
    form.route === "commission"
      ? t(
          "A share of net tax received funds commissions. The selected author is paid in the pool asset.",
          "实际到账税收按比例进入公益预算。选稿时，作者直接收到该底池资产。",
        )
      : form.route === "x"
        ? xEnabled && xMinimum && xMinimum === xMaximum
          ? t(
              `Every ${Number(xMinimum)} USDT available after collection or conversion starts an X Money payout.`,
              `每累计 ${Number(xMinimum)} USDT 已到账（含兑换所得），自动启动 X Money 付款。`,
            )
          : t(
              "Flap trading tax is settled via X Money.",
              "Flap 交易税通过 X Money 支付。",
            )
        : form.route === "binance"
          ? t(
              "For posts, the merchant checks the author's linked Binance payee.",
              "使用帖子时，商户将核对作者已绑定的币安收款账户。",
            )
          : form.route === "square"
            ? t(
                "Use a signed payout post or a post by an author with a registered declaration.",
                "粘贴签名收款帖，或已登记收款声明作者的原创帖。",
              )
            : form.route === "reserve"
              ? t(
                  "The token creator and Flap Guardian can withdraw from this reserve.",
                  "代币创建者与 Flap Guardian 可以支取此金库的资产。",
                )
              : t(
                  "Flap distributes this token’s tax to the selected BSC wallet.",
                  "Flap 将这枚代币的税收分配到指定 BSC 钱包。",
                );
  return (
    <div className="bags-launch">
      <header className="issue-intro">
        <h1>{t("Launch on Dark", "在 Dark 上发行")}</h1>
        <p>
          {t(
            "Launch a coin and share its trading fees.",
            "发行代币，分享交易税收。",
          )}
        </p>
        <div
          className="issue-networks"
          aria-label={t("Launch network and protocol", "发行网络与协议")}
        >
          <span>
            <BnbMark /> BSC
          </span>
          <span>
            <Layers size={15} /> Flap V3
          </span>
        </div>
      </header>
      {completed ? (
        <div className="launch-success issue-card">
          <Check size={34} />
          <h2>{t("Your token is onchain.", "代币已在链上创建。")}</h2>
          <CopyText value={completed.token} />
          <a
            href={
              config!.chains[completed.chain].explorer + "/tx/" + completed.hash
            }
            target="_blank"
            rel="noreferrer"
          >
            {t("View the creation receipt", "查看创建回执")}
            <ArrowRight size={15} />
          </a>
          <button
            className="button primary"
            onClick={() => void register()}
            disabled={busy}
          >
            {t("Register in Dark", "登记到 Dark")}
          </button>
          <p>
            {t(
              "Registration is a separate on-chain transaction. It does not imply official endorsement.",
              "登记是独立的链上交易，不代表 Dark 官方背书。",
            )}
          </p>
          {form.route === "commission" && (
            <Link
              className="button primary"
              to={"/app/hire?new=1&token=" + completed.token}
            >
              {t("Post a tax-funded brief", "用税收发布公益委托")}
            </Link>
          )}
          {form.route !== "wallet" && form.route !== "commission" && (
            <Link
              className="button"
              to={
                "/app/impact?token=" + completed.token + "&tx=" + completed.hash
              }
            >
              {t("Track tax distributions", "查看税收去向")}
            </Link>
          )}
        </div>
      ) : preview ? (
        <section className="issue-card issue-review">
          <h2>{t("Review your launch", "核对发行交易")}</h2>
          <dl className="review-terms">
            <div>
              <dt>{t("Token", "代币")}</dt>
              <dd>
                {form.name} / {form.symbol}
              </dd>
            </div>
            <div>
              <dt>{t("Network", "网络")}</dt>
              <dd>{"BSC / Flap V3"}</dd>
            </div>
            <div>
              <dt>{t("Tax beneficiary", "税收受益人")}</dt>
              <dd>
                {form.route === "x"
                  ? nomination
                    ? nominationTitle ||
                      t("Private nomination", "私密受益人提名")
                    : "X · @" +
                      form.social.trim().replace(/^@/, "").toLowerCase()
                  : form.route === "binance"
                    ? "Binance Pay · " + form.social
                    : form.route === "square"
                      ? form.social
                      : form.route === "commission"
                        ? t("Agent commissions", "Agent 公益委托") +
                          " · " +
                          form.commissionShare +
                          "%"
                        : form.route === "reserve"
                          ? t("Dark reserve", "Dark 独立金库")
                          : form.creator}
              </dd>
            </div>
            {form.route === "x" && (
              <div>
                <dt>{t("Settlement", "税收结算")}</dt>
                <dd>
                  {t(
                    "Operator-controlled collection · ",
                    "运营方控制归集地址 · ",
                  )}
                  {xMinimum} USDT{" "}
                  {t(
                    "minimum per batch after conversion · confirmed receipts in USD",
                    "起付 · 非 USDT 底池由运营方兑换后结算 · 按美元付款凭证核对",
                  )}
                </dd>
              </div>
            )}
            {preview.squarePayProfile && (
              <div>
                <dt>{t("Square author", "广场作者")}</dt>
                <dd>
                  <a
                    href={preview.squarePayProfile}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {preview.squarePayProfile.split("/").pop()}
                  </a>
                </dd>
              </div>
            )}
            {preview.verifiedSquare && (
              <div>
                <dt>{t("Verified Square author", "已核验广场作者")}</dt>
                <dd>
                  <a
                    href={preview.verifiedSquare.profile}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {preview.verifiedSquare.profile.split("/").pop()}
                  </a>{" "}
                  ·{" "}
                  <a
                    href={preview.verifiedSquare.proof}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {t("Signed declaration", "签名声明")}
                  </a>
                </dd>
              </div>
            )}
            {["x", "binance", "square"].includes(form.route) && (
              <div>
                <dt>
                  {form.route === "x"
                    ? t("BSC tax collection address", "BSC 税收归集地址")
                    : form.route === "square"
                      ? t(
                          "Author’s verified BSC wallet",
                          "已核验作者的 BSC 钱包",
                        )
                      : t("Merchant collection address", "商户归集地址")}
                </dt>
                <dd>
                  <CopyText value={preview.params.beneficiary} />
                </dd>
              </div>
            )}
            <div>
              <dt>{t("Buy / sell tax", "买入 / 卖出税")}</dt>
              <dd>
                {form.buyTax}% / {form.sellTax}%
              </dd>
            </div>
            <div>
              <dt>{t("Paired asset", "底池资产")}</dt>
              <dd>
                {preview.quoteSymbol}{" "}
                {preview.params.quoteToken !== ZeroAddress && (
                  <CopyText value={preview.params.quoteToken} />
                )}
              </dd>
            </div>
            <div>
              <dt>{t("Initial buy", "首买")}</dt>
              <dd>
                {preview.firstBuy} {preview.quoteSymbol}
              </dd>
            </div>
            <div>
              <dt>{t("Native value", "发送原生币")}</dt>
              <dd>
                {formatEther(preview.request.value)}{" "}
                {form.chain === "bsc" ? "BNB" : "ETH"}
              </dd>
            </div>
            <div>
              <dt>{t("Estimated gas units", "预计 Gas 单位")}</dt>
              <dd>{Number(preview.gas).toLocaleString()}</dd>
            </div>
          </dl>
          <label>
            {t("Expected token address", "预计代币地址")}
            <CopyText value={preview.predicted} />
          </label>
          <label>
            {t("Transaction target", "交易目标")}
            <CopyText value={preview.request.to} />
          </label>
          <p className="note">
            {t(
              "Simulation passed at the last checked block. Your wallet shows the final fee. Confirmations and receipt checks are required before this is recorded as a launch.",
              "已通过当前区块模拟，最终费用以钱包预览为准。取得成功回执并核对地址后才记为发行成功。",
            )}
          </p>
          {pending && (
            <p>
              {t(
                "Submitted or awaiting reconciliation. Check Activity before doing anything again.",
                "已提交或等待核对，请先查看交易记录，不要重复发行。",
              )}
            </p>
          )}
          <div className="issue-actions">
            {pending && (
              <Link className="button" to="/app/activity">
                {t("Open transaction history", "查看交易记录")}
              </Link>
            )}
            {!pending && (
              <button className="button" onClick={() => setPreview(null)}>
                {t("Edit details", "修改资料")}
              </button>
            )}
            <button
              className="button primary"
              onClick={() => void launch()}
              disabled={busy || pending}
            >
              {t("Confirm in my wallet", "在我的钱包中确认")}
            </button>
          </div>
        </section>
      ) : (
        <fieldset
          className="issue-form"
          disabled={!!working || busy || pending}
        >
          <section
            className="issue-card issue-identity"
            aria-label={t("Token details", "代币资料")}
          >
            <div className="issue-identity-top">
              <label
                className="issue-art"
                title={t(
                  "Choose a PNG, JPEG or WebP up to 2.5 MB",
                  "选择不超过 2.5 MB 的 PNG、JPEG 或 WebP 图片",
                )}
              >
                <input
                  aria-label={t("Choose a token image", "选择代币图片")}
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  onChange={(e) => void choose(e.target.files?.[0])}
                />
                {art ? (
                  <img
                    src={art}
                    alt={t("Token image preview", "代币图片预览")}
                  />
                ) : (
                  <svg
                    width="40"
                    height="40"
                    viewBox="0 0 24 24"
                    fill="currentColor"
                    aria-hidden="true"
                  >
                    <path
                      fillRule="evenodd"
                      d="M4.5 1h15A3.5 3.5 0 0 1 23 4.5v15a3.5 3.5 0 0 1-3.5 3.5h-15A3.5 3.5 0 0 1 1 19.5v-15A3.5 3.5 0 0 1 4.5 1Zm4 4a2.4 2.4 0 1 0 0 4.8 2.4 2.4 0 0 0 0-4.8Zm11.6 12.5-4.4-4.6a1.6 1.6 0 0 0-2.3 0l-3 3-1.9-1.7a1.6 1.6 0 0 0-2.2.1l-2.4 2.9v2.2h16.2v-1.9Z"
                    />
                  </svg>
                )}
                <span className="issue-art-edit">
                  <Pencil size={13} />
                </span>
              </label>
              <div className="issue-name-fields">
                <input
                  aria-label={t("Token name", "代币名称")}
                  placeholder={t("Name", "名称")}
                  value={form.name}
                  onChange={(e) => update("name", e.target.value)}
                  maxLength={64}
                  required
                />
                <input
                  aria-label={t("Token symbol", "代币代码")}
                  placeholder={t("Ticker", "代码")}
                  value={form.symbol}
                  onChange={(e) => update("symbol", e.target.value)}
                  maxLength={16}
                  required
                />
              </div>
            </div>
            <textarea
              aria-label={t("Description", "项目描述")}
              placeholder={t("Description", "项目描述")}
              maxLength={2000}
              value={form.description}
              onChange={(e) => update("description", e.target.value)}
            />
            <div className="issue-links">
              <label>
                <Globe2 size={16} />
                <input
                  aria-label={t("Website (optional)", "网站（可选）")}
                  placeholder={t("website", "网站")}
                  value={form.website}
                  onChange={(e) => update("website", e.target.value)}
                />
              </label>
              <label>
                <XBrand />
                <input
                  aria-label={t(
                    "Public project X profile (optional)",
                    "项目公开 X 主页（可选）",
                  )}
                  placeholder="x.com"
                  value={form.twitter}
                  onChange={(e) => update("twitter", e.target.value)}
                />
              </label>
            </div>
            {(file || form.cid) && (
              <div className="issue-upload-meta">
                <button
                  className="button"
                  disabled={!!working || busy}
                  onClick={() => void (account ? upload() : app.connect())}
                >
                  <Upload size={15} />
                  {!account
                    ? t("Connect wallet to upload", "连接钱包后上传")
                    : working === "UPLOADING"
                      ? t("Uploading…", "正在上传…")
                      : form.cid
                        ? t("Refresh pinned metadata", "重新读取已上传资料")
                        : t("Upload image & metadata", "上传图片与 metadata")}
                </button>
                {form.cid ? (
                  <CopyText value={"ipfs://" + form.cid} />
                ) : (
                  <small>
                    {t(
                      "Uploading publishes the image and project metadata to IPFS.",
                      "上传会将图片和项目资料发布至 IPFS。",
                    )}
                  </small>
                )}
              </div>
            )}
          </section>
          <section
            className="issue-card issue-share route-picker"
            aria-labelledby="issue-share-title"
          >
            <h2 id="issue-share-title">{t("share fees", "分配交易税")}</h2>
            <div className="issue-channels">
              {channels.map(({ id, label, full, icon }) => (
                <button
                  type="button"
                  key={id}
                  disabled={!!nomination && id !== "x"}
                  title={full}
                  aria-label={full}
                  aria-pressed={form.route === id}
                  onClick={() => changeRoute(id)}
                >
                  <span>{icon}</span>
                  <small>{label}</small>
                </button>
              ))}
            </div>
            {form.route === "commission" && (
              <label>
                {t(
                  "Commission share of net tax received (%)",
                  "实际到账税收中的公益比例（%）",
                )}
                <input
                  type="number"
                  min=".01"
                  max="100"
                  step=".01"
                  placeholder="1–100"
                  value={form.commissionShare || ""}
                  onChange={(e) => update("commissionShare", e.target.value)}
                />
                <small>
                  {t(
                    "The rest remains available to the issuer. The percentage is fixed at launch.",
                    "剩余部分归发行人，公益比例在发币后固定。",
                  )}
                </small>
              </label>
            )}
            {nomination ? (
              <div className="nomination-choice">
                <strong>
                  {nominationTitle ||
                    t("Private beneficiary nomination", "私密受益人提名")}
                </strong>
                <Link
                  to={
                    "/app/impact?view=nominations&case=" +
                    encodeURIComponent(nomination)
                  }
                >
                  {t("View nomination", "查看提名")}
                </Link>
                <Link to="/app/launch?route=x">
                  {t("Leave nomination", "退出本次认领")}
                </Link>
              </div>
            ) : (
              <Link
                className="nomination-browse"
                to="/app/impact?view=nominations"
              >
                {t("Choose a community nomination", "从社区提名中选择")}
              </Link>
            )}
            {needsRecipient && !nomination && (
              <div className="issue-handle">
                <input
                  value={form.social}
                  autoComplete="off"
                  maxLength={512}
                  onChange={(e) => update("social", e.target.value)}
                  aria-label={
                    form.route === "x"
                      ? t("X beneficiary", "X 税收受益人")
                      : form.route === "square"
                        ? t("Square author’s original post", "广场作者原创帖")
                        : t(
                            "Ordinary Square post or exchange UID",
                            "普通广场原帖或交易所 UID",
                          )
                  }
                  placeholder={
                    form.route === "x"
                      ? "@username"
                      : form.route === "square"
                        ? "binance.com/square/post/…"
                        : t("Binance UID or post", "币安 UID 或帖子链接")
                  }
                />
                {form.route === "x" && (
                  <span className="issue-money" title="X Money">
                    <XBrand />
                    <span>$</span>
                    <button
                      type="button"
                      aria-label={t("Settlement details", "结算详情")}
                      aria-expanded={showSettlement}
                      aria-controls="issue-settlement-info"
                      onClick={() => setShowSettlement((v) => !v)}
                    >
                      <Info size={14} />
                      {t("Details", "详情")}
                    </button>
                  </span>
                )}
              </div>
            )}
            {form.route === "wallet" && (
              <label>
                {t("BSC tax recipient", "BSC 税收接收地址")}
                <input
                  value={form.creator}
                  onChange={(e) => update("creator", e.target.value)}
                  placeholder="0x…"
                />
              </label>
            )}
            <p className="issue-share-hint">
              {compatiblePool
                ? shareHint
                : t(
                    "This payout channel requires a USDT pool. Choose the pool or payout channel below.",
                    "此付款渠道需要 USDT 底池，请在底池区调整资产或收款方式。",
                  )}
            </p>
            {form.route === "x" && (
              <div className="recipient-check">
                {compatiblePool && (nomination || form.social.trim()) && (
                  <>
                    <label>
                      <input
                        type="checkbox"
                        checked={xConsent}
                        onChange={(e) => {
                          setXConsent(e.target.checked);
                          setPayCheck(null);
                          setPreview(null);
                        }}
                      />{" "}
                      {nomination
                        ? t(
                            "Use the nominated X beneficiary for this token and verify the payout route.",
                            "确认使用提名中绑定的 X 受益人，并核验付款渠道。",
                          )
                        : xEnabled
                          ? t(
                              `I have confirmed the recipient can receive X Money. Dark may send the handle to ${xIdentityProvider} for verification and to Peer for payout.`,
                              `我已确认对方可收取 X Money，同意 Dark 向 ${xIdentityProvider} 提交用户名核验，付款时再提供给 Peer。`,
                            )
                          : t(
                              `Allow Dark to check this username with ${xIdentityProvider || "the identity service"} and request a bridge quote.`,
                              `同意 Dark 向 ${xIdentityProvider || "身份查询服务"} 提交用户名核验，并查询跨链报价。`,
                            )}
                    </label>
                    {xConsent &&
                      payCheck &&
                      payCheck.state !== "READY" &&
                      !xChecking && (
                        <button
                          type="button"
                          className="button"
                          onClick={() => setXRetry((n) => n + 1)}
                        >
                          {t("Check again", "重新核验")}
                        </button>
                      )}
                    <p role="status">
                      {xChecking
                        ? t(
                            "Verifying X account and bridge quote…",
                            "正在核验 X 用户名与跨链报价…",
                          )
                        : payCheck?.input === (nomination || form.social) &&
                            payCheck.state === "VERIFIED"
                          ? t(
                              "X identity verified. Automatic settlement is currently unavailable.",
                              "X 身份已核验。自动结算服务恢复后即可用此账户发行。",
                            )
                          : payReady
                            ? t(
                                "X identity verified. The handle stays out of the launch transaction.",
                                "X 身份已核验，发币交易不会写入用户名。",
                              )
                            : payCheck &&
                                payCheck.input === (nomination || form.social)
                              ? payCheck.state === "X_QUOTE_UNAVAILABLE"
                                ? t(
                                    "A live BSC to Base quote is unavailable. Try again when the route can settle.",
                                    "BSC 至 Base 暂无可执行报价，请稍后重试。",
                                  )
                                : t(
                                    "Could not verify this X account. Check the handle or try again.",
                                    "未能核验此 X 账户，请检查用户名后重试。",
                                  )
                              : xEnabled === false
                                ? xCanCheck
                                  ? t(
                                      "You can check an account and get a quote. Automatic transfers are paused.",
                                      "可查询 X 账户和实时报价，自动付款待启用。",
                                    )
                                  : t(
                                      "X Money settlement is offline.",
                                      "X Money 结算服务尚未启用。",
                                    )
                                : t(
                                    "The recipient needs an active X Money account.",
                                    "对方需已开通 X Money。",
                                  )}
                      {payCheck?.input === (nomination || form.social) &&
                        payCheck.quote && (
                          <small className="quote-result">
                            {t(" Bridge quote minimum", " 跨链报价最低可得")} ·{" "}
                            {payCheck.quote.inputUSDT} USDT →{" "}
                            {payCheck.quote.minimumUSDC} USDC
                          </small>
                        )}
                    </p>
                  </>
                )}
                <div
                  id="issue-settlement-info"
                  className="issue-settlement"
                  hidden={!showSettlement}
                >
                  <p>
                    {t(
                      "Flap sends this pool’s tax asset to a dedicated BSC address. Dark converts non-USDT tax to USDT before bridging to Base USDC. A Peer buyer pays the recipient USD on X Money.",
                      "Flap 将底池资产税收转入专属 BSC 地址。Dark 先将非 USDT 税收兑换为 USDT，再跨链至 Base USDC，Peer 买家将美元付到受益人的 X Money。",
                    )}
                  </p>
                  {gasSponsored && (
                    <p>
                      {xMinimum === xMaximum
                        ? t(
                            `Every ${Number(xMinimum)} USDT in confirmed tax starts a payment batch.`,
                            `每累计 ${Number(xMinimum)} USDT 已确认税收，自动启动一批付款。`,
                          )
                        : t(
                            `Settlement starts at ${xMinimum} USDT, up to ${xMaximum} USDT per batch.`,
                            `累计 ${xMinimum} USDT 后结算，每批最多 ${xMaximum} USDT。`,
                          )}{" "}
                      {t(
                        "Dark covers settlement gas on BSC and Base.",
                        "BSC 和 Base 的结算 Gas 由 Dark 支付。",
                      )}
                    </p>
                  )}
                </div>
              </div>
            )}
            {form.route === "square" && (
              <Link to="/app/impact#square-proof">
                {t("How to publish a payout declaration", "如何发布收款声明")}
              </Link>
            )}
            {form.route === "binance" && (
              <BinanceRecipientCheck
                value={form.social}
                onResult={setPayCheck}
                result={payCheck}
              />
            )}
            {form.route === "binance" &&
              merchant !== true &&
              payCheck?.state !== "MERCHANT_UNAVAILABLE" && (
                <p role="status">
                  {merchant === null
                    ? t("Checking merchant availability…", "正在检查商户渠道…")
                    : t(
                        "Binance Pay merchant settlement is not configured. This route cannot be launched yet.",
                        "币安 Pay 商户结算尚未配置，该渠道暂不能发行。",
                      )}
                </p>
              )}
          </section>
          <section className="issue-card issue-pools">
            <h2>
              {t("Paired asset", "底池资产")}
              {quoteStatus === "ready" && (
                <span>
                  {t(
                    `${quotes.length} Flap assets`,
                    `Flap · ${quotes.length} 种资产`,
                  )}
                </span>
              )}
            </h2>
            <div className="pool-tools">
              <div className="segmented">
                {[
                  ["all", "All", "全部"],
                  ["rwa", "Stocks / RWA", "币股 / RWA"],
                  ["crypto", "Crypto", "加密资产"],
                ].map(([v, en, cn]) => (
                  <button
                    key={v}
                    className={filter === v ? "selected" : ""}
                    aria-pressed={filter === v}
                    onClick={() => setFilter(v)}
                  >
                    {t(en, cn)}
                  </button>
                ))}
              </div>
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                aria-label={t("Search pool assets", "搜索底池资产")}
                placeholder={t("Search pool assets", "搜索底池资产")}
              />
            </div>
            <div className="pool-directory">
              {availableQuotes.map((x) => (
                <button
                  key={x.address}
                  className={
                    form.quote.toLowerCase() === x.address.toLowerCase()
                      ? "selected"
                      : ""
                  }
                  aria-pressed={
                    form.quote.toLowerCase() === x.address.toLowerCase()
                  }
                  onClick={() => selectPool(x.address)}
                >
                  <img
                    loading="lazy"
                    src={"/api/quote-logo/56/" + x.address}
                    alt=""
                  />
                  <span>
                    <strong>{x.symbol}</strong>
                    <small>{x.name}</small>
                  </span>
                  {form.quote.toLowerCase() === x.address.toLowerCase() && (
                    <Check size={14} />
                  )}
                </button>
              ))}
            </div>
            {availableQuotes.length === 0 && (
              <div role="status">
                {quoteStatus === "error" ? (
                  <button
                    className="button"
                    onClick={() => setQuoteRetry((n) => n + 1)}
                  >
                    {t("Retry pool directory", "重试底池目录")}
                  </button>
                ) : quoteStatus === "loading" ? (
                  t(
                    "Loading the Flap asset directory…",
                    "正在加载 Flap 底池目录…",
                  )
                ) : (
                  t("No matching assets", "没有匹配的资产")
                )}
              </div>
            )}
            {selectedQuote && (
              <p className="pool-selection" role="status">
                {t("Selected pool", "当前底池")} <strong>{quoteLabel}</strong>
              </p>
            )}
            {stablePool && (
              <div className="pool-compatibility">
                <p>
                  {form.route === "x"
                    ? t(
                        "USDT fees settle directly. Dark converts BNB and other pool assets to BSC USDT before payout.",
                        "USDT 税收直接结算。BNB 和其他底池资产先由 Dark 兑换成 BSC USDT，再计入付款批次。",
                      )
                    : t(
                        "Binance Pay settles from the BSC USDT pool.",
                        "币安 Pay 使用 BSC USDT 底池结算。",
                      )}
                </p>
                {!compatiblePool && (
                  <>
                    <button
                      type="button"
                      className="button"
                      onClick={() => selectPool(BSC_USDT)}
                    >
                      {t(
                        "Use USDT for this beneficiary",
                        "为此受益人使用 USDT",
                      )}
                    </button>
                    <button
                      type="button"
                      className="button"
                      disabled={!!nomination}
                      onClick={() => changeRoute("wallet")}
                    >
                      {t(
                        `Keep ${quoteLabel} and choose a BSC wallet`,
                        `保留 ${quoteLabel} 并改用 BSC 钱包收款`,
                      )}
                    </button>
                  </>
                )}
              </div>
            )}
            <details className="pool-info">
              <summary>{t("Pool details", "底池详情")}</summary>
              <div className="selected-pool" aria-live="polite">
                <span>{t("Selected pool", "当前底池")}</span>
                <strong>
                  {selectedQuote
                    ? `${selectedQuote.symbol} · ${selectedQuote.name}`
                    : form.quote === ZeroAddress
                      ? "BNB · BNB"
                      : t(
                          "Asset not in the current directory",
                          "资产不在当前目录中",
                        )}
                </strong>
                {form.quote === ZeroAddress ? (
                  <span>
                    {t(
                      "Native BNB · no token contract",
                      "原生 BNB · 无代币合约",
                    )}
                  </span>
                ) : (
                  <CopyText value={form.quote} />
                )}
              </div>
            </details>
          </section>
          <section className="issue-card issue-terms">
            <h2>{t("Trading tax & first buy", "交易税与首买")}</h2>
            <div className="field-row">
              <label>
                {t("Buy tax (%)", "买入税（%）")}
                <input
                  inputMode="decimal"
                  value={form.buyTax}
                  onChange={(e) => update("buyTax", e.target.value)}
                />
              </label>
              <label>
                {t("Sell tax (%)", "卖出税（%）")}
                <input
                  inputMode="decimal"
                  value={form.sellTax}
                  onChange={(e) => update("sellTax", e.target.value)}
                />
              </label>
            </div>
            {form.chain === "bsc" && (
              <>
                <label>
                  {t("Tax duration (days)", "税收持续天数")}
                  <input
                    value={form.taxDays}
                    onChange={(e) => update("taxDays", e.target.value)}
                  />
                </label>
              </>
            )}
            <label>
              {t("Initial buy", "首买金额")} ({quoteLabel}
              )
              <input
                value={form.firstBuy}
                onChange={(e) => update("firstBuy", e.target.value)}
              />
              <small>
                {t(
                  "Changing pools resets the initial buy to 0. Gas and any protocol launch fee still apply.",
                  "更换底池后首买归零。填 0 表示不首买，仍需支付 Gas 及协议发行费。",
                )}
              </small>
            </label>
            {form.chain === "bsc" &&
              form.quote !== ZeroAddress &&
              Number(form.firstBuy) > 0 && (
                <button
                  className="button"
                  onClick={() => void approve()}
                  disabled={busy || !compatiblePool || !selectedQuote}
                >
                  {t("Approve the selected quote amount", "授权指定底池金额")}
                </button>
              )}
            {form.chain === "bsc" &&
              Number(form.buyTax) === 0 &&
              Number(form.sellTax) === 0 && (
                <p className="note">
                  {t(
                    "Zero-tax launches are currently unavailable in this interface; use a tax-token configuration.",
                    "此界面暂不开放零税发行，请使用税币配置。",
                  )}
                </p>
              )}
          </section>
          <div className="issue-submit">
            <button
              className="button primary"
              disabled={!!account && !canPreview}
              onClick={() => void (account ? check() : app.connect())}
            >
              {!account
                ? t("Connect wallet to launch", "连接钱包以发行")
                : working
                  ? t("Preparing & simulating…", "准备并模拟中…")
                  : t("Preview launch transaction", "预览发行交易")}
            </button>
            {account && !canPreview && (
              <small>
                {!form.name.trim() || !form.symbol.trim()
                  ? t("Enter a name and ticker.", "请填写代币名称与代码。")
                  : !form.cid || !form.image
                    ? t(
                        "Choose an image and upload it to IPFS.",
                        "请选择图片并上传至 IPFS。",
                      )
                    : !compatiblePool || !selectedQuote
                      ? t(
                          "Choose a pool compatible with the beneficiary.",
                          "请选择与受益人收款方式兼容的底池。",
                        )
                      : t(
                          "Complete the beneficiary details above.",
                          "请完成上方的受益人资料。",
                        )}
              </small>
            )}
            <div>
              <Link to="/app/learn">{t("Launch guide", "发行教程")}</Link>
              <span>·</span>
              <a
                target="_blank"
                rel="noreferrer"
                href="https://docs.flap.sh/en/flap/v2/developers/bonding-curve/basic-and-mechanism/bonding-curve-tax-token-v3"
              >
                {t("Protocol documentation", "协议文档")}
              </a>
            </div>
          </div>
        </fieldset>
      )}
    </div>
  );
}

function XBrand() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M18.9 2h3.4l-7.4 8.5L23.6 22h-6.8l-5.4-7.1L5.2 22H1.8l8-9.1L1.5 2h7l4.9 6.5L18.9 2zm-1.2 18h1.9L7.4 3.9h-2L17.7 20z" />
    </svg>
  );
}
function BnbMark() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="m12 1.5 4.7 4.7-2.2 2.2L12 5.9 9.5 8.4 7.3 6.2 12 1.5ZM3.7 9.8 6 12l-2.3 2.2L1.5 12l2.2-2.2Zm4.5 2.2L12 8.2l3.8 3.8-3.8 3.8L8.2 12Zm12.1-2.2 2.2 2.2-2.2 2.2L18 12l2.3-2.2ZM7.3 17.8l2.2-2.2 2.5 2.5 2.5-2.5 2.2 2.2-4.7 4.7-4.7-4.7Z" />
    </svg>
  );
}
