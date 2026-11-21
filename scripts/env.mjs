import fs from "node:fs";
import dotenv from "dotenv";
import { Wallet, getAddress, isAddress } from "ethers";
export function loadEnv() {
  const env = dotenv.parse(fs.readFileSync(".env", "utf8"));
  if (!/^0x[\da-fA-F]{64}$/.test(env.DEPLOYER_PRIVATE_KEY || ""))
    throw Error("DEPLOYER_PRIVATE_KEY is missing or invalid");
  const address = new Wallet(env.DEPLOYER_PRIVATE_KEY).address;
  for (const name of ["CONTRACT_OWNER", "FEE_RECIPIENT"]) {
    if (!isAddress(env[name] || ""))
      throw Error(name + " must be an explicit valid address");
    env[name] = getAddress(env[name]);
  }
  return { env, address };
}
export function atomic(file, value, privateFile = false) {
  fs.mkdirSync(
    new URL(".", new URL(file, "file://" + process.cwd() + "/")).pathname,
    { recursive: true },
  );
  fs.writeFileSync(file + ".tmp", JSON.stringify(value, null, 2), {
    mode: privateFile ? 0o600 : 0o644,
  });
  fs.renameSync(file + ".tmp", file);
}
