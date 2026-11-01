const bytes = globalThis.crypto.getRandomValues(new Uint8Array(32));
console.log(Buffer.from(bytes).toString("base64"));
