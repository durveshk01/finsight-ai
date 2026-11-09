const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const repository = process.argv[2];
if (!repository || !/^[\w.-]+\/[\w.-]+$/.test(repository)) throw new Error("Supply the GitHub owner/repository explicitly.");
const root = path.resolve(__dirname, "..");
const credentials = JSON.parse(fs.readFileSync(path.join(root, ".signing", "release.json"), "utf8"));
if (credentials.alias !== "finsight" || !credentials.password) throw new Error("Build with the project's generated release key first, or configure external signing secrets manually.");
const secrets = {
  FINSIGHT_ANDROID_KEYSTORE_BASE64: fs.readFileSync(credentials.keystore).toString("base64"),
  FINSIGHT_ANDROID_STORE_PASSWORD: credentials.password,
};
for (const [name, value] of Object.entries(secrets)) {
  const result = spawnSync("gh", ["secret", "set", name, "--repo", repository], { input: value, stdio: ["pipe", "inherit", "inherit"] });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Could not configure ${name}.`);
  console.log(`Configured encrypted GitHub Actions secret ${name}.`);
}
console.log("The keystore remains in ignored mobile/.signing; keep a private backup for compatible future updates.");
