import { useEffect, useRef, useState } from "react";
import {
  Link,
  useLocation,
  useNavigate,
  useSearchParams,
} from "react-router-dom";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Download,
  FilePenLine,
  ImagePlus,
  Plus,
} from "lucide-react";
import { useApp } from "../lib/context";
import {
  api,
  draftKey,
  errors,
  heading,
  photoUpload,
  picture,
  registration,
  route,
  saveCard,
  visitor,
  type Brief,
  type Entry,
  type Profile,
  type TxResult,
} from "../lib/hire";
import {
  RewardFields,
  RewardSummary,
  RewardAction,
} from "../components/HireReward";
import { useRead, Wait } from "../components/HireRead";
import {
  Directory,
  ServiceDetail,
  ServiceEditor,
  ServiceManager,
  ServiceOrder,
  Delivery,
  DirectoryHeader,
} from "../components/AgentDirectory";
import type { Service } from "../lib/agent-directory";
import {
  PassportDesk,
  PassportPage,
  PassportWork,
  PortfolioLink,
} from "../components/AgentPassport";
import HireSignature from "../components/HireSignature";
import "../hire.css";

type Sign = (
  data: Record<string, unknown>,
  done: (result: TxResult) => void,
) => void;
function Share({ url }: { url: string }) {
  const { t } = useApp(),
    [show, set] = useState(false),
    [copied, ok] = useState(false);
  return (
    <>
      <button
        className="hire-btn"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(
              new URL(url, location.origin).href,
            );
            ok(true);
          } catch {
            set(true);
          }
        }}
      >
        {copied
          ? t("Link copied", "链接已复制")
          : t("Copy share link", "复制分享链接")}
      </button>
      {show && (
        <input
          aria-label={t("Share link", "分享链接")}
          value={new URL(url, location.origin).href}
          readOnly
          onFocus={(e) => e.target.select()}
        />
      )}
    </>
  );
}
function Board() {
  const { t } = useApp(),
    first = useRead<Brief[]>("board"),
    [more, setMore] = useState<Brief[]>([]),
    [end, setEnd] = useState(false),
    [busy, setBusy] = useState(false),
    [err, fail] = useState("");
  if (!first.value) return <Wait state={first} />;
  const rows = [...first.value, ...more],
    last = rows.at(-1);
  return (
    <section className="hire-section">
      <div className="hire-section-head">
        <h2>{t("Commission board", "公开委托")}</h2>
        <Link className="hire-text" to={route("new", "1")}>
          {t("Post a brief", "发布委托")} <Plus size={15} />
        </Link>
      </div>
      {localStorage.getItem("dark:hire:last-budget") && (
        <Link
          className="hire-text"
          to={route("brief", localStorage.getItem("dark:hire:last-budget")!)}
        >
          {t("Return to my last funded brief", "继续我的最近一份税收委托")}
        </Link>
      )}
      {rows.length ? (
        rows.map((b) => (
          <Link className="hire-row" key={b.id} to={route("brief", b.id)}>
            <strong>{b.title}</strong>
            {b.reward && (
              <span>
                {b.reward.display} {b.reward.symbol}
              </span>
            )}
            <span>{b.target || t("Open call", "公开招募")}</span>
            <small>
              {b.selected
                ? t("Selected", "已选稿")
                : t("View brief", "查看委托")}{" "}
              <ArrowRight size={14} />
            </small>
          </Link>
        ))
      ) : (
        <p>
          {t(
            "Have an adoption story, a charity campaign or a meme that needs a caption? Post the first brief.",
            "有领养故事、公益活动或 meme 需要配文？在这里发布第一份委托。",
          )}
        </p>
      )}
      {rows.length >= 25 && !end && last && (
        <button
          disabled={busy}
          className="hire-text"
          onClick={async () => {
            setBusy(true);
            fail("");
            try {
              const next = await api<Brief[]>("board?before=" + last.cursor);
              setMore([...more, ...next]);
              setEnd(next.length < 25);
            } catch (e) {
              fail(errors(e, t));
            } finally {
              setBusy(false);
            }
          }}
        >
          {t("Load more", "加载更多")}
        </button>
      )}
      {err && <p role="alert">{err}</p>}
    </section>
  );
}
function Poster({
  brief: b,
  line,
  author,
}: {
  brief: Brief;
  line?: string;
  author?: string;
}) {
  const { t } = useApp(),
    src = picture(b);
  return (
    <figure className={"hire-poster" + (src ? "" : " no-photo")}>
      {src ? (
        <img
          src={src}
          alt={
            b.id === "studio"
              ? t(
                  "Doubao, an illustrated example of a calico cat",
                  "原创示例图中的三花猫豆包",
                )
              : b.title
          }
        />
      ) : (
        <FilePenLine size={65} strokeWidth={1.25} />
      )}
      <figcaption>
        <span>
          {b.id === "studio"
            ? t("Dark Studio · Fictional cat", "Dark 工作室 · 虚构猫咪")
            : t("Community commission", "社区委托")}
        </span>
        <strong>{line || heading(b, t)}</strong>
        {author && <small>{author}</small>}
      </figcaption>
    </figure>
  );
}
function Restore({
  onRestore,
}: {
  onRestore: (id: string, text: string) => void;
}) {
  const { t } = useApp(),
    [code, set] = useState(""),
    [err, fail] = useState(""),
    [busy, wait] = useState(false);
  return (
    <details className="hire-detail">
      <summary>{t("Have a return code?", "用返回码找回草稿")}</summary>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          wait(true);
          fail("");
          try {
            const r = await api<{ brief: string; line: string }>("recover", {
              code: code.trim(),
            });
            onRestore(r.brief, r.line);
            set("");
            e.currentTarget?.closest("details")?.removeAttribute("open");
          } catch (x) {
            fail(errors(x, t));
          } finally {
            wait(false);
          }
        }}
      >
        <label>
          {t("Private return code", "私人返回码")}
          <input
            autoComplete="off"
            maxLength={40}
            value={code}
            onChange={(e) => set(e.target.value)}
            required
          />
        </label>
        <button className="hire-btn" disabled={busy}>
          {t("Restore draft", "恢复草稿")}
        </button>
        {err && <p role="alert">{err}</p>}
      </form>
    </details>
  );
}
function Editor({
  brief: b,
  sign,
  variant,
}: {
  brief: Brief;
  sign: Sign;
  variant: string;
}) {
  const { t } = useApp(),
    nav = useNavigate(),
    [line, setLine] = useState(
      () => localStorage.getItem(draftKey(b.id)) || "",
    ),
    [code, setCode] = useState(""),
    [status, notify] = useState(""),
    [busy, wait] = useState(false);
  const box = useRef<HTMLTextAreaElement>(null);
  const wrote = useRef(false);
  const change = (s: string) => {
    if (s.trim() && !wrote.current) {
      wrote.current = true;
      void api("wrote", { visitor: visitor() }).catch(() => {
        wrote.current = false;
      });
    }
    setLine(s);
    localStorage.setItem(draftKey(b.id), s);
    setCode("");
    notify("");
  };
  const claim = () => {
    void api("claim", { visitor: visitor() }).catch(() => {});
  };
  const canSubmit =
    Boolean(line.trim()) &&
    (!b.selected || b.id === "studio") &&
    (!b.reward ||
      (b.reward.state === "open" && b.reward.deadline > Date.now() / 1000));
  const description =
    b.id === "studio"
      ? t(
          "Write a short adoption caption in Doubao’s voice. This fictional cat is your practice brief.",
          "用豆包的口吻写一句领养文案。这是一份以虚构三花猫为主角的练习委托。",
        )
      : b.body;
  return (
    <div className="hire-spread">
      <Poster brief={b} />
      <section className="hire-editor">
        <h2>
          {b.id === "studio"
            ? t("Write a caption", "给它写一句")
            : t("Your submission", "写下你的投稿")}
        </h2>
        <p>{description}</p>
        {b.target && (
          <p>
            {t("Invited Agent", "受邀 Agent")} ·{" "}
            <Link to={route("agent", b.target)}>{b.target}</Link>
          </p>
        )}
        <label htmlFor="hire-line">{t("Your caption", "你的文案")}</label>
        <div className="hire-notepad">
          <textarea
            ref={box}
            id="hire-line"
            maxLength={90}
            placeholder={
              b.id === "studio"
                ? t("If Doubao could speak…", "如果豆包会说话……")
                : t("Write a line for this brief…", "为这份委托写一句……")
            }
            value={line}
            onChange={(e) => change(e.target.value)}
          />
          <small>{line.length} / 90</small>
        </div>
        <div className="hire-actions">
          <button
            className="hire-btn primary"
            disabled={!canSubmit}
            onClick={() =>
              sign(
                {
                  kind: "submit",
                  brief: b.id,
                  line: line.trim(),
                  visitor: visitor(),
                },
                (r) => {
                  nav(route("work", r.entry!));
                },
              )
            }
          >
            {t("Sign with Agent ID", "用 Agent ID 署名投稿")}{" "}
            <ArrowRight size={15} />
          </button>
          <button
            className="hire-btn"
            disabled={!line.trim() || busy}
            onClick={async () => {
              wait(true);
              try {
                await saveCard(b, line, "", t);
                notify(t("Card downloaded.", "作品卡已下载。"));
              } catch (e) {
                notify(errors(e, t));
              } finally {
                wait(false);
              }
            }}
          >
            <Download size={15} />
            {t("Save card", "下载作品卡")}
          </button>
        </div>
        <div className="hire-draft">
          <span>
            {line
              ? t("Draft saved on this device", "草稿已存于此设备")
              : t("Try writing without a wallet", "无需钱包即可试写")}
          </span>
          {line.trim() && (
            <button
              className="hire-text"
              disabled={busy}
              onClick={async () => {
                wait(true);
                try {
                  setCode(
                    (
                      await api<{ code: string }>("draft", {
                        brief: b.id,
                        line,
                      })
                    ).code,
                  );
                } catch (e) {
                  notify(errors(e, t));
                } finally {
                  wait(false);
                }
              }}
            >
              {t("Get a return code", "获取返回码")}
            </button>
          )}
        </div>
        {code && (
          <label className="hire-code">
            {t("Private code · valid for 7 days", "私人返回码 · 7 天有效")}
            <input value={code} readOnly onFocus={(e) => e.target.select()} />
          </label>
        )}
        <Restore
          onRestore={(id, text) => {
            localStorage.setItem(draftKey(id), text);
            if (id === b.id) {
              change(text);
              notify(t("Draft restored.", "草稿已恢复。"));
            } else nav(route("brief", id));
          }}
        />
        <p className="hire-register">
          {variant === "write" && !line.trim() && (
            <>
              <button
                className="hire-register-em"
                onClick={() => box.current?.focus()}
              >
                {t("Try your first line", "试写第一句")}
              </button>
              {" · "}
            </>
          )}
          {t("Need a .ai name?", "还没有 .ai 名称？")}{" "}
          <a
            className={variant === "claim" ? "hire-register-em" : "hire-text"}
            href={registration}
            target="_blank"
            rel="noreferrer"
            onClick={claim}
          >
            {t("Register with Binance", "前往币安注册")}
          </a>
        </p>
        {b.selected && b.id !== "studio" && (
          <p role="status">
            {t("This brief has selected a caption.", "这份委托已选稿。")}
          </p>
        )}
        {status && <p role="status">{status}</p>}
      </section>
    </div>
  );
}
function BriefPage({
  id,
  sign,
  variant,
}: {
  id: string;
  sign: Sign;
  variant: string;
}) {
  const { t } = useApp(),
    data = useRead<Brief>("brief/" + encodeURIComponent(id)),
    [review, setReview] = useState(false);
  if (!data.value) return <Wait state={data} />;
  const b = data.value;
  if (b.service) return <ServiceOrder b={b} sign={sign} reload={data.retry} />;
  return (
    <>
      <RewardSummary brief={b} onUpdate={data.retry} />
      {b.reward?.state === "open" && b.reward.deadline > Date.now() / 1000 && (
        <div className="hire-actions reward-accept">
          <button
            className="hire-btn"
            onClick={() =>
              sign({ kind: "accept", brief: b.id }, () => {
                data.retry();
              })
            }
          >
            {t("Accept with Agent ID", "用 Agent ID 接单")}
          </button>
          <span>
            {b.applicants || 0} {t("Agents accepted", "位 Agent 已接单")}
          </span>
        </div>
      )}
      <Editor key={b.id} brief={b} sign={sign} variant={variant} />
      <section className="hire-section">
        <div className="hire-section-head">
          <h2>
            {t("Signed work", "署名作品")} <small>{b.total}</small>
          </h2>
          {b.total > 0 && !b.selected && (
            <button className="hire-text" onClick={() => setReview(!review)}>
              {t("Review as requester", "委托方选稿")}
            </button>
          )}
        </div>
        {b.submissions.map((e) => (
          <div key={e.id} className="hire-entry">
            <Link to={route("work", e.id)}>{e.line}</Link>
            <Link className="hire-author" to={route("agent", e.handle)}>
              {e.handle}
            </Link>
            {b.selected === e.id ? (
              <span>
                <Check size={14} />
                {t("Selected", "已选用")}
              </span>
            ) : (
              review &&
              (b.reward ? (
                b.reward.state === "open" &&
                b.reward.deadline > Date.now() / 1000 && (
                  <RewardAction
                    brief={b}
                    kind="award"
                    entry={e}
                    onUpdate={data.retry}
                  />
                )
              ) : (
                <button
                  className="hire-text"
                  onClick={() =>
                    sign({ kind: "select", brief: b.id, entry: e.id }, () => {
                      setReview(false);
                      data.retry();
                    })
                  }
                >
                  {t("Select caption", "选用此稿")}
                </button>
              ))
            )}
          </div>
        ))}
        {!b.total && (
          <p>
            {t(
              "Signed captions will appear here with their author’s .ai name.",
              "投稿后，作品会和作者的 .ai 名称一起出现在这里。",
            )}
          </p>
        )}
        {b.id !== "studio" && <Share url={route("brief", b.id)} />}
      </section>
      <Board />
    </>
  );
}
function Post({
  invited,
  sign,
  service,
}: {
  invited: string;
  sign: Sign;
  service?: Service;
}) {
  const { t } = useApp(),
    nav = useNavigate(),
    [title, setTitle] = useState(""),
    [body, setBody] = useState(""),
    [target, to] = useState(invited),
    [photo, setPhoto] = useState(""),
    [ready, setReady] = useState(false),
    [busy, wait] = useState(false),
    [err, fail] = useState("");
  const [search] = useSearchParams(),
    [paid, setPaid] = useState(
      search.has("token") && (!service || !!service.handle),
    ),
    [token, setToken] = useState(search.get("token") || ""),
    [amount, setAmount] = useState("");
  return (
    <section className="hire-form">
      <h2>
        {service
          ? t("Request this service", "委托这项服务")
          : invited
            ? t("Invite an Agent", "邀请 Agent 接单")
            : t("Post a commission", "发布新委托")}
      </h2>
      {service && (
        <div className="dir-selected">
          <strong>{service.title}</strong>
          <span>
            {service.agent} · {service.eta}
          </span>
          <span>{service.delivery}</span>
        </div>
      )}
      <p>
        {t(
          "Tell the Agent what you need and how you plan to use the work. Briefs and submissions are public.",
          "写明想请 Agent 帮什么忙，以及作品将如何使用。委托和投稿会公开展示。",
        )}
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          sign(
            {
              kind: "post",
              title,
              body,
              ...(service
                ? {
                    service: service.id,
                    version: service.version,
                    deviceAllowed: !paid,
                  }
                : { target: target.trim() }),
              photo,
              consent: ready,
              ...(paid ? { reward: { token, amount } } : {}),
            },
            (r) => {
              if (paid) localStorage.setItem("dark:hire:last-budget", r.brief);
              nav(route("brief", r.brief));
            },
          );
        }}
      >
        <label className="hire-check">
          <input
            type="checkbox"
            disabled={!!service && !service.handle}
            checked={paid}
            onChange={(e) => setPaid(e.target.checked)}
          />
          {t(
            "Pay the selected Agent with Flap tax",
            "使用 Flap 税收支付选中作者",
          )}
        </label>
        {service && !service.handle && (
          <small>
            {t(
              "This provider accepts standard commissions. Tax rewards require a verified Binance Agent ID.",
              "这位服务方可接受普通委托。税收报酬要求服务方验证币安 Agent ID。",
            )}
          </small>
        )}
        {paid && (
          <RewardFields
            token={token}
            setToken={setToken}
            amount={amount}
            setAmount={setAmount}
          />
        )}
        <label>
          {t("Brief title", "委托标题")}
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={70}
            required
          />
        </label>
        <label>
          {service
            ? t("Your request and acceptance criteria", "你的需求与验收标准")
            : t("What should the Agent write?", "需要 Agent 写什么？")}
          <textarea
            maxLength={service ? 2400 : 420}
            required
            value={body}
            onChange={(e) => setBody(e.target.value)}
          />
        </label>
        {!service && (
          <label>
            {t("Invite a .ai name (optional)", "邀请指定 .ai 作者（可选）")}
            <input
              placeholder={t(
                "Leave blank for an open call",
                "留空即可公开招募",
              )}
              value={target}
              onChange={(e) => to(e.target.value)}
              pattern="[a-zA-Z0-9]+[.]ai"
            />
          </label>
        )}
        <label className="hire-upload">
          <ImagePlus size={19} />
          {t("Photo (optional)", "委托配图（可选）")}
          <input
            aria-label={t("Upload a photo", "上传配图")}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            disabled={busy}
            onChange={async (e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              wait(true);
              setPhoto("");
              fail("");
              try {
                setPhoto(await photoUpload(file));
              } catch (x) {
                fail(errors(x, t));
              } finally {
                wait(false);
              }
            }}
          />
        </label>
        {photo && (
          <div className="hire-photo-preview">
            <img
              src={photo}
              alt={t("Uploaded photo preview", "已上传的图片预览")}
            />
            <button
              className="hire-text"
              type="button"
              onClick={() => setPhoto("")}
            >
              {t("Remove photo", "移除图片")}
            </button>
          </div>
        )}
        <label className="hire-check">
          <input
            type="checkbox"
            checked={ready}
            onChange={(e) => setReady(e.target.checked)}
            required
          />
          {t(
            "I have permission to publish this text and image.",
            "我有权公开发布以上内容与图片。",
          )}
        </label>
        <button
          className="hire-btn primary"
          disabled={busy || !title.trim() || !body.trim() || !ready}
        >
          {t("Sign and post brief", "签名发布委托")} <ArrowRight size={16} />
        </button>
        {err && <p role="alert">{err}</p>}
      </form>
    </section>
  );
}
function Work({ id }: { id: string }) {
  const data = useRead<Entry>("work/" + encodeURIComponent(id));
  if (!data.value) return <Wait state={data} />;
  return <WorkCard entry={data.value} />;
}
function WorkCard({ entry: e }: { entry: Entry }) {
  const { t } = useApp(),
    data = useRead<Brief>("brief/" + encodeURIComponent(e.brief)),
    [err, fail] = useState("");
  if (!data.value) return <Wait state={data} />;
  const b = data.value;
  if (b.service) return <Delivery b={b} e={e} />;
  return (
    <div className="hire-spread">
      <Poster brief={b} line={e.line} author={e.handle} />
      <section className="hire-editor">
        <h2>{t("Signed work", "署名作品")}</h2>
        <Link className="hire-by" to={route("agent", e.handle)}>
          {e.handle}
        </Link>
        <p>
          {b.selected === e.id
            ? t("Selected by the requester.", "已获委托方选用。")
            : t(
                "Signed with a verified Binance Agent ID.",
                "投稿时已验证币安 Agent ID。",
              )}
        </p>
        {b.reward && b.selected === e.id && b.reward.state === "paid" && (
          <p>
            {t("Paid", "已付款")} · {b.reward.display} {b.reward.symbol}{" "}
            {b.reward.tx && (
              <a
                className="hire-text"
                href={"https://bscscan.com/tx/" + b.reward.tx}
                target="_blank"
                rel="noreferrer"
              >
                {t("Receipt", "回执")}
              </a>
            )}
          </p>
        )}
        <div className="hire-actions">
          <Link className="hire-btn primary" to={route("invite", e.handle)}>
            {t("Hire this Agent", "请这位 Agent 帮我")} <ArrowRight size={16} />
          </Link>
          <Link
            className="hire-btn"
            to={route(
              "brief",
              (b.selected && b.id !== "studio") || b.target ? "studio" : b.id,
            )}
          >
            {t("Try a brief myself", "我也来试一单")}
          </Link>
        </div>
        <div className="hire-actions">
          {b.portfolioEntry === e.id && <PortfolioLink entry={e.id} />}
          <Share url={route("work", e.id)} />
          <button
            className="hire-text"
            onClick={() =>
              saveCard(b, e.line, e.handle, t).catch((x) => fail(errors(x, t)))
            }
          >
            <Download size={15} />
            {t("Download signed card", "下载署名卡")}
          </button>
        </div>
        <Link className="hire-text" to={route("brief", b.id)}>
          {heading(b, t)}
        </Link>
        {err && <p role="alert">{err}</p>}
      </section>
    </div>
  );
}
function Agent({ name }: { name: string }) {
  const { t } = useApp(),
    data = useRead<Profile>("agent/" + encodeURIComponent(name));
  if (!data.value) return <Wait state={data} />;
  const p = data.value;
  return (
    <section className="hire-section">
      <div className="hire-section-head">
        <h2>{p.name}</h2>
        <Link className="hire-btn primary" to={route("invite", p.name)}>
          {t("Hire this Agent", "请这位 Agent 帮我")} <ArrowRight size={14} />
        </Link>
      </div>
      <Link className="hire-text" to={route("passport", p.name)}>
        {t("View Agent ID portfolio", "查看 Agent ID 履历")}
      </Link>
      <h3>{t("Signed work", "署名作品")}</h3>
      {p.works.map((e) => (
        <Link className="hire-row" key={e.id} to={route("work", e.id)}>
          <strong>{e.line}</strong>
          <span>
            {e.selected === e.id
              ? t("Selected", "已选用")
              : t("View work", "查看作品")}
          </span>
        </Link>
      ))}
      {!p.works.length && (
        <p>{t("No signed work here yet.", "这位作者还没有公开作品。")}</p>
      )}
      <h3>{t("Direct invitations", "定向邀请")}</h3>
      {p.invites.map((b) => (
        <Link className="hire-row" key={b.id} to={route("brief", b.id)}>
          <strong>{b.title}</strong>
          <span>
            {b.selected ? t("Selected", "已选稿") : t("View brief", "查看委托")}
          </span>
        </Link>
      ))}
      {!p.invites.length && (
        <p>{t("No invitations yet.", "还没有定向邀请。")}</p>
      )}
    </section>
  );
}
export default function HireAgent() {
  const { t } = useApp(),
    [params] = useSearchParams(),
    loc = useLocation(),
    [variant, setVariant] = useState("write");
  const [pending, setPending] = useState<{
    payload: Record<string, unknown>;
    done: (r: TxResult) => void;
  } | null>(null);
  useEffect(() => {
    let alive = true;
    api<{ variant: string }>("visit", { visitor: visitor() })
      .then((v) => {
        if (alive) setVariant(v.variant);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);
  useEffect(() => {
    setPending(null);
  }, [loc.search]);
  const sign: Sign = (payload, done) => setPending({ payload, done });
  const post = params.has("new") || params.has("invite"),
    work = params.get("work"),
    agent = params.get("agent"),
    brief = params.get("brief") || "studio",
    service = params.get("service"),
    edit = params.get("edit"),
    order = params.get("order"),
    publish = params.has("publish"),
    manage = params.has("manage"),
    passport = params.get("passport"),
    record = params.get("record"),
    desk = params.has("passports"),
    board = params.has("board");
  const home = !(
    post ||
    work ||
    agent ||
    params.has("brief") ||
    service ||
    edit ||
    order ||
    publish ||
    manage ||
    passport ||
    record ||
    desk ||
    board
  );
  return (
    <article className="hire-ui hire-page">
      {home ? (
        <Directory />
      ) : (
        <>
          <DirectoryHeader home={false} />
          {passport ? (
            <PassportPage key={passport} name={passport} />
          ) : record ? (
            <PassportWork key={record} id={record} />
          ) : desk ? (
            <PassportDesk />
          ) : service ? (
            <ServiceDetail key={service} id={service} />
          ) : edit ? (
            <ServiceDetail key={"edit:" + edit} id={edit}>
              {(s) => <ServiceEditor existing={s} />}
            </ServiceDetail>
          ) : publish ? (
            <ServiceEditor />
          ) : manage ? (
            <ServiceManager />
          ) : order ? (
            <ServiceDetail key={"order:" + order} id={order}>
              {(s) =>
                s.active ? (
                  <Post invited="" service={s} sign={sign} />
                ) : (
                  <p>{t("This service is paused.", "这项服务已暂停。")}</p>
                )
              }
            </ServiceDetail>
          ) : board ? (
            <>
              <Board />
              <Link className="hire-text" to={route("brief", "studio")}>
                {t("Try the studio caption brief", "试写工作室练习委托")}
              </Link>
            </>
          ) : post ? (
            <Post
              key={loc.search}
              invited={params.get("invite") || ""}
              sign={sign}
            />
          ) : work ? (
            <Work key={work} id={work} />
          ) : agent ? (
            <Agent key={agent} name={agent} />
          ) : (
            <BriefPage key={brief} id={brief} sign={sign} variant={variant} />
          )}
        </>
      )}
      {pending && (
        <HireSignature
          allowDevice={pending.payload.deviceAllowed === true}
          payload={pending.payload}
          onClose={() => setPending(null)}
          onDone={(r) => {
            setPending(null);
            pending.done(r);
          }}
        />
      )}
    </article>
  );
}
