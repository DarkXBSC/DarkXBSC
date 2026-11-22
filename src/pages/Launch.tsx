import { checkPonsFunding, confirmPonsCreation, ponsFeeSchedule } from "../lib/pons";
import { composeLaunchImage } from "../lib/launch-image";
import BinanceRecipientCheck from "../components/BinanceRecipientCheck";
import {
  BSC_USDT,
  BASE_USDC,
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
  Shield,
  Check,
} from "lucide-react";
import { Interface, formatEther, isAddress } from "ethers";
import { useApp } from "../lib/context";
import "../bags-launch.css";
import { CopyText } from "../components/Frame";
import {
  Chain,
  LaunchChain,
  chainInfo,
  flapFor,
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
import { LaunchForm, Preview, prepare, fingerprint, bps } from "../lib/launch";
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
  disclosure: { visibility: "private", purpose: "" },
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
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [publishConsent, setPublishConsent] = useState(false);
  const [sourceFile, setSourceFile] = useState<File | null>(null);
  const [imageZoom, setImageZoom] = useState(1);
  const [imageCaption, setImageCaption] = useState("");
  const [imageBusy, setImageBusy] = useState(false);
  const operation = useRef(false);
  const [payCheck, setPayCheck] = useState<RecipientCheck | null>(null);
  const [xEnabled, setXEnabled] = useState<boolean | null>(null);
  const [ponsGiving,setPonsGiving]=useState(false);
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
        setPonsGiving(r.chains?.includes(4663) === true);
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
        beneficiaryKey: Array.from(
          crypto.getRandomValues(new Uint8Array(32)),
          (b) => b.toString(16).padStart(2, "0"),
        ).join(""),
        route: preset ?? blank.route,
        quote: preset === "binance" ? BSC_USDT : ZeroAddress,
      };
      try {
        const draft = JSON.parse(
          localStorage.getItem("tiger-genesis:draft") || "{}",
        );
        if (draft.chain && !["bsc", "base", "robinhood"].includes(draft.chain))
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
        const pons = draft.chain === "robinhood" && (!preset || preset === "x");
        const chain = pons ? "robinhood" : draft.chain === "base" ? "base" : "bsc";
        return {
          ...initial,
          ...draft,
          chain,
          route: pons ? (route === "x" ? "x" : "wallet") : chain === "base" && !["x", "wallet"].includes(route) ? "x" : route,
          quote: pons ? ZeroAddress : quote,
          ...(preset && preset !== draft.route ? { cid: "", image: "" } : {}),
          social: "",
          beneficiaryKey: initial.beneficiaryKey,
          disclosure: {
            visibility: nomination
              ? "private"
              : draft.disclosure?.visibility === "public"
                ? "public"
                : "private",
            purpose:
              typeof draft.disclosure?.purpose === "string"
                ? draft.disclosure.purpose.slice(0, 280)
                : "",
          },
          nomination,
          firstBuy:
            savedQuote?.toLowerCase() === (pons ? ZeroAddress : quote).toLowerCase() && chain === draft.chain
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
  const network = chainInfo[form.chain];
  const isPons = form.chain === "robinhood";
  const [ponsFees, setPonsFees] = useState<Awaited<ReturnType<typeof ponsFeeSchedule>> | null>(null);
  useEffect(() => {
    let current = true;
    setPonsFees(null);
    if (isPons && config) {
      ponsFeeSchedule(config).then(fees => { if (current) setPonsFees(fees); }).catch(() => {});
    }
    return () => { current = false; };
  }, [isPons, config]);
  const chainLabel = isPons ? "Robinhood" : form.chain === "base" ? "Base" : "BSC";
  const protocolLabel = isPons ? "Pons V2" : "Flap V3";
  const stableAddress = form.chain === "base" ? BASE_USDC : BSC_USDT;
  const stableSymbol = form.chain === "bsc" ? "USDT" : "USDC";
  const stablePool = form.route === "x" || form.route === "binance";
  const compatiblePool =
    !stablePool || (isPons && form.route === "x" && form.quote === ZeroAddress) ||
    form.quote.toLowerCase() === stableAddress.toLowerCase() ||
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
    void checkRecipient(
      form.social,
      "x",
      nomination,
      form.disclosure,
      form.beneficiaryKey,
      network.id,
    ).then((result) => {
      if (active) {
        setPayCheck(result);
        setXChecking(false);
      }
    });
    return () => {
      active = false;
    };
  }, [
    form.chain,
    form.route,
    form.social,
    form.disclosure,
    nomination,
    compatiblePool,
    xCanCheck,
    xConsent,
    xRetry,
  ]);
  const payReady =
    (!isPons || ponsGiving) && payCheck?.state === "READY" &&
    payCheck.input === (nomination || form.social) &&
    !!payCheck.ticket;
  const generation = useRef(0);
  const update = (key: keyof LaunchForm, value: any) => {
    if (key === "social" || key === "disclosure") {
      setPayCheck(null);
      setXConsent(false);
    }
    if (
      [
        "name",
        "symbol",
        "description",
        "website",
        "twitter",
        "disclosure",
        "social",
      ].includes(key)
    )
      generation.current++;
    setForm((f) => ({
      ...f,
      [key]: value,
      ...([
        "name",
        "symbol",
        "description",
        "website",
        "twitter",
        "disclosure",
        "social",
      ].includes(key)
        ? { cid: "", image: "" }
        : {}),
    }));
    setPreview(null);
    if (key !== "creator") setPublishConsent(false);
  };
  useEffect(() => {
    const { social, nomination, beneficiaryKey, ...draft } = form;
    try {
      localStorage.setItem("tiger-genesis:draft", JSON.stringify(draft));
    } catch {
      /* The form remains usable without persistent storage. */
    }
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
    if (form.chain === "robinhood") {
      setQuotes([{address: ZeroAddress, symbol: "ETH", name: "Ether", decimals: 18, logoUrl: "", category: "crypto"}]);
      setQuoteStatus("ready");
      return;
    }
    setQuoteStatus("loading");
    setQuotes([]);
    fetch("/api/flap/quotes", { signal: abort.signal })
      .then(async (response) => {
        if (!response.ok) throw Error("QUOTE_DIRECTORY_UNAVAILABLE");
        const data = await response.json();
        const items = data.chains?.find(
          (chain: { chainId: number }) => chain.chainId === network.id,
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
  }, [quoteRetry, form.chain]);
  function changeChain(chain: LaunchChain) {
    if (chain === form.chain || working || pending || busy) return;
    generation.current++;
    setPayCheck(null); setXConsent(false); setPublishConsent(false);
    setPreview(null); setStep(1); setFilter("all"); setQ(""); setQuotes([]);
    setForm(f => {
      const route = chain === "robinhood" ? (f.route === "x" ? "x" : "wallet")
        : chain === "base" && !["x", "wallet"].includes(f.route) ? "x" : f.route;
      return { ...f, chain, quote: ZeroAddress, firstBuy: "0", route,
        ...(route !== f.route ? { cid: "", image: "", social: "" } : {}) };
    });
  }
  function changeRoute(route: TaxRoute) {
    if (nomination || route === form.route) return;
    setPayCheck(null);
    setXConsent(false);
    setShowSettlement(false);
    setPublishConsent(false);
    setFilter("all");
    setQ("");
    setForm((f) => ({
      ...f,
      route,
      social: "",
      cid: "",
      image: "",
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
    setPreview(null);
    setPublishConsent(false);
    setSourceFile(null);
    setFile(null);
    setLocalImage("");
    setForm((f) => ({ ...f, cid: "", image: "" }));
    if (!file) return;
    if (
      !file.size ||
      file.size > 2_500_000 ||
      !["image/png", "image/jpeg", "image/webp"].includes(file.type)
    ) {
      setMessage(
        t(
          "Use a PNG, JPEG or WebP up to 2.5 MB.",
          "请选择不超过 2.5 MB 的 PNG、JPEG 或 WebP。",
        ),
      );
      return;
    }
    setImageZoom(1);
    setImageCaption("");
    setSourceFile(file);
  }
  useEffect(() => {
    if (!sourceFile) return;
    let active = true;
    ++generation.current;
    setImageBusy(true);
    setFile(null);
    setPreview(null);
    setPublishConsent(false);
    setForm((f) => ({ ...f, cid: "", image: "" }));
    const timer = setTimeout(() => {
      void composeLaunchImage(sourceFile, imageZoom, imageCaption)
        .then((image) => {
          if (!active) return;
          setFile(image);
          setLocalImage(URL.createObjectURL(image));
        })
        .catch(() => {
          if (active)
            setMessage(
              t(
                "This image could not be processed. Choose another image.",
                "图片处理失败，请选择其他图片。",
              ),
            );
        })
        .finally(() => {
          if (active) setImageBusy(false);
        });
    }, 120);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [sourceFile, imageZoom, imageCaption]);
  async function upload(): Promise<LaunchForm> {
    if (!account) throw Error("CONNECT_WALLET");
    if (!file && !form.cid) throw Error("UPLOAD_IMAGE_FIRST");
    const gen = generation.current;
    setWorking("UPLOADING");
    let cid = form.cid;
    if (!cid) {
      const body = new FormData();
      body.set("image", file!);
      body.set("creator", account);
      body.set("description", form.description);
      body.set("website", form.website);
      body.set("twitter", form.twitter);
      body.set("name", form.name);
      body.set("symbol", form.symbol);
      if (form.route === "x") {
        body.set("recipient", form.social);
        if (nomination) body.set("nomination", nomination);
        body.set("disclosure", JSON.stringify(form.disclosure));
      }
      const r = await fetch("/api/upload", { method: "POST", body });
      const data = await r.json();
      if (!r.ok) throw Error(data.error || "UPLOAD_FAILED");
      cid = data.cid;
      if (gen !== generation.current) throw Error("LAUNCH_DETAILS_CHANGED");
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
    if (gen !== generation.current) throw Error("LAUNCH_DETAILS_CHANGED");
    const uploaded = { ...form, cid, image };
    setForm(uploaded);
    return uploaded;
  }
  async function check() {
    if (operation.current) return;
    if (!config || !account) return setMessage("CONNECT_WALLET");
    if (!publishConsent) return;
    operation.current = true;
    setMessage("");
    setWorking("PREPARING");
    try {
      if (!identityReady || !selectedQuote) throw Error("INVALID_TOKEN_NAME");
      const buyTax = bps(form.buyTax),
        sellTax = isPons ? buyTax : bps(form.sellTax);
      if (isPons && form.route === "x" && !buyTax) throw Error("RESERVE_REQUIRES_TAX");
      if (!isPons && !buyTax && !sellTax) throw Error("ZERO_TAX_UNAVAILABLE");
      if (
        !isPons && (!/^\d+$/.test(form.taxDays) ||
        Number(form.taxDays) < 1 ||
        Number(form.taxDays) > 3650)
      )
        throw Error("INVALID_TAX_DURATION");
      units(form.firstBuy, selectedQuote.decimals);
      if (
        form.route === "wallet" &&
        (!isAddress(form.creator) || form.creator === ZeroAddress)
      )
        throw Error("INVALID_ADDRESS");
      if(isPons && form.route==="x" && !payReady) throw Error("X_TAX_CHECK_REQUIRED");
      if (isPons) await checkPonsFunding(config, account, buyTax, form.firstBuy);
      const uploaded = await upload();
      if (uploaded.chain !== "robinhood" && uploaded.quote !== ZeroAddress && Number(uploaded.firstBuy) > 0) {
        setWorking("APPROVING");
        const c = new Contract(uploaded.quote, erc20, rpc(uploaded.chain));
        const amount = units(uploaded.firstBuy, Number(await c.decimals()));
        const target = ["reserve", "commission"].includes(uploaded.route)
          ? flapFor(config, uploaded.chain).vaultPortal
          : flapFor(config, uploaded.chain).portal;
        await approveExact(
          uploaded.chain,
          uploaded.quote,
          target,
          amount,
          app.transact,
          "Approve launch quote",
        );
      }
      const p = await prepare(
        uploaded,
        config,
        account,
        setWorking,
        ["binance", "x"].includes(uploaded.route) && payReady
          ? payCheck?.ticket
          : undefined,
      );
      setPreview(p);
      window.scrollTo(0, 0);
    } catch (e) {
      setMessage(errorCode(e));
    } finally {
      operation.current = false;
      setWorking("");
    }
  }
  async function launch() {
    if (!preview || !config || operation.current || pending) return;
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
    operation.current = true;
    setPending(true);
    let confirmed = false;
    try {
      if (form.route === "x" || form.route === "binance") {
        const checked = await checkRecipient(
          form.social,
          form.route,
          nomination,
          form.disclosure,
          form.beneficiaryKey,
          network.id,
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
              form.disclosure,
              form.beneficiaryKey,
              network.id,
              isPons ? {issuer:account,proof:preview.request} : undefined,
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
      confirmed = true;
      if (preview.pons) await confirmPonsCreation(config, preview, receipt.logs);
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
          "Token creation confirmed. Your transaction receipt is available below.",
          "代币创建已确认，可在下方查看链上回执。",
        ),
      );
    } catch (e: any) {
      setMessage(errorCode(e));
      if (!confirmed && !e?.submitted) setPending(false);
    } finally {
      operation.current = false;
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
      label: t(`${chainLabel} wallet`, `${chainLabel} 钱包`),
      full: t(`${chainLabel} wallet`, `${chainLabel} 钱包`),
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
    (form.quote === ZeroAddress ? network.symbol : short(form.quote));
  const needsRecipient = stablePool || form.route === "square";
  const canPreview =
    (form.route !== "commission" ||
      (Number(form.commissionShare) > 0 &&
        Number(form.commissionShare) <= 100)) &&
    !!form.name.trim() &&
    !!form.symbol.trim() &&
    (!!file || (!!form.cid && !!form.image)) &&
    !imageBusy &&
    !!selectedQuote &&
    compatiblePool &&
    (!stablePool || payReady) &&
    (form.route !== "x" || xConsent) &&
    (form.route !== "square" || !!form.social.trim());
  const identityReady =
    !!form.name.trim() &&
    !!form.symbol.trim() &&
    new TextEncoder().encode(form.name).length <= 64 &&
    new TextEncoder().encode(form.symbol).length <= 16 &&
    (!!file || (!!form.cid && !!form.image)) &&
    !imageBusy;
  const art = localImage || form.image;
  function goStep(next: 1 | 2 | 3) {
    if (working || busy || pending || imageBusy) return;
    setStep(next);
    setPreview(null);
    window.scrollTo(0, 0);
  }
  const publicPurpose =
    form.route === "x" ? form.disclosure?.purpose || "" : "";
  const recipientLabel =
    form.route === "x"
      ? nomination
        ? nominationTitle || t("Private nomination", "私密受益人提名")
        : "@" + form.social.replace(/^@/, "")
      : form.route === "wallet"
        ? form.creator || t("Connected wallet", "连接的钱包")
        : channels.find((c) => c.id === form.route)?.full;
  const sponsorNotice = isPons && form.route === "x" && payCheck?.sponsorFunded === false && (
    <p role="status">{t(
      "Robinhood gas funding is pending. Fees can accrue. Automatic settlement will start after the sponsor wallet receives ETH.",
      "Robinhood 代付钱包待补 ETH。发币后费用可以累计，自动结算将在 Gas 到账后执行。",
    )}</p>
  );
  const shareHint =
    isPons && form.route === "x" ? t("Pons credits creator fees in ETH. Dark claims them, bridges each batch to Base USDC, then opens the X Money payout.", "Pons 归集创建者费用后，Dark 自动领取 ETH，逐批跨链为 Base USDC，再发起 X Money 付款。")
    : isPons ? t("Pons credits fees to this recipient after a sweep. The recipient can claim ETH from the Pons fee escrow.", "Pons 归集费用后，指定的接收地址可从 Pons 费用托管合约领取 ETH。")
    : form.route === "commission"
      ? t(
          "A share of net tax received funds commissions. The selected author is paid in the pool asset.",
          "实际到账税收按比例进入公益预算。选稿时，作者直接收到该底池资产。",
        )
      : form.route === "x"
        ? xEnabled && xMinimum && xMinimum === xMaximum
          ? t(
              `Every ${Number(xMinimum)} ${stableSymbol} available after collection or conversion starts an X Money payout.`,
              `每累计 ${Number(xMinimum)} ${stableSymbol} 已到账（含兑换所得），自动启动 X Money 付款。`,
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
                  `Flap distributes this token’s tax to the selected ${chainLabel} wallet.`,
                  `Flap 将这枚代币的税收分配到指定 ${chainLabel} 钱包。`,
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
          {(["bsc", "base", "robinhood"] as const).map(chain => (
            <button type="button" key={chain} aria-pressed={form.chain === chain}
              disabled={!!working || busy || pending || !!completed}
              onClick={() => changeChain(chain)}>
              {chain === "bsc" && <BnbMark />}{chain === "base" && <span className="base-mark" />}
              {chain === "bsc" ? "BSC" : chain === "base" ? "Base" : "Robinhood"}
            </button>
          ))}
          <span>
            <Layers size={15} /> {protocolLabel}
          </span>
        </div>
      </header>
      {!completed && (
        <nav className="issue-steps" aria-label={t("Launch steps", "发行步骤")}>
          {[
            [1, t("Your Meme", "Meme 资料")],
            [2, isPons ? t("Creator fees & giving", "创建者费用与公益") : t("Tax & privacy", "税收与隐私")],
            [3, t("Review & launch", "确认发行")],
          ].map(([n, label]) => (
            <button
              key={n}
              type="button"
              aria-current={step === n ? "step" : undefined}
              disabled={Number(n) > step || !!working || busy || pending}
              onClick={() => goStep(Number(n) as 1 | 2 | 3)}
            >
              <span>{n}</span>
              {label}
            </button>
          ))}
        </nav>
      )}
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
          {config?.chains[completed.chain].contracts.registry && <button
            className="button primary"
            onClick={() => void register()}
            disabled={busy || !config?.chains[completed.chain].contracts.registry}
          >
            {t("Register in Dark", "登记到 Dark")}
          </button>}
          {completed.chain !== "robinhood" && <p>
            {t(
              completed.chain === "base" ? "Created through Flap on Base. Market indexing can take time; your creation receipt is the primary confirmation." : "Registration is a separate on-chain transaction. It does not imply official endorsement.",
              completed.chain === "base" ? "已通过 Base 上的 Flap 创建。行情收录可能有延迟，请以创建回执为准。" : "登记是独立的链上交易，不代表 Dark 官方背书。",
            )}
          </p>}
          {completed.chain === "robinhood"
            ? <a className="button" href={"https://ponsfamily.com/launchpad/" + completed.token.toLowerCase()} target="_blank" rel="noreferrer">{t("View on Pons", "在 Pons 查看")}</a>
            : <Link className="button" to={"/app/explore?chain=" + completed.chain + "&token=" + completed.token}>{t("Open market & chart", "打开行情与 K 线")}</Link>}
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
                "/app/impact?chain=" + completed.chain + "&token=" + completed.token + "&tx=" + completed.hash
              }
            >
              {t("Track tax distributions", "查看税收去向")}
            </Link>
          )}
        </div>
      ) : preview ? (
        <section className="issue-card issue-review">
          <h2>{t("Confirm your launch", "确认发行交易")}</h2>
          <div className="issue-token-preview">
            {art && (
              <img src={art} alt={t("Final token image", "最终代币图片")} />
            )}
            <div>
              <strong>{form.name}</strong>
              <span>{form.symbol}</span>
            </div>
          </div>
          {form.route === "x" && (
            <p className="note">
              {form.disclosure?.visibility === "public"
                ? t(
                    "The beneficiary’s X profile is public.",
                    "受益人的 X 主页已公开。",
                  )
                : t(
                    "The beneficiary’s X identity is private. Wallet addresses and transactions are public.",
                    "受益人 X 身份保密，钱包地址和交易公开。",
                  )}
            </p>
          )}
          <dl className="review-terms">
            <div>
              <dt>{t("Token", "代币")}</dt>
              <dd>
                {form.name} / {form.symbol}
              </dd>
            </div>
            <div>
              <dt>{t("Network", "网络")}</dt>
              <dd>{chainLabel + " / " + protocolLabel}</dd>
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
                  {xMinimum} {stableSymbol}{" "}
                  {t(
                    "minimum per batch after conversion · confirmed receipts in USD",
                    "起付 · 以稳定币实际到账计入批次 · 按美元付款凭证核对",
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
                    ? t(`${chainLabel} tax collection address`, `${chainLabel} 税收归集地址`)
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
              <dt>{isPons ? t("Creator tax", "创建者税率") : t("Buy / sell tax", "买入 / 卖出税")}</dt>
              <dd>
                {isPons ? form.buyTax + "%" : form.buyTax + "% / " + form.sellTax + "%"}
              </dd>
            </div>
            <div>
              <dt>{t("Paired asset", "底池资产")}</dt>
              <dd>
                {preview.quoteSymbol}{" "}
                {!isPons && preview.params.quoteToken !== ZeroAddress && (
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
            {preview.pons && <>
              <div><dt>{t("Pons launch fee", "Pons 发行费")}</dt><dd>{formatEther(preview.pons.fee)} ETH</dd></div>
              {BigInt(preview.pons.minimum) > 0n && <div><dt>{t("Minimum tokens from first buy", "首买最低到账")}</dt><dd>{formatEther(preview.pons.minimum)} {form.symbol}</dd></div>}
            </>}
            <div>
              <dt>{t("Native value", "发送原生币")}</dt>
              <dd>
                {formatEther(preview.request.value)}{" "}
                {form.chain === "bsc" ? "BNB" : "ETH"}
              </dd>
            </div>
            <div>
              <dt>{t("Estimated network fee", "预计网络费")}</dt>
              <dd>{formatEther(preview.networkFee)} {network.symbol}</dd>
            </div>
            <div>
              <dt>{t(`Estimated ${network.symbol} total`, `预计 ${network.symbol} 总支出`)}</dt>
              <dd>
                {formatEther(
                  BigInt(preview.networkFee) + BigInt(preview.request.value),
                )}{" "}
                {network.symbol}
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
              <button className="button" onClick={() => goStep(2)}>
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
            hidden={step !== 1}
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
            {sourceFile && (
              <div className="issue-image-tools">
                <label>
                  {t("Crop zoom", "裁剪缩放")}
                  <input
                    type="range"
                    min="1"
                    max="3"
                    step=".05"
                    value={imageZoom}
                    onChange={(e) => setImageZoom(Number(e.target.value))}
                  />
                </label>
                <label>
                  {t("Meme caption (optional)", "图片配字（可选）")}
                  <input
                    maxLength={80}
                    value={imageCaption}
                    onChange={(e) => setImageCaption(e.target.value)}
                  />
                </label>
              </div>
            )}
            <p className="note">
              {t(
                "Your image is edited on this device. Publishing starts after your confirmation in step 3. Re-select the image if you reload before uploading.",
                "图片在本机编辑，第 3 步确认后才公开上传。上传前刷新页面，需要重新选择图片。",
              )}
            </p>
          </section>
          <section
            hidden={step !== 2}
            className="issue-card issue-share route-picker"
            aria-labelledby="issue-share-title"
          >
            <h2 id="issue-share-title">{t("share fees", "分配交易税")}</h2>
            <div className="issue-channels">
              {channels
                .filter((c) => (isPons ? ["x","wallet"] : form.chain === "base" ? ["x", "wallet"] : ["x", "commission", "wallet"]).includes(c.id))
                .map(({ id, label, full, icon }) => (
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
            {form.chain === "bsc" && <details
              className="issue-other-routes"
              open={
                ["binance", "square", "reserve"].includes(form.route) ||
                undefined
              }
            >
              <summary>{t("More tax routes", "其他税收渠道")}</summary>
              <div className="issue-channels">
                {channels
                  .filter((c) =>
                    ["binance", "square", "reserve"].includes(c.id),
                  )
                  .map(({ id, label, full, icon }) => (
                    <button
                      key={id}
                      type="button"
                      title={full}
                      aria-label={full}
                      aria-pressed={form.route === id}
                      disabled={
                        !!nomination || (id === "binance" && merchant === false)
                      }
                      onClick={() => changeRoute(id)}
                    >
                      <span>{icon}</span>
                      <small>{label}</small>
                    </button>
                  ))}
              </div>
              {merchant === false && (
                <p className="note">
                  {t(
                    "Binance Pay is awaiting merchant setup.",
                    "币安 Pay 待开通商户权限。",
                  )}
                </p>
              )}
            </details>}
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
            {(nomination ? (
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
            ))}
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
                {t(`${chainLabel} tax recipient`, `${chainLabel} 税收接收地址`)}
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
              <div className="issue-privacy">
                <h3>
                  <Shield size={16} />
                  {t("Beneficiary privacy", "受益人隐私")}
                </h3>
                <div className="segmented">
                  <button
                    type="button"
                    aria-pressed={form.disclosure?.visibility !== "public"}
                    className={
                      form.disclosure?.visibility !== "public" ? "selected" : ""
                    }
                    onClick={() =>
                      update("disclosure", {
                        ...form.disclosure,
                        visibility: "private",
                      })
                    }
                  >
                    {t("Private beneficiary", "私密受益人")}
                  </button>
                  <button
                    type="button"
                    disabled={!!nomination}
                    aria-pressed={form.disclosure?.visibility === "public"}
                    className={
                      form.disclosure?.visibility === "public" ? "selected" : ""
                    }
                    onClick={() =>
                      update("disclosure", {
                        ...form.disclosure,
                        visibility: "public",
                      })
                    }
                  >
                    {t("Public beneficiary", "公开受益人")}
                  </button>
                </div>
                <p>
                  {form.disclosure?.visibility === "public"
                    ? t(
                        "The beneficiary’s X profile will be published in IPFS metadata and Dark’s payment tracker. Confirm you have permission to publish it.",
                        "受益人的 X 主页会公开写入 IPFS 资料和 Dark 付款查询。请确认已获得对方的公开授权。",
                      )
                    : t(
                        "Dark’s public pages and token metadata omit the beneficiary’s X account. Dark and payment providers process the account to settle payments.",
                        "Dark 公开页面和代币元数据隐藏受益人的 X 账号。Dark 与付款服务商处理账号以完成结算。",
                      )}
                </p>
                <label>
                  {t("Public purpose (optional)", "公开公益用途（可选）")}
                  <input
                    maxLength={280}
                    value={form.disclosure?.purpose || ""}
                    placeholder={t(
                      "For example, animal rescue artwork",
                      "例如，支持动物救助宣传",
                    )}
                    onChange={(e) =>
                      update("disclosure", {
                        ...form.disclosure,
                        purpose: e.target.value,
                      })
                    }
                  />
                </label>
                <small>
                  {t(
                    "The purpose, image and project description are public. Use only information approved for publication. Blockchain wallets and transactions are public.",
                    "公益用途、图片和项目描述会公开，请仅填写获准公开的信息。链上钱包地址与交易可查。",
                  )}
                </small>
              </div>
            )}
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
                                    "A live settlement quote is unavailable. Try again when the route can settle.",
                                    "暂无可执行的结算报价，请稍后重试。",
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
                            {t(form.chain === "base" ? "Settlement batch" : "Bridge quote minimum", form.chain === "base" ? "结算批次" : "跨链报价最低可得")} ·{" "}
                            {payCheck.quote.inputUSDT} {payCheck.quote.inputSymbol || stableSymbol} →{" "}
                            {payCheck.quote.minimumUSDC} USDC
                          </small>
                        )}
                    </p>
                  </>
                )}
                {sponsorNotice}
                <div
                  id="issue-settlement-info"
                  className="issue-settlement"
                  hidden={!showSettlement}
                >
                  <p>
                    {isPons ? shareHint : t(
                      form.chain === "base" ? "Flap sends tax to a dedicated Base address. ETH converts to USDC automatically with price protection. Peer matches a buyer who pays USD to the recipient on X Money." : "Flap sends tax to a dedicated BSC address. BNB converts to USDT automatically with price protection, then bridges to Base USDC. Other pool assets use operator conversion. Peer matches the USD payer on X Money.",
                      form.chain === "base" ? "Flap 将税收转入专属 Base 地址。ETH 通过价格检查后自动兑换 USDC，Peer 匹配买家向受益人的 X Money 支付美元。" : "Flap 将税收转入专属 BSC 地址。BNB 通过价格检查后自动兑换 USDT，再跨链为 Base USDC；其他底池资产由运营方兑换。Peer 匹配买家向 X Money 支付美元。",
                    )}
                  </p>
                  {gasSponsored && (
                    <p>
                      {xMinimum === xMaximum
                        ? t(
                            `Every ${Number(xMinimum)} ${stableSymbol} in confirmed tax starts a payment batch.`,
                            `每累计 ${Number(xMinimum)} ${stableSymbol} 已确认税收，自动启动一批付款。`,
                          )
                        : t(
                            `Settlement starts at ${xMinimum} ${stableSymbol}, up to ${xMaximum} ${stableSymbol} per batch.`,
                            `累计 ${xMinimum} ${stableSymbol} 后结算，每批最多 ${xMaximum} ${stableSymbol}。`,
                          )}{" "}
                      {t(
                        "Dark covers settlement gas.",
                        "结算 Gas 由 Dark 代付。",
                      )}
                    </p>
                  )}
                </div>
              </div>
            )}
            {form.route === "x" && payReady && payCheck?.recipient && (
              <div className="issue-verified-recipient" role="status">
                {payCheck.recipient.avatar ? (
                  <img
                    src={payCheck.recipient.avatar}
                    alt=""
                    referrerPolicy="no-referrer"
                    width="32"
                    height="32"
                  />
                ) : (
                  <Check size={16} />
                )}
                <span>
                  {payCheck.recipient.name} ·{" "}
                  {t("Verified recipient", "已核验受益人")}{" "}
                  <a
                    href={payCheck.recipient.profile}
                    target="_blank"
                    rel="noreferrer"
                  >
                    @{payCheck.recipient.handle}
                  </a>
                </span>
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
          <section hidden={step !== 2} className="issue-card issue-pools">
            <h2>
              {t("Paired asset", "底池资产")}
              {!isPons && quoteStatus === "ready" && (
                <span>
                  {t(
                    `${quotes.length} Flap assets`,
                    `Flap · ${quotes.length} 种资产`,
                  )}
                </span>
              )}
            </h2>
            {!isPons && <div className="pool-tools">
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
            </div>}
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
                  {!isPons && <img
                    loading="lazy"
                    src={"/api/quote-logo/" + network.id + "/" + x.address}
                    alt=""
                  />}
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
                        isPons ? "Pons creator fees bridge from ETH to Base USDC." : form.chain === "base" ? "ETH taxes convert automatically to Base USDC. Other pool assets require operator conversion before settlement." : "USDT fees settle directly. BNB converts automatically to USDT. Other pool assets require operator conversion.",
                        isPons ? "Pons 创建者费用从 ETH 跨链为 Base USDC。" : form.chain === "base" ? "ETH 税收自动兑换为 Base USDC；其他底池资产需先由运营方兑换，再计入付款批次。" : "USDT 税收直接结算，BNB 自动兑换为 USDT；其他底池资产需先由运营方兑换。",
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
                      disabled={!quotes.some(q => q.address.toLowerCase() === stableAddress.toLowerCase())}
                      onClick={() => selectPool(stableAddress)}
                    >
                      {t(
                        `Use ${stableSymbol} for this beneficiary`,
                        `为此受益人使用 ${stableSymbol}`,
                      )}
                    </button>
                    <button
                      type="button"
                      className="button"
                      disabled={!!nomination}
                      onClick={() => changeRoute("wallet")}
                    >
                      {t(
                        `Keep ${quoteLabel} and choose a ${chainLabel} wallet`,
                        `保留 ${quoteLabel} 并改用 ${chainLabel} 钱包收款`,
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
                      ? `${network.symbol} · ${network.symbol}`
                      : t(
                          "Asset not in the current directory",
                          "资产不在当前目录中",
                        )}
                </strong>
                {form.quote === ZeroAddress ? (
                  <span>
                    {t(
                      `Native ${network.symbol} · no token contract`,
                      `原生 ${network.symbol} · 无代币合约`,
                    )}
                  </span>
                ) : (
                  <CopyText value={form.quote} />
                )}
              </div>
            </details>
          </section>
          <section hidden={step !== 2} className="issue-card issue-terms">
            <h2>{t("Trading tax & first buy", "交易税与首买")}</h2>
            {isPons && ponsFees && <p className="note">
              {t("Pons launch fee", "Pons 发行费")} {formatEther(ponsFees.fee)} ETH · {t("Maximum creator tax", "创建者税率上限")} {Number(ponsFees.maximum) / 100}%
            </p>}
            <div className="field-row">
              <label>
                {isPons ? t("Creator tax (%)", "创建者税率（%）") : t("Buy tax (%)", "买入税（%）")}
                <input
                  inputMode="decimal"
                  value={form.buyTax}
                  onChange={(e) => update("buyTax", e.target.value)}
                />
              </label>
              {!isPons && <label>
                {t("Sell tax (%)", "卖出税（%）")}
                <input
                  inputMode="decimal"
                  value={form.sellTax}
                  onChange={(e) => update("sellTax", e.target.value)}
                />
              </label>}
            </div>
            {["bsc", "base"].includes(form.chain) && (
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
            {["bsc", "base"].includes(form.chain) &&
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
          {step === 3 && (
            <section className="issue-card issue-preflight">
              <h2>{t("Review before publishing", "公开前核对")}</h2>
              <div className="issue-token-preview">
                {art && (
                  <img src={art} alt={t("Final token image", "最终代币图片")} />
                )}
                <div>
                  <strong>{form.name}</strong>
                  <span>{form.symbol}</span>
                  <p>{form.description}</p>
                </div>
              </div>
              <dl className="review-terms">
                <div>
                  <dt>{t("Tax beneficiary", "税收受益人")}</dt>
                  <dd>{recipientLabel}</dd>
                </div>
                <div>
                  <dt>{t("Paired asset", "底池资产")}</dt>
                  <dd>{quoteLabel}</dd>
                </div>
                <div>
                  <dt>{isPons ? t("Creator tax", "创建者税率") : t("Buy / sell tax", "买入 / 卖出税")}</dt>
                  <dd>
                    {isPons ? form.buyTax + "%" : form.buyTax + "% / " + form.sellTax + "%"}
                  </dd>
                </div>
                {!isPons && <div>
                  <dt>{t("Tax duration", "税期")}</dt>
                  <dd>
                    {form.taxDays} {t("days", "天")}
                  </dd>
                </div>}
                <div>
                  <dt>{t("Initial buy", "首买")}</dt>
                  <dd>
                    {form.firstBuy} {quoteLabel}
                  </dd>
                </div>
                {form.route === "x" && (
                  <div>
                    <dt>
                      {t("Public beneficiary identity", "公开受益人身份")}
                    </dt>
                    <dd>
                      {form.disclosure?.visibility === "public"
                        ? t("Publish X profile", "公开 X 主页")
                        : t("Private", "保密")}
                    </dd>
                  </div>
                )}
                {publicPurpose && (
                  <div>
                    <dt>{t("Public purpose", "公开用途")}</dt>
                    <dd>{publicPurpose}</dd>
                  </div>
                )}
              </dl>
              <p className="note">{shareHint}</p>
              {sponsorNotice}
              <label className="issue-publication-consent">
                <input
                  type="checkbox"
                  checked={publishConsent}
                  onChange={(e) => setPublishConsent(e.target.checked)}
                />
                <span>
                  {t(
                    "Publish this image and project information to IPFS, then check the launch. IPFS content can remain public even if I cancel the wallet transaction.",
                    "同意将此图片和项目资料公开到 IPFS，然后检查发行。取消钱包交易后，IPFS 内容仍可能公开保留。",
                  )}
                </span>
              </label>
              {form.quote !== ZeroAddress && Number(form.firstBuy) > 0 && (
                <p className="note">
                  {t(
                    "If needed, your wallet will first request approval for exactly the initial-buy amount.",
                    "如需授权，钱包会先请求与首买金额一致的额度。",
                  )}
                </p>
              )}
            </section>
          )}
          <div className="issue-submit">
            <div className="issue-step-actions">
              {step > 1 && (
                <button
                  className="button"
                  onClick={() => goStep((step - 1) as 1 | 2)}
                >
                  {t("Back", "上一步")}
                </button>
              )}
              <button
                className="button primary"
                disabled={
                  step === 1
                    ? !identityReady
                    : step === 2
                      ? !canPreview
                      : !!account && (!canPreview || !publishConsent)
                }
                onClick={() => {
                  if (step < 3) goStep((step + 1) as 2 | 3);
                  else void (account ? check() : app.connect());
                }}
              >
                {step === 1
                  ? (isPons ? t("Next · Creator fees & giving", "下一步 · 创建者费用与公益") : t("Next · Tax & privacy", "下一步 · 税收与隐私"))
                  : step === 2
                    ? t("Next · Review", "下一步 · 核对发行")
                    : !account
                      ? t("Connect wallet", "连接钱包")
                      : working === "UPLOADING"
                        ? t("Publishing image…", "正在公开图片…")
                        : working === "APPROVING"
                          ? t("Check wallet approval…", "请核对钱包授权…")
                          : working
                            ? t("Checking launch…", "正在检查发行…")
                            : t("Publish & check launch", "公开资料并检查发行")}
              </button>
            </div>
            {step === 2 && !canPreview && (
              <small>
                {t(
                  "Choose an available pool and complete the beneficiary checks above.",
                  "请选择可用底池，并完成上方的受益人核验。",
                )}
              </small>
            )}
            <div>
              <Link to="/app/learn">{t("Launch guide", "发行教程")}</Link>
              <span>·</span>
              <a
                target="_blank"
                rel="noreferrer"
                href={isPons ? "https://docs.ponsfamily.com/v2" : "https://docs.flap.sh/en/flap/v2/developers/bonding-curve/basic-and-mechanism/bonding-curve-tax-token-v3"}
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
