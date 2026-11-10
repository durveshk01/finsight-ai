"""Build a disposable native share receiver with installed SDK tools and Java.

The fixture has no storage/network permissions. It can read an exported file only
through Android's actual ACTION_SEND URI grant. Its signing key is disposable;
it is unrelated to FinSight's private release signing identity.
"""

import argparse
import os
from pathlib import Path
import re
import shutil
import subprocess
import zipfile


def version(path):
    return tuple(map(int, re.findall(r"\d+", path.name)))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    sdk = os.environ.get("ANDROID_HOME") or os.environ.get("ANDROID_SDK_ROOT")
    assert sdk, "Set ANDROID_HOME to the installed Android SDK"
    suffix = ".exe" if os.name == "nt" else ""
    platforms = list(Path(sdk).glob("platforms/android-*/android.jar"))
    assert platforms, "Install an Android SDK platform before building the native receiver"
    android = max(platforms, key=lambda path: version(path.parent))
    versions = [path for path in Path(sdk).glob("build-tools/*") if (path / ("aapt2" + suffix)).is_file()
                and (path / "lib/d8.jar").is_file() and (path / "lib/apksigner.jar").is_file()]
    assert versions, "Install Android SDK build-tools before building the native receiver"
    tools = max(versions, key=version)
    java_home = os.environ.get("JAVA_HOME")

    def java_tool(name):
        executable = str(Path(java_home) / "bin" / (name + suffix)) if java_home else shutil.which(name)
        assert executable, f"Install Java 21 and put {name} on PATH"
        return executable

    def run(*command):
        subprocess.run(list(map(str, command)), check=True)

    source = Path(__file__).resolve().parent
    output = args.output.resolve()
    classes, dex = output / "classes", output / "dex"
    classes.mkdir(parents=True, exist_ok=True)
    dex.mkdir(parents=True, exist_ok=True)
    unsigned, apk, key = output / "receiver-unsigned.apk", output / "receiver.apk", output / "receiver.p12"
    run(java_tool("javac"), "--release", "8", "-classpath", android, "-d", classes, source / "ShareReceiverActivity.java")
    run(java_tool("java"), "-classpath", tools / "lib/d8.jar", "com.android.tools.r8.D8", "--release",
        "--min-api", "24", "--lib", android, "--output", dex, *classes.rglob("*.class"))
    run(tools / ("aapt2" + suffix), "link", "--manifest", source / "AndroidManifest.xml", "-I", android, "-o", unsigned)
    with zipfile.ZipFile(unsigned, "a") as archive:
        archive.write(dex / "classes.dex", "classes.dex")
    try:
        run(java_tool("keytool"), "-genkeypair", "-noprompt", "-alias", "receiver", "-keystore", key,
            "-storetype", "PKCS12", "-storepass", "android", "-keypass", "android", "-keyalg", "RSA",
            "-keysize", "2048", "-validity", "2", "-dname", "CN=FinSight native verification")
        run(java_tool("java"), "-jar", tools / "lib/apksigner.jar", "sign", "--ks", key,
            "--ks-key-alias", "receiver", "--ks-pass", "pass:android", "--key-pass", "pass:android", "--out", apk, unsigned)
        run(java_tool("java"), "-jar", tools / "lib/apksigner.jar", "verify", apk)
    finally:
        key.unlink(missing_ok=True)
    print("Built native share verification receiver: " + str(apk), flush=True)


if __name__ == "__main__":
    main()
