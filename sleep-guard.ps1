$source = @'
using System;
using System.Runtime.InteropServices;

public static class SleepGuard {
    [DllImport("kernel32.dll", SetLastError = true)]
    public static extern uint SetThreadExecutionState(uint flags);
}
'@

Add-Type -TypeDefinition $source
$previousState = [SleepGuard]::SetThreadExecutionState([uint32]2147483649)
if ($previousState -eq 0) {
    throw 'Windows rejected the sleep prevention request.'
}

[Console]::Out.WriteLine('READY')
try {
    while ([Console]::In.ReadLine() -ne $null) { }
} finally {
    [void][SleepGuard]::SetThreadExecutionState([uint32]2147483648)
}
