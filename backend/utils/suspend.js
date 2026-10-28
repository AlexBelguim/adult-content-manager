/**
 * Freezing a process and thawing it — how pausing the re-encode queue keeps the encode instead of killing it. Linux
 * and macOS have SIGSTOP/SIGCONT; Windows has no signal for it, so there it's ntdll's NtSuspendProcess/NtResumeProcess
 * through a short PowerShell (about a second, most of it compiling the P/Invoke). Both resolve when it's done and
 * throw when it couldn't be done (the process already gone, or not ours).
 *
 * The same as Hikari's server/lib/suspend.js (and the copy inside its worker script).
 */
const { execFile } = require('child_process');

const ACCESS = 0x0800; // PROCESS_SUSPEND_RESUME

function ntProcess(pid, fn) {
  const script = `
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class AcmSuspend {
  [DllImport("ntdll.dll")] public static extern int NtSuspendProcess(IntPtr h);
  [DllImport("ntdll.dll")] public static extern int NtResumeProcess(IntPtr h);
  [DllImport("kernel32.dll", SetLastError = true)] public static extern IntPtr OpenProcess(uint access, bool inherit, uint pid);
  [DllImport("kernel32.dll")] public static extern bool CloseHandle(IntPtr h);
}
"@
$h = [AcmSuspend]::OpenProcess(${ACCESS}, $false, ${pid})
if ($h -eq [IntPtr]::Zero) { exit 2 }
$r = [AcmSuspend]::${fn}($h)
[AcmSuspend]::CloseHandle($h) | Out-Null
if ($r -ne 0) { exit 3 }
exit 0
`;
  return new Promise((resolve, reject) => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')],
      { windowsHide: true, timeout: 20000 }, (err, _out, stderr) => {
        if (!err) return resolve();
        const code = err.code;
        reject(new Error(code === 2 ? `process ${pid} can't be opened (gone, or not ours)` : code === 3 ? `${fn} refused for ${pid}` : String(stderr || err.message).trim().split('\n')[0]));
      });
  });
}

/** Stop a process where it is; everything it holds stays. */
async function suspendProcess(pid) {
  if (process.platform === 'win32') return ntProcess(pid, 'NtSuspendProcess');
  process.kill(pid, 'SIGSTOP');
}

/** Let a suspended process carry on. */
async function resumeProcess(pid) {
  if (process.platform === 'win32') return ntProcess(pid, 'NtResumeProcess');
  process.kill(pid, 'SIGCONT');
}

module.exports = { suspendProcess, resumeProcess };
