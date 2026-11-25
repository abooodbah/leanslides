// The TCP connections and UDP endpoints of a set of processes, read straight
// from the IP helper tables (GetExtendedTcpTable, GetExtendedUdpTable) for
// IPv4 and IPv6. One call takes about a millisecond, so Observe-Network.ps1
// can sample every 50 ms; Get-NetTCPConnection took up to two seconds.
using System;
using System.Collections.Generic;
using System.Net;
using System.Runtime.InteropServices;

public static class LeanSlidesNetTables
{
    [DllImport("iphlpapi.dll", SetLastError = true)]
    static extern uint GetExtendedTcpTable(IntPtr table, ref int size, bool order, int family, int tableClass, uint reserved);

    [DllImport("iphlpapi.dll", SetLastError = true)]
    static extern uint GetExtendedUdpTable(IntPtr table, ref int size, bool order, int family, int tableClass, uint reserved);

    const int AF_INET = 2, AF_INET6 = 23;
    const int TCP_TABLE_OWNER_PID_ALL = 5, UDP_TABLE_OWNER_PID = 1;

    static readonly string[] States = { "", "Closed", "Listen", "SynSent", "SynReceived", "Established",
        "FinWait1", "FinWait2", "CloseWait", "Closing", "LastAck", "TimeWait", "DeleteTcb" };

    static IntPtr Read(bool tcp, int family, out int size)
    {
        size = 0;
        for (int attempt = 0; attempt < 5; attempt++)
        {
            IntPtr buffer = size > 0 ? Marshal.AllocHGlobal(size) : IntPtr.Zero;
            uint result = tcp
                ? GetExtendedTcpTable(buffer, ref size, false, family, TCP_TABLE_OWNER_PID_ALL, 0)
                : GetExtendedUdpTable(buffer, ref size, false, family, UDP_TABLE_OWNER_PID, 0);
            if (result == 0) return buffer;
            if (buffer != IntPtr.Zero) Marshal.FreeHGlobal(buffer);
            if (result != 122) throw new InvalidOperationException("IP helper table call failed: " + result);
        }
        throw new InvalidOperationException("IP helper table kept growing");
    }

    static string Address(IntPtr row, int offset, bool v6)
    {
        if (!v6) return new IPAddress(BitConverter.GetBytes(Marshal.ReadInt32(row, offset)) ).ToString();
        byte[] bytes = new byte[16];
        Marshal.Copy(IntPtr.Add(row, offset), bytes, 0, 16);
        return new IPAddress(bytes).ToString();
    }

    static int Port(IntPtr row, int offset)
    {
        int raw = Marshal.ReadInt32(row, offset);
        return ((raw & 0xff) << 8) | ((raw >> 8) & 0xff);
    }

    static System.Threading.Thread sampler;
    static volatile bool sampling;
    static readonly Dictionary<string, long> firstSeen = new Dictionary<string, long>();
    static long largestGapMs, samples;

    // Samples every endpoint of every process on its own thread, so the
    // interval does not depend on how long PowerShell takes to read the
    // process list. Rows are kept by first-seen time in milliseconds since
    // Start; the caller filters them by process afterwards.
    public static void Start(int intervalMs)
    {
        lock (firstSeen) { firstSeen.Clear(); largestGapMs = 0; samples = 0; }
        sampling = true;
        var clock = System.Diagnostics.Stopwatch.StartNew();
        sampler = new System.Threading.Thread(() =>
        {
            long last = -1;
            while (sampling)
            {
                long now = clock.ElapsedMilliseconds;
                List<string> rows = Snapshot(null);
                lock (firstSeen)
                {
                    if (last >= 0) largestGapMs = Math.Max(largestGapMs, now - last);
                    samples++;
                    foreach (string row in rows) if (!firstSeen.ContainsKey(row)) firstSeen[row] = now;
                }
                last = now;
                System.Threading.Thread.Sleep(intervalMs);
            }
        });
        sampler.IsBackground = true;
        sampler.Start();
    }

    // Stops sampling and returns "firstSeenMs|row" lines, then the sample
    // count and the largest gap between samples as the last two lines.
    public static List<string> Stop()
    {
        sampling = false;
        sampler.Join();
        var lines = new List<string>();
        lock (firstSeen)
        {
            foreach (var pair in firstSeen) lines.Add(pair.Value + "|" + pair.Key);
            lines.Add("samples|" + samples);
            lines.Add("largestGapMs|" + largestGapMs);
        }
        return lines;
    }

    // One line per endpoint of a process in pids (every process when pids is
    // null): "tcp|pid|local|localPort|remote|remotePort|state" or
    // "udp|pid|local|localPort".
    public static List<string> Snapshot(int[] pids)
    {
        HashSet<int> wanted = pids == null ? null : new HashSet<int>(pids);
        var lines = new List<string>();
        foreach (bool v6 in new[] { false, true })
        {
            int size;
            IntPtr table = Read(true, v6 ? AF_INET6 : AF_INET, out size);
            try
            {
                int count = Marshal.ReadInt32(table);
                // MIB_TCPROW_OWNER_PID: 24 bytes; MIB_TCP6ROW_OWNER_PID: 56 bytes.
                int rowSize = v6 ? 56 : 24;
                for (int i = 0; i < count; i++)
                {
                    IntPtr row = IntPtr.Add(table, 4 + i * rowSize);
                    int pid = Marshal.ReadInt32(row, v6 ? 52 : 20);
                    if (wanted != null && !wanted.Contains(pid)) continue;
                    int state = Marshal.ReadInt32(row, v6 ? 48 : 0);
                    string local = v6 ? Address(row, 0, true) : Address(row, 4, false);
                    int localPort = Port(row, v6 ? 20 : 8);
                    string remote = v6 ? Address(row, 24, true) : Address(row, 12, false);
                    int remotePort = Port(row, v6 ? 44 : 16);
                    lines.Add(string.Join("|", "tcp", pid, local, localPort, remote, remotePort,
                        state >= 0 && state < States.Length ? States[state] : state.ToString()));
                }
            }
            finally { Marshal.FreeHGlobal(table); }

            table = Read(false, v6 ? AF_INET6 : AF_INET, out size);
            try
            {
                int count = Marshal.ReadInt32(table);
                // MIB_UDPROW_OWNER_PID: 12 bytes; MIB_UDP6ROW_OWNER_PID: 28 bytes.
                int rowSize = v6 ? 28 : 12;
                for (int i = 0; i < count; i++)
                {
                    IntPtr row = IntPtr.Add(table, 4 + i * rowSize);
                    int pid = Marshal.ReadInt32(row, v6 ? 24 : 8);
                    if (wanted != null && !wanted.Contains(pid)) continue;
                    string local = v6 ? Address(row, 0, true) : Address(row, 0, false);
                    int localPort = Port(row, v6 ? 20 : 4);
                    lines.Add(string.Join("|", "udp", pid, local, localPort));
                }
            }
            finally { Marshal.FreeHGlobal(table); }
        }
        return lines;
    }
}
