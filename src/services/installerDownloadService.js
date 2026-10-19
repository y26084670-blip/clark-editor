// The installed handler owns the trusted configuration URL and the transfer.
// Never put a download URL, executable path or shell command in the protocol URI.
export function createInstallerDownloadUri() {
  return `clark://download-installer?request=${globalThis.crypto.randomUUID()}`;
}

export function validateInstallerDownloadConfiguration(config) {
  const url = new URL(config?.solverInstallerUrl);
  if (url.protocol !== "https:" || url.username || url.password || url.hash || url.port) {
    throw new Error("Для прямой загрузки нужна HTTPS-ссылка на установщик.");
  }
  return config;
}
