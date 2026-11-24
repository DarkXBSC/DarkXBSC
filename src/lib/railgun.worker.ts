import "./railgun-worker-env";
import { createShieldCall } from "./railgun-crypto.mjs";
self.onmessage = async (event) => {
  try {
    self.postMessage({ result: await createShieldCall(event.data) });
  } catch (error: any) {
    const code = error?.message;
    self.postMessage({
      error: /^[A-Z_]+$/.test(code) ? code : "RAILGUN_NOTE_FAILED",
    });
  }
};
