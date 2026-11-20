// Meme Mixer tray launcher / installer / updater.
// Built with the C# compiler that ships with Windows (.NET Framework 4.x, C# 5) by build.ps1.
//
// Run from anywhere (e.g. Downloads): installs itself into %LOCALAPPDATA%\MemeMixer and starts.
// Installed: shows a tray icon, downloads Node.js on first run, unpacks the web app that is
// embedded in this exe, runs it hidden, and offers Open / Run at startup / Updates / Exit.
using System;
using System.Collections;
using System.Collections.Generic;
using System.ComponentModel;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.IO.Compression;
using System.Net;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;
using System.Windows.Forms;
using Microsoft.Win32;

[assembly: AssemblyTitle("Meme Mixer")]
[assembly: AssemblyProduct("Meme Mixer")]
[assembly: AssemblyDescription("Meme Mixer - Biamp Tesira headphone mixer")]
[assembly: AssemblyVersion(BuildInfo.Version + ".0")]
[assembly: AssemblyFileVersion(BuildInfo.Version + ".0")]

static class Paths
{
    public static readonly string Home = Env("MEMEMIXER_HOME", Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "MemeMixer"));
    public static readonly string Exe = Path.Combine(Home, "MemeMixer.exe");
    public static readonly string OldExe = Path.Combine(Home, "MemeMixer.old.exe");
    public static readonly string NewExe = Path.Combine(Home, "MemeMixer.new.exe");
    public static readonly string NodeDir = Path.Combine(Home, "node");
    public static readonly string NodeExe = Path.Combine(NodeDir, "node.exe");
    public static readonly string AppDir = Path.Combine(Home, "app");
    public static readonly string DataDir = Path.Combine(Home, "data");
    public static readonly string ServerLog = Path.Combine(DataDir, "server.log");
    public static readonly string TrayLog = Path.Combine(DataDir, "tray.log");
    public static readonly string ApiBase = Env("MEMEMIXER_API", "https://api.github.com").TrimEnd('/');
    public static readonly string NodeDist = Env("MEMEMIXER_NODE_DIST", "https://nodejs.org/dist").TrimEnd('/');
    public const string MutexName = "Local\\MemeMixer.Tray";
    public const string QuitEventName = "Local\\MemeMixer.Quit";
    public const string RunKey = @"Software\Microsoft\Windows\CurrentVersion\Run";
    public const string UninstallKey = @"Software\Microsoft\Windows\CurrentVersion\Uninstall\MemeMixer";
    public const string AppName = "Meme Mixer";
    // For testing: don't create shortcuts / startup / Apps & Features entries.
    public static readonly bool NoSystem = Environment.GetEnvironmentVariable("MEMEMIXER_NO_SYSTEM") == "1";

    static string Env(string name, string def)
    {
        string v = Environment.GetEnvironmentVariable(name);
        return string.IsNullOrEmpty(v) ? def : v;
    }

    public static void Log(string msg)
    {
        try
        {
            Directory.CreateDirectory(DataDir);
            File.AppendAllText(TrayLog, DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss") + "  " + msg + Environment.NewLine);
        }
        catch { }
    }
}

static class Program
{
    [STAThread]
    static int Main(string[] args)
    {
        ServicePointManager.SecurityProtocol |= (SecurityProtocolType)3072; // TLS 1.2
        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);
        List<string> a = new List<string>(args);

        if (a.Contains("--uninstall")) { Installer.Uninstall(a.Contains("--quiet")); return 0; }

        string self = Path.GetFullPath(Assembly.GetExecutingAssembly().Location);
        if (!string.Equals(self, Path.GetFullPath(Paths.Exe), StringComparison.OrdinalIgnoreCase))
        {
            return Installer.InstallFrom(self) ? 0 : 1;
        }

        bool created;
        Mutex mutex = new Mutex(true, Paths.MutexName, out created);
        if (!created)
        {
            // Started again while running, or a fresh update waiting for the old copy to exit.
            if (a.Contains("--updated") || a.Contains("--first-run"))
            {
                try { created = mutex.WaitOne(20000); } catch (AbandonedMutexException) { created = true; }
            }
            if (!created)
            {
                if (!a.Contains("--startup")) Util.OpenUi();
                return 0;
            }
        }

        try
        {
            Application.Run(new TrayApp(a.Contains("--first-run"), a.Contains("--updated"), a.Contains("--startup")));
        }
        catch (Exception ex)
        {
            Paths.Log("fatal: " + ex);
            MessageBox.Show("Meme Mixer stopped because of an error:\n\n" + ex.Message, Paths.AppName, MessageBoxButtons.OK, MessageBoxIcon.Error);
        }
        finally
        {
            try { mutex.ReleaseMutex(); } catch { }
            GC.KeepAlive(mutex);
        }
        return 0;
    }
}

static class Util
{
    public static int WebPort()
    {
        try
        {
            string cfg = Path.Combine(Paths.DataDir, "config.json");
            if (File.Exists(cfg))
            {
                Dictionary<string, object> c = Json.Obj(File.ReadAllText(cfg));
                Dictionary<string, object> web = c != null && c.ContainsKey("web") ? c["web"] as Dictionary<string, object> : null;
                if (web != null && web.ContainsKey("port")) return Convert.ToInt32(web["port"]);
            }
        }
        catch { }
        return 8080;
    }

    public static string UiUrl() { return "http://localhost:" + WebPort() + "/"; }

    public static void OpenUi()
    {
        try { Process.Start(UiUrl()); }
        catch (Exception ex) { MessageBox.Show("Couldn't open the browser: " + ex.Message + "\n\nOpen " + UiUrl() + " yourself.", Paths.AppName); }
    }

    public static bool ServerAnswers()
    {
        try
        {
            HttpWebRequest r = (HttpWebRequest)WebRequest.Create("http://127.0.0.1:" + WebPort() + "/api/state");
            r.Timeout = 1500;
            r.Proxy = null;
            using (HttpWebResponse resp = (HttpWebResponse)r.GetResponse()) return resp.StatusCode == HttpStatusCode.OK;
        }
        catch { return false; }
    }

    public static bool IsTrayRunning()
    {
        try { using (Mutex m = Mutex.OpenExisting(Paths.MutexName)) return true; }
        catch { return false; }
    }

    // Ask a running tray instance to exit and wait for it.
    public static bool StopRunningTray(int timeoutMs)
    {
        if (!IsTrayRunning()) return true;
        try { using (EventWaitHandle e = EventWaitHandle.OpenExisting(Paths.QuitEventName)) e.Set(); } catch { }
        Stopwatch sw = Stopwatch.StartNew();
        while (sw.ElapsedMilliseconds < timeoutMs)
        {
            if (!IsTrayRunning()) return true;
            Thread.Sleep(200);
        }
        return !IsTrayRunning();
    }

    public static string Get(string url, string accept)
    {
        HttpWebRequest r = (HttpWebRequest)WebRequest.Create(url);
        r.UserAgent = "MemeMixer-Updater";
        if (accept != null) r.Accept = accept;
        r.Timeout = 20000;
        using (WebResponse resp = r.GetResponse())
        using (StreamReader sr = new StreamReader(resp.GetResponseStream(), Encoding.UTF8))
            return sr.ReadToEnd();
    }

    public static void Download(string url, string dest, Action<int> progress)
    {
        HttpWebRequest r = (HttpWebRequest)WebRequest.Create(url);
        r.UserAgent = "MemeMixer-Updater";
        r.Timeout = 30000;
        r.ReadWriteTimeout = 60000;
        string tmp = dest + ".part";
        using (WebResponse resp = r.GetResponse())
        using (Stream src = resp.GetResponseStream())
        using (FileStream fs = File.Create(tmp))
        {
            long total = resp.ContentLength, done = 0;
            byte[] buf = new byte[81920];
            int n, lastPct = -1;
            while ((n = src.Read(buf, 0, buf.Length)) > 0)
            {
                fs.Write(buf, 0, n);
                done += n;
                if (total > 0 && progress != null)
                {
                    int pct = (int)(done * 100 / total);
                    if (pct != lastPct) { lastPct = pct; progress(pct); }
                }
            }
        }
        if (File.Exists(dest)) File.Delete(dest);
        File.Move(tmp, dest);
    }

    public static string Sha256(string file)
    {
        using (SHA256 sha = SHA256.Create())
        using (FileStream fs = File.OpenRead(file))
        {
            byte[] h = sha.ComputeHash(fs);
            StringBuilder sb = new StringBuilder();
            foreach (byte b in h) sb.Append(b.ToString("x2"));
            return sb.ToString();
        }
    }

    public static Version ParseVersion(string s)
    {
        if (s == null) return new Version(0, 0, 0);
        s = s.Trim().TrimStart('v', 'V');
        int dash = s.IndexOfAny(new char[] { '-', '+' });
        if (dash >= 0) s = s.Substring(0, dash);
        string[] p = s.Split('.');
        int[] n = new int[3];
        for (int i = 0; i < 3 && i < p.Length; i++) int.TryParse(p[i], out n[i]);
        return new Version(n[0], n[1], n[2]);
    }

    public static void CreateShortcut(string lnkPath, string target, string args, string description)
    {
        Type t = Type.GetTypeFromProgID("WScript.Shell");
        object sh = Activator.CreateInstance(t);
        try
        {
            object lnk = t.InvokeMember("CreateShortcut", BindingFlags.InvokeMethod, null, sh, new object[] { lnkPath });
            Type lt = lnk.GetType();
            lt.InvokeMember("TargetPath", BindingFlags.SetProperty, null, lnk, new object[] { target });
            lt.InvokeMember("Arguments", BindingFlags.SetProperty, null, lnk, new object[] { args ?? "" });
            lt.InvokeMember("WorkingDirectory", BindingFlags.SetProperty, null, lnk, new object[] { Path.GetDirectoryName(target) });
            lt.InvokeMember("Description", BindingFlags.SetProperty, null, lnk, new object[] { description });
            lt.InvokeMember("IconLocation", BindingFlags.SetProperty, null, lnk, new object[] { target + ",0" });
            lt.InvokeMember("Save", BindingFlags.InvokeMethod, null, lnk, null);
            Marshal.FinalReleaseComObject(lnk);
        }
        finally { Marshal.FinalReleaseComObject(sh); }
    }
}

static class Json
{
    static JavaScriptSerializer Ser() { JavaScriptSerializer s = new JavaScriptSerializer(); s.MaxJsonLength = int.MaxValue; return s; }
    public static Dictionary<string, object> Obj(string json) { return Ser().DeserializeObject(json) as Dictionary<string, object>; }
    public static object Any(string json) { return Ser().DeserializeObject(json); }
    public static string Str(Dictionary<string, object> o, string k) { object v; return o != null && o.TryGetValue(k, out v) && v != null ? v.ToString() : null; }
}

// Kills node.exe automatically if the tray process dies for any reason.
static class Job
{
    [StructLayout(LayoutKind.Sequential)]
    struct BASIC { public long PerProcessUserTimeLimit, PerJobUserTimeLimit; public uint LimitFlags; public UIntPtr MinimumWorkingSetSize, MaximumWorkingSetSize; public uint ActiveProcessLimit; public UIntPtr Affinity; public uint PriorityClass, SchedulingClass; }
    [StructLayout(LayoutKind.Sequential)]
    struct IO { public ulong a, b, c, d, e, f; }
    [StructLayout(LayoutKind.Sequential)]
    struct EXTENDED { public BASIC Basic; public IO Io; public UIntPtr ProcessMemoryLimit, JobMemoryLimit, PeakProcessMemoryUsed, PeakJobMemoryUsed; }

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] static extern IntPtr CreateJobObject(IntPtr a, string name);
    [DllImport("kernel32.dll")] static extern bool SetInformationJobObject(IntPtr job, int cls, ref EXTENDED info, int len);
    [DllImport("kernel32.dll")] static extern bool AssignProcessToJobObject(IntPtr job, IntPtr proc);

    static IntPtr handle = IntPtr.Zero;

    public static void Add(Process p)
    {
        try
        {
            if (handle == IntPtr.Zero)
            {
                handle = CreateJobObject(IntPtr.Zero, null);
                EXTENDED info = new EXTENDED();
                info.Basic.LimitFlags = 0x2000; // JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
                SetInformationJobObject(handle, 9, ref info, Marshal.SizeOf(typeof(EXTENDED)));
            }
            AssignProcessToJobObject(handle, p.Handle);
        }
        catch (Exception ex) { Paths.Log("job object: " + ex.Message); }
    }
}

static class Installer
{
    // Copies this exe into the install folder and starts the installed copy.
    public static bool InstallFrom(string self)
    {
        try
        {
            Directory.CreateDirectory(Paths.Home);
            bool wasInstalled = File.Exists(Paths.Exe);
            if (!Util.StopRunningTray(15000))
            {
                MessageBox.Show("Meme Mixer is running and couldn't be closed. Exit it from the tray icon and run this again.", Paths.AppName, MessageBoxButtons.OK, MessageBoxIcon.Warning);
                return false;
            }
            try { if (File.Exists(Paths.OldExe)) File.Delete(Paths.OldExe); } catch { }
            if (File.Exists(Paths.Exe))
            {
                try { File.Delete(Paths.Exe); }
                catch { File.Move(Paths.Exe, Paths.OldExe); }
            }
            File.Copy(self, Paths.Exe, true);
            Process.Start(new ProcessStartInfo(Paths.Exe, wasInstalled ? "--updated" : "--first-run") { UseShellExecute = false, WorkingDirectory = Paths.Home });
            return true;
        }
        catch (Exception ex)
        {
            MessageBox.Show("Couldn't install Meme Mixer:\n\n" + ex.Message, Paths.AppName, MessageBoxButtons.OK, MessageBoxIcon.Error);
            return false;
        }
    }

    public static string StartMenuLink { get { return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Programs), "Meme Mixer.lnk"); } }
    public static string DesktopLink { get { return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory), "Meme Mixer.lnk"); } }

    public static void CreateShortcuts()
    {
        try { Util.CreateShortcut(StartMenuLink, Paths.Exe, "", "Meme Mixer - Tesira headphone mixer"); } catch (Exception ex) { Paths.Log("start menu shortcut: " + ex.Message); }
        try { Util.CreateShortcut(DesktopLink, Paths.Exe, "", "Meme Mixer - Tesira headphone mixer"); } catch (Exception ex) { Paths.Log("desktop shortcut: " + ex.Message); }
    }

    public static void RegisterUninstall()
    {
        try
        {
            using (RegistryKey k = Registry.CurrentUser.CreateSubKey(Paths.UninstallKey))
            {
                k.SetValue("DisplayName", Paths.AppName);
                k.SetValue("DisplayVersion", BuildInfo.Version);
                k.SetValue("Publisher", Paths.AppName);
                k.SetValue("DisplayIcon", Paths.Exe + ",0");
                k.SetValue("InstallLocation", Paths.Home);
                k.SetValue("UninstallString", "\"" + Paths.Exe + "\" --uninstall");
                k.SetValue("QuietUninstallString", "\"" + Paths.Exe + "\" --uninstall --quiet");
                k.SetValue("NoModify", 1, RegistryValueKind.DWord);
                k.SetValue("NoRepair", 1, RegistryValueKind.DWord);
                k.SetValue("EstimatedSize", 90000, RegistryValueKind.DWord);
            }
        }
        catch (Exception ex) { Paths.Log("uninstall entry: " + ex.Message); }
    }

    public static bool RunAtStartup
    {
        get
        {
            using (RegistryKey k = Registry.CurrentUser.OpenSubKey(Paths.RunKey)) return k != null && k.GetValue(Paths.AppName) != null;
        }
        set
        {
            using (RegistryKey k = Registry.CurrentUser.CreateSubKey(Paths.RunKey))
            {
                if (value) k.SetValue(Paths.AppName, "\"" + Paths.Exe + "\" --startup");
                else k.DeleteValue(Paths.AppName, false);
            }
        }
    }

    // Allow phones on the network to reach node.exe (asks for admin once).
    public static void AddFirewallRule()
    {
        if (Environment.GetEnvironmentVariable("MEMEMIXER_NO_FIREWALL") == "1") return;
        try
        {
            ProcessStartInfo psi = new ProcessStartInfo("netsh",
                "advfirewall firewall add rule name=\"Meme Mixer\" dir=in action=allow enable=yes profile=private,domain program=\"" + Paths.NodeExe + "\"");
            psi.Verb = "runas";
            psi.UseShellExecute = true;
            psi.WindowStyle = ProcessWindowStyle.Hidden;
            Process p = Process.Start(psi);
            if (p != null) p.WaitForExit(15000);
        }
        catch (Win32Exception) { Paths.Log("firewall rule declined"); }
        catch (Exception ex) { Paths.Log("firewall rule: " + ex.Message); }
    }

    public static void Uninstall(bool quiet)
    {
        if (!quiet && MessageBox.Show("Remove Meme Mixer from this PC?\n\nThis also deletes its settings and scenes.", Paths.AppName,
                MessageBoxButtons.YesNo, MessageBoxIcon.Question) != DialogResult.Yes) return;
        Util.StopRunningTray(15000);
        try { RunAtStartup = false; } catch { }
        try { Registry.CurrentUser.DeleteSubKeyTree(Paths.UninstallKey, false); } catch { }
        try { File.Delete(StartMenuLink); } catch { }
        try { File.Delete(DesktopLink); } catch { }
        if (!quiet && Environment.GetEnvironmentVariable("MEMEMIXER_NO_FIREWALL") != "1")
        {
            try
            {
                ProcessStartInfo psi = new ProcessStartInfo("netsh", "advfirewall firewall delete rule name=\"Meme Mixer\"");
                psi.Verb = "runas"; psi.UseShellExecute = true; psi.WindowStyle = ProcessWindowStyle.Hidden;
                Process p = Process.Start(psi); if (p != null) p.WaitForExit(15000);
            }
            catch { }
        }
        // This exe lives in the folder being removed, so delete it after we exit.
        ProcessStartInfo del = new ProcessStartInfo("cmd.exe", "/c ping 127.0.0.1 -n 3 >nul & rmdir /s /q \"" + Paths.Home + "\"");
        del.CreateNoWindow = true; del.UseShellExecute = false; del.WorkingDirectory = Path.GetTempPath();
        Process.Start(del);
        if (!quiet) MessageBox.Show("Meme Mixer has been removed.", Paths.AppName);
    }
}

class SetupForm : Form
{
    Label status = new Label();
    ProgressBar bar = new ProgressBar();

    public SetupForm()
    {
        Text = "Meme Mixer setup";
        FormBorderStyle = FormBorderStyle.FixedDialog;
        MaximizeBox = false; MinimizeBox = false;
        StartPosition = FormStartPosition.CenterScreen;
        ClientSize = new Size(420, 130);
        BackColor = Color.FromArgb(18, 21, 29);
        ForeColor = Color.White;
        Font = new Font("Segoe UI", 9.5f);
        try { Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath); } catch { }
        Label title = new Label();
        title.Text = "Setting up Meme Mixer";
        title.Font = new Font("Segoe UI Semibold", 13f);
        title.AutoSize = true; title.Location = new Point(20, 16);
        status.AutoSize = false; status.Location = new Point(22, 52); status.Size = new Size(380, 22);
        status.ForeColor = Color.FromArgb(170, 178, 195);
        bar.Location = new Point(22, 84); bar.Size = new Size(376, 14); bar.Style = ProgressBarStyle.Marquee;
        Controls.Add(title); Controls.Add(status); Controls.Add(bar);
        ShowInTaskbar = true;
    }

    public void SetStatus(string text, int pct)
    {
        status.Text = text;
        if (pct < 0) { bar.Style = ProgressBarStyle.Marquee; }
        else { bar.Style = ProgressBarStyle.Continuous; bar.Value = Math.Max(0, Math.Min(100, pct)); }
    }
}

class UpdateInfo
{
    public Version Version;
    public string Tag, Url, Sha256, Notes;
}

class TrayApp : ApplicationContext
{
    readonly NotifyIcon tray = new NotifyIcon();
    readonly Control ui = new Control();
    readonly ToolStripMenuItem openItem, startupItem, updateItem, statusItem;
    readonly bool firstRun, updated, startup;
    SetupForm setupForm;
    Process server;
    bool stopping, busy;
    readonly object logLock = new object();
    StreamWriter serverLog;
    readonly List<DateTime> crashes = new List<DateTime>();
    UpdateInfo pending;
    string balloonAction;
    string notifiedVersion;
    System.Windows.Forms.Timer updateTimer;

    public TrayApp(bool firstRun, bool updated, bool startup)
    {
        this.firstRun = firstRun; this.updated = updated; this.startup = startup;
        IntPtr forceHandle = ui.Handle; // BeginInvoke target for background threads

        ContextMenuStrip menu = new ContextMenuStrip();
        openItem = new ToolStripMenuItem("Open Meme Mixer", null, delegate { Util.OpenUi(); });
        openItem.Font = new Font(openItem.Font, FontStyle.Bold);
        startupItem = new ToolStripMenuItem("Run when Windows starts", null, delegate { ToggleStartup(); });
        updateItem = new ToolStripMenuItem("Check for updates", null, delegate { UpdateClicked(); });
        statusItem = new ToolStripMenuItem("Starting…") { Enabled = false };
        menu.Items.Add(openItem);
        menu.Items.Add(new ToolStripSeparator());
        menu.Items.Add(startupItem);
        menu.Items.Add(updateItem);
        menu.Items.Add(new ToolStripMenuItem("Open log folder", null, delegate { try { Process.Start(Paths.DataDir); } catch { } }));
        menu.Items.Add(new ToolStripSeparator());
        menu.Items.Add(statusItem);
        menu.Items.Add(new ToolStripMenuItem("Version " + BuildInfo.Version) { Enabled = false });
        menu.Items.Add(new ToolStripSeparator());
        menu.Items.Add(new ToolStripMenuItem("Exit", null, delegate { ExitApp(); }));
        menu.Opening += delegate { try { startupItem.Checked = Installer.RunAtStartup; } catch { } };

        try { tray.Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath); } catch { tray.Icon = SystemIcons.Application; }
        tray.Text = "Meme Mixer";
        tray.ContextMenuStrip = menu;
        tray.DoubleClick += delegate { Util.OpenUi(); };
        tray.BalloonTipClicked += delegate { BalloonClicked(); };
        tray.Visible = true;

        // Another copy (installer / uninstaller) can ask us to quit.
        Thread quitWatcher = new Thread(delegate ()
        {
            using (EventWaitHandle quit = new EventWaitHandle(false, EventResetMode.AutoReset, Paths.QuitEventName))
            {
                quit.WaitOne();
                OnUi(ExitApp);
            }
        });
        quitWatcher.IsBackground = true;
        quitWatcher.Start();

        Application.ApplicationExit += delegate { StopServer(); tray.Visible = false; };

        Directory.CreateDirectory(Paths.DataDir);
        Paths.Log("start " + BuildInfo.Version + (firstRun ? " first-run" : "") + (updated ? " updated" : "") + (startup ? " startup" : ""));
        CleanupOldExe();

        if (firstRun || !File.Exists(Paths.NodeExe))
        {
            setupForm = new SetupForm();
            setupForm.FormClosing += delegate (object s, FormClosingEventArgs e) { if (e.CloseReason == CloseReason.UserClosing && busy) e.Cancel = true; };
            setupForm.Show();
        }
        RunSetup();

        updateTimer = new System.Windows.Forms.Timer();
        updateTimer.Interval = Environment.GetEnvironmentVariable("MEMEMIXER_TEST_AUTOUPDATE") == "1" ? 5000 : 45000; // first automatic check shortly after start, then every 12 h
        updateTimer.Tick += delegate { updateTimer.Interval = 12 * 3600 * 1000; CheckForUpdates(false); };
        updateTimer.Start();
    }

    void OnUi(Action a)
    {
        try { if (ui.IsHandleCreated) ui.BeginInvoke(a); } catch { }
    }

    void Status(string text, int pct)
    {
        OnUi(delegate
        {
            statusItem.Text = text;
            tray.Text = ("Meme Mixer - " + text).Length > 63 ? "Meme Mixer" : "Meme Mixer - " + text;
            if (setupForm != null && !setupForm.IsDisposed) setupForm.SetStatus(text, pct);
        });
    }

    void Balloon(string title, string text, ToolTipIcon icon, string action)
    {
        OnUi(delegate { balloonAction = action; tray.ShowBalloonTip(8000, title, text, icon); });
    }

    void BalloonClicked()
    {
        string a = balloonAction; balloonAction = null;
        if (a == "update" && pending != null) InstallUpdate(pending);
        else if (a == "open") Util.OpenUi();
        else if (a == "log") { try { Process.Start(Paths.DataDir); } catch { } }
    }

    void CleanupOldExe()
    {
        for (int i = 0; i < 10 && File.Exists(Paths.OldExe); i++)
        {
            try { File.Delete(Paths.OldExe); } catch { Thread.Sleep(300); }
        }
        try { if (File.Exists(Paths.NewExe)) File.Delete(Paths.NewExe); } catch { }
    }

    // ------------------------------------------------------------------ setup
    void RunSetup()
    {
        busy = true;
        Thread t = new Thread(delegate ()
        {
            string error = null;
            try
            {
                EnsureApp();
                EnsureNode();
                if (firstRun && !Paths.NoSystem)
                {
                    Status("Finishing setup…", -1);
                    Installer.CreateShortcuts();
                    try { Installer.RunAtStartup = true; } catch { }
                    Installer.AddFirewallRule();
                }
                if (!Paths.NoSystem) Installer.RegisterUninstall();
            }
            catch (Exception ex) { error = ex.Message; Paths.Log("setup failed: " + ex); }

            OnUi(delegate
            {
                busy = false;
                if (error != null)
                {
                    Status("Setup failed", 0);
                    if (setupForm != null && !setupForm.IsDisposed) setupForm.Hide();
                    DialogResult r = MessageBox.Show("Meme Mixer couldn't finish setting up:\n\n" + error +
                        "\n\nCheck the internet connection and try again.", Paths.AppName, MessageBoxButtons.RetryCancel, MessageBoxIcon.Warning);
                    if (r == DialogResult.Retry) { if (setupForm != null && !setupForm.IsDisposed) setupForm.Show(); RunSetup(); }
                    else ExitApp();
                    return;
                }
                StartServer();
            });
        });
        t.IsBackground = true;
        t.Start();
    }

    // Unpack the web app embedded in this exe when it's missing or a different version.
    void EnsureApp()
    {
        string verFile = Path.Combine(Paths.AppDir, "VERSION");
        string have = File.Exists(verFile) ? File.ReadAllText(verFile).Trim() : null;
        if (have == BuildInfo.Version && File.Exists(Path.Combine(Paths.AppDir, "server.js"))) return;
        Status("Unpacking Meme Mixer " + BuildInfo.Version + "…", -1);
        string tmp = Paths.AppDir + ".tmp";
        if (Directory.Exists(tmp)) Directory.Delete(tmp, true);
        Directory.CreateDirectory(tmp);
        using (Stream s = Assembly.GetExecutingAssembly().GetManifestResourceStream("app.zip"))
        {
            if (s == null) throw new Exception("this build has no app files inside");
            using (ZipArchive zip = new ZipArchive(s, ZipArchiveMode.Read))
            {
                foreach (ZipArchiveEntry e in zip.Entries)
                {
                    string dest = Path.GetFullPath(Path.Combine(tmp, e.FullName));
                    if (!dest.StartsWith(Path.GetFullPath(tmp), StringComparison.OrdinalIgnoreCase)) continue;
                    if (e.FullName.EndsWith("/")) { Directory.CreateDirectory(dest); continue; }
                    Directory.CreateDirectory(Path.GetDirectoryName(dest));
                    e.ExtractToFile(dest, true);
                }
            }
        }
        if (Directory.Exists(Paths.AppDir)) Directory.Delete(Paths.AppDir, true);
        Directory.Move(tmp, Paths.AppDir);
        Paths.Log("app " + (have ?? "none") + " -> " + BuildInfo.Version);
    }

    // Download the current Node.js LTS (just node.exe) and check it against nodejs.org's checksums.
    void EnsureNode()
    {
        if (File.Exists(Paths.NodeExe)) return;
        Status("Finding the latest Node.js…", -1);
        string arch = RuntimeInformationArch();
        object index = Json.Any(Util.Get(Paths.NodeDist + "/index.json", null));
        string ver = null;
        foreach (object o in (IEnumerable)index)
        {
            Dictionary<string, object> d = o as Dictionary<string, object>;
            if (d == null) continue;
            object lts; d.TryGetValue("lts", out lts);
            if (lts == null || lts is bool) continue; // lts is false or a codename
            object files; d.TryGetValue("files", out files);
            bool hasZip = false;
            if (files is IEnumerable) foreach (object f in (IEnumerable)files) if (("" + f) == arch + "-zip") hasZip = true;
            if (!hasZip) continue;
            ver = Json.Str(d, "version");
            break;
        }
        if (ver == null) throw new Exception("couldn't find a Node.js download");
        string name = "node-" + ver + "-" + arch;
        string zipPath = Path.Combine(Path.GetTempPath(), name + ".zip");
        Status("Downloading Node.js " + ver + "…", 0);
        Util.Download(Paths.NodeDist + "/" + ver + "/" + name + ".zip", zipPath, delegate (int p) { Status("Downloading Node.js " + ver + "… " + p + "%", p); });
        Status("Checking the download…", -1);
        string sums = Util.Get(Paths.NodeDist + "/" + ver + "/SHASUMS256.txt", null);
        string expect = null;
        foreach (string line in sums.Split('\n'))
        {
            string[] parts = line.Trim().Split(new char[] { ' ' }, StringSplitOptions.RemoveEmptyEntries);
            if (parts.Length == 2 && parts[1] == name + ".zip") expect = parts[0].ToLowerInvariant();
        }
        string got = Util.Sha256(zipPath);
        if (expect == null || expect != got) { File.Delete(zipPath); throw new Exception("the Node.js download didn't match its checksum"); }
        Directory.CreateDirectory(Paths.NodeDir);
        using (ZipArchive zip = ZipFile.OpenRead(zipPath))
        {
            ZipArchiveEntry e = zip.GetEntry(name + "/node.exe");
            if (e == null) throw new Exception("node.exe missing from the download");
            e.ExtractToFile(Paths.NodeExe + ".tmp", true);
        }
        File.Move(Paths.NodeExe + ".tmp", Paths.NodeExe);
        File.WriteAllText(Path.Combine(Paths.NodeDir, "VERSION"), ver);
        try { File.Delete(zipPath); } catch { }
        Paths.Log("node " + ver + " installed");
    }

    static string RuntimeInformationArch()
    {
        string a = (Environment.GetEnvironmentVariable("PROCESSOR_ARCHITEW6432") ?? Environment.GetEnvironmentVariable("PROCESSOR_ARCHITECTURE") ?? "").ToUpperInvariant();
        return a == "ARM64" ? "win-arm64" : "win-x64";
    }

    // ------------------------------------------------------------------ server
    void StartServer()
    {
        stopping = false;
        try
        {
            lock (logLock)
            {
                if (serverLog != null) serverLog.Dispose();
                serverLog = new StreamWriter(new FileStream(Paths.ServerLog, FileMode.Create, FileAccess.Write, FileShare.ReadWrite), Encoding.UTF8);
                serverLog.AutoFlush = true;
            }
            ProcessStartInfo psi = new ProcessStartInfo(Paths.NodeExe, "\"" + Path.Combine(Paths.AppDir, "server.js") + "\"");
            psi.UseShellExecute = false;
            psi.CreateNoWindow = true;
            psi.WorkingDirectory = Paths.AppDir;
            psi.RedirectStandardOutput = true;
            psi.RedirectStandardError = true;
            psi.EnvironmentVariables["MIXER_DATA"] = Paths.DataDir;
            Process p = new Process();
            p.StartInfo = psi;
            p.EnableRaisingEvents = true;
            p.OutputDataReceived += delegate (object s, DataReceivedEventArgs e) { WriteLog(e.Data); };
            p.ErrorDataReceived += delegate (object s, DataReceivedEventArgs e) { WriteLog(e.Data); };
            p.Exited += delegate { OnUi(delegate { ServerExited(p); }); };
            p.Start();
            Job.Add(p);
            p.BeginOutputReadLine();
            p.BeginErrorReadLine();
            server = p;
            Status("Starting…", -1);
            WaitUntilReady();
        }
        catch (Exception ex)
        {
            Paths.Log("start server: " + ex);
            Status("Couldn't start", 0);
            if (setupForm != null && !setupForm.IsDisposed) setupForm.Close();
            MessageBox.Show("Couldn't start Meme Mixer:\n\n" + ex.Message, Paths.AppName, MessageBoxButtons.OK, MessageBoxIcon.Error);
        }
    }

    void WriteLog(string line)
    {
        if (line == null) return;
        lock (logLock) { try { if (serverLog != null) serverLog.WriteLine(line); } catch { } }
    }

    void WaitUntilReady()
    {
        Process p = server;
        Thread t = new Thread(delegate ()
        {
            Stopwatch sw = Stopwatch.StartNew();
            bool ok = false;
            while (sw.ElapsedMilliseconds < 20000 && !p.HasExited)
            {
                if (Util.ServerAnswers()) { ok = true; break; }
                Thread.Sleep(300);
            }
            OnUi(delegate
            {
                if (setupForm != null && !setupForm.IsDisposed) { setupForm.Close(); setupForm = null; }
                if (!ok) return; // ServerExited reports the problem
                Status("Running at " + Util.UiUrl(), -1);
                if (firstRun)
                {
                    Balloon("Meme Mixer is running", "It lives here in the taskbar tray. Right-click the icon to open it, set it to start with Windows, or check for updates.", ToolTipIcon.Info, "open");
                    Util.OpenUi();
                }
                else if (updated) Balloon("Meme Mixer updated", "Now running version " + BuildInfo.Version + ".", ToolTipIcon.Info, "open");
                else if (!startup) Util.OpenUi();
            });
        });
        t.IsBackground = true;
        t.Start();
    }

    void ServerExited(Process p)
    {
        if (p != server || stopping) return;
        int code = -1;
        try { code = p.ExitCode; } catch { }
        Paths.Log("server exited with code " + code);
        server = null;
        if (setupForm != null && !setupForm.IsDisposed) { setupForm.Close(); setupForm = null; }
        if (code == 2)
        {
            Status("Port " + Util.WebPort() + " in use", 0);
            Balloon("Meme Mixer couldn't start", "Port " + Util.WebPort() + " is already in use. Close the other copy of Meme Mixer (start.bat?) and choose Exit, then start it again.", ToolTipIcon.Error, "log");
            return;
        }
        crashes.Add(DateTime.Now);
        crashes.RemoveAll(delegate (DateTime d) { return (DateTime.Now - d).TotalSeconds > 60; });
        if (crashes.Count >= 4)
        {
            Status("Stopped (error)", 0);
            Balloon("Meme Mixer stopped", "It keeps stopping. Click to open the log folder (server.log).", ToolTipIcon.Error, "log");
            return;
        }
        Status("Restarting…", -1);
        System.Windows.Forms.Timer t = new System.Windows.Forms.Timer();
        t.Interval = 2000;
        t.Tick += delegate { t.Stop(); t.Dispose(); if (!stopping && server == null) StartServer(); };
        t.Start();
    }

    void StopServer()
    {
        stopping = true;
        Process p = server;
        server = null;
        if (p != null)
        {
            try { if (!p.HasExited) { p.Kill(); p.WaitForExit(5000); } } catch { }
        }
        lock (logLock) { try { if (serverLog != null) { serverLog.Dispose(); serverLog = null; } } catch { } }
    }

    // ------------------------------------------------------------------ menu actions
    void ToggleStartup()
    {
        try
        {
            bool now = !Installer.RunAtStartup;
            Installer.RunAtStartup = now;
            startupItem.Checked = now;
            Balloon("Meme Mixer", now ? "Meme Mixer will start when you sign in to Windows." : "Meme Mixer won't start with Windows.", ToolTipIcon.Info, null);
        }
        catch (Exception ex) { MessageBox.Show("Couldn't change the startup setting: " + ex.Message, Paths.AppName); }
    }

    void ExitApp()
    {
        if (updateTimer != null) updateTimer.Stop();
        StopServer();
        tray.Visible = false;
        tray.Dispose();
        if (setupForm != null && !setupForm.IsDisposed) setupForm.Close();
        ExitThread();
    }

    // ------------------------------------------------------------------ updates
    void UpdateClicked()
    {
        if (pending != null) { InstallUpdate(pending); return; }
        CheckForUpdates(true);
    }

    void CheckForUpdates(bool userAsked)
    {
        if (busy) return;
        if (BuildInfo.Repo.Length == 0 || BuildInfo.Repo.Contains("OWNER"))
        {
            if (userAsked) MessageBox.Show("Updates aren't set up in this build (no GitHub repository).", Paths.AppName);
            return;
        }
        busy = true;
        if (userAsked) { updateItem.Text = "Checking for updates…"; updateItem.Enabled = false; }
        Thread t = new Thread(delegate ()
        {
            UpdateInfo info = null; string error = null; bool none = false;
            try { info = FetchLatest(out none); }
            catch (Exception ex) { error = ex.Message; Paths.Log("update check: " + ex.Message); }
            OnUi(delegate
            {
                busy = false;
                updateItem.Enabled = true;
                updateItem.Text = "Check for updates";
                Version cur = Util.ParseVersion(BuildInfo.Version);
                if (info != null && info.Version > cur)
                {
                    pending = info;
                    updateItem.Text = "Install update " + info.Tag;
                    if (userAsked)
                    {
                        string notes = string.IsNullOrEmpty(info.Notes) ? "" : "\n\nWhat's new:\n" + (info.Notes.Length > 900 ? info.Notes.Substring(0, 900) + "…" : info.Notes);
                        if (MessageBox.Show("Meme Mixer " + info.Tag + " is available (you have " + BuildInfo.Version + ")." + notes + "\n\nInstall it now? Meme Mixer will restart.",
                                Paths.AppName, MessageBoxButtons.YesNo, MessageBoxIcon.Information) == DialogResult.Yes)
                            InstallUpdate(info);
                    }
                    else if (Environment.GetEnvironmentVariable("MEMEMIXER_TEST_AUTOUPDATE") == "1") InstallUpdate(info); // test hook
                    else if (notifiedVersion != info.Tag)
                    {
                        notifiedVersion = info.Tag;
                        Balloon("Meme Mixer update available", "Version " + info.Tag + " is ready. Click here to install it.", ToolTipIcon.Info, "update");
                    }
                }
                else if (userAsked)
                {
                    if (error != null) MessageBox.Show("Couldn't check for updates:\n\n" + error, Paths.AppName, MessageBoxButtons.OK, MessageBoxIcon.Warning);
                    else if (none) MessageBox.Show("No updates have been published yet.", Paths.AppName);
                    else MessageBox.Show("You have the latest version (" + BuildInfo.Version + ").", Paths.AppName);
                }
            });
        });
        t.IsBackground = true;
        t.Start();
    }

    UpdateInfo FetchLatest(out bool noReleases)
    {
        noReleases = false;
        string json;
        try { json = Util.Get(Paths.ApiBase + "/repos/" + BuildInfo.Repo + "/releases/latest", "application/vnd.github+json"); }
        catch (WebException ex)
        {
            HttpWebResponse r = ex.Response as HttpWebResponse;
            if (r != null && r.StatusCode == HttpStatusCode.NotFound) { noReleases = true; return null; }
            throw;
        }
        Dictionary<string, object> rel = Json.Obj(json);
        UpdateInfo info = new UpdateInfo();
        info.Tag = Json.Str(rel, "tag_name");
        info.Version = Util.ParseVersion(info.Tag);
        info.Notes = (Json.Str(rel, "body") ?? "").Replace("\r", "").Trim();
        object assets; rel.TryGetValue("assets", out assets);
        if (assets is IEnumerable)
        {
            foreach (object o in (IEnumerable)assets)
            {
                Dictionary<string, object> a = o as Dictionary<string, object>;
                if (a == null || !string.Equals(Json.Str(a, "name"), "MemeMixer.exe", StringComparison.OrdinalIgnoreCase)) continue;
                info.Url = Json.Str(a, "browser_download_url");
                string digest = Json.Str(a, "digest");
                if (digest != null && digest.StartsWith("sha256:")) info.Sha256 = digest.Substring(7).ToLowerInvariant();
            }
        }
        if (info.Url == null) throw new Exception("release " + info.Tag + " has no MemeMixer.exe");
        return info;
    }

    void InstallUpdate(UpdateInfo info)
    {
        if (busy) return;
        busy = true;
        updateItem.Enabled = false;
        Thread t = new Thread(delegate ()
        {
            string error = null;
            try
            {
                Util.Download(info.Url, Paths.NewExe, delegate (int p) { OnUi(delegate { updateItem.Text = "Downloading update… " + p + "%"; }); });
                if (info.Sha256 != null && Util.Sha256(Paths.NewExe) != info.Sha256) throw new Exception("the download didn't match its checksum");
                byte[] head = new byte[2];
                using (FileStream fs = File.OpenRead(Paths.NewExe)) fs.Read(head, 0, 2);
                if (head[0] != 'M' || head[1] != 'Z' || new FileInfo(Paths.NewExe).Length < 50000) throw new Exception("the download isn't a valid program");
            }
            catch (Exception ex) { error = ex.Message; Paths.Log("update download: " + ex); }
            OnUi(delegate
            {
                busy = false;
                updateItem.Enabled = true;
                updateItem.Text = "Install update " + info.Tag;
                if (error != null) { MessageBox.Show("Couldn't download the update:\n\n" + error, Paths.AppName, MessageBoxButtons.OK, MessageBoxIcon.Warning); return; }
                ApplyUpdate();
            });
        });
        t.IsBackground = true;
        t.Start();
    }

    // Swap in the new exe (a running exe can be renamed, not overwritten) and restart into it.
    void ApplyUpdate()
    {
        StopServer();
        try
        {
            if (File.Exists(Paths.OldExe)) File.Delete(Paths.OldExe);
            File.Move(Paths.Exe, Paths.OldExe);
            try { File.Move(Paths.NewExe, Paths.Exe); }
            catch { File.Move(Paths.OldExe, Paths.Exe); throw; }
            Paths.Log("update applied, restarting");
            Process.Start(new ProcessStartInfo(Paths.Exe, "--updated") { UseShellExecute = false, WorkingDirectory = Paths.Home });
            ExitApp();
        }
        catch (Exception ex)
        {
            Paths.Log("apply update: " + ex);
            MessageBox.Show("Couldn't install the update:\n\n" + ex.Message, Paths.AppName, MessageBoxButtons.OK, MessageBoxIcon.Warning);
            StartServer();
        }
    }
}
