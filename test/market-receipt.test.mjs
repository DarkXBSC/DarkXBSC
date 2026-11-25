import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Interface } from "ethers";
import sharp from "sharp";
import {
  createReceiptHandler,
  receiptRoute,
} from "../scripts/market-receipt.mjs";
import { firstReceipt, receiptPaths } from "../src/lib/market-receipt.mjs";

const token = "0x" + "12".repeat(20),
  txHash = "0x" + "ab".repeat(32),
  creation = "0x" + "13".repeat(32);
const cid = "bafkreif52fy2kvlpmqyaxkhcra6fvksxu23oytxlvw4q4e3vvt4ibcl4fy";
const receipt = {
  seq: 1,
  stage: "confirmed",
  net: "24.9375",
  hash: txHash,
  block: 123,
};
const ledger = {
  token,
  creation,
  rail: "railgun-tax",
  chainId: 56,
  batches: [receipt],
};
const launch = new Interface(
  JSON.parse(readFileSync("public/contracts/IPortal.abi.json")),
);
const type = launch.getFunction("newTokenV6").inputs[0];
const params = type.components.map(
  (field, i) =>
    ({ symbol: "<M&M>", meta: cid })[field.name] ??
    launch.getAbiCoder().getDefaultValue([type])[0][i],
);
const input = launch.encodeFunctionData("newTokenV6", [params]);
const to = JSON.parse(readFileSync("public/protocols.json")).flap.portal;

test("only a finalized first batch for the selected BSC token has a shareable receipt", () => {
  assert.deepEqual(firstReceipt(ledger, token), receipt);
  for (const update of [
    { chainId: 8453 },
    { token: to },
    { creation: null },
    { rail: "xmoney-tax" },
    { batches: [{ ...receipt, seq: 2 }] },
    { batches: [{ ...receipt, net: "0.0" }] },
    { batches: [{ ...receipt, stage: "shielding" }] },
    { batches: [{ ...receipt, hash: "no" }] },
    { batches: [{ ...receipt, block: 0 }] },
  ])
    assert.equal(firstReceipt({ ...ledger, ...update }, token), null);
  assert.equal(
    receiptRoute(
      new URL(
        "https://darkwork.fun/app/explore?chain=base&receipt=1&token=" + token,
      ),
    ),
    null,
  );
});

test("crawler HTML and PNG derive art, amount, and evidence from the same verified batch", async () => {
  const art = await sharp({
    create: { width: 48, height: 48, channels: 3, background: "#ee1144" },
  })
    .png()
    .toBuffer();
  let state = { ...ledger, batches: [] };
  const handle = createReceiptHandler({
    api: "http://api",
    giving: "http://giving",
    readIndex: async () => "<html><head></head><body>app</body></html>",
    fetcher: async (url, options) => {
      if (url === "http://giving/api/giving/railgun/status?address=" + token)
        return Response.json({ ...state, recipient: "PRIVATE_ONLY" });
      if (url === "http://api/api/rpc/bsc") {
        assert.deepEqual(JSON.parse(options.body).params, [creation]);
        return Response.json({ result: { hash: creation, input, to } });
      }
      if (url === "http://api/api/metadata/" + cid)
        return Response.json({ image: cid });
      assert.equal(url, "https://flap.mypinata.cloud/ipfs/" + cid);
      return new Response(art);
    },
  });
  async function request(path, method = "GET") {
    const url = new URL(path, "https://darkwork.fun"),
      route = receiptRoute(url),
      out = {};
    await handle(
      route,
      { url: path, method },
      {
        writeHead: (status, headers) => Object.assign(out, { status, headers }),
        end: (body) => (out.body = body),
      },
    );
    return out;
  }
  const { chart, image } = receiptPaths(token);
  assert.equal((await request(image)).status, 404);
  assert.doesNotMatch((await request(chart)).body, /twitter:card/);
  state = ledger;
  const html = (await request(chart)).body;
  assert.match(html, /summary_large_image/);
  assert.match(html, /24.9375 USDT/);
  assert.match(html, /&lt;M&amp;M&gt;/);
  assert(!html.includes("PRIVATE_ONLY"));
  assert(html.includes(image));
  const png = await request(image);
  assert.equal(png.status, 200);
  assert.equal(png.headers["Content-Type"], "image/png");
  const { width, height } = await sharp(png.body).metadata();
  assert.deepEqual([width, height], [1200, 630]);
  const color = await sharp(png.body)
    .extract({ left: 801, top: 201, width: 1, height: 1 })
    .removeAlpha()
    .raw()
    .toBuffer();
  assert.equal(color.toString("hex"), "ee1144");
  assert.equal((await request(image, "HEAD")).body, undefined);
});
