import { verifyMessage, getAddress } from "ethers";
import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  squarePostId,
  squareProfile,
  squareStatement,
} from "../src/lib/square-route.ts";

const canonicalPost = (id) => "https://www.binance.com/en/square/post/" + id;
const absolute = (value) =>
  typeof value === "string" ? value : value?.["@id"] || value?.url || "";

function articleFromHtml(html, postId) {
  const articles = [];
  function collect(value) {
    if (Array.isArray(value)) return value.forEach(collect);
    if (!value || typeof value !== "object") return;
    if (value["@graph"]) collect(value["@graph"]);
    if (
      [value["@type"]]
        .flat()
        .some((type) =>
          [
            "Article",
            "NewsArticle",
            "SocialMediaPosting",
            "BlogPosting",
          ].includes(type),
        )
    )
      articles.push(value);
  }
  for (const match of html.matchAll(
    /<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi,
  )) {
    try {
      collect(JSON.parse(match[1]));
    } catch {}
  }
  const matches = articles.filter((v) =>
    [absolute(v.url), absolute(v.mainEntityOfPage), v["@id"]].some(
      (x) => squarePostId(x) === postId,
    ),
  );
  if (matches.length !== 1) throw Error("POST_AUTHOR_UNVERIFIED");
  const a = matches[0],
    authors = [a.author].flat();
  if (authors.length !== 1) throw Error("POST_AUTHOR_UNVERIFIED");
  let profile;
  try {
    profile = squareProfile(absolute(authors[0]?.url || authors[0]?.["@id"]));
  } catch {
    throw Error("POST_AUTHOR_UNVERIFIED");
  }
  const identifier = authors[0]?.identifier;
  return {
    profile,
    authorId: typeof identifier === "string" ? identifier : "",
    published: Date.parse(a.datePublished) || 0,
    body: String(a.articleBody || a.text || "").trim(),
  };
}
function verifyProof(article, postId) {
  const proof = article.body.match(
    /^Dark Flap tax beneficiary\s+Network: BSC \(56\)\s+Square: (https:\/\/[^\s]+)\s+Wallet: (0x[a-fA-F0-9]{40})\s+Signature: (0x[a-fA-F0-9]{130})$/,
  );
  if (!proof) throw Error("POST_PAYOUT_NOT_BOUND");
  try {
    const address = getAddress(proof[2]);
    if (
      squareProfile(proof[1]) !== article.profile ||
      verifyMessage(squareStatement(article.profile, address), proof[3]) !==
        address
    )
      throw Error();
    return {
      profile: article.profile,
      address,
      proof: canonicalPost(postId),
      post: canonicalPost(postId),
      chainId: 56,
      rail: "square-wallet",
    };
  } catch {
    throw Error("POST_PAYOUT_NOT_BOUND");
  }
}
export function checkSquareArticle(html, postId) {
  return verifyProof(articleFromHtml(html, postId), postId);
}
export async function readSquareArticle(postId, fetcher = fetch) {
  const res = await fetcher(canonicalPost(postId), {
    redirect: "error",
    signal: AbortSignal.timeout(8000),
    headers: { accept: "text/html" },
  });
  if (res.status !== 200 || !res.body) throw Error("POST_AUTHOR_UNVERIFIED");
  let total = 0;
  const chunks = [];
  for await (const chunk of res.body) {
    total += chunk.length;
    if (total > 3_000_000) throw Error("POST_AUTHOR_UNVERIFIED");
    chunks.push(chunk);
  }
  return articleFromHtml(Buffer.concat(chunks).toString("utf8"), postId);
}
export function createSquareResolver({
  directory = "deployments/private/square-proofs",
  fetcher = fetch,
} = {}) {
  return async function resolve(raw, { declarationOnly = false } = {}) {
    const postId = squarePostId(raw);
    if (!postId) throw Error("INVALID_RECIPIENT");
    const article = await readSquareArticle(postId, fetcher);
    const file = join(
      directory,
      createHash("sha256").update(article.profile).digest("hex") + ".json",
    );
    let saved;
    try {
      saved = JSON.parse(readFileSync(file, "utf8"));
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    if (article.body.startsWith("Dark Flap tax beneficiary")) {
      const bound = verifyProof(article, postId);
      if (
        saved &&
        saved.postId !== postId &&
        saved.address !== bound.address &&
        (!saved.published || article.published <= saved.published)
      )
        throw Error("POST_PAYOUT_NOT_BOUND");
      if (
        !saved ||
        saved.postId === postId ||
        article.published >= saved.published
      ) {
        mkdirSync(directory, { recursive: true, mode: 0o700 });
        const temp = file + "." + randomUUID();
        writeFileSync(
          temp,
          JSON.stringify({
            postId,
            published: article.published,
            address: bound.address,
          }),
          { mode: 0o600 },
        );
        renameSync(temp, file);
      }
      return bound;
    }
    if (!saved || declarationOnly) throw Error("POST_PAYOUT_NOT_BOUND");
    const proof = await readSquareArticle(saved.postId, fetcher);
    if (
      proof.profile !== article.profile ||
      ((article.authorId || proof.authorId) &&
        proof.authorId !== article.authorId)
    )
      throw Error("POST_AUTHOR_UNVERIFIED");
    const bound = verifyProof(proof, saved.postId);
    if (bound.address !== saved.address) throw Error("POST_PAYOUT_NOT_BOUND");
    return { ...bound, post: canonicalPost(postId) };
  };
}
export const resolveSquarePost = createSquareResolver();
