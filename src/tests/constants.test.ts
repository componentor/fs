/**
 * Constants Tests
 *
 * Verifies that all expected fs.constants are defined with correct values.
 */

import { describe, it, expect } from 'vitest';
import { constants } from '../src/constants.js';

describe('fs.constants', () => {
  describe('file access constants', () => {
    it('F_OK = 0', () => expect(constants.F_OK).toBe(0));
    it('R_OK = 4', () => expect(constants.R_OK).toBe(4));
    it('W_OK = 2', () => expect(constants.W_OK).toBe(2));
    it('X_OK = 1', () => expect(constants.X_OK).toBe(1));
  });

  describe('file open constants', () => {
    it('O_RDONLY = 0', () => expect(constants.O_RDONLY).toBe(0));
    it('O_WRONLY = 1', () => expect(constants.O_WRONLY).toBe(1));
    it('O_RDWR = 2', () => expect(constants.O_RDWR).toBe(2));
    it('O_CREAT = 64', () => expect(constants.O_CREAT).toBe(64));
    it('O_EXCL = 128', () => expect(constants.O_EXCL).toBe(128));
    it('O_TRUNC = 512', () => expect(constants.O_TRUNC).toBe(512));
    it('O_APPEND = 1024', () => expect(constants.O_APPEND).toBe(1024));
    it('O_NOCTTY = 256', () => expect(constants.O_NOCTTY).toBe(256));
    it('O_NONBLOCK = 2048', () => expect(constants.O_NONBLOCK).toBe(2048));
    it('O_SYNC = 4096', () => expect(constants.O_SYNC).toBe(4096));
    it('O_DSYNC = 4096', () => expect(constants.O_DSYNC).toBe(4096));
    it('O_DIRECTORY = 65536', () => expect(constants.O_DIRECTORY).toBe(65536));
    it('O_NOFOLLOW = 131072', () => expect(constants.O_NOFOLLOW).toBe(131072));
    it('O_NOATIME = 262144', () => expect(constants.O_NOATIME).toBe(262144));
  });

  describe('copy constants', () => {
    it('COPYFILE_EXCL = 1', () => expect(constants.COPYFILE_EXCL).toBe(1));
    it('COPYFILE_FICLONE = 2', () => expect(constants.COPYFILE_FICLONE).toBe(2));
    it('COPYFILE_FICLONE_FORCE = 4', () => expect(constants.COPYFILE_FICLONE_FORCE).toBe(4));
  });

  describe('file type constants', () => {
    it('S_IFMT = 0o170000', () => expect(constants.S_IFMT).toBe(0o170000));
    it('S_IFREG = 0o100000', () => expect(constants.S_IFREG).toBe(0o100000));
    it('S_IFDIR = 0o040000', () => expect(constants.S_IFDIR).toBe(0o040000));
    it('S_IFCHR = 0o020000', () => expect(constants.S_IFCHR).toBe(0o020000));
    it('S_IFBLK = 0o060000', () => expect(constants.S_IFBLK).toBe(0o060000));
    it('S_IFIFO = 0o010000', () => expect(constants.S_IFIFO).toBe(0o010000));
    it('S_IFLNK = 0o120000', () => expect(constants.S_IFLNK).toBe(0o120000));
    it('S_IFSOCK = 0o140000', () => expect(constants.S_IFSOCK).toBe(0o140000));
  });

  describe('permission constants', () => {
    it('S_IRWXU = 0o700', () => expect(constants.S_IRWXU).toBe(0o700));
    it('S_IRUSR = 0o400', () => expect(constants.S_IRUSR).toBe(0o400));
    it('S_IWUSR = 0o200', () => expect(constants.S_IWUSR).toBe(0o200));
    it('S_IXUSR = 0o100', () => expect(constants.S_IXUSR).toBe(0o100));
    it('S_IRWXG = 0o070', () => expect(constants.S_IRWXG).toBe(0o070));
    it('S_IRGRP = 0o040', () => expect(constants.S_IRGRP).toBe(0o040));
    it('S_IWGRP = 0o020', () => expect(constants.S_IWGRP).toBe(0o020));
    it('S_IXGRP = 0o010', () => expect(constants.S_IXGRP).toBe(0o010));
    it('S_IRWXO = 0o007', () => expect(constants.S_IRWXO).toBe(0o007));
    it('S_IROTH = 0o004', () => expect(constants.S_IROTH).toBe(0o004));
    it('S_IWOTH = 0o002', () => expect(constants.S_IWOTH).toBe(0o002));
    it('S_IXOTH = 0o001', () => expect(constants.S_IXOTH).toBe(0o001));
  });

  describe('all constants are numbers', () => {
    it('every constant value is a number', () => {
      for (const [key, value] of Object.entries(constants)) {
        expect(typeof value).toBe('number');
      }
    });
  });
});
