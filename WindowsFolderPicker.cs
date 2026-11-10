using System;
using System.IO;
using System.Runtime.InteropServices;

public static class WindowsFolderPicker
{
    private const uint PickFolders = 0x20;
    private const uint ForceFileSystem = 0x40;
    private const uint PathMustExist = 0x800;
    private const uint Topmost = 0x8;
    private const uint ToolWindow = 0x80;
    private const uint PopupWindow = 0x80000000;
    private const uint FileSystemPath = 0x80058000;
    private const int Cancelled = unchecked((int)0x800704C7);
    private static readonly Guid FileOpenDialog = new Guid("DC1C5A9C-E88A-4DDE-A5A1-60F82A20AEF7");

    public static string Pick(string initialFolder)
    {
        var dialog = (IFileDialog)Activator.CreateInstance(Type.GetTypeFromCLSID(FileOpenDialog));
        try
        {
            dialog.SetOptions(PickFolders | ForceFileSystem | PathMustExist);
            dialog.SetTitle("Kanban Planner");
            if (Directory.Exists(initialFolder))
            {
                IShellItem initialItem;
                var id = typeof(IShellItem).GUID;
                if (SHCreateItemFromParsingName(initialFolder, IntPtr.Zero, ref id, out initialItem) >= 0)
                {
                    try { dialog.SetFolder(initialItem); }
                    finally { Marshal.ReleaseComObject(initialItem); }
                }
            }

            var result = ShowInFront(dialog);
            if (result == Cancelled) return null;
            Marshal.ThrowExceptionForHR(result);
            IShellItem selected;
            dialog.GetResult(out selected);
            try
            {
                IntPtr displayName;
                selected.GetDisplayName(FileSystemPath, out displayName);
                try { return Marshal.PtrToStringUni(displayName); }
                finally { Marshal.FreeCoTaskMem(displayName); }
            }
            finally { Marshal.ReleaseComObject(selected); }
        }
        finally { Marshal.ReleaseComObject(dialog); }
    }

    private static int ShowInFront(IFileDialog dialog)
    {
        // The dialog inherits topmost placement from its temporary owner.
        Rect bounds;
        GetWindowRect(GetForegroundWindow(), out bounds);
        var owner = CreateWindowEx(Topmost | ToolWindow, "STATIC", "", PopupWindow,
            bounds.Left, bounds.Top, bounds.Right - bounds.Left, bounds.Bottom - bounds.Top,
            IntPtr.Zero, IntPtr.Zero, IntPtr.Zero, IntPtr.Zero);
        if (owner == IntPtr.Zero) throw new System.ComponentModel.Win32Exception();
        try { return dialog.Show(owner); }
        finally { DestroyWindow(owner); }
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct Rect
    {
        public int Left, Top, Right, Bottom;
    }

    [DllImport("user32.dll")]
    private static extern IntPtr GetForegroundWindow();

    [DllImport("user32.dll")]
    private static extern bool GetWindowRect(IntPtr window, out Rect bounds);

    [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern IntPtr CreateWindowEx(uint extendedStyle, string className, string title, uint style,
        int x, int y, int width, int height, IntPtr parent, IntPtr menu, IntPtr instance, IntPtr parameter);

    [DllImport("user32.dll")]
    private static extern bool DestroyWindow(IntPtr window);

    [DllImport("shell32.dll", CharSet = CharSet.Unicode, ExactSpelling = true)]
    private static extern int SHCreateItemFromParsingName(string path, IntPtr context, ref Guid id, [MarshalAs(UnmanagedType.Interface)] out IShellItem item);

    // COM methods must appear in the same order as in the Windows interface.
    [ComImport, Guid("42F85136-DB7E-439C-85F1-E4075D135FC8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IFileDialog
    {
        [PreserveSig] int Show(IntPtr owner);
        void SetFileTypes(uint count, IntPtr types);
        void SetFileTypeIndex(uint index);
        void GetFileTypeIndex(out uint index);
        void Advise(IntPtr events, out uint cookie);
        void Unadvise(uint cookie);
        void SetOptions(uint options);
        void GetOptions(out uint options);
        void SetDefaultFolder(IShellItem item);
        void SetFolder(IShellItem item);
        void GetFolder(out IShellItem item);
        void GetCurrentSelection(out IShellItem item);
        void SetFileName([MarshalAs(UnmanagedType.LPWStr)] string name);
        void GetFileName(out IntPtr name);
        void SetTitle([MarshalAs(UnmanagedType.LPWStr)] string title);
        void SetOkButtonLabel([MarshalAs(UnmanagedType.LPWStr)] string label);
        void SetFileNameLabel([MarshalAs(UnmanagedType.LPWStr)] string label);
        void GetResult(out IShellItem item);
    }

    [ComImport, Guid("43826D1E-E718-42EE-BC55-A1E261C37BFE"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IShellItem
    {
        void BindToHandler(IntPtr context, ref Guid handler, ref Guid id, out IntPtr value);
        void GetParent(out IShellItem item);
        void GetDisplayName(uint kind, out IntPtr name);
    }
}
