import webpush from "web-push";

const keys = webpush.generateVAPIDKeys();
console.log("BOAT_PON_VAPID_PUBLIC_KEY=" + keys.publicKey);
console.log("BOAT_PON_VAPID_PRIVATE_KEY=" + keys.privateKey);
console.log("BOAT_PON_VAPID_SUBJECT=mailto:you@example.com");
console.log("");
console.log("# .env.local などに保存して dev/api を再起動してください。");
