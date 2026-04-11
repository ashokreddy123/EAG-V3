import sqlite3
from datetime import datetime

DB_FILE = "tracking.db"
today = datetime.now().strftime('%Y-%m-%d')

conn = sqlite3.connect(DB_FILE)
c = conn.cursor()

print(f"\n=== DB Contents for today ({today}) ===")
c.execute("SELECT type, name, seconds FROM usage_logs WHERE date=? ORDER BY seconds DESC", (today,))
rows = c.fetchall()
if rows:
    for r in rows:
        print(f"  [{r[0]}] {r[1]}: {r[2]}s ({round(r[2]/60,1)} min)")
else:
    print("  No usage data for today!")

print(f"\n=== Deep Work for today ===")
c.execute("SELECT seconds FROM deep_work_logs WHERE date=?", (today,))
dw = c.fetchone()
print(f"  {dw[0]}s ({round(dw[0]/60,1)} min)" if dw else "  No deep work logged today.")

conn.close()

print(f"\n=== Live tracking test (10 samples, 2s apart) ===")
import ctypes
import os
import time
from ctypes.wintypes import DWORD

BROWSER_EXES = ["chrome", "firefox", "msedge", "brave"]

for i in range(10):
    hwnd = ctypes.windll.user32.GetForegroundWindow()
    length = ctypes.windll.user32.GetWindowTextLengthW(hwnd)
    title = None
    if length > 0:
        buf = ctypes.create_unicode_buffer(length + 1)
        ctypes.windll.user32.GetWindowTextW(hwnd, buf, length + 1)
        title = buf.value

    pid = DWORD()
    ctypes.windll.user32.GetWindowThreadProcessId(hwnd, ctypes.byref(pid))
    PROCESS_QUERY_LIMITED_INFORMATION = 0x1000
    h_process = ctypes.windll.kernel32.OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, False, pid)
    exe_name = None
    if h_process:
        exe_buf = ctypes.create_unicode_buffer(260)
        size = DWORD(260)
        success = ctypes.windll.kernel32.QueryFullProcessImageNameW(h_process, 0, exe_buf, ctypes.byref(size))
        if success:
            exe_name = os.path.basename(exe_buf.value).split('.exe')[0]
        ctypes.windll.kernel32.CloseHandle(h_process)

    app_lower = exe_name.lower() if exe_name else ""
    is_browser = any(b in app_lower for b in BROWSER_EXES)
    print(f"  [{i+1}] exe={exe_name} | browser={is_browser} | title={title[:60] if title else 'None'}...")
    time.sleep(2)
