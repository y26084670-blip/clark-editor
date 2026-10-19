// The installed handler owns the trusted configuration URL and the transfer.
// Never put a download URL, executable path or shell command in the protocol URI.
export function createInstallerDownloadUri() {
  return `clark://download-installer?request=${globalThis.crypto.randomUUID()}`;
}

export function validateInstallerMetadata(config) {
  const url = new URL(config?.solverInstallerUrl);
  if (url.protocol !== "https:" || url.username || url.password || url.hash || url.port
    || !Number.isSafeInteger(config?.solverInstallerSize) || config.solverInstallerSize < 2
    || !/^[a-f0-9]{64}$/i.test(config?.solverInstallerSha256 ?? "")) {
    throw new Error("Для прямой загрузки нужны HTTPS-ссылка, размер и SHA-256 установщика.");
  }
  return config;
}
