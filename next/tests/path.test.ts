/**
 * Path Utilities Tests
 */

import { describe, it, expect } from 'vitest';
import * as path from '../src/path.js';

describe('path', () => {
  describe('normalize', () => {
    it('should normalize absolute paths', () => {
      expect(path.normalize('/foo/bar/../baz')).toBe('/foo/baz');
      expect(path.normalize('/foo/./bar')).toBe('/foo/bar');
      expect(path.normalize('/foo//bar')).toBe('/foo/bar');
      expect(path.normalize('/')).toBe('/');
    });

    it('should normalize relative paths', () => {
      expect(path.normalize('foo/bar/../baz')).toBe('foo/baz');
      expect(path.normalize('./foo')).toBe('foo');
    });

    it('should handle empty string', () => {
      expect(path.normalize('')).toBe('.');
    });
  });

  describe('join', () => {
    it('should join paths', () => {
      expect(path.join('/foo', 'bar', 'baz')).toBe('/foo/bar/baz');
      expect(path.join('/foo', '../bar')).toBe('/bar');
      expect(path.join('/', 'foo')).toBe('/foo');
    });
  });

  describe('dirname', () => {
    it('should return parent directory', () => {
      expect(path.dirname('/foo/bar.txt')).toBe('/foo');
      expect(path.dirname('/foo')).toBe('/');
      expect(path.dirname('/')).toBe('/');
    });
  });

  describe('basename', () => {
    it('should return filename', () => {
      expect(path.basename('/foo/bar.txt')).toBe('bar.txt');
      expect(path.basename('/foo/bar.txt', '.txt')).toBe('bar');
    });
  });

  describe('extname', () => {
    it('should return extension', () => {
      expect(path.extname('/foo/bar.txt')).toBe('.txt');
      expect(path.extname('/foo/bar')).toBe('');
      expect(path.extname('/foo/.hidden')).toBe('');
    });
  });

  describe('isAbsolute', () => {
    it('should detect absolute paths', () => {
      expect(path.isAbsolute('/foo')).toBe(true);
      expect(path.isAbsolute('foo')).toBe(false);
    });
  });

  describe('resolve', () => {
    it('should resolve paths', () => {
      expect(path.resolve('/foo', 'bar')).toBe('/foo/bar');
      expect(path.resolve('/foo', '/bar')).toBe('/bar');
    });
  });

  describe('relative', () => {
    it('should compute relative paths', () => {
      expect(path.relative('/foo/bar', '/foo/baz')).toBe('../baz');
      expect(path.relative('/foo', '/foo/bar')).toBe('bar');
    });
  });

  describe('parse/format', () => {
    it('should parse and format path', () => {
      const parsed = path.parse('/foo/bar.txt');
      expect(parsed.root).toBe('/');
      expect(parsed.dir).toBe('/foo');
      expect(parsed.base).toBe('bar.txt');
      expect(parsed.ext).toBe('.txt');
      expect(parsed.name).toBe('bar');

      expect(path.format(parsed)).toBe('/foo/bar.txt');
    });
  });
});
