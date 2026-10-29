// electron-builder afterSign hook: give the Mac app a lasting identity.
//
// Without an Apple Developer ID, builds are signed "ad hoc", and macOS knows
// an ad hoc app only by a hash of that exact build. Its permission switches
// (Accessibility, Screen Recording, Microphone) then stop applying after
// every update. Signed with Persuna's own certificate instead (the same one
// for every release), macOS knows each new version as the same app:
//   identifier "app.persuna.persuna" and certificate leaf = H"…"
// so permissions survive updates. The certificate needn't be trusted by
// anyone for that (it isn't an Apple one, so Gatekeeper still asks once on
// first install; updates install without that).
//
// Runs only when PERSUNA_MAC_IDENTITY is set (the release workflow sets it
// from a secret, with PERSUNA_MAC_KEYCHAIN). It runs before the dmg, zip and
// update fingerprints are made, so they all hold the re-signed app.
const { execFileSync } = require("node:child_process");
const path = require("node:path");

exports.default = async function signMac(context) {
  const identity = process.env.PERSUNA_MAC_IDENTITY;
  if (context.electronPlatformName !== "darwin" || !identity) return;
  const app = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  const keychain = process.env.PERSUNA_MAC_KEYCHAIN;
  const args = [
    "--force",
    "--deep",
    "--sign",
    identity,
    ...(keychain ? ["--keychain", keychain] : []),
    "--entitlements",
    path.join(__dirname, "build", "entitlements.mac.plist"),
    app,
  ];
  execFileSync("/usr/bin/codesign", args, { stdio: "inherit" });
  const requirement = execFileSync("/usr/bin/codesign", ["-dr", "-", app], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  console.log(`  • signed with ${identity}: ${requirement.trim().split("\n").pop()}`);
};
