import test from "node:test";
import assert from "node:assert/strict";
import { launchDisclosure, launchMetadata } from "../scripts/launch-disclosure.mjs";
const fields = {
  creator: "0x1111111111111111111111111111111111111111",
  description: "A cat helping shelter volunteers.",
  recipient: "PrivateFriend",
  disclosure: { visibility: "private", purpose: "Support animal rescue" },
};
test("private launch metadata publishes only approved project fields", () => {
  const metadata = launchMetadata(fields);
  assert.equal(metadata.description, fields.description + "\n\nSupport animal rescue");
  assert.equal(JSON.stringify(metadata).toLowerCase().includes("privatefriend"), false);
  assert.equal("recipient" in metadata, false);
  assert.equal("disclosure" in metadata, false);
});
test("private identity in any public field blocks publication", () => {
  for (const field of ["description", "website", "twitter", "name", "symbol"]) {
    assert.throws(() => launchMetadata({ ...fields, [field]: "https://x.com/PrivateFriend" }),
      /PRIVATE_RECIPIENT_IN_PUBLIC_CONTENT/);
  }
  assert.throws(() => launchMetadata({ ...fields, disclosure: { visibility: "private", purpose: "Help @PrivateFriend" } }),
    /PRIVATE_RECIPIENT_IN_PUBLIC_CONTENT/);
});
test("public disclosure is explicit and community nominations stay private", () => {
  const metadata = launchMetadata({ ...fields, disclosure: { visibility: "public", purpose: "" } });
  assert.match(metadata.description, /X beneficiary: https:\/\/x.com\/privatefriend/);
  assert.throws(() => launchDisclosure({ visibility: "public" }, "", "nomination"), /PRIVATE_NOMINATION_REQUIRED/);
  assert.throws(() => launchDisclosure({ visibility: "unknown" }), /INVALID_DISCLOSURE/);
  assert.throws(() => launchDisclosure({ visibility: "private", purpose: "a".repeat(281) }), /INVALID_DISCLOSURE/);
  assert.equal(launchDisclosure(undefined), undefined);
});
test("legacy uploads remain valid and disclosure cannot silently truncate", () => {
  const { disclosure, recipient, ...legacy } = fields;
  assert.equal(launchMetadata(legacy).description, fields.description);
  assert.throws(() => launchMetadata({ ...fields, description: "a".repeat(2000) }), /DESCRIPTION_TOO_LONG/);
});
