// Builds persuna-eyes.exe with the C# compiler that comes with Windows.
// Run from desktop/: npm run build:eyes:win
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const framework = path.join(process.env.WINDIR, "Microsoft.NET", "Framework64", "v4.0.30319");

fs.mkdirSync(path.join("build", "bin"), { recursive: true });
execFileSync(
  path.join(framework, "csc.exe"),
  [
    "/nologo",
    "/optimize+",
    "/target:exe",
    // One file for both chips: Windows runs it natively on x64 and arm64.
    "/platform:anycpu",
    `/out:${path.join("build", "bin", "persuna-eyes.exe")}`,
    `/lib:${path.join(framework, "WPF")}`,
    "/reference:UIAutomationClient.dll",
    "/reference:UIAutomationTypes.dll",
    "/reference:WindowsBase.dll",
    path.join("native", "win", "eyes.cs"),
  ],
  { stdio: "inherit" },
);
