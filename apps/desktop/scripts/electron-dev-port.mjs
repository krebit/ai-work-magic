export async function resolveElectronDevPort(rawPort, findFreeTcpPort) {
  const portValue = Number.parseInt(rawPort, 10);
  if (Number.isFinite(portValue) && portValue > 0) return portValue;
  return findFreeTcpPort();
}
