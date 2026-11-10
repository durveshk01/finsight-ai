"""Exercise the signed APK through Android's real UI on a disposable emulator.

Requires an Android SDK, Python 3.12+, and a booted, rootable emulator. Clears
FinSight's data on that emulator and creates explicitly named verification data.
Native exports, screenshots, UI trees, and results are retained in --output.
No Metro server, development build, injected app state, or mocked native modules.
"""

import argparse
import csv
import hashlib
import io
import json
import os
from pathlib import Path
import re
import shlex
import shutil
import subprocess
import time
import xml.etree.ElementTree as ET
import zipfile

PACKAGE = "ai.finsight.mobile"
VERSION = "1.1.0"


class Device:
    def __init__(self, adb, serial, output):
        self.adb = adb
        self.serial = serial
        self.output = output
        self.checks = []
        self.launcher_dialogs = 0
        self.width, self.height = 1080, 1920

    def command(self, *args, binary=False, timeout=90):
        result = subprocess.run(
            [self.adb, "-s", self.serial, *map(str, args)],
            check=True, capture_output=True, timeout=timeout,
        )
        return result.stdout if binary else result.stdout.decode("utf-8", errors="replace")

    def shell(self, command):
        return self.command("shell", command)

    def nodes(self):
        self.shell("uiautomator dump --compressed /sdcard/finsight-window.xml")
        xml = self.command("exec-out", "cat", "/sdcard/finsight-window.xml")
        return list(ET.fromstring(xml).iter("node"))

    @staticmethod
    def bounds(node):
        values = list(map(int, re.findall(r"\d+", node.get("bounds", ""))))
        return values if len(values) == 4 else [0, 0, 0, 0]

    @staticmethod
    def matches(node, value, contains=False, editable=False):
        if editable and not node.get("class", "").endswith("EditText"):
            return False
        attributes = [node.get("resource-id", ""), node.get("content-desc", ""), node.get("text", "")]
        return any(value in text if contains else value == text or text.endswith("/" + value) for text in attributes)

    def find(self, value, contains=False, editable=False):
        for node in self.nodes():
            x1, y1, x2, y2 = self.bounds(node)
            # Android 15 can expose a clipped field underneath its Home/taskbar
            # control. Scroll fields fully into the form before tapping/typing.
            if editable and (y1 < self.height * 0.08 or y2 > self.height * 0.88):
                continue
            if x2 > x1 and y2 > y1 and self.matches(node, value, contains, editable):
                return node
        return None

    def swipe(self, direction):
        top, bottom = int(self.height * 0.28), int(self.height * 0.77)
        start, end = (bottom, top) if direction == "down" else (top, bottom)
        self.shell(f"input swipe {self.width // 2} {start} {self.width // 2} {end} 450")
        time.sleep(0.35)

    def locate(self, value, contains=False, editable=False, direction="down"):
        # Native screens retain their scroll position when revisited.
        for travel in [direction, "up" if direction == "down" else "down"]:
            for _ in range(9):
                node = self.find(value, contains, editable)
                if node is not None:
                    return node
                self.swipe(travel)
        raise AssertionError(f"Native UI element not found: {value}")

    def wait(self, value, contains=False, timeout=120, recover_launcher=False):
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            node = self.find(value, contains)
            if node is not None:
                return node
            if recover_launcher:
                self.close_launcher_dialog()
            time.sleep(1)
        raise AssertionError(f"Native UI did not display: {value}")

    def close_launcher_dialog(self):
        # Cold-boot launcher ANRs can cover an already running app. Recover only
        # these known emulator launchers, only at startup, retaining the evidence.
        nodes = self.nodes()
        titles = {"Quickstep isn't responding", "Pixel Launcher isn't responding",
                  "Launcher isn't responding", "Launcher3 isn't responding"}
        title = next((node for node in nodes if node.get("resource-id") == "android:id/alertTitle"
                      and node.get("text") in titles), None)
        if title is None:
            return
        assert self.launcher_dialogs < 3, "Emulator launcher repeatedly failed during startup"
        close = next((node for node in nodes if node.get("resource-id") == "android:id/aerr_close"), None)
        assert close is not None, "Emulator launcher dialog has no Close app control"
        self.launcher_dialogs += 1
        prefix = self.output / f"emulator-launcher-dialog-{self.launcher_dialogs}"
        prefix.with_suffix(".png").write_bytes(self.command("exec-out", "screencap", "-p", binary=True))
        prefix.with_suffix(".xml").write_text(self.command("exec-out", "cat", "/sdcard/finsight-window.xml"), encoding="utf-8")
        print("Recovered emulator startup dialog: " + title.get("text"), flush=True)
        self.tap_node(close)

    def tap_node(self, node, twice=False):
        if node.get("enabled") == "false":
            raise AssertionError("Attempted to tap a disabled native control")
        x1, y1, x2, y2 = self.bounds(node)
        command = f"input tap {(x1 + x2) // 2} {(y1 + y2) // 2}"
        self.shell(command + ("; " + command if twice else ""))
        time.sleep(0.35)

    def tap(self, value, direction="down", twice=False):
        self.tap_node(self.locate(value, direction=direction), twice)

    def confirm_alert(self, title, action):
        # Android themes can uppercase button text. Target the native positive
        # button, checking both the dialog title and its intended action.
        dialog = self.wait("android:id/alertTitle", timeout=30)
        assert dialog.get("text") == title, f"Unexpected native confirmation: {dialog.get('text')}"
        button = self.wait("android:id/button1", timeout=30)
        assert button.get("text", "").casefold() == action.casefold(), "Unexpected native confirmation action"
        self.tap_node(button)

    def fill(self, label, value, direction="down"):
        node = self.locate(label, editable=True, direction=direction)
        self.tap_node(node)
        delete = " ".join(["67"] * (min(len(node.get("text", "")), 256) + 3))
        self.shell("input keyevent 123 " + delete)
        if value:
            self.shell("input text " + shlex.quote(str(value).replace(" ", "%s")))
            entered = self.wait(label, timeout=30).get("text", "")
            assert entered == str(value), f"Native field {label} did not receive its intended value: {entered}"
        # mInputShown tracks the show request, even for a hidden hardware-keyboard
        # input view. Back in that state backgrounds the app or closes its form.
        ime = self.shell("dumpsys input_method")
        if "mIsInputViewShown=true" in ime and "mDecorViewVisible=true" in ime:
            self.shell("input keyevent 4")
            time.sleep(0.35)

    def choose(self, group, option):
        label = self.locate(group)
        _, y1, _, y2 = self.bounds(label)
        if y2 > self.height * 0.55:
            self.swipe("down")
            label = self.locate(group, direction="up")
        boundary = self.bounds(label)[3]
        for node in self.nodes():
            if self.matches(node, option) and self.bounds(node)[1] >= boundary:
                self.tap_node(node)
                return
        raise AssertionError(f"Native choice not found: {group} / {option}")

    def back(self):
        self.shell("input keyevent 4")
        time.sleep(0.4)

    def close_tool(self):
        # Android Back can dismiss an IME or a closing modal instead of the stack.
        self.tap_node(self.wait("Navigate up", timeout=30))
        self.wait("tab-more", timeout=30)

    def acquire_root(self):
        # Restarting adbd can close its first connection on older emulator images.
        deadline = time.monotonic() + 90
        last_error = ""
        while time.monotonic() < deadline:
            try:
                self.command("wait-for-device", timeout=15)
                if self.shell("id -u").strip() == "0":
                    return
                self.command("root", timeout=15)
                self.command("wait-for-device", timeout=15)
                if self.shell("id -u").strip() == "0":
                    return
            except subprocess.SubprocessError as error:
                details = getattr(error, "stderr", None) or getattr(error, "stdout", None) or b""
                last_error = details.decode("utf-8", errors="replace") if isinstance(details, bytes) else str(details)
                if "cannot run as root in production builds" in last_error:
                    break
            time.sleep(2)
        raise AssertionError("Use a rootable default/google_apis emulator image. " + last_error.strip())

    def cash(self, expected):
        self.tap("tab-home")
        node = self.locate("current-cash", direction="up")
        actual = re.sub(r"[^\d.-]", "", node.get("text", ""))
        assert actual == expected, f"Cash mismatch: expected {expected}, got {actual}"

    def tool(self, identifier):
        self.tap("tab-more")
        self.tap(identifier)

    def checkpoint(self, name):
        filename = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")
        self.output.joinpath(filename + ".png").write_bytes(self.command("exec-out", "screencap", "-p", binary=True))
        self.output.joinpath(filename + ".xml").write_text(self.command("exec-out", "cat", "/sdcard/finsight-window.xml"), encoding="utf-8")
        self.checks.append(name)
        print("PASS: " + name, flush=True)

    def export(self, extension):
        self.tap("export-" + extension)
        deadline = time.monotonic() + 120
        handoff = False
        mime_types = {"pdf": "application/pdf", "xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                      "csv": "text/csv", "json": "application/json"}
        while time.monotonic() < deadline:
            activities = self.shell("dumpsys activity activities")
            if re.search(r"mResumedActivity:.*(?:ChooserActivity|ResolverActivity)", activities):
                break
            # Android may auto-launch the sole share receiver instead of leaving
            # its chooser visible. Require the real ACTION_SEND with our file URI.
            resumed = re.search(r"topResumedActivity=(.*)", activities) or re.search(r"mResumedActivity:(.*)", activities)
            if resumed and PACKAGE not in resumed.group(1):
                launches = self.command("logcat", "-d", "-s", "ActivityTaskManager:I", "ActivityManager:I")
                if any("act=android.intent.action.SEND " in line and "typ=" + mime_types[extension] in line
                       and f"content://{PACKAGE}.SharingFileProvider/" in line
                       and re.search(r"\." + extension + r"\b", line) for line in launches.splitlines()):
                    self.output.joinpath("native-sharing-handoff-" + extension + ".log").write_text(launches, encoding="utf-8")
                    handoff = True
                    break
            time.sleep(1)
        else:
            raise AssertionError(f"Native {extension} sharing did not open a resolver or hand off its file URI")
        self.nodes()
        self.checkpoint("Native " + extension.upper() + (" sharing handoff" if handoff else " share sheet"))
        for _ in range(4):
            self.back()
            activities = self.shell("dumpsys activity activities")
            resumed = re.search(r"topResumedActivity=(.*)", activities) or re.search(r"mResumedActivity:(.*)", activities)
            if resumed and PACKAGE in resumed.group(1):
                break
        else:
            raise AssertionError("Native sharing did not return to FinSight")
        self.wait("Navigate up", timeout=30)
        files = self.shell(f"find /data/user/0/{PACKAGE}/cache -type f").splitlines()
        matches = [file for file in files if file.endswith("." + extension) and
                   (extension == "pdf" or file.rsplit("/", 1)[-1].startswith("FinSight-"))]
        assert matches, f"Native {extension} export did not write a real file"
        destination = self.output / ("native-export." + extension)
        self.command("pull", matches[-1], destination)
        return destination

    def pick_file(self, button, source):
        target = "/sdcard/Download/" + source.name
        self.command("push", source, target)
        self.tap(button)
        self.wait("Show roots", timeout=90)
        self.tap("Show roots")
        self.tap("Downloads")
        self.tap(source.name)


def run(device, apk):
    assert device.shell("getprop ro.kernel.qemu").strip() == "1", "Use a disposable Android emulator, not a physical device"
    device.acquire_root()
    device.command("install", "-r", apk, timeout=180)
    package = device.shell(f"dumpsys package {PACKAGE}")
    assert "versionName=" + VERSION in package and "versionCode=2" in package
    assert not re.search(r"flags=\[.*\bDEBUGGABLE\b", package), "Test the signed release APK"
    device.shell(f"pm clear {PACKAGE}")
    device.command("logcat", "-c")
    device.shell("settings put global window_animation_scale 0")
    device.shell("settings put global transition_animation_scale 0")
    device.shell("settings put global animator_duration_scale 0")
    device.shell("settings put secure show_ime_with_hard_keyboard 0")
    device.shell("svc wifi disable; svc data disable")
    sizes = re.findall(r"(\d+)x(\d+)", device.shell("wm size"))
    device.width, device.height = map(int, sizes[-1])
    device.shell(f"am start -W -n {PACKAGE}/.MainActivity")
    device.wait("create-local-workspace", timeout=180, recover_launcher=True)
    device.tap("create-local-workspace")
    device.fill("owner-name", "Verification Owner")
    device.fill("workspace-name", "Native Verification")
    device.tap("USD")
    device.fill("opening-cash", "1000")
    device.fill("minimum-reserve", "100")
    device.tap("submit-auth")
    device.wait("current-cash")
    device.cash("1000.00")
    device.checkpoint("Release startup and local workspace without internet")

    device.tool("open-settings")
    device.tap("add-account")
    device.fill("account-name", "Native bank")
    device.tap("save-account")
    device.close_tool()
    device.cash("1000.00")

    for kind, amount, description in [
        ("Income", "500.25", "Native income"),
        ("Expense", "100.10", "Native expense"),
        ("Transfer", "75.45", "Native transfer"),
    ]:
        device.tap("tab-transactions")
        device.tap("add-transaction")
        device.tap(kind)
        device.fill("transaction-amount", amount)
        device.fill("transaction-description", description)
        device.choose("From account" if kind == "Transfer" else "Account", "Operating cash")
        if kind == "Transfer":
            device.choose("To account", "Native bank")
        device.tap("save-transaction")
        device.wait("Activity ledger")
    device.cash("1400.15")
    device.tap("tab-transactions")
    device.fill("search-transactions", "Native income")
    device.wait("1 entry", contains=True)
    device.checkpoint("Income expense transfer and ledger search")
    device.fill("search-transactions", "")

    device.tool("open-invoices")
    device.tap("add-invoice")
    device.fill("invoice-number", "NATIVE-001")
    device.fill("invoice-counterparty", "Verification Customer")
    device.fill("invoice-amount", "200.75")
    device.tap("save-invoice")
    device.tap("pay-NATIVE-001")
    device.fill("payment-amount", "200.76")
    device.tap("save-payment")
    device.locate("cannot exceed the outstanding amount", contains=True, direction="up")
    device.fill("payment-amount", "50.35", direction="up")
    device.choose("Settlement account", "Operating cash")
    device.tap("save-payment", twice=True)
    # A very fast completion can let the second tap reopen the payment form.
    # Close that unsaved form before checking the persisted single posting.
    if device.find("payment-amount") is not None:
        device.tap("Close", direction="up")
    invoice_due = device.locate("invoice-due-NATIVE-001")
    assert "150.40" in invoice_due.get("text", "")
    device.checkpoint("Overpayment rejected and partial payment posted once")
    device.close_tool()
    device.cash("1450.50")

    device.tap("tab-analytics")
    device.wait("Financial analytics")
    device.locate("100.10", contains=True)
    device.locate("1 transfers excluded", contains=True)
    device.tap("Revenue")
    device.locate("TOTAL RECORDED REVENUE")
    device.locate("550.60", contains=True)
    device.checkpoint("Native financial analytics")
    device.tap("tab-forecasts")
    device.locate("Insufficient history for a statistical trend", contains=True)
    device.checkpoint("Sparse history has an obligations-only forecast")
    device.tool("open-simulator")
    device.locate("What-if sandbox")
    device.fill("scenario-capex", "100")
    projected = device.locate("scenario-closing-cash")
    assert re.sub(r"[^\d.-]", "", projected.get("text", "")) == "1500.90"
    device.checkpoint("Native scenario sandbox")
    device.close_tool()
    device.tool("open-sync")
    device.locate("intentionally local", contains=True)
    assert device.find("sync-now") is None, "Local mode must not offer a successful cloud sync"
    device.checkpoint("Local workspace reports truthful synchronization status")
    device.close_tool()

    device.tool("open-reports")
    imported = device.output / "native-import.csv"
    today = time.strftime("%Y-%m-%d")
    row = f"{today},income,Native import,25.15,Native imported,completed,Imported,,Operating cash,\n"
    imported.write_text("date,kind,category,amount,description,status,payment_method,reference,account,to_account\n" + row + row + "2025-02-29,income,Invalid date,12.00,Rejected,completed,Imported,,,\n", encoding="utf-8")
    device.pick_file("Import ledger CSV", imported)
    device.locate("1 valid new entries", contains=True)
    device.locate("1 duplicates skipped", contains=True)
    device.locate("1 invalid rows", contains=True)
    device.tap("Confirm valid CSV entries")
    device.locate("Imported 1 entries", contains=True, direction="up")
    device.checkpoint("Real CSV picker preview validation and atomic import")
    exports = {extension: device.export(extension) for extension in ["pdf", "xlsx", "csv", "json"]}
    pdf = exports["pdf"].read_bytes()
    assert pdf.startswith(b"%PDF-") and b"%%EOF" in pdf
    with zipfile.ZipFile(exports["xlsx"]) as workbook:
        root = ET.fromstring(workbook.read("xl/workbook.xml"))
        ns = {"s": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
        assert [sheet.get("name") for sheet in root.findall("s:sheets/s:sheet", ns)] == ["Summary", "Ledger", "Invoices", "Monthly"]
        assert b"1475.65" in workbook.read("xl/worksheets/sheet1.xml")
    csv_rows = list(csv.DictReader(io.StringIO(exports["csv"].read_text(encoding="utf-8-sig"))))
    assert len(csv_rows) == 5 and any(row["kind"] == "transfer" for row in csv_rows)
    backup = json.loads(exports["json"].read_text(encoding="utf-8"))
    assert backup["schema"] == "finsight.backup.v1"
    snapshot = backup["snapshot"]
    assert len(snapshot["transactions"]) == 5
    assert len([transaction for transaction in snapshot["transactions"] if transaction.get("invoice_id")]) == 1
    assert snapshot["invoices"][0]["amount_due"] == 150.40
    assert "access_token" not in backup and "token" not in snapshot
    device.close_tool()
    device.cash("1475.65")
    device.checkpoint("PDF Excel CSV and JSON contain the actual financial records")

    device.shell(f"am force-stop {PACKAGE}")
    device.shell(f"am start -W -n {PACKAGE}/.MainActivity")
    device.wait("current-cash")
    device.cash("1475.65")
    device.checkpoint("Local records and session survive an app restart")
    device.tap("tab-transactions")
    device.tap("Edit Native expense")
    device.fill("transaction-amount", "120.10")
    device.tap("save-transaction")
    device.cash("1455.65")
    device.tap("tab-transactions")
    device.tap("Edit Native expense")
    device.tap("Delete transaction")
    device.confirm_alert("Delete transaction?", "Delete")
    device.cash("1575.75")
    device.checkpoint("Transaction editing and confirmed deletion recompute cash")

    device.tool("open-reports")
    device.pick_file("Open backup as local workspace", exports["json"])
    device.confirm_alert("Open backup locally?", "Open backup")
    device.wait("current-cash")
    device.cash("1475.65")
    device.checkpoint("Actual JSON document picker restores a separate local workspace")
    device.tap("tab-more")
    device.tap("sign-out")
    device.confirm_alert("Close local workspace?", "Sign out")
    device.wait("create-local-workspace")
    device.tap("Resume Native Verification")
    device.wait("current-cash")
    device.cash("1475.65")
    device.checkpoint("Closing and resuming the local workspace preserves records")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apk", type=Path, required=True)
    parser.add_argument("--output", type=Path, default=Path("artifacts/verification"))
    parser.add_argument("--serial")
    args = parser.parse_args()
    assert args.apk.is_file(), "Build or download the signed APK first"
    sdk = os.environ.get("ANDROID_HOME") or os.environ.get("ANDROID_SDK_ROOT")
    adb = str(Path(sdk) / "platform-tools" / ("adb.exe" if os.name == "nt" else "adb")) if sdk else shutil.which("adb")
    assert adb, "Set ANDROID_HOME or add adb to PATH"
    devices = subprocess.check_output([adb, "devices"], text=True)
    available = re.findall(r"^(emulator-\d+)\s+device$", devices, re.MULTILINE)
    serial = args.serial or (available[0] if len(available) == 1 else None)
    assert serial in available, "Select one booted emulator with --serial"
    args.output.mkdir(parents=True, exist_ok=True)
    device = Device(adb, serial, args.output)
    result = {"version": VERSION, "serial": serial,
              "apk_sha256": hashlib.sha256(args.apk.read_bytes()).hexdigest(),
              "checks": device.checks, "passed": False}
    try:
        run(device, args.apk.resolve())
        errors = device.command("logcat", "-d", "-s", "ReactNativeJS:E", "AndroidRuntime:E")
        args.output.joinpath("native-errors.log").write_text(errors, encoding="utf-8")
        assert not re.search(r"FATAL EXCEPTION|ReactNativeJS.*(?:Error:|Exception|Invariant Violation)", errors), "See native-errors.log"
        result["api_level"] = device.shell("getprop ro.build.version.sdk").strip()
        result["passed"] = True
        print(f"Verified {len(device.checks)} native release workflows on Android API {result['api_level']}", flush=True)
    except Exception as error:
        result["error"] = str(error)
        try:
            device.nodes()
            args.output.joinpath("failure.png").write_bytes(device.command("exec-out", "screencap", "-p", binary=True))
            args.output.joinpath("failure.xml").write_text(device.command("exec-out", "cat", "/sdcard/finsight-window.xml"), encoding="utf-8")
            args.output.joinpath("failure-logcat.log").write_text(device.command("logcat", "-d"), encoding="utf-8")
        except Exception:
            pass
        raise
    finally:
        result["emulator_launcher_dialogs"] = device.launcher_dialogs
        args.output.joinpath("results.json").write_text(json.dumps(result, indent=2), encoding="utf-8")


if __name__ == "__main__":
    main()
