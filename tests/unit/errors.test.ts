import { describe, it, expect } from 'vitest';
import {
  FSError,
  ErrorCodes,
  createENOENT,
  createEEXIST,
  createEISDIR,
  createENOTDIR,
  createENOTEMPTY,
  createEACCES,
  createEINVAL,
  mapErrorCode,
} from '../../src/errors.js';

describe('errors module', () => {
  describe('FSError', () => {
    it('should create error with all properties', () => {
      const err = new FSError('ENOENT', -2, 'No such file', 'open', '/test.txt');
      expect(err.code).toBe('ENOENT');
      expect(err.errno).toBe(-2);
      expect(err.message).toBe('No such file');
      expect(err.syscall).toBe('open');
      expect(err.path).toBe('/test.txt');
      expect(err.name).toBe('FSError');
    });

    it('should be instanceof Error', () => {
      const err = new FSError('TEST', -1, 'Test error');
      expect(err).toBeInstanceOf(Error);
      expect(err).toBeInstanceOf(FSError);
    });
  });

  describe('ErrorCodes', () => {
    it('should have correct error codes', () => {
      expect(ErrorCodes.ENOENT).toBe(-2);
      expect(ErrorCodes.EEXIST).toBe(-17);
      expect(ErrorCodes.EISDIR).toBe(-21);
      expect(ErrorCodes.ENOTDIR).toBe(-20);
      expect(ErrorCodes.ENOTEMPTY).toBe(-39);
      expect(ErrorCodes.EACCES).toBe(-13);
    });
  });

  describe('createENOENT', () => {
    it('should create ENOENT error', () => {
      const err = createENOENT('open', '/missing.txt');
      expect(err.code).toBe('ENOENT');
      expect(err.errno).toBe(-2);
      expect(err.syscall).toBe('open');
      expect(err.path).toBe('/missing.txt');
      expect(err.message).toContain('no such file or directory');
    });
  });

  describe('createEEXIST', () => {
    it('should create EEXIST error', () => {
      const err = createEEXIST('mkdir', '/existing');
      expect(err.code).toBe('EEXIST');
      expect(err.errno).toBe(-17);
      expect(err.message).toContain('file already exists');
    });
  });

  describe('createEISDIR', () => {
    it('should create EISDIR error', () => {
      const err = createEISDIR('read', '/directory');
      expect(err.code).toBe('EISDIR');
      expect(err.errno).toBe(-21);
      expect(err.message).toContain('illegal operation on a directory');
    });
  });

  describe('createENOTDIR', () => {
    it('should create ENOTDIR error', () => {
      const err = createENOTDIR('readdir', '/file.txt');
      expect(err.code).toBe('ENOTDIR');
      expect(err.errno).toBe(-20);
      expect(err.message).toContain('not a directory');
    });
  });

  describe('createENOTEMPTY', () => {
    it('should create ENOTEMPTY error', () => {
      const err = createENOTEMPTY('rmdir', '/nonempty');
      expect(err.code).toBe('ENOTEMPTY');
      expect(err.errno).toBe(-39);
      expect(err.message).toContain('directory not empty');
    });
  });

  describe('createEACCES', () => {
    it('should create EACCES error', () => {
      const err = createEACCES('open', '/protected');
      expect(err.code).toBe('EACCES');
      expect(err.errno).toBe(-13);
      expect(err.message).toContain('permission denied');
    });
  });

  describe('createEINVAL', () => {
    it('should create EINVAL error', () => {
      const err = createEINVAL('open', '/invalid\0path');
      expect(err.code).toBe('EINVAL');
      expect(err.errno).toBe(-22);
      expect(err.message).toContain('invalid argument');
    });
  });

  describe('mapErrorCode', () => {
    it('should map NotFoundError to ENOENT', () => {
      const err = mapErrorCode('NotFoundError', 'read', '/missing');
      expect(err.code).toBe('ENOENT');
    });

    it('should map NotAllowedError to EACCES', () => {
      const err = mapErrorCode('NotAllowedError', 'write', '/protected');
      expect(err.code).toBe('EACCES');
    });

    it('should map TypeMismatchError to ENOTDIR', () => {
      const err = mapErrorCode('TypeMismatchError', 'readdir', '/file');
      expect(err.code).toBe('ENOTDIR');
    });

    it('should map InvalidModificationError to ENOTEMPTY', () => {
      const err = mapErrorCode('InvalidModificationError', 'rmdir', '/dir');
      expect(err.code).toBe('ENOTEMPTY');
    });

    it('should map QuotaExceededError to ENOSPC', () => {
      const err = mapErrorCode('QuotaExceededError', 'write', '/file');
      expect(err.code).toBe('ENOSPC');
    });

    it('should map unknown errors to EINVAL', () => {
      const err = mapErrorCode('UnknownError', 'operation', '/path');
      expect(err.code).toBe('EINVAL');
    });
  });
});
