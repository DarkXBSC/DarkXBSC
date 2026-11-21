import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { squarePostId, squareProfile } from "../src/lib/square-route.ts";
import { readSquareArticle } from "./square-post.mjs";

const uidPattern = /^[1-9]\d{0,18}$/;
const canonicalPost = (id) => "https://www.binance.com/en/square/post/" + id;

function directoryEntry(dir, file, key) {
  const path = join(dir, file);
  if (!existsSync(path)) return null;
  const entries = JSON.parse(readFileSync(path, "utf8"));
  if (!Object.hasOwn(entries, key)) return null;
  const entry = entries[key];
  if (
    !entry ||
    entry.revokedAt ||
    typeof entry.uid !== "string" ||
    !uidPattern.test(entry.uid) ||
    typeof entry.evidence !== "string" ||
    !entry.evidence.trim() ||
    !Number.isFinite(Date.parse(entry.verifiedAt))
  )
    throw Error("POST_NOT_LINKED");
  return entry;
}

export function createRecipientResolver(dir, readArticle = readSquareArticle) {
  return async function resolve(raw) {
    if (typeof raw !== "string" || raw.length > 512)
      throw Error("INVALID_RECIPIENT");
    const input = raw.trim();
    if (uidPattern.test(input)) return { kind: "uid", uid: input };
    const id = squarePostId(input);
    if (!id) throw Error("INVALID_RECIPIENT");
    const post = canonicalPost(id);
    // An existing operator-verified record is scoped to this exact original post.
    const exact = directoryEntry(dir, "verified-posts.json", id);

    let article;
    try {
      article = await readArticle(id);
    } catch {
      if (exact) return { kind: "post", post, uid: exact.uid };
      throw Error("POST_AUTHOR_UNVERIFIED");
    }
    const profile = squareProfile(article.profile);

    // JSON-LD author identifiers identify Square authors only. The payee always
    // comes from independent merchant evidence binding this author to a Binance UID.
    const author = directoryEntry(dir, "verified-authors.json", profile);
    if (exact) {
      if (
        author &&
        (!article.authorId ||
          author.squareAuthorId !== article.authorId ||
          author.uid !== exact.uid)
      )
        throw Error("POST_NOT_LINKED");
      return { kind: "post", post, profile, uid: exact.uid };
    }
    if (
      !article.authorId ||
      !author ||
      author.squareAuthorId !== article.authorId
    )
      return { kind: "post", post, profile };
    return { kind: "post", post, profile, uid: author.uid };
  };
}
