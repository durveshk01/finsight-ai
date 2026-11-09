const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const crypto = require("node:crypto");
const { spawnSync, execFileSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const windows = process.platform === "win32";
const env = { ...process.env, EXPO_NO_DOTENV: "1", CI: "1" };
const sdk = env.ANDROID_HOME || env.ANDROID_SDK_ROOT || (windows ? path.join(env.LOCALAPPDATA || "", "Android", "Sdk") : path.join(os.homedir(), process.platform === "darwin" ? "Library/Android/sdk" : "Android/Sdk"));
if (!fs.existsSync(sdk)) throw new Error("Set ANDROID_HOME to an installed Android SDK (platform 36, build-tools 36.0.0). See mobile/README.md.");
env.ANDROID_HOME = sdk; env.ANDROID_SDK_ROOT = sdk;
const javaTool = (name) => env.JAVA_HOME ? path.join(env.JAVA_HOME, "bin", `${name}${windows ? ".exe" : ""}`) : name;
const run = (command, args, cwd = root) => {
  const batch = windows && /\.(bat|cmd)$/i.test(command);
  const quote = (value) => `"${value.replace(/"/g, '""')}"`;
  const result = batch
    ? spawnSync(env.ComSpec || "cmd.exe", ["/d", "/s", "/c", `"${[command, ...args].map(quote).join(" ")}"`], { cwd, env, stdio: "inherit", windowsVerbatimArguments: true })
    : spawnSync(command, args, { cwd, env, stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${path.basename(command)} failed (${result.status ?? result.signal}).`);
};

run(process.execPath, [path.join(root, "scripts", "generate-assets.cjs")]);
run(process.execPath, [require.resolve("expo/bin/cli"), "prebuild", "--platform", "android", "--no-install"]);
const signingDir = path.join(root, ".signing");
fs.mkdirSync(signingDir, { recursive: true, mode: 0o700 });
const credentialsPath = path.join(signingDir, "release.json");
let credentials;
if (env.FINSIGHT_KEYSTORE_PATH) {
  credentials = { keystore: path.resolve(env.FINSIGHT_KEYSTORE_PATH), alias: env.FINSIGHT_KEY_ALIAS || "finsight", password: env.FINSIGHT_STORE_PASSWORD, keyPassword: env.FINSIGHT_KEY_PASSWORD || env.FINSIGHT_STORE_PASSWORD };
  if (!credentials.password) throw new Error("FINSIGHT_STORE_PASSWORD is required for the supplied release keystore.");
} else if (fs.existsSync(credentialsPath)) credentials = JSON.parse(fs.readFileSync(credentialsPath, "utf8"));
else {
  credentials = { keystore: path.join(signingDir, "finsight-release.p12"), alias: "finsight", password: crypto.randomBytes(32).toString("hex") };
  env.FINSIGHT_STORE_PASSWORD = credentials.password;
  run(javaTool("keytool"), ["-genkeypair", "-keystore", credentials.keystore, "-storetype", "PKCS12", "-alias", credentials.alias, "-keyalg", "RSA", "-keysize", "3072", "-validity", "10000", "-dname", "CN=FinSight AI, OU=Mobile, O=FinSight AI, C=IN", "-storepass:env", "FINSIGHT_STORE_PASSWORD", "-keypass:env", "FINSIGHT_STORE_PASSWORD"]);
  fs.writeFileSync(credentialsPath, JSON.stringify(credentials), { mode: 0o600 });
  console.log("Created an ignored release key in mobile/.signing. Keep a private backup to sign compatible future updates.");
}
if (!fs.existsSync(credentials.keystore)) throw new Error("Release signing keystore is missing.");
Object.assign(env, { FINSIGHT_KEYSTORE_PATH: credentials.keystore, FINSIGHT_KEY_ALIAS: credentials.alias, FINSIGHT_STORE_PASSWORD: credentials.password, FINSIGHT_KEY_PASSWORD: credentials.keyPassword || credentials.password });
const android = path.join(root, "android");
fs.writeFileSync(path.join(android, "finsight-release.gradle"), `if (System.getenv("FINSIGHT_KEYSTORE_PATH")) {
android {
  signingConfigs {
    finsightRelease {
      storeFile file(System.getenv("FINSIGHT_KEYSTORE_PATH"))
      storePassword System.getenv("FINSIGHT_STORE_PASSWORD")
      keyAlias System.getenv("FINSIGHT_KEY_ALIAS")
      keyPassword System.getenv("FINSIGHT_KEY_PASSWORD")
    }
  }
  buildTypes { release { signingConfig signingConfigs.finsightRelease } }
}
}
`);
const appGradle = path.join(android, "app", "build.gradle");
const releaseScript = 'apply from: rootProject.file("finsight-release.gradle")';
const source = fs.readFileSync(appGradle, "utf8");
if (!source.includes(releaseScript)) fs.writeFileSync(appGradle, source + `\n${releaseScript}\n`);
fs.writeFileSync(path.join(android, "local.properties"), `sdk.dir=${sdk.replace(/\\/g, "/").replace(/:/g, "\\:")}\n`);
run(path.join(android, windows ? "gradlew.bat" : "gradlew"), [":app:assembleRelease", "--no-daemon", `--max-workers=${env.FINSIGHT_GRADLE_WORKERS || "2"}`, "-Dorg.gradle.jvmargs=-Xmx3g -XX:MaxMetaspaceSize=768m", "-Pkotlin.compiler.execution.strategy=in-process", "-PreactNativeArchitectures=arm64-v8a,x86_64"], android);

const artifacts = path.join(root, "artifacts"); fs.mkdirSync(artifacts, { recursive: true });
const version = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")).version;
const name = `FinSight-AI-${version}.apk`;
const apk = path.join(artifacts, name);
fs.copyFileSync(path.join(android, "app", "build", "outputs", "apk", "release", "app-release.apk"), apk);
const tools = path.join(sdk, "build-tools", "36.0.0");
run(path.join(tools, windows ? "apksigner.bat" : "apksigner"), ["verify", "--verbose", "--print-certs", apk]);
const badging = execFileSync(path.join(tools, windows ? "aapt.exe" : "aapt"), ["dump", "badging", apk], { env, encoding: "utf8" });
if (!badging.includes("name='ai.finsight.mobile'") || !badging.includes(`versionName='${version}'`)) throw new Error("Built APK identity/version does not match the release.");
if (badging.includes("application-debuggable")) throw new Error("Release APK must not be debuggable.");
const contents = execFileSync(javaTool("jar"), ["tf", apk], { env, encoding: "utf8", maxBuffer: 8 * 1024 * 1024 });
if (!contents.includes("assets/index.android.bundle") || !contents.includes("lib/arm64-v8a/libhermes.so") || !contents.includes("lib/x86_64/libhermes.so")) throw new Error("APK is missing the bundled app or a required 64-bit ABI.");
const checksum = crypto.createHash("sha256").update(fs.readFileSync(apk)).digest("hex");
fs.writeFileSync(path.join(artifacts, `${name}.sha256`), `${checksum}  ${name}\n`);
console.log(`Verified signed APK: ${apk}\nSHA-256: ${checksum}\n${(fs.statSync(apk).size / 1024 / 1024).toFixed(1)} MB · arm64-v8a + x86_64`);
