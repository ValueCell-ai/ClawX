param(
    [Parameter(Mandatory = $true, Position = 0)]
    [string]$Mode,

    [Parameter(Mandatory = $true, Position = 1)]
    [string]$AssociationInput,

    [Parameter(Position = 2)]
    [string]$HandlerId
)

$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = New-Object System.Text.UTF8Encoding($false)
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)

$bridgeSource = @'
using System;
using System.Collections.Generic;
using System.IO;
using System.Runtime.InteropServices;
using System.Runtime.InteropServices.ComTypes;
using System.Security.Cryptography;
using System.Text;

namespace AttachmentOpenWith
{
    public sealed class HandlerRecord
    {
        public string NativeId { get; set; }
        public string Name { get; set; }
        public string ApplicationPath { get; set; }
        public string IconSourcePath { get; set; }
        public bool IsDefault { get; set; }
    }

    public sealed class PreparedHandler
    {
        internal IAssocHandler Handler;
        internal string Association;
    }

    [Flags]
    internal enum AssocFilter : uint
    {
        None = 0
    }

    internal enum AssocString : uint
    {
        Command = 1,
        Executable = 2
    }

    [ComImport]
    [Guid("F04061AC-1659-4A3F-A954-775AA57FC083")]
    [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    internal interface IAssocHandler
    {
        [PreserveSig]
        int GetName([MarshalAs(UnmanagedType.LPWStr)] out string name);

        [PreserveSig]
        int GetUIName([MarshalAs(UnmanagedType.LPWStr)] out string name);

        [PreserveSig]
        int GetIconLocation([MarshalAs(UnmanagedType.LPWStr)] out string path, out int index);

        [PreserveSig]
        int IsRecommended();

        [PreserveSig]
        int MakeDefault([MarshalAs(UnmanagedType.LPWStr)] string description);

        [PreserveSig]
        int Invoke([MarshalAs(UnmanagedType.Interface)] IDataObject dataObject);

        [PreserveSig]
        int CreateInvoker(
            [MarshalAs(UnmanagedType.Interface)] IDataObject dataObject,
            [MarshalAs(UnmanagedType.Interface)] out object invoker);
    }

    [ComImport]
    [Guid("973810AE-9599-4B88-9E4D-6EE98C9552DA")]
    [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    internal interface IEnumAssocHandlers
    {
        [PreserveSig]
        int Next(
            uint count,
            [Out, MarshalAs(UnmanagedType.LPArray, SizeParamIndex = 0)] IAssocHandler[] handlers,
            out uint fetched);

        [PreserveSig]
        int Skip(uint count);

        [PreserveSig]
        int Reset();

        [PreserveSig]
        int Clone(out IEnumAssocHandlers clone);
    }

    [ComImport]
    [Guid("43826D1E-E718-42EE-BC55-A1E261C37BFE")]
    [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    internal interface IShellItem
    {
        [PreserveSig]
        int BindToHandler(
            IntPtr bindContext,
            ref Guid handlerId,
            ref Guid interfaceId,
            [MarshalAs(UnmanagedType.Interface)] out object result);

        [PreserveSig]
        int GetParent(out IShellItem parent);

        [PreserveSig]
        int GetDisplayName(uint displayNameType, out IntPtr name);

        [PreserveSig]
        int GetAttributes(uint mask, out uint attributes);

        [PreserveSig]
        int Compare(IShellItem other, uint hint, out int order);
    }

    public static class HandlerBridge
    {
        private const int S_OK = 0;
        private const int HandlerIdMaxLength = 512;
        private const int HandlerNameMaxLength = 256;
        private const int NativePathMaxLength = 4096;

        private static readonly Guid ShellItemId =
            new Guid("43826D1E-E718-42EE-BC55-A1E261C37BFE");
        private static readonly Guid DataObjectHandlerId =
            new Guid("B8C0BD9F-ED24-455C-83E6-D5390C4FE8C4");
        private static readonly Guid DataObjectId =
            new Guid("0000010E-0000-0000-C000-000000000046");

        [DllImport("shell32.dll", CharSet = CharSet.Unicode, PreserveSig = true)]
        private static extern int SHAssocEnumHandlers(
            string association,
            AssocFilter filter,
            out IEnumAssocHandlers enumerator);

        [DllImport("shlwapi.dll", CharSet = CharSet.Unicode, PreserveSig = true)]
        private static extern uint AssocQueryString(
            uint flags,
            AssocString value,
            string association,
            string extra,
            [Out] StringBuilder output,
            ref uint outputLength);

        [DllImport("shell32.dll", CharSet = CharSet.Unicode, PreserveSig = true)]
        private static extern int SHCreateItemFromParsingName(
            string path,
            IntPtr bindContext,
            ref Guid interfaceId,
            out IShellItem item);

        public static HandlerRecord[] List(string associationInput)
        {
            string association = GetAssociation(associationInput);
            return Enumerate(association, null, false).Records.ToArray();
        }

        public static PreparedHandler Prepare(string associationInput, string publicHandlerId)
        {
            if (!IsSafeText(publicHandlerId, 64)) return null;
            string association = GetAssociation(associationInput);
            EnumerationResult result = Enumerate(association, publicHandlerId, true);
            if (result.Retained == null) return null;
            return new PreparedHandler { Handler = result.Retained, Association = association };
        }

        public static bool HasSameAssociation(PreparedHandler prepared, string path)
        {
            if (prepared == null || !IsSafePath(path)) return false;
            return string.Equals(prepared.Association, GetAssociation(path), StringComparison.OrdinalIgnoreCase);
        }

        public static void Invoke(PreparedHandler prepared, string path)
        {
            if (prepared == null || prepared.Handler == null || !IsSafePath(path))
                throw new InvalidOperationException("invalid invoke request");

            IShellItem shellItem = null;
            object dataObjectValue = null;
            try
            {
                Guid shellItemId = ShellItemId;
                int result = SHCreateItemFromParsingName(
                    path,
                    IntPtr.Zero,
                    ref shellItemId,
                    out shellItem);
                ThrowIfFailed(result, "shell item creation failed");

                Guid handlerId = DataObjectHandlerId;
                Guid dataObjectId = DataObjectId;
                result = shellItem.BindToHandler(
                    IntPtr.Zero,
                    ref handlerId,
                    ref dataObjectId,
                    out dataObjectValue);
                ThrowIfFailed(result, "data object creation failed");

                IDataObject dataObject = dataObjectValue as IDataObject;
                if (dataObject == null) throw new InvalidOperationException("data object unavailable");
                result = prepared.Handler.Invoke(dataObject);
                ThrowIfFailed(result, "handler invocation failed");
            }
            finally
            {
                ReleaseComObject(dataObjectValue);
                ReleaseComObject(shellItem);
            }
        }

        public static void ReleasePrepared(PreparedHandler prepared)
        {
            if (prepared == null) return;
            ReleaseComObject(prepared.Handler);
            prepared.Handler = null;
        }

        public static bool IsSafePath(string value)
        {
            return IsSafeText(value, NativePathMaxLength) && Path.IsPathRooted(value);
        }

        private sealed class EnumerationResult
        {
            internal readonly List<HandlerRecord> Records = new List<HandlerRecord>();
            internal IAssocHandler Retained;
        }

        private static EnumerationResult Enumerate(
            string association,
            string retainPublicId,
            bool retainOnly)
        {
            IEnumAssocHandlers enumerator = null;
            var result = new EnumerationResult();
            string defaultExecutable = QueryDefaultExecutable(association);
            try
            {
                int status = SHAssocEnumHandlers(association, AssocFilter.None, out enumerator);
                ThrowIfFailed(status, "association enumeration failed");

                var values = new IAssocHandler[1];
                uint fetched;
                while (enumerator.Next(1, values, out fetched) == S_OK && fetched == 1)
                {
                    IAssocHandler handler = values[0];
                    values[0] = null;
                    bool retain = false;
                    try
                    {
                        string nativeId;
                        if (handler.GetName(out nativeId) != S_OK ||
                            !IsSafeText(nativeId, HandlerIdMaxLength))
                            continue;

                        string publicId = PublicId(nativeId);
                        if (retainOnly)
                        {
                            if (string.Equals(publicId, retainPublicId, StringComparison.Ordinal))
                            {
                                result.Retained = handler;
                                retain = true;
                                break;
                            }
                            continue;
                        }

                        string uiName;
                        if (handler.GetUIName(out uiName) != S_OK ||
                            !IsSafeText(uiName, HandlerNameMaxLength))
                            continue;

                        string iconPath = null;
                        int iconIndex;
                        string candidateIconPath;
                        if (handler.GetIconLocation(out candidateIconPath, out iconIndex) == S_OK &&
                            IsSafeText(candidateIconPath, NativePathMaxLength))
                        {
                            iconPath = Environment.ExpandEnvironmentVariables(candidateIconPath);
                            if (!IsSafeText(iconPath, NativePathMaxLength)) iconPath = null;
                        }

                        string applicationPath = NormalizeExecutablePath(nativeId);

                        result.Records.Add(new HandlerRecord
                        {
                            NativeId = nativeId,
                            Name = uiName,
                            ApplicationPath = applicationPath,
                            IconSourcePath = iconPath,
                            IsDefault = IsSameExecutable(defaultExecutable, nativeId)
                        });
                    }
                    finally
                    {
                        if (!retain) ReleaseComObject(handler);
                    }
                }
                return result;
            }
            finally
            {
                ReleaseComObject(enumerator);
            }
        }

        private static string GetAssociation(string associationInput)
        {
            if (!IsSafeText(associationInput, NativePathMaxLength))
                throw new ArgumentException("invalid association input");
            string fileName = Path.GetFileName(associationInput);
            string extension = Path.GetExtension(fileName);
            string association = string.IsNullOrEmpty(extension) ? fileName : extension;
            if (!IsSafeText(association, HandlerIdMaxLength))
                throw new ArgumentException("invalid association");
            return association.ToLowerInvariant();
        }

        private static string QueryDefaultExecutable(string association)
        {
            uint length = 0;
            AssocQueryString(0, AssocString.Executable, association, null, null, ref length);
            if (length == 0 || length > NativePathMaxLength) return null;
            var output = new StringBuilder((int)length);
            uint status = AssocQueryString(
                0,
                AssocString.Executable,
                association,
                null,
                output,
                ref length);
            return status == 0 ? NormalizeExecutablePath(output.ToString()) : null;
        }

        private static bool IsSameExecutable(string defaultExecutable, string nativeId)
        {
            string defaultPath = NormalizeExecutablePath(defaultExecutable);
            string handlerPath = NormalizeExecutablePath(nativeId);
            return defaultPath != null &&
                handlerPath != null &&
                string.Equals(defaultPath, handlerPath, StringComparison.OrdinalIgnoreCase);
        }

        private static string NormalizeExecutablePath(string value)
        {
            if (!IsSafeText(value, NativePathMaxLength)) return null;
            try
            {
                string expanded = Environment.ExpandEnvironmentVariables(value);
                if (!Path.IsPathRooted(expanded)) return null;
                string fullPath = Path.GetFullPath(expanded);
                return IsSafeText(fullPath, NativePathMaxLength) ? fullPath : null;
            }
            catch { return null; }
        }

        private static string PublicId(string nativeId)
        {
            using (SHA256 hash = SHA256.Create())
            {
                byte[] value = hash.ComputeHash(Encoding.UTF8.GetBytes("win32\0" + nativeId));
                var output = new StringBuilder(value.Length * 2);
                foreach (byte item in value) output.Append(item.ToString("x2"));
                return output.ToString();
            }
        }

        private static bool IsSafeText(string value, int maxLength)
        {
            if (string.IsNullOrEmpty(value) || value.Length > maxLength) return false;
            foreach (char item in value)
            {
                if (item <= 0x1f || (item >= 0x7f && item <= 0x9f)) return false;
            }
            return true;
        }

        private static void ThrowIfFailed(int status, string reason)
        {
            if (status < 0) throw new InvalidOperationException(reason);
        }

        private static void ReleaseComObject(object value)
        {
            if (value == null || !Marshal.IsComObject(value)) return;
            try { Marshal.FinalReleaseComObject(value); } catch { }
        }
    }
}
'@

function Test-SafePath([string]$PathValue) {
    return [AttachmentOpenWith.HandlerBridge]::IsSafePath($PathValue)
}

$prepared = $null
$exitCode = 1

try {
    Add-Type -TypeDefinition $bridgeSource -Language CSharp

    if ($Mode -eq 'list') {
        $nativeRecords = [AttachmentOpenWith.HandlerBridge]::List($AssociationInput)
        $records = @($nativeRecords | ForEach-Object {
            $record = [ordered]@{
                nativeId = $_.NativeId
                name = $_.Name
                isDefault = $_.IsDefault
            }
            if ($_.ApplicationPath) { $record.applicationPath = $_.ApplicationPath }
            if ($_.IconSourcePath) { $record.iconSourcePath = $_.IconSourcePath }
            $record
        })
        [Console]::Out.WriteLine((ConvertTo-Json -InputObject @($records) -Compress -Depth 4))
        [Console]::Out.Flush()
        $exitCode = 0
    }
    elseif ($Mode -eq 'prepare-open') {
        if (-not (Test-SafePath $AssociationInput)) { $exitCode = 10 }
        elseif ($HandlerId -notmatch '^[a-f0-9]{64}$') { $exitCode = 11 }
        else {
            $prepared = [AttachmentOpenWith.HandlerBridge]::Prepare($AssociationInput, $HandlerId)
            if ($null -eq $prepared) { $exitCode = 12 }
            else {
                [Console]::Out.WriteLine('{"ready":true}')
                [Console]::Out.Flush()

                $readTask = [Console]::In.ReadLineAsync()
                if (-not $readTask.Wait(5000)) { $exitCode = 13 }
                else {
                    $line = $readTask.Result
                    if ([string]::IsNullOrEmpty($line) -or $line.Length -gt 8192) { $exitCode = 14 }
                    else {
                        try { $message = ConvertFrom-Json -InputObject $line -ErrorAction Stop }
                        catch { $message = $null }

                        if ($null -eq $message -or $message -is [array]) { $exitCode = 15 }
                        else {
                            $propertyNames = @($message.PSObject.Properties.Name)
                            if ($message.command -eq 'cancel' -and
                                $propertyNames.Count -eq 1 -and
                                $propertyNames[0] -ceq 'command') {
                                $exitCode = 0
                            }
                            elseif ($message.command -ne 'invoke' -or
                                $propertyNames.Count -ne 2 -or
                                -not ($propertyNames -ccontains 'command') -or
                                -not ($propertyNames -ccontains 'path') -or
                                -not (Test-SafePath $message.path)) {
                                $exitCode = 17
                            }
                            elseif (-not [AttachmentOpenWith.HandlerBridge]::HasSameAssociation(
                                $prepared,
                                [string]$message.path)) {
                                $exitCode = 18
                            }
                            else {
                                [AttachmentOpenWith.HandlerBridge]::Invoke($prepared, [string]$message.path)
                                $exitCode = 0
                            }
                        }
                    }
                }
            }
        }
    }
    else {
        $exitCode = 19
    }
}
catch {
    $exitCode = 20
}
finally {
    if ($null -ne $prepared) {
        [AttachmentOpenWith.HandlerBridge]::ReleasePrepared($prepared)
    }
}

exit $exitCode
