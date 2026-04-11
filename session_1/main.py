import webview
import threading
import time
import os
import shutil
import ctypes
import db_manager
from datetime import datetime
from ctypes.wintypes import DWORD

BROWSERS = ["Google Chrome", "Mozilla Firefox", "Microsoft Edge", "Brave"]
BROWSER_EXES = ["chrome", "firefox", "msedge", "brave", "brave_browser"]

class Api:
    def __init__(self):
        self.timer_window = None
        self.timer_duration = 0
        # Python-side timer state (immune to window minimize/suspend)
        self._timer_running = False
        self._timer_elapsed = 0
        self._timer_thread = None
        db_manager.init_db()

    def _timer_tick(self):
        """Runs in background thread. Saves to DB every 30s. Saves remainder on stop."""
        last_saved = 0
        while self._timer_running:
            time.sleep(1)
            if self._timer_running:
                self._timer_elapsed += 1
                # Commit every 30 seconds to protect against crashes
                if self._timer_elapsed - last_saved >= 30:
                    delta = self._timer_elapsed - last_saved
                    db_manager.log_deep_work(delta)
                    last_saved = self._timer_elapsed
        
        # Thread stopping naturally — save uncommitted remainder
        remainder = self._timer_elapsed - last_saved
        if remainder > 0:
            db_manager.log_deep_work(remainder)

    def get_stats(self, time_range):
        stats = db_manager.get_stats(time_range)
        # Only show the uncommitted remainder (0-29s) — the rest is already in DB
        # This prevents double-counting the already-committed 30s chunks
        if self._timer_running and self._timer_elapsed > 0:
            uncommitted = self._timer_elapsed % 30
            if uncommitted > 0:
                today = datetime.now().strftime('%Y-%m-%d')
                found = False
                for dw in stats['deep_work']:
                    if dw['date'] == today:
                        dw['seconds'] += uncommitted
                        found = True
                        break
                if not found:
                    stats['deep_work'].append({'date': today, 'seconds': uncommitted})
        return stats

    def start_python_timer(self):
        """Starts the Python timer. Safe to call multiple times - idempotent."""
        if self._timer_running:
            # Already running - do NOT reset! This protects against double-calls
            return
        self._timer_elapsed = 0
        self._timer_running = True
        self._timer_thread = threading.Thread(target=self._timer_tick, daemon=True)
        self._timer_thread.start()

    def sync_active_timer(self, elapsed_seconds):
        """Legacy compatibility - JS can still sync its count as a fallback."""
        if elapsed_seconds > self._timer_elapsed:
            self._timer_elapsed = elapsed_seconds

    def launch_timer(self, duration_seconds):
        self.timer_duration = duration_seconds
        
        if self.timer_window:
            self.timer_window.destroy()
        
        screen_width = ctypes.windll.user32.GetSystemMetrics(0)
        screen_height = ctypes.windll.user32.GetSystemMetrics(1)
        
        window_width = 100
        window_height = 220
        
        start_x = screen_width - window_width - 40
        start_y = screen_height - window_height - 80

        self.timer_window = webview.create_window(
            'Deep Work Timer', 
            url='ui/timer.html', 
            width=window_width, 
            height=window_height, 
            x=start_x,
            y=start_y,
            frameless=True, 
            transparent=False, 
            background_color='#3d2b1f',
            on_top=True,
            js_api=self
        )

    def get_timer_duration(self):
        return self.timer_duration

    def start_drag(self):
        hwnd = ctypes.windll.user32.GetForegroundWindow()
        if hwnd:
            ctypes.windll.user32.ReleaseCapture()
            ctypes.windll.user32.SendMessageW(hwnd, 0x00A1, 2, 0)

    def close_timer(self, elapsed_seconds=0):
        # Signal thread to stop — _timer_tick saves the uncommitted remainder
        self._timer_running = False
        # Wait for the thread to finish its final save (up to 3s)
        if self._timer_thread and self._timer_thread.is_alive():
            self._timer_thread.join(timeout=3)
        # Reset in-memory counter for next session
        self._timer_elapsed = 0
            
        if self.timer_window:
            self.timer_window.destroy()
            self.timer_window = None

    def set_window_opacity(self, opacity_percent):
        try:
            hwnd = ctypes.windll.user32.FindWindowW(None, 'Deep Work Timer')
            if hwnd:
                GWL_EXSTYLE = -20
                WS_EX_LAYERED = 0x00080000
                LWA_ALPHA = 0x00000002
                
                ex_style = ctypes.windll.user32.GetWindowLongW(hwnd, GWL_EXSTYLE)
                ctypes.windll.user32.SetWindowLongW(hwnd, GWL_EXSTYLE, ex_style | WS_EX_LAYERED)
                
                alpha = int(255 * (opacity_percent / 100.0))
                ctypes.windll.user32.SetLayeredWindowAttributes(hwnd, 0, alpha, LWA_ALPHA)
        except Exception as e:
            print("Opacity set error:", e)

    def minimize_timer(self):
        if self.timer_window:
            self.timer_window.minimize()

    def notify_complete(self, elapsed_seconds=0):
        """Fire a Windows toast notification announcing session completion."""
        import subprocess
        mins = round(elapsed_seconds / 60)
        msg = f"You completed {mins} minutes of deep work! Great job!"
        ps_script = f'''
$ErrorActionPreference = 'SilentlyContinue'
[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType=WindowsRuntime] | Out-Null
$template = [Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent(
    [Windows.UI.Notifications.ToastTemplateType]::ToastText02)
$xml = [xml]$template.GetXml()
$xml.GetElementsByTagName("text")[0].AppendChild($xml.CreateTextNode("Deep Work Complete! 🎉")) | Out-Null
$xml.GetElementsByTagName("text")[1].AppendChild($xml.CreateTextNode("{msg}")) | Out-Null
$xDoc = New-Object Windows.Data.Xml.Dom.XmlDocument
$xDoc.LoadXml($xml.OuterXml)
$toast = [Windows.UI.Notifications.ToastNotification]::new($xDoc)
[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier("Deep Work Tracker").Show($toast)
'''
        try:
            subprocess.Popen(
                ['powershell', '-WindowStyle', 'Hidden', '-Command', ps_script],
                creationflags=0x08000000  # CREATE_NO_WINDOW
            )
        except Exception as e:
            print(f"[Notify] Error: {e}")

    def restart_timer(self):
        pass

def get_active_app_info():
    hwnd = ctypes.windll.user32.GetForegroundWindow()
    if not hwnd: return None, None
    
    # Get Window Title
    length = ctypes.windll.user32.GetWindowTextLengthW(hwnd)
    title = None
    if length > 0:
        buf = ctypes.create_unicode_buffer(length + 1)
        ctypes.windll.user32.GetWindowTextW(hwnd, buf, length + 1)
        title = buf.value

    # Get Process ID
    pid = DWORD()
    ctypes.windll.user32.GetWindowThreadProcessId(hwnd, ctypes.byref(pid))
    
    # Open Process to get exe name
    PROCESS_QUERY_LIMITED_INFORMATION = 0x1000
    h_process = ctypes.windll.kernel32.OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, False, pid)
    
    exe_name = None
    if h_process:
        exe_buf = ctypes.create_unicode_buffer(260)
        size = DWORD(260)
        success = ctypes.windll.kernel32.QueryFullProcessImageNameW(h_process, 0, exe_buf, ctypes.byref(size))
        if success:
            exe_path = exe_buf.value
            exe_name = os.path.basename(exe_path).split('.exe')[0]
        ctypes.windll.kernel32.CloseHandle(h_process)
        
    return title, exe_name

def get_clean_app_name(exe_name, title):
    app_lower = exe_name.lower()
    title_lower = title.lower() if title else ""
    
    KNOWN_EXES = {
        "code": "VS Code",
        "msedge": "Microsoft Edge",
        "chrome": "Google Chrome",
        "firefox": "Mozilla Firefox",
        "explorer": "File Explorer",
        "mintty": "Git Bash",
        "bash": "Git Bash",
        "windowsterminal": "Windows Terminal",
        "pycharm64": "PyCharm",
        "idea64": "IntelliJ IDEA",
        "excel": "Microsoft Excel",
        "winword": "Microsoft Word",
        "powerpnt": "Microsoft PowerPoint"
    }
    
    if app_lower in KNOWN_EXES:
        return KNOWN_EXES[app_lower]
        
    # UWP UI Apps
    if app_lower in ("applicationframehost", "shellexperiencehost", "systemsettings"):
        if title:
            return title.split(' - ')[-1].strip()
            
    # Generic Process Hosts and Terminals
    if app_lower in ("cmd", "powershell", "python", "conhost"):
        if "mingw" in title_lower or "git bash" in title_lower: return "Git Bash"
        if "powershell" in title_lower: return "PowerShell"
        if ("python" in title_lower) or (app_lower == "python"): return "Python Console"
        return "Terminal"
        
    # Look for Anti Gravity in the window title
    if "antigravity" in title_lower or app_lower == "antigravity":
        return "Anti Gravity"
        
    # Catch standard app patterns
    if title and " - " in title:
        page, app = title.rsplit(' - ', 1)
        if app.lower() in KNOWN_EXES:
            return KNOWN_EXES[app.lower()]
            
    # Final fallback bins unmapped apps to 'Others'
    return "Others"

def get_app_bin(exe_name, title):
    """Maps exe/title to strict explicit app bins. Everything else -> Others."""
    app_lower = exe_name.lower() if exe_name else ""
    title_lower = title.lower() if title else ""
    
    if app_lower in ("chrome",): return "Chrome"
    if app_lower in ("firefox",): return "Mozilla Firefox"
    if app_lower in ("msedge",): return "Microsoft Edge"
    if app_lower in ("code",): return "VS Code"
    if app_lower in ("explorer",): return "File Explorer"
    if app_lower in ("telegram", "telegramdesktop"): return "Telegram"
    if app_lower in ("mintty", "bash"): return "Git Bash"
    if "antigravity" in app_lower or "antigravity" in title_lower: return "Anti Gravity"
    
    # Terminal/shell resolution by title
    if app_lower in ("cmd", "conhost", "windowsterminal", "powershell"):
        if "mingw" in title_lower or "git bash" in title_lower: return "Git Bash"
        return "Others"
    
    # Everything else is Others
    return "Others"

def get_website_bin(title):
    t = title.lower() if title else ""
    if "youtube" in t: return "YouTube"
    if "gmail" in t: return "Gmail"
    # OTT platforms — match by domain keyword OR by streaming content patterns
    # Note: platforms like Hotstar show content titles, NOT their domain in the tab
    OTT_KEYWORDS = [
        # Domain/brand keywords (appear if user is on homepage or search)
        "netflix", "hotstar", "jio cinema", "jiosaavn", "prime video",
        "amazon prime", "aha video", "sony liv", "zee5", "voot", "mxplayer",
        # Content-type keywords (appear in actual stream pages)
        "tata ipl", "ipl 2026", "ipl 2025", " ipl ", "ipl|",
        "live streaming", "watch live", "live video streaming",
        "t20", "cricket live", "live cricket",
    ]
    if any(x in t for x in OTT_KEYWORDS): return "OTT"
    if "linkedin" in t: return "LinkedIn"
    if "canvas" in t: return "Canvas"
    if "chatgpt" in t: return "ChatGPT"
    if "notion" in t: return "Notion"
    if "cricbuzz" in t: return "Cricbuzz"
    return "Others"

def track_usage():
    while True:
        try:
            title, exe_name = get_active_app_info()
            if not exe_name:
                time.sleep(2)
                continue
                
            app_lower = exe_name.lower() if exe_name else ""
            is_browser = any(b in app_lower for b in BROWSER_EXES)
            app_bin = get_app_bin(exe_name, title)
            
            if is_browser and title:
                # Log content category for the Websites chart
                domain = get_website_bin(title)
                db_manager.log_usage("website", domain, 2)
                # Also log the browser itself for the Apps chart
                db_manager.log_usage("app", app_bin, 2)
            else:
                db_manager.log_usage("app", app_bin, 2)
                
        except Exception as e:
            print("Tracker error:", e)
        time.sleep(2)

BACKUP_DIR = "backups"
BACKUP_RETAIN_DAYS = 7

def backup_db():
    """Copy tracking.db to backups/ folder with today's date stamp."""
    try:
        os.makedirs(BACKUP_DIR, exist_ok=True)
        today = datetime.now().strftime('%Y-%m-%d')
        backup_path = os.path.join(BACKUP_DIR, f"tracking_{today}.db")
        if not os.path.exists(db_manager.DB_FILE):
            return
        shutil.copy2(db_manager.DB_FILE, backup_path)
        print(f"[Backup] Saved → {backup_path}")
        # Remove backups older than BACKUP_RETAIN_DAYS days
        for fname in os.listdir(BACKUP_DIR):
            fpath = os.path.join(BACKUP_DIR, fname)
            if os.path.isfile(fpath):
                age_days = (datetime.now() - datetime.fromtimestamp(os.path.getmtime(fpath))).days
                if age_days > BACKUP_RETAIN_DAYS:
                    os.remove(fpath)
                    print(f"[Backup] Removed old backup: {fname}")
    except Exception as e:
        print(f"[Backup] Error: {e}")

def run_daily_backup():
    """Background thread: backup on startup, then every 24 hours."""
    backup_db()
    while True:
        time.sleep(24 * 60 * 60)
        backup_db()

if __name__ == '__main__':
    # Ensure ui directory exists
    os.makedirs('ui', exist_ok=True)
    db_manager.init_db()
    
    tracker_thread = threading.Thread(target=track_usage, daemon=True)
    tracker_thread.start()

    backup_thread = threading.Thread(target=run_daily_backup, daemon=True)
    backup_thread.start()

    api = Api()
    window = webview.create_window(
        'Deep Work Tracker Dashboard', 
        url='ui/dashboard.html', 
        width=1100, 
        height=800, 
        js_api=api
    )
    webview.start(debug=True)
