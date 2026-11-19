// URLs and hashes come from Google's official ACP registry entry. Archive and
// member sizes were read from Google's servers on 2026-11-19; the darwin-arm64
// archive was downloaded and its hash checked independently.
// Registry: agentclientprotocol/registry main, antigravity-acp 1.5.0
export const ANTIGRAVITY_RELEASE_VERSION = "1.5.0";

export interface AntigravityReleaseAsset {
  version: string;
  url: string;
  sha256: string;
  archiveBytes: number;
  executable: { name: string; bytes: number };
  harness: { name: string; bytes: number };
}

const RELEASES = new Map<string, AntigravityReleaseAsset>([
  [
    "darwin-arm64",
    {
      version: ANTIGRAVITY_RELEASE_VERSION,
      url: "https://dl.google.com/agy-extensions/releases/macos/agy-acp-server-1.5.0-darwin-arm64.zip",
      sha256: "c82ecb4ef476bfc35cbe5b2745cdddef873b99c9f5bd7fd11e5ca1fc1667a3fc",
      archiveBytes: 100_401_185,
      executable: { name: "agy_acp_server.par", bytes: 179_756_208 },
      harness: { name: "localharness_external", bytes: 129_572_384 },
    },
  ],
  [
    "darwin-x64",
    {
      version: ANTIGRAVITY_RELEASE_VERSION,
      url: "https://dl.google.com/agy-extensions/releases/macos/agy-acp-server-1.5.0-darwin-x86_64.zip",
      sha256: "86a94e33b25d4a38ff30526ad844546860aa9ed98698498d9e87d30eb794426e",
      archiveBytes: 106_461_356,
      executable: { name: "agy_acp_server.par", bytes: 184_151_792 },
      harness: { name: "localharness_external", bytes: 134_730_544 },
    },
  ],
  [
    "linux-x64",
    {
      version: ANTIGRAVITY_RELEASE_VERSION,
      url: "https://dl.google.com/agy-extensions/releases/linux/agy-acp-server-1.5.0-linux-x86_64.zip",
      sha256: "36f373e8948edf1727b39c7d62b5722d6a4474bdfd72b04ad3d6def571808c9f",
      archiveBytes: 274_069_093,
      executable: { name: "agy_acp_server.par", bytes: 714_224_576 },
      harness: { name: "localharness_external", bytes: 139_570_072 },
    },
  ],
  [
    "linux-arm64",
    {
      version: ANTIGRAVITY_RELEASE_VERSION,
      url: "https://dl.google.com/agy-extensions/releases/linux/agy-acp-server-1.5.0-linux-arm64.zip",
      sha256: "1e184f439477b54138e94440056b26a78c0a8075a8fd2ffda637ec31267c6459",
      archiveBytes: 264_366_319,
      executable: { name: "agy_acp_server.par", bytes: 721_489_411 },
      harness: { name: "localharness_external", bytes: 132_951_888 },
    },
  ],
  [
    "win32-x64",
    {
      version: ANTIGRAVITY_RELEASE_VERSION,
      url: "https://dl.google.com/agy-extensions/releases/windows/agy-acp-server-1.5.0-windows-x86_64.zip",
      sha256: "6163f6b59b381bae419652dbae167bc8cda0ef29d665c0ba8af3d8c7fddd8867",
      archiveBytes: 105_513_364,
      executable: { name: "agy_acp_server.exe", bytes: 58_314_376 },
      harness: { name: "localharness_external.exe", bytes: 155_782_808 },
    },
  ],
  [
    "win32-arm64",
    {
      version: ANTIGRAVITY_RELEASE_VERSION,
      url: "https://dl.google.com/agy-extensions/releases/windows/agy-acp-server-1.5.0-windows-arm64.zip",
      sha256: "340092b8af6dafc71eb15f4a8ec54b4d1f0bce16d1fa4d163b562c50b905f8f4",
      archiveBytes: 108_145_235,
      executable: { name: "agy_acp_server.exe", bytes: 65_077_040 },
      harness: { name: "localharness_external.exe", bytes: 147_104_920 },
    },
  ],
]);

export function resolveAntigravityReleaseAsset(
  platform: NodeJS.Platform = process.platform,
  arch: string = process.arch,
): AntigravityReleaseAsset | null {
  return RELEASES.get(`${platform}-${arch}`) ?? null;
}
