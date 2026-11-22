import test from "node:test";
import assert from "node:assert/strict";
import { publicUrl } from "../src/lib/public-url.mjs";

// Captured from the real Flap upload endpoint when reproducing the launch bug.
const image = "bafybeibpra27kt3kert2flezg7ed5lltk2yhhe5n3rr7n7f3lhpdlldfmu";
const gateway = "https://flap.mypinata.cloud/ipfs/";

test("Flap's bare image CID resolves to the same image as IPFS and HTTPS metadata", () => {
  for (const value of [image, "ipfs://" + image, "ipfs://ipfs/" + image, gateway + image])
    assert.equal(publicUrl(value), gateway + image);
  const v0 = "QmYwAPJzv5CZsnAzt8auVTL5oVQf9J3jWcLzSN4L1bZd5S";
  assert.equal(publicUrl(v0), gateway + v0);
  const raw = "bafkreif52fy2kvlpmqyaxkhcra6fvksxu23oytxlvw4q4e3vvt4ibcl4fy";
  assert.equal(publicUrl(raw), gateway + raw);
  assert.equal(publicUrl("  " + image + "  "), gateway + image);
  assert.equal(publicUrl("https://example.com/token.png"), "https://example.com/token.png");
});

test("IPFS directory images preserve their path and cannot escape the CID", () => {
  assert.equal(publicUrl("ipfs://" + image + "/art/token image.png"), gateway + image + "/art/token%20image.png");
  assert.equal(publicUrl(image + "/art/token%20image.png"), gateway + image + "/art/token%20image.png");
  for (const path of ["../other", "%2e%2e/other", "%2Fother", "image.png?bad", "image.png#bad", "%00.png"])
    assert.equal(publicUrl("ipfs://" + image + "/" + path), "");
});

test("missing or unsafe metadata still fails image validation without throwing", () => {
  for (const value of [undefined, null, {}, [], 123, "", "not-a-cid", "ipfs://not-a-cid", "http://example.com/token.png", "javascript:alert(1)", "data:image/png;base64,AAAA", "//example.com/token.png", "https://user:pass@example.com/token.png"])
    assert.equal(publicUrl(value), "");
});
