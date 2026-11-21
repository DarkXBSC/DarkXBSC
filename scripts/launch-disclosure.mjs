// Disclosure is fixed for a launch and stored with the encrypted payee record.
export function launchDisclosure(input, recipient = "", nomination) {
  if (input === undefined) return undefined;
  if (!input || !["private", "public"].includes(input.visibility))
    throw Error("INVALID_DISCLOSURE");
  const purpose = String(input.purpose ?? "").trim();
  if (purpose.length > 280 || /[\u0000-\u001f]/u.test(purpose))
    throw Error("INVALID_DISCLOSURE");
  if (nomination && input.visibility !== "private")
    throw Error("PRIVATE_NOMINATION_REQUIRED");
  const result = { visibility: input.visibility, purpose };
  assertPrivateContent(result, recipient, purpose);
  return result;
}
export function assertPrivateContent(disclosure, recipient, text) {
  const handle = String(recipient).trim().replace(/^@/, "").toLowerCase();
  if (
    disclosure?.visibility === "private" &&
    /^[a-z0-9_]{1,15}$/.test(handle) &&
    new RegExp("(^|[^a-z0-9_])" + handle + "([^a-z0-9_]|$)", "i").test(text)
  )
    throw Error("PRIVATE_RECIPIENT_IN_PUBLIC_CONTENT");
}
export function launchMetadata(fields) {
  const creator = String(fields.creator || "");
  if (!/^0x[\da-fA-F]{40}$/.test(creator)) throw Error("INVALID_CREATOR");
  const description = String(fields.description || "").slice(0, 2000);
  const website = String(fields.website || "").slice(0, 300);
  const twitter = String(fields.twitter || "").slice(0, 300);
  const disclosure = launchDisclosure(
    fields.disclosure,
    fields.recipient,
    fields.nomination,
  );
  assertPrivateContent(
    disclosure,
    fields.recipient,
    [description, website, twitter, fields.name, fields.symbol].join("\n"),
  );
  const additions = [];
  if (disclosure?.purpose) additions.push(disclosure.purpose);
  if (disclosure?.visibility === "public") {
    const handle = String(fields.recipient || "")
      .trim()
      .replace(/^@/, "")
      .toLowerCase();
    if (!/^[a-z0-9_]{1,15}$/.test(handle)) throw Error("INVALID_X_HANDLE");
    additions.push("X beneficiary: https://x.com/" + handle);
  }
  const publishedDescription = [description, ...additions]
    .filter(Boolean)
    .join("\n\n");
  if (publishedDescription.length > 2000) throw Error("DESCRIPTION_TOO_LONG");
  return {
    creator,
    description: publishedDescription,
    website,
    twitter,
    telegram: null,
  };
}
