// Node.js fs constants
// https://nodejs.org/api/fs.html#file-access-constants

// File Access Constants (for fs.access)
export const F_OK = 0 // File exists
export const R_OK = 4 // File can be read
export const W_OK = 2 // File can be written
export const X_OK = 1 // File can be executed

// File Copy Constants (for fs.copyFile)
export const COPYFILE_EXCL = 1 // Fail if dest exists
export const COPYFILE_FICLONE = 2 // Use copy-on-write if supported
export const COPYFILE_FICLONE_FORCE = 4 // Force copy-on-write, fail if not supported

// File Open Constants (for fs.open)
export const O_RDONLY = 0 // Open for reading only
export const O_WRONLY = 1 // Open for writing only
export const O_RDWR = 2 // Open for reading and writing
export const O_CREAT = 64 // Create file if it doesn't exist (0o100)
export const O_EXCL = 128 // Fail if file exists (with O_CREAT) (0o200)
export const O_NOCTTY = 256 // Don't assign controlling terminal (0o400)
export const O_TRUNC = 512 // Truncate file to zero length (0o1000)
export const O_APPEND = 1024 // Append to file (0o2000)
export const O_DIRECTORY = 65536 // Fail if not a directory (0o200000)
export const O_NOATIME = 262144 // Don't update access time (0o1000000)
export const O_NOFOLLOW = 131072 // Don't follow symlinks (0o400000)
export const O_SYNC = 1052672 // Synchronous I/O (0o4010000)
export const O_DSYNC = 4096 // Synchronous data I/O (0o10000)
export const O_SYMLINK = 2097152 // Open symlink itself (0o10000000)
export const O_DIRECT = 16384 // Direct I/O (0o40000)
export const O_NONBLOCK = 2048 // Non-blocking I/O (0o4000)

// File Type Constants (for stat mode)
export const S_IFMT = 61440 // File type mask (0o170000)
export const S_IFREG = 32768 // Regular file (0o100000)
export const S_IFDIR = 16384 // Directory (0o40000)
export const S_IFCHR = 8192 // Character device (0o20000)
export const S_IFBLK = 24576 // Block device (0o60000)
export const S_IFIFO = 4096 // FIFO/pipe (0o10000)
export const S_IFLNK = 40960 // Symbolic link (0o120000)
export const S_IFSOCK = 49152 // Socket (0o140000)

// File Mode Constants (permissions)
export const S_IRWXU = 448 // Owner read/write/execute (0o700)
export const S_IRUSR = 256 // Owner read (0o400)
export const S_IWUSR = 128 // Owner write (0o200)
export const S_IXUSR = 64 // Owner execute (0o100)
export const S_IRWXG = 56 // Group read/write/execute (0o70)
export const S_IRGRP = 32 // Group read (0o40)
export const S_IWGRP = 16 // Group write (0o20)
export const S_IXGRP = 8 // Group execute (0o10)
export const S_IRWXO = 7 // Others read/write/execute (0o7)
export const S_IROTH = 4 // Others read (0o4)
export const S_IWOTH = 2 // Others write (0o2)
export const S_IXOTH = 1 // Others execute (0o1)

// Special mode bits
export const S_ISUID = 2048 // Set user ID on execution (0o4000)
export const S_ISGID = 1024 // Set group ID on execution (0o2000)
export const S_ISVTX = 512 // Sticky bit (0o1000)

// Combined constants object (like fs.constants in Node.js)
export const constants = {
    // File Access
    F_OK,
    R_OK,
    W_OK,
    X_OK,

    // File Copy
    COPYFILE_EXCL,
    COPYFILE_FICLONE,
    COPYFILE_FICLONE_FORCE,

    // File Open
    O_RDONLY,
    O_WRONLY,
    O_RDWR,
    O_CREAT,
    O_EXCL,
    O_NOCTTY,
    O_TRUNC,
    O_APPEND,
    O_DIRECTORY,
    O_NOATIME,
    O_NOFOLLOW,
    O_SYNC,
    O_DSYNC,
    O_SYMLINK,
    O_DIRECT,
    O_NONBLOCK,

    // File Type
    S_IFMT,
    S_IFREG,
    S_IFDIR,
    S_IFCHR,
    S_IFBLK,
    S_IFIFO,
    S_IFLNK,
    S_IFSOCK,

    // File Mode (permissions)
    S_IRWXU,
    S_IRUSR,
    S_IWUSR,
    S_IXUSR,
    S_IRWXG,
    S_IRGRP,
    S_IWGRP,
    S_IXGRP,
    S_IRWXO,
    S_IROTH,
    S_IWOTH,
    S_IXOTH,

    // Special mode bits
    S_ISUID,
    S_ISGID,
    S_ISVTX,
}

export default constants
