const targets: Record<string, Record<string, string>> = {
  linux: {
    x64: "linux-x86_64",
    arm64: "linux-aarch_64",
    ia32: "linux-x86_32",
    ppc64: "linux-ppcle_64",
    s390x: "linux-s390_64",
  },
  darwin: { x64: "osx-x86_64", arm64: "osx-aarch_64" },
  win32: { x64: "win64", ia32: "win32", arm64: "win64" },
};

export function getTarget(platform: string, architecture: string): string {
  const target = targets[platform]?.[architecture];
  if (typeof target !== "string") {
    throw new Error(
      `Unsupported platform/architecture: ${platform}/${architecture}`,
    );
  }
  return target;
}

export function assetName(version: string, target: string): string {
  return `protoc-${version}-${target}.zip`;
}
