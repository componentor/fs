import { describe, it, expect } from 'vitest';
import {
  normalize,
  join,
  resolve,
  isAbsolute,
  dirname,
  basename,
  extname,
  relative,
  parse,
  format,
  sep,
  delimiter,
} from '../../src/path.js';

describe('path module', () => {
  describe('sep and delimiter', () => {
    it('should have correct separator', () => {
      expect(sep).toBe('/');
    });

    it('should have correct delimiter', () => {
      expect(delimiter).toBe(':');
    });
  });

  describe('normalize', () => {
    it('should normalize simple paths', () => {
      expect(normalize('/foo/bar//baz/asdf/quux/..')).toBe('/foo/bar/baz/asdf');
    });

    it('should handle empty string', () => {
      expect(normalize('')).toBe('.');
    });

    it('should handle root', () => {
      expect(normalize('/')).toBe('/');
    });

    it('should resolve . and ..', () => {
      expect(normalize('/foo/./bar/../baz')).toBe('/foo/baz');
    });

    it('should handle relative paths', () => {
      expect(normalize('foo/bar/../baz')).toBe('foo/baz');
    });

    it('should handle multiple slashes', () => {
      expect(normalize('///foo///bar///')).toBe('/foo/bar/');
    });
  });

  describe('join', () => {
    it('should join path segments', () => {
      expect(join('/foo', 'bar', 'baz')).toBe('/foo/bar/baz');
    });

    it('should handle empty arguments', () => {
      expect(join()).toBe('.');
    });

    it('should handle empty strings', () => {
      expect(join('', '')).toBe('.');
    });

    it('should normalize result', () => {
      expect(join('/foo', 'bar', '..', 'baz')).toBe('/foo/baz');
    });

    it('should handle absolute paths', () => {
      expect(join('foo', '/bar', 'baz')).toBe('foo/bar/baz');
    });
  });

  describe('resolve', () => {
    it('should resolve to absolute path', () => {
      expect(resolve('/foo/bar', './baz')).toBe('/foo/bar/baz');
    });

    it('should handle absolute path in arguments', () => {
      expect(resolve('/foo/bar', '/baz')).toBe('/baz');
    });

    it('should handle relative paths', () => {
      expect(resolve('foo', 'bar')).toBe('/foo/bar');
    });

    it('should handle empty arguments', () => {
      expect(resolve()).toBe('/');
    });

    it('should resolve .. correctly', () => {
      expect(resolve('/foo/bar', '..', 'baz')).toBe('/foo/baz');
    });
  });

  describe('isAbsolute', () => {
    it('should return true for absolute paths', () => {
      expect(isAbsolute('/foo/bar')).toBe(true);
      expect(isAbsolute('/')).toBe(true);
    });

    it('should return false for relative paths', () => {
      expect(isAbsolute('foo/bar')).toBe(false);
      expect(isAbsolute('./foo')).toBe(false);
      expect(isAbsolute('')).toBe(false);
    });
  });

  describe('dirname', () => {
    it('should return directory name', () => {
      expect(dirname('/foo/bar/baz')).toBe('/foo/bar');
      expect(dirname('/foo/bar')).toBe('/foo');
      expect(dirname('/foo')).toBe('/');
    });

    it('should handle trailing slash', () => {
      expect(dirname('/foo/bar/')).toBe('/foo');
    });

    it('should handle root', () => {
      expect(dirname('/')).toBe('/');
    });

    it('should handle relative paths', () => {
      expect(dirname('foo/bar')).toBe('foo');
      expect(dirname('foo')).toBe('.');
    });

    it('should handle empty string', () => {
      expect(dirname('')).toBe('.');
    });
  });

  describe('basename', () => {
    it('should return base name', () => {
      expect(basename('/foo/bar/baz.txt')).toBe('baz.txt');
      expect(basename('/foo/bar/baz')).toBe('baz');
    });

    it('should handle extension removal', () => {
      expect(basename('/foo/bar/baz.txt', '.txt')).toBe('baz');
      expect(basename('/foo/bar/baz.txt', '.html')).toBe('baz.txt');
    });

    it('should handle trailing slash', () => {
      expect(basename('/foo/bar/')).toBe('bar');
    });

    it('should handle root', () => {
      expect(basename('/')).toBe('');
    });
  });

  describe('extname', () => {
    it('should return extension', () => {
      expect(extname('index.html')).toBe('.html');
      expect(extname('index.coffee.md')).toBe('.md');
      expect(extname('index.')).toBe('.');
    });

    it('should handle no extension', () => {
      expect(extname('index')).toBe('');
      expect(extname('.index')).toBe('');
    });

    it('should handle paths', () => {
      expect(extname('/foo/bar/baz.txt')).toBe('.txt');
    });
  });

  describe('relative', () => {
    it('should return relative path', () => {
      expect(relative('/data/orandea/test/aaa', '/data/orandea/impl/bbb')).toBe('../../impl/bbb');
    });

    it('should handle same path', () => {
      expect(relative('/foo/bar', '/foo/bar')).toBe('');
    });

    it('should handle parent directory', () => {
      expect(relative('/foo/bar/baz', '/foo/bar')).toBe('..');
    });

    it('should handle child directory', () => {
      expect(relative('/foo/bar', '/foo/bar/baz')).toBe('baz');
    });
  });

  describe('parse', () => {
    it('should parse path into components', () => {
      const parsed = parse('/home/user/dir/file.txt');
      expect(parsed.root).toBe('/');
      expect(parsed.dir).toBe('/home/user/dir');
      expect(parsed.base).toBe('file.txt');
      expect(parsed.ext).toBe('.txt');
      expect(parsed.name).toBe('file');
    });

    it('should handle relative paths', () => {
      const parsed = parse('dir/file.txt');
      expect(parsed.root).toBe('');
      expect(parsed.dir).toBe('dir');
      expect(parsed.base).toBe('file.txt');
    });

    it('should handle no extension', () => {
      const parsed = parse('/foo/bar');
      expect(parsed.ext).toBe('');
      expect(parsed.name).toBe('bar');
    });

    it('should handle empty string', () => {
      const parsed = parse('');
      expect(parsed.root).toBe('');
      expect(parsed.dir).toBe('');
      expect(parsed.base).toBe('');
    });
  });

  describe('format', () => {
    it('should format path object to string', () => {
      expect(
        format({
          root: '/',
          dir: '/home/user/dir',
          base: 'file.txt',
        })
      ).toBe('/home/user/dir/file.txt');
    });

    it('should handle name and ext', () => {
      expect(
        format({
          root: '/',
          name: 'file',
          ext: '.txt',
        })
      ).toBe('/file.txt');
    });

    it('should prioritize base over name+ext', () => {
      expect(
        format({
          name: 'ignored',
          ext: '.ignored',
          base: 'file.txt',
        })
      ).toBe('file.txt');
    });
  });
});
