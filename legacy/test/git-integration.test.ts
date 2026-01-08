import { describe, it, expect, beforeEach } from 'vitest'
import git from 'isomorphic-git'
import OPFS from '../dist/index.js'

describe('Git Integration Tests', () => {
  let fs: OPFS

  beforeEach(() => {
    resetFileSystem()
    fs = new OPFS({ useSync: true, verbose: false })
  })

  // Helper to create a git repo with common config
  const initRepo = async (dir: string): Promise<string> => {
    await git.init({ fs, dir })
    return dir
  }

  // Helper to commit files
  const commitFiles = async (dir: string, files: string[], message: string): Promise<string> => {
    await Promise.all(
      files.map(f => git.add({ fs, dir, filepath: f }))
    )
    return git.commit({
      fs,
      dir,
      message,
      author: { name: 'Test', email: 'test@example.com' }
    })
  }

  describe('Basic Git Operations', () => {
    it('should initialize a git repository', async () => {
      await initRepo('/test-repo')
      const files = await fs.readdir('/test-repo')
      expect(files).toContain('.git')
    })

    it('should create commits', async () => {
      await initRepo('/repo')
      await fs.writeFile('/repo/test.txt', 'Hello World')

      const sha = await commitFiles('/repo', ['test.txt'], 'Initial commit')

      expect(sha).toBeTruthy()
      expect(sha).toHaveLength(40)
    })

    it('should read git status', async () => {
      await initRepo('/repo')
      await fs.writeFile('/repo/file.txt', 'content')

      const status = await git.status({ fs, dir: '/repo', filepath: 'file.txt' })
      expect(status).toBe('*added')
    })

    it('should handle multiple branches', async () => {
      await initRepo('/repo')
      await fs.writeFile('/repo/file.txt', 'content')
      await commitFiles('/repo', ['file.txt'], 'Initial')

      await git.branch({ fs, dir: '/repo', ref: 'feature' })
      const branches = await git.listBranches({ fs, dir: '/repo' })

      expect(branches).toContain('master')
      expect(branches).toContain('feature')
    })

    it('should read commit log', async () => {
      await initRepo('/repo')
      await fs.writeFile('/repo/file.txt', 'v1')
      await commitFiles('/repo', ['file.txt'], 'First commit')

      await fs.writeFile('/repo/file.txt', 'v2')
      await commitFiles('/repo', ['file.txt'], 'Second commit')

      const log = await git.log({ fs, dir: '/repo', depth: 10 })
      expect(log).toHaveLength(2)
      expect(log[0].commit.message.trim()).toBe('Second commit')
      expect(log[1].commit.message.trim()).toBe('First commit')
    })
  })

  describe('Symlink Handling in Git', () => {
    it('should create and commit a symlink', async () => {
      await initRepo('/repo')
      await fs.writeFile('/repo/target.txt', 'target content')
      await fs.symlink('/repo/target.txt', '/repo/link.txt')

      const sha = await commitFiles('/repo', ['target.txt', 'link.txt'], 'Add symlink')
      expect(sha).toBeTruthy()

      const lstat = await fs.lstat('/repo/link.txt')
      expect(lstat.isSymbolicLink()).toBe(true)
    })

    it('should handle symlink in readTree', async () => {
      await initRepo('/repo')
      await fs.writeFile('/repo/target.txt', 'content')
      await fs.symlink('/repo/target.txt', '/repo/link.txt')

      const sha = await commitFiles('/repo', ['target.txt', 'link.txt'], 'Add files')
      const tree = await git.readTree({ fs, dir: '/repo', oid: sha })

      expect(tree.tree).toBeDefined()
      expect(Array.isArray(tree.tree)).toBe(true)
    })

    it('should preserve symlink target after multiple commits', async () => {
      await initRepo('/repo')
      await fs.writeFile('/repo/target.txt', 'v1')
      await fs.symlink('/repo/target.txt', '/repo/link.txt')
      await commitFiles('/repo', ['target.txt', 'link.txt'], 'First')

      // Update target, symlink should still point to same file
      await fs.writeFile('/repo/target.txt', 'v2')
      await commitFiles('/repo', ['target.txt'], 'Update target')

      const content = await fs.readFile('/repo/link.txt', { encoding: 'utf-8' })
      expect(content).toBe('v2')
    })

    it('should handle symlink to file in subdirectory', async () => {
      await initRepo('/repo')
      await fs.mkdir('/repo/src')
      await fs.writeFile('/repo/src/module.js', 'export default 42')
      await fs.symlink('/repo/src/module.js', '/repo/index.js')

      await commitFiles('/repo', ['src/module.js', 'index.js'], 'Add module')

      const content = await fs.readFile('/repo/index.js', { encoding: 'utf-8' })
      expect(content).toBe('export default 42')
    })
  })

  describe('Clone-like Operations', () => {
    it('should handle realistic repo structure with symlinks', async () => {
      await initRepo('/clone-sim')

      // Create directories in parallel
      await Promise.all([
        fs.mkdir('/clone-sim/src'),
        fs.mkdir('/clone-sim/lib'),
        fs.mkdir('/clone-sim/docs'),
        fs.mkdir('/clone-sim/bin')
      ])

      // Create files in parallel
      await Promise.all([
        fs.writeFile('/clone-sim/README.md', '# Test Repo'),
        fs.writeFile('/clone-sim/package.json', '{"name":"test","version":"1.0.0"}'),
        fs.writeFile('/clone-sim/src/index.js', 'export default {}'),
        fs.writeFile('/clone-sim/src/utils.js', 'export const util = 1'),
        fs.writeFile('/clone-sim/lib/main.js', 'import * as src from "../src/index.js"'),
        fs.writeFile('/clone-sim/bin/cli.js', '#!/usr/bin/env node')
      ])

      // Create symlinks (common in monorepos)
      await fs.symlinkBatch([
        { target: '/clone-sim/README.md', path: '/clone-sim/docs/README.md' },
        { target: '/clone-sim/src/index.js', path: '/clone-sim/lib/index.js' },
        { target: '/clone-sim/package.json', path: '/clone-sim/docs/package.json' }
      ])

      const sha = await commitFiles('/clone-sim', [
        'README.md', 'package.json',
        'src/index.js', 'src/utils.js',
        'lib/main.js', 'lib/index.js',
        'docs/README.md', 'docs/package.json',
        'bin/cli.js'
      ], 'Initial commit')

      expect(sha).toBeTruthy()

      // Verify symlinks work
      const [readme, index] = await Promise.all([
        fs.readFile('/clone-sim/docs/README.md', { encoding: 'utf-8' }),
        fs.readFile('/clone-sim/lib/index.js', { encoding: 'utf-8' })
      ])
      expect(readme).toBe('# Test Repo')
      expect(index).toBe('export default {}')
    })

    it('should handle deeply nested symlinks', async () => {
      await initRepo('/deep')
      await fs.mkdir('/deep/a/b/c/d/e')
      await fs.writeFile('/deep/a/b/c/d/e/file.txt', 'deep content')
      await fs.symlink('/deep/a/b/c/d/e/file.txt', '/deep/shortcut.txt')

      await commitFiles('/deep', ['a/b/c/d/e/file.txt', 'shortcut.txt'], 'Add deep structure')

      const content = await fs.readFile('/deep/shortcut.txt', { encoding: 'utf-8' })
      expect(content).toBe('deep content')

      const lstat = await fs.lstat('/deep/shortcut.txt')
      expect(lstat.isSymbolicLink()).toBe(true)
    })

    it('should handle cross-directory symlinks', async () => {
      await initRepo('/cross')

      await Promise.all([
        fs.mkdir('/cross/packages/core/src'),
        fs.mkdir('/cross/packages/utils/src'),
        fs.mkdir('/cross/apps/web/src')
      ])

      await Promise.all([
        fs.writeFile('/cross/packages/core/src/index.ts', 'export const core = 1'),
        fs.writeFile('/cross/packages/utils/src/index.ts', 'export const utils = 2')
      ])

      // Symlinks across packages (monorepo pattern)
      await fs.symlinkBatch([
        { target: '/cross/packages/core/src/index.ts', path: '/cross/apps/web/src/core.ts' },
        { target: '/cross/packages/utils/src/index.ts', path: '/cross/apps/web/src/utils.ts' }
      ])

      await commitFiles('/cross', [
        'packages/core/src/index.ts',
        'packages/utils/src/index.ts',
        'apps/web/src/core.ts',
        'apps/web/src/utils.ts'
      ], 'Setup monorepo')

      const [core, utils] = await Promise.all([
        fs.readFile('/cross/apps/web/src/core.ts', { encoding: 'utf-8' }),
        fs.readFile('/cross/apps/web/src/utils.ts', { encoding: 'utf-8' })
      ])
      expect(core).toBe('export const core = 1')
      expect(utils).toBe('export const utils = 2')
    })
  })

  describe('Edge Cases', () => {
    it('should handle symlink chain in git repo', async () => {
      await initRepo('/repo')
      await fs.writeFile('/repo/target.txt', 'data')
      await fs.symlink('/repo/target.txt', '/repo/link1.txt')
      await fs.symlink('/repo/link1.txt', '/repo/link2.txt')
      await fs.symlink('/repo/link2.txt', '/repo/link3.txt')

      const sha = await commitFiles('/repo',
        ['target.txt', 'link1.txt', 'link2.txt', 'link3.txt'],
        'Add symlink chain'
      )
      expect(sha).toBeTruthy()

      // Read through chain
      const content = await fs.readFile('/repo/link3.txt', { encoding: 'utf-8' })
      expect(content).toBe('data')
    })

    it('should handle broken symlink in git repo', async () => {
      await initRepo('/repo')
      await fs.symlink('/repo/nonexistent.txt', '/repo/broken-link.txt')

      const sha = await commitFiles('/repo', ['broken-link.txt'], 'Add broken symlink')
      expect(sha).toBeTruthy()

      const lstat = await fs.lstat('/repo/broken-link.txt')
      expect(lstat.isSymbolicLink()).toBe(true)

      await expect(fs.stat('/repo/broken-link.txt'))
        .rejects.toMatchObject({ code: 'ENOENT' })
    })

    it('should handle directory with many symlinks', async () => {
      await initRepo('/repo')
      await fs.mkdir('/repo/targets')
      await fs.mkdir('/repo/links')

      // Create 30 targets and symlinks
      const writePromises: Promise<void>[] = []
      const linkOps: { target: string; path: string }[] = []
      for (let i = 0; i < 30; i++) {
        writePromises.push(fs.writeFile(`/repo/targets/file${i}.txt`, `content ${i}`))
        linkOps.push({ target: `/repo/targets/file${i}.txt`, path: `/repo/links/link${i}.txt` })
      }
      await Promise.all(writePromises)
      await fs.symlinkBatch(linkOps)

      // Add all files
      const filepaths: string[] = []
      for (let i = 0; i < 30; i++) {
        filepaths.push(`targets/file${i}.txt`, `links/link${i}.txt`)
      }
      const sha = await commitFiles('/repo', filepaths, 'Add many symlinks')
      expect(sha).toBeTruthy()

      // Verify some random ones
      const [c5, c15, c25] = await Promise.all([
        fs.readFile('/repo/links/link5.txt', { encoding: 'utf-8' }),
        fs.readFile('/repo/links/link15.txt', { encoding: 'utf-8' }),
        fs.readFile('/repo/links/link25.txt', { encoding: 'utf-8' })
      ])
      expect(c5).toBe('content 5')
      expect(c15).toBe('content 15')
      expect(c25).toBe('content 25')
    })

    it('should handle replacing file with symlink', async () => {
      await initRepo('/repo')
      await fs.writeFile('/repo/file.txt', 'original')
      await commitFiles('/repo', ['file.txt'], 'Add file')

      // Replace file with symlink
      await fs.writeFile('/repo/target.txt', 'new target')
      await fs.unlink('/repo/file.txt')
      await fs.symlink('/repo/target.txt', '/repo/file.txt')

      await commitFiles('/repo', ['target.txt', 'file.txt'], 'Replace with symlink')

      const lstat = await fs.lstat('/repo/file.txt')
      expect(lstat.isSymbolicLink()).toBe(true)

      const content = await fs.readFile('/repo/file.txt', { encoding: 'utf-8' })
      expect(content).toBe('new target')
    })

    it('should handle special characters in symlink paths', async () => {
      await initRepo('/repo')
      await fs.writeFile('/repo/file with spaces.txt', 'spaced content')
      await fs.symlink('/repo/file with spaces.txt', '/repo/link-to-spaced.txt')

      const sha = await commitFiles('/repo', ['file with spaces.txt', 'link-to-spaced.txt'], 'Add spaced')
      expect(sha).toBeTruthy()

      const content = await fs.readFile('/repo/link-to-spaced.txt', { encoding: 'utf-8' })
      expect(content).toBe('spaced content')
    })
  })

  describe('Git Operations After Symlink Changes', () => {
    it('should detect symlink target changes in status', async () => {
      await initRepo('/repo')
      await fs.writeFile('/repo/target1.txt', 'target 1')
      await fs.writeFile('/repo/target2.txt', 'target 2')
      await fs.symlink('/repo/target1.txt', '/repo/link.txt')
      await commitFiles('/repo', ['target1.txt', 'target2.txt', 'link.txt'], 'Initial')

      // Change symlink target
      await fs.unlink('/repo/link.txt')
      await fs.symlink('/repo/target2.txt', '/repo/link.txt')

      const status = await git.status({ fs, dir: '/repo', filepath: 'link.txt' })
      expect(status).toBe('*modified')
    })

    it('should handle git diff with symlinks', async () => {
      await initRepo('/repo')
      await fs.writeFile('/repo/target.txt', 'content')
      await fs.symlink('/repo/target.txt', '/repo/link.txt')
      const sha1 = await commitFiles('/repo', ['target.txt', 'link.txt'], 'First')

      await fs.writeFile('/repo/target.txt', 'modified content')
      const sha2 = await commitFiles('/repo', ['target.txt'], 'Modify target')

      // Symlink should still resolve to updated content
      const content = await fs.readFile('/repo/link.txt', { encoding: 'utf-8' })
      expect(content).toBe('modified content')

      // Both commits should exist
      expect(sha1).not.toBe(sha2)
    })
  })

  describe('Performance Benchmarks', () => {
    it('should handle 100 files + commit efficiently', async () => {
      await initRepo('/perf')

      const start = performance.now()

      // Create files in batches for better performance
      const batchSize = 20
      for (let batch = 0; batch < 5; batch++) {
        const promises: Promise<void>[] = []
        for (let i = 0; i < batchSize; i++) {
          const idx = batch * batchSize + i
          promises.push(fs.writeFile(`/perf/file${idx}.txt`, `content ${idx}`))
        }
        await Promise.all(promises)
      }

      // Add all files
      const filepaths = Array.from({ length: 100 }, (_, i) => `file${i}.txt`)
      await Promise.all(filepaths.map(f => git.add({ fs, dir: '/perf', filepath: f })))

      await git.commit({
        fs,
        dir: '/perf',
        message: 'Add 100 files',
        author: { name: 'Test', email: 'test@example.com' }
      })

      const duration = performance.now() - start
      console.log(`100 files + commit: ${duration.toFixed(2)}ms`)

      expect(duration).toBeLessThan(5000)
    })

    it('should handle 50 symlinks with batch operation efficiently', async () => {
      await initRepo('/perf-sym')

      // Create targets
      const targetPromises: Promise<void>[] = []
      for (let i = 0; i < 50; i++) {
        targetPromises.push(fs.writeFile(`/perf-sym/target${i}.txt`, `data ${i}`))
      }
      await Promise.all(targetPromises)

      const start = performance.now()

      // Create symlinks using batch
      const links = Array.from({ length: 50 }, (_, i) => ({
        target: `/perf-sym/target${i}.txt`,
        path: `/perf-sym/link${i}.txt`
      }))
      await fs.symlinkBatch(links)

      const duration = performance.now() - start
      console.log(`50 symlinks (batch): ${duration.toFixed(2)}ms`)

      expect(duration).toBeLessThan(500)
    })

    it('should handle concurrent git operations', async () => {
      // Create 3 repos in parallel
      const start = performance.now()

      await Promise.all([
        (async () => {
          await initRepo('/repo1')
          await fs.writeFile('/repo1/file.txt', 'repo1')
          await commitFiles('/repo1', ['file.txt'], 'Commit 1')
        })(),
        (async () => {
          await initRepo('/repo2')
          await fs.writeFile('/repo2/file.txt', 'repo2')
          await commitFiles('/repo2', ['file.txt'], 'Commit 2')
        })(),
        (async () => {
          await initRepo('/repo3')
          await fs.writeFile('/repo3/file.txt', 'repo3')
          await commitFiles('/repo3', ['file.txt'], 'Commit 3')
        })()
      ])

      const duration = performance.now() - start
      console.log(`3 parallel repos: ${duration.toFixed(2)}ms`)

      // Verify all repos exist
      const [r1, r2, r3] = await Promise.all([
        fs.readdir('/repo1'),
        fs.readdir('/repo2'),
        fs.readdir('/repo3')
      ])
      expect(r1).toContain('.git')
      expect(r2).toContain('.git')
      expect(r3).toContain('.git')
    })

    it('should handle reading many files through symlinks efficiently', async () => {
      await initRepo('/read-perf')

      // Create files and symlinks
      const targets = Array.from({ length: 20 }, (_, i) =>
        fs.writeFile(`/read-perf/target${i}.txt`, `content ${i}`)
      )
      await Promise.all(targets)

      const links = Array.from({ length: 20 }, (_, i) => ({
        target: `/read-perf/target${i}.txt`,
        path: `/read-perf/link${i}.txt`
      }))
      await fs.symlinkBatch(links)

      const start = performance.now()

      // Read all symlinks in parallel
      const reads = Array.from({ length: 20 }, (_, i) =>
        fs.readFile(`/read-perf/link${i}.txt`, { encoding: 'utf-8' })
      )
      const results = await Promise.all(reads)

      const duration = performance.now() - start
      console.log(`20 parallel symlink reads: ${duration.toFixed(2)}ms`)

      expect(duration).toBeLessThan(100)
      expect(results[0]).toBe('content 0')
      expect(results[19]).toBe('content 19')
    })
  })

  describe('Stress Tests', () => {
    it('should handle rapid file creation and symlink operations', async () => {
      await initRepo('/stress')

      const start = performance.now()

      // Rapidly create files
      for (let i = 0; i < 30; i++) {
        await fs.writeFile(`/stress/file${i}.txt`, `v${i}`)
        if (i > 0) {
          await fs.symlink(`/stress/file${i - 1}.txt`, `/stress/chain${i}.txt`)
        }
      }

      const sha = await commitFiles('/stress',
        Array.from({ length: 30 }, (_, i) => `file${i}.txt`)
          .concat(Array.from({ length: 29 }, (_, i) => `chain${i + 1}.txt`)),
        'Stress test'
      )

      const duration = performance.now() - start
      console.log(`Stress test (30 files + 29 symlinks): ${duration.toFixed(2)}ms`)

      expect(sha).toBeTruthy()
      expect(duration).toBeLessThan(5000)
    })

    it('should handle many sequential commits with symlinks', async () => {
      await initRepo('/seq')
      await fs.writeFile('/seq/main.txt', 'main')

      const start = performance.now()

      for (let i = 0; i < 10; i++) {
        await fs.writeFile(`/seq/file${i}.txt`, `version ${i}`)
        await fs.symlink(`/seq/file${i}.txt`, `/seq/latest.txt`)
        await commitFiles('/seq', [`file${i}.txt`, 'latest.txt'], `Commit ${i}`)
        await fs.unlink('/seq/latest.txt') // Remove for next iteration
      }

      const duration = performance.now() - start
      console.log(`10 sequential commits: ${duration.toFixed(2)}ms`)

      const log = await git.log({ fs, dir: '/seq', depth: 20 })
      expect(log.length).toBe(10)
    })
  })
})
