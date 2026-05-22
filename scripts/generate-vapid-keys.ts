import { createECDH } from "node:crypto";

const ecdh = createECDH("prime256v1");
ecdh.generateKeys();

console.log("BOAT_PON_VAPID_PUBLIC_KEY=" + base64Url(ecdh.getPublicKey()));
console.log("BOAT_PON_VAPID_PRIVATE_KEY=" + base64Url(ecdh.getPrivateKey()));
console.log("BOAT_PON_VAPID_SUBJECT=mailto:you@example.com");

function base64Url(buffer: Buffer) {
  return buffer.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
