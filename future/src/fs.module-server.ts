/**
 * VFS Module Server for Service Worker
 *
 * Serves JavaScript modules from VFS via fetch interception.
 * Routes file reads through a client (main thread) which uses the SAB-based
 * sync interface to fs.sync.worker for fast sync reads.
 *
 * This enables native ESM execution:
 * - import "postcss" → rewritten to → import "/vfs-module/postcss"
 * - Service worker intercepts and serves the actual module from VFS
 */

const sw = self as unknown as ServiceWorkerGlobalScope
const VFS_MODULE_PREFIX = '/vfs-module/'
const VFS_CONFIG_PREFIX = '/vfs-config/'

/**
 * Store for bundled config code - populated via postMessage from main thread
 * Key is pattern (e.g., "vite.config"), value is { code, timestamp }
 */
const bundledConfigStore: Map<string, { code: string; timestamp: number }> = new Map()

/**
 * Store for pre-registered worker module code - populated via postMessage from exec worker.
 * Used to serve rayon sub-worker scripts before VFS write propagates.
 * Key is the VFS file path (e.g., "/ecommerce/node_modules/.../wasi-worker-browser.__worker2__.mjs")
 */
const workerModuleStore: Map<string, { code: string; timestamp: number }> = new Map()

/**
 * Store worker module code for immediate service worker serving.
 * Called via postMessage from exec worker → primary tab → service worker.
 */
export function storeWorkerModuleInSW(filePath: string, code: string): void {
    workerModuleStore.set(filePath, { code, timestamp: Date.now() })
    console.log(`[ModuleServer] Stored worker module: ${filePath} (${code.length} bytes)`)
}

/**
 * Create a Response with proper COEP/CORP headers for cross-origin isolated contexts.
 * Module workers in COEP pages require Cross-Origin-Resource-Policy: same-origin.
 */
function moduleResponse(content: string, status = 200, contentType = 'application/javascript'): Response {
    return new Response(content, {
        status,
        headers: {
            'Content-Type': contentType,
            'Cross-Origin-Resource-Policy': 'same-origin',
            'Cross-Origin-Embedder-Policy': 'require-corp',
        }
    })
}

/**
 * Store bundled config code for later retrieval
 */
export function storeBundledConfigInSW(pattern: string, code: string): void {
    bundledConfigStore.set(pattern, { code, timestamp: Date.now() })
    console.log(`[ModuleServer] Stored bundled config for pattern "${pattern}" (${code.length} bytes)`)
    console.log(`[ModuleServer] Config preview: ${code.substring(0, 300).replace(/\n/g, '\\n')}...`)
}

/**
 * Get bundled config code by path pattern
 */
function getBundledConfigFromSW(path: string): string | null {
    // Check for patterns in the path
    for (const [pattern, { code, timestamp }] of bundledConfigStore.entries()) {
        if (path.includes(pattern)) {
            // Check if it's recent (within last 60 seconds)
            if (Date.now() - timestamp < 60000) {
                console.log(`[ModuleServer] Found bundled config for "${path}" via pattern "${pattern}"`)
                return code
            } else {
                console.log(`[ModuleServer] Bundled config for "${pattern}" is stale, removing`)
                bundledConfigStore.delete(pattern)
            }
        }
    }
    return null
}

/**
 * Node.js builtin modules - should be provided by globalThis polyfills
 */
const NODE_BUILTINS = new Set([
    'assert', 'buffer', 'child_process', 'cluster', 'console', 'constants',
    'crypto', 'dgram', 'dns', 'domain', 'events', 'fs', 'http', 'https',
    'module', 'net', 'os', 'path', 'perf_hooks', 'process', 'punycode',
    'querystring', 'readline', 'repl', 'stream', 'string_decoder', 'sys',
    'timers', 'tls', 'tty', 'url', 'util', 'v8', 'vm', 'worker_threads',
    'zlib', 'async_hooks', 'http2', 'inspector', 'trace_events',
    'diagnostics_channel', 'wasi', 'fs/promises',
])

/**
 * Recursively resolve nested export condition objects to a string path.
 * Handles packages like tslib that have nested conditions:
 *   { "module": { "types": "...", "default": "./tslib.es6.mjs" } }
 * Tries conditions in order: module, import, require, default, node
 * Prefers 'module' (esm-bundler, self-contained) over 'import' (mjs, often many sub-files)
 */
function resolveExportCondition(exp: any): string | null {
    if (typeof exp === 'string') return exp
    if (!exp || typeof exp !== 'object') return null
    // Try conditions in priority order - 'module' first for self-contained esm-bundler builds
    for (const cond of ['module', 'import', 'require', 'default', 'node']) {
        if (exp[cond] !== undefined) {
            const result = resolveExportCondition(exp[cond])
            if (result) return result
        }
    }
    return null
}

/**
 * Check if a specifier is a Node.js builtin
 */
function isNodeBuiltin(specifier: string): boolean {
    if (specifier.startsWith('node:')) {
        return true
    }
    return NODE_BUILTINS.has(specifier)
}

/**
 * Get the globalThis key for a builtin module
 */
function getBuiltinGlobalKey(specifier: string): string {
    let name = specifier.startsWith('node:') ? specifier.slice(5) : specifier
    name = name.replace(/\//g, '_')
    return `__node_${name}`  // Single underscore at end to match esm-transforms.ts and node-polyfills.ts
}

/**
 * Generate a shim module that re-exports from globalThis polyfills
 */
function generateBuiltinShim(specifier: string): string {
    const globalKey = getBuiltinGlobalKey(specifier)
    return `// Node.js builtin shim: ${specifier}
const mod = globalThis.${globalKey} || {};
export default mod;
export const {${Array.from(getCommonExports(specifier)).join(', ')}} = mod;
`
}

/**
 * Generate a shim for rollup that re-exports from @rolldown/browser via globalThis
 * Uses globalThis.__node_rollup__ for acorn-based parseAst (set by node-polyfills.ts)
 * Uses globalThis.__rolldown__ for build/rollup (set by rolldown-async.ts)
 *
 * IMPORTANT: The rollup function is wrapped to intercept bundle.write() calls.
 * @rolldown/browser uses WASI's virtual filesystem, not our VFS.
 * We intercept write() and use generate() + our VFS instead.
 */
function generateRolldownShim(specifier: string): string {
    // Map rollup subpaths to rolldown equivalents
    if (specifier === 'rollup/parseAst' || specifier.includes('parseAst')) {
        return `// Rollup parseAst shim -> acorn-based implementation
const nodeRollup = globalThis.__node_rollup || globalThis.__node_rollup__ || {};
export const parseAst = nodeRollup.parseAst || ((code) => { throw new Error('parseAst not available'); });
export const parseAstAsync = nodeRollup.parseAst?.parseAstAsync || (async (code) => parseAst(code));
export default { parseAst, parseAstAsync };
`
    }

    // For native.js or other internal files, provide stub exports
    if (specifier.includes('native') || specifier.includes('dist/')) {
        return `// Rollup native shim -> acorn-based implementation
const nodeRollup = globalThis.__node_rollup || globalThis.__node_rollup__ || {};
export const parse = nodeRollup.parseAst || ((code) => { throw new Error('parse not available'); });
export const parseAsync = nodeRollup.parseAst?.parseAstAsync || (async (code) => parse(code));
export const xxhashBase64Url = () => '';
export const xxhashBase36 = () => '';
export const xxhashBase16 = () => '';
export default { parse, parseAsync, xxhashBase64Url, xxhashBase36, xxhashBase16 };
`
    }

    // Main rollup module - wrap rollup() to intercept bundle.write()
    return `// Rollup shim -> @rolldown/browser + acorn parseAst
// Wrapped to use our VFS for bundle.write() instead of WASI filesystem
const rolldownInternal = globalThis.__rolldown__ || {};
const nodeRollup = globalThis.__node_rollup || globalThis.__node_rollup__ || {};
const fs = globalThis.__node_fs || globalThis.__node_fs__;
const path = globalThis.__node_path || globalThis.__node_path__;

export const parseAst = nodeRollup.parseAst || ((code) => { throw new Error('parseAst not available'); });
export const parseAstAsync = nodeRollup.parseAst?.parseAstAsync || (async (code) => parseAst(code));

// Wrap the rollup function to intercept bundle.write()
const originalRollup = rolldownInternal.rollup || rolldownInternal.build;

export const rollup = async function(inputOptions) {
    console.log('[rollup shim] rollup() called with:', inputOptions?.input);
    const bundle = await originalRollup(inputOptions);

    // Wrap the bundle object to intercept write()
    return {
        // Preserve all original bundle properties
        ...bundle,
        cache: bundle.cache,
        watchFiles: bundle.watchFiles,
        closed: bundle.closed,

        // Intercept close() to track bundle state
        close: async function() {
            console.log('[rollup shim] bundle.close() called');
            return bundle.close?.();
        },

        // Preserve generate() as-is
        generate: async function(outputOptions) {
            console.log('[rollup shim] bundle.generate() called');
            return bundle.generate(outputOptions);
        },

        // Intercept write() to use our VFS instead of WASI filesystem
        write: async function(outputOptions) {
            console.log('[rollup shim] bundle.write() called with dir:', outputOptions?.dir, 'file:', outputOptions?.file);

            // Use generate() to get output in memory, then write to our VFS
            const result = await bundle.generate(outputOptions);
            console.log('[rollup shim] generate() returned', result?.output?.length || 0, 'chunks');

            if (!fs || !fs.writeFileSync) {
                console.error('[rollup shim] fs.writeFileSync not available, cannot write output');
                return result;
            }

            if (!fs.mkdirSync) {
                console.error('[rollup shim] fs.mkdirSync not available, cannot create directories');
                return result;
            }

            const outDir = outputOptions?.dir || (outputOptions?.file ? (path?.dirname?.(outputOptions.file) || '/') : '/dist');
            console.log('[rollup shim] Output directory:', outDir);

            // Ensure output directory exists
            try {
                fs.mkdirSync(outDir, { recursive: true });
                console.log('[rollup shim] Created output directory:', outDir);
            } catch (err) {
                // Directory might already exist
                console.log('[rollup shim] mkdirSync result (may already exist):', err?.message || 'ok');
            }

            // Write each output chunk/asset to our VFS
            for (const chunk of result.output || []) {
                let filePath;
                if (outputOptions?.file && chunk.type === 'chunk' && chunk.isEntry) {
                    filePath = outputOptions.file;
                } else {
                    filePath = (path?.join ? path.join(outDir, chunk.fileName) : outDir + '/' + chunk.fileName);
                }

                // Ensure parent directory exists for this specific file
                const parentDir = path?.dirname ? path.dirname(filePath) : filePath.substring(0, filePath.lastIndexOf('/'));
                if (parentDir && parentDir !== outDir) {
                    try {
                        fs.mkdirSync(parentDir, { recursive: true });
                    } catch (err) {
                        // Directory might already exist
                    }
                }

                // Write the file content
                if (chunk.type === 'chunk') {
                    console.log('[rollup shim] Writing chunk:', filePath, '(' + (chunk.code?.length || 0) + ' bytes)');
                    fs.writeFileSync(filePath, chunk.code || '');

                    // Write sourcemap if present
                    if (chunk.map && outputOptions?.sourcemap) {
                        const mapPath = filePath + '.map';
                        console.log('[rollup shim] Writing sourcemap:', mapPath);
                        fs.writeFileSync(mapPath, JSON.stringify(chunk.map));
                    }
                } else if (chunk.type === 'asset') {
                    console.log('[rollup shim] Writing asset:', filePath, '(' + (chunk.source?.length || 0) + ' bytes)');
                    fs.writeFileSync(filePath, chunk.source || '');
                }
            }

            console.log('[rollup shim] bundle.write() complete, wrote', result.output?.length || 0, 'files to', outDir);
            return result;
        }
    };
};

export const watch = rolldownInternal.watch;
export const VERSION = rolldownInternal.VERSION || '4.0.0';

// Default export - ensure rollup function is on it
const shimExports = {
    ...rolldownInternal,
    rollup,
    parseAst,
    parseAstAsync,
    watch,
    VERSION
};
export default shimExports;
`
}

/**
 * Generate a shim for esbuild that maps to @rolldown/browser
 *
 * Key mappings (esbuild -> rolldown):
 * - entryPoints -> input
 * - absWorkingDir -> cwd
 * - outdir -> output.dir
 * - outfile -> output.file
 * - format -> output.format
 * - sourcemap -> output.sourcemap
 * - minify -> output.minify (partial)
 * - external -> external
 * - platform -> platform
 * - loader -> moduleTypes (different format)
 * - resolveExtensions -> resolve.extensions
 * - mainFields -> resolve.mainFields
 * - conditions -> resolve.conditions
 */
function generateEsbuildShim(specifier: string): string {
    return `// esbuild shim -> @rolldown/browser
// Maps esbuild API to rolldown API
const rolldown = globalThis.__rolldown__ || {};
const fs = globalThis.__node_fs || globalThis.__node_fs__;

// Transform using rolldown's transformSync
export const transform = async (code, options = {}) => {
    console.log('[esbuild shim] transform()');
    if (rolldown.transformSync) {
        try {
            const result = rolldown.transformSync(options.sourcefile || 'input.js', code, {
                loader: options.loader,
                target: options.target,
                jsx: options.jsx,
                jsxFactory: options.jsxFactory,
                jsxFragment: options.jsxFragment,
            });
            return { code: result.code, map: result.map || '', warnings: [] };
        } catch (err) {
            return { code, map: '', warnings: [{ text: err?.message || String(err) }] };
        }
    }
    // Fallback: return code as-is
    return { code, map: '', warnings: [] };
};

export const transformSync = (code, options = {}) => {
    console.log('[esbuild shim] transformSync()');
    if (rolldown.transformSync) {
        try {
            const result = rolldown.transformSync(options.sourcefile || 'input.js', code, {
                loader: options.loader,
                target: options.target,
            });
            return { code: result.code, map: result.map || '', warnings: [] };
        } catch (err) {
            return { code, map: '', warnings: [{ text: err?.message || String(err) }] };
        }
    }
    return { code, map: '', warnings: [] };
};

/**
 * Convert esbuild loader map to rolldown moduleTypes
 * esbuild: { '.png': 'dataurl', '.txt': 'text' }
 * rolldown: { '**/*.png': 'dataurl', '**/*.txt': 'text' }
 */
function convertLoader(loader) {
    if (!loader) return undefined;
    const moduleTypes = {};
    for (const [ext, type] of Object.entries(loader)) {
        const pattern = ext.startsWith('.') ? '**/*' + ext : '**/*.' + ext;
        moduleTypes[pattern] = type;
    }
    return moduleTypes;
}

/**
 * Build using rolldown - maps esbuild options to rolldown options
 */
export const build = async (options = {}) => {
    console.log('[esbuild shim] build()', {
        entryPoints: options.entryPoints,
        stdin: !!options.stdin,
        write: options.write
    });

    if (!rolldown.build) {
        throw new Error('build not available - @rolldown/browser not loaded');
    }

    // Map esbuild options to rolldown options
    const rolldownOptions = {
        // Entry points: esbuild uses entryPoints, rolldown uses input
        input: options.entryPoints || options.input,

        // Working directory
        cwd: options.absWorkingDir,

        // External modules
        external: options.external,

        // Platform (browser/node/neutral)
        platform: options.platform,

        // Treeshaking
        treeshake: options.treeShaking !== false,

        // Module types (converted from esbuild's loader)
        moduleTypes: convertLoader(options.loader),

        // Resolve options
        resolve: {
            extensions: options.resolveExtensions,
            mainFields: options.mainFields,
            conditions: options.conditions,
        },

        // Output options - rolldown uses nested output object
        output: {
            dir: options.outdir,
            file: options.outfile,
            format: options.format === 'iife' ? 'iife' : options.format === 'cjs' ? 'cjs' : 'esm',
            sourcemap: options.sourcemap,
            minify: options.minify,
            name: options.globalName, // for IIFE
        },

        // Plugins
        plugins: options.plugins || [],
    };

    // Handle stdin input (virtual file)
    if (options.stdin) {
        const stdinPath = options.stdin.sourcefile || '/stdin.js';
        rolldownOptions.input = stdinPath;
        rolldownOptions.plugins = [
            {
                name: 'stdin-plugin',
                resolveId(id) {
                    if (id === stdinPath) return id;
                    return null;
                },
                load(id) {
                    if (id === stdinPath) return options.stdin.contents;
                    return null;
                }
            },
            ...(options.plugins || [])
        ];
    }

    // Clean up undefined values
    Object.keys(rolldownOptions).forEach(key => {
        if (rolldownOptions[key] === undefined) delete rolldownOptions[key];
    });
    if (rolldownOptions.resolve) {
        Object.keys(rolldownOptions.resolve).forEach(key => {
            if (rolldownOptions.resolve[key] === undefined) delete rolldownOptions.resolve[key];
        });
        if (Object.keys(rolldownOptions.resolve).length === 0) delete rolldownOptions.resolve;
    }
    if (rolldownOptions.output) {
        Object.keys(rolldownOptions.output).forEach(key => {
            if (rolldownOptions.output[key] === undefined) delete rolldownOptions.output[key];
        });
        if (Object.keys(rolldownOptions.output).length === 0) delete rolldownOptions.output;
    }

    console.log('[esbuild shim] Mapped to rolldown options:', JSON.stringify(rolldownOptions, null, 2));

    try {
        const result = await rolldown.build(rolldownOptions);
        console.log('[esbuild shim] build() completed successfully');

        // Convert rolldown result to esbuild result format
        const outputFiles = [];
        if (result.output) {
            for (const chunk of result.output) {
                const path = chunk.fileName || 'out.js';
                const contents = chunk.type === 'chunk' ? chunk.code : chunk.source;
                outputFiles.push({
                    path,
                    contents: typeof contents === 'string' ? new TextEncoder().encode(contents) : contents,
                    text: typeof contents === 'string' ? contents : new TextDecoder().decode(contents),
                });
            }
        }

        // Write files if write !== false
        if (options.write !== false && fs && fs.writeFileSync) {
            const outDir = options.outdir || (options.outfile ? options.outfile.substring(0, options.outfile.lastIndexOf('/')) : '/dist');
            if (fs.mkdirSync) {
                try { fs.mkdirSync(outDir, { recursive: true }); } catch {}
            }
            for (const file of outputFiles) {
                const filePath = options.outfile || (outDir + '/' + file.path);
                console.log('[esbuild shim] Writing:', filePath);
                fs.writeFileSync(filePath, file.text);
            }
        }

        return {
            errors: [],
            warnings: [],
            outputFiles: options.write === false ? outputFiles : undefined,
            metafile: options.metafile ? { inputs: {}, outputs: {} } : undefined,
        };
    } catch (err) {
        console.error('[esbuild shim] build() failed:', err?.message || err);
        return {
            errors: [{ text: err?.message || String(err), location: null }],
            warnings: [],
            outputFiles: [],
        };
    }
};

export const buildSync = () => {
    throw new Error('buildSync not supported in browser');
};

export const context = async (options = {}) => {
    console.log('[esbuild shim] context()');
    return {
        rebuild: () => build(options),
        watch: () => Promise.resolve(),
        serve: () => Promise.resolve({ host: 'localhost', port: 0 }),
        cancel: () => {},
        dispose: () => {},
    };
};

export const formatMessages = async (messages, options) => messages.map(m => m.text || String(m));
export const formatMessagesSync = (messages, options) => messages.map(m => m.text || String(m));
export const analyzeMetafile = async (metafile) => JSON.stringify(metafile, null, 2);
export const analyzeMetafileSync = (metafile) => JSON.stringify(metafile, null, 2);
export const initialize = async () => { console.log('[esbuild shim] initialize()'); };
export const version = '0.20.0';
export const stop = () => {};

export default {
    build, buildSync, transform, transformSync,
    formatMessages, formatMessagesSync,
    analyzeMetafile, analyzeMetafileSync,
    context, initialize, version, stop
};
`
}

/**
 * Generate inline shim for @rolldown/pluginutils
 * This is a pure JS package providing composable filter utilities for Rolldown plugins.
 * NOT the same as @rollup/pluginutils — completely different API.
 * Source: https://github.com/rolldown/rolldown (MIT license)
 */
function generateRolldownPluginutilsShim(): string {
    return `// @rolldown/pluginutils inline shim
// Composable filter utilities for Rolldown plugin hook filters

// --- utils ---
const postfixRE = /[?#].*$/;
export function cleanUrl(url) { return url.replace(postfixRE, ''); }
export function extractQueryWithoutFragment(url) {
    const qi = url.indexOf('?');
    if (qi === -1) return '';
    const fi = url.indexOf('#', qi);
    return fi === -1 ? url.substring(qi) : url.substring(qi, fi);
}

// --- simple filters ---
const escapeRegexRE = /[-\\/\\\\^$*+?.()|[\\]{}]/g;
function escapeRegex(str) { return str.replace(escapeRegexRE, '\\\\$&'); }

export function exactRegex(str, flags) { return new RegExp('^' + escapeRegex(str) + '$', flags); }
export function prefixRegex(str, flags) { return new RegExp('^' + escapeRegex(str), flags); }

export function makeIdFiltersToMatchWithQuery(input) {
    if (!Array.isArray(input)) return makeIdFilterToMatchWithQuery(input);
    return input.map(i => makeIdFilterToMatchWithQuery(i));
}
function makeIdFilterToMatchWithQuery(input) {
    if (typeof input === 'string') return input + '{?*,}';
    return makeRegexIdFilterToMatchWithQuery(input);
}
function makeRegexIdFilterToMatchWithQuery(input) {
    return new RegExp(input.source.replace(/(?<!\\\\)\\$/g, '(?:\\\\?.*)?$'), input.flags);
}

// --- composable filters ---
class And { constructor(...args) { this.args = args; this.kind = 'and'; } }
class Or { constructor(...args) { this.args = args; this.kind = 'or'; } }
class Not { constructor(expr) { this.expr = expr; this.kind = 'not'; } }
class Id { constructor(p, params) { this.pattern = p; this.kind = 'id'; this.params = params ?? { cleanUrl: false }; } }
class ImporterId { constructor(p, params) { this.pattern = p; this.kind = 'importerId'; this.params = params ?? { cleanUrl: false }; } }
class ModuleType { constructor(p) { this.pattern = p; this.kind = 'moduleType'; } }
class Code { constructor(p) { this.pattern = p; this.kind = 'code'; } }
class Query { constructor(k, p) { this.key = k; this.pattern = p; this.kind = 'query'; } }
class Include { constructor(e) { this.expr = e; this.kind = 'include'; } }
class Exclude { constructor(e) { this.expr = e; this.kind = 'exclude'; } }

export function and(...args) { return new And(...args); }
export function or(...args) { return new Or(...args); }
export function not(expr) { return new Not(expr); }
export function id(pattern, params) { return new Id(pattern, params); }
export function importerId(pattern, params) { return new ImporterId(pattern, params); }
export function moduleType(pattern) { return new ModuleType(pattern); }
export function code(pattern) { return new Code(pattern); }
export function query(key, pattern) { return new Query(key, pattern); }
export function include(expr) { return new Include(expr); }
export function exclude(expr) { return new Exclude(expr); }

export function queries(queryFilter) {
    const arr = Object.entries(queryFilter).map(([k, v]) => new Query(k, v));
    return and(...arr);
}

export function exprInterpreter(expr, code, id, moduleType, importerId, ctx = {}) {
    switch (expr.kind) {
        case 'and': return expr.args.every(e => exprInterpreter(e, code, id, moduleType, importerId, ctx));
        case 'or': return expr.args.some(e => exprInterpreter(e, code, id, moduleType, importerId, ctx));
        case 'not': return !exprInterpreter(expr.expr, code, id, moduleType, importerId, ctx);
        case 'id': {
            if (id === undefined) throw new Error('id required');
            let m = id; if (expr.params.cleanUrl) m = cleanUrl(m);
            return typeof expr.pattern === 'string' ? m === expr.pattern : expr.pattern.test(m);
        }
        case 'importerId': {
            if (importerId === undefined) return false;
            let m = importerId; if (expr.params.cleanUrl) m = cleanUrl(m);
            return typeof expr.pattern === 'string' ? m === expr.pattern : expr.pattern.test(m);
        }
        case 'moduleType': return moduleType === expr.pattern;
        case 'code': {
            if (code === undefined) throw new Error('code required');
            return typeof expr.pattern === 'string' ? code.includes(expr.pattern) : expr.pattern.test(code);
        }
        case 'query': {
            if (id === undefined) throw new Error('id required');
            if (!ctx.urlSearchParamsCache) ctx.urlSearchParamsCache = new URLSearchParams(extractQueryWithoutFragment(id));
            const p = ctx.urlSearchParamsCache;
            if (typeof expr.pattern === 'boolean') return expr.pattern ? p.has(expr.key) : !p.has(expr.key);
            if (typeof expr.pattern === 'string') return p.get(expr.key) === expr.pattern;
            return expr.pattern.test(p.get(expr.key) ?? '');
        }
        default: throw new Error('Unexpected expression: ' + JSON.stringify(expr));
    }
}

export function interpreterImpl(expr, code, id, moduleType, importerId, ctx = {}) {
    let hasInclude = false;
    for (const e of expr) {
        if (e.kind === 'include') { hasInclude = true; if (exprInterpreter(e.expr, code, id, moduleType, importerId, ctx)) return true; }
        else if (e.kind === 'exclude') { if (exprInterpreter(e.expr, code, id, moduleType, importerId, ctx)) return false; }
    }
    return !hasInclude;
}

export function interpreter(exprs, code, id, moduleType, importerId) {
    return interpreterImpl(Array.isArray(exprs) ? exprs : [exprs], code, id, moduleType, importerId);
}

// --- filter-vite-plugins ---
export function filterVitePlugins(plugins) {
    if (!plugins) return [];
    const arr = Array.isArray(plugins) ? plugins : [plugins];
    const result = [];
    for (const plugin of arr) {
        if (!plugin) continue;
        if (Array.isArray(plugin)) { result.push(...filterVitePlugins(plugin)); continue; }
        if ('apply' in plugin) {
            const a = plugin.apply;
            if (typeof a === 'function') { try { if (a({}, { command: 'build', mode: 'production' })) result.push(plugin); } catch { result.push(plugin); } }
            else if (a === 'serve') continue;
            else result.push(plugin);
        } else result.push(plugin);
    }
    return result;
}

export default {
    exactRegex, prefixRegex, makeIdFiltersToMatchWithQuery,
    and, or, not, id, importerId, moduleType, code, query, include, exclude,
    queries, interpreter, interpreterImpl, exprInterpreter, filterVitePlugins,
    cleanUrl, extractQueryWithoutFragment
};
`
}

/**
 * Get common exports for a builtin module (for named exports)
 */
function getCommonExports(specifier: string): Set<string> {
    const name = specifier.startsWith('node:') ? specifier.slice(5) : specifier

    // Common exports for frequently used modules
    const exports: Record<string, string[]> = {
        'fs': ['readFileSync', 'writeFileSync', 'existsSync', 'mkdirSync', 'readdirSync', 'statSync', 'unlinkSync', 'rmdirSync', 'promises', 'readFile', 'writeFile', 'mkdir', 'readdir', 'stat', 'unlink', 'rmdir', 'copyFile', 'rename', 'access', 'constants'],
        'fs/promises': ['readFile', 'writeFile', 'mkdir', 'readdir', 'stat', 'unlink', 'rmdir', 'copyFile', 'rename', 'access'],
        'path': ['join', 'resolve', 'dirname', 'basename', 'extname', 'relative', 'isAbsolute', 'normalize', 'parse', 'format', 'sep', 'posix', 'win32'],
        'url': ['URL', 'URLSearchParams', 'parse', 'format', 'resolve', 'fileURLToPath', 'pathToFileURL'],
        'util': ['promisify', 'inspect', 'format', 'deprecate', 'inherits', 'isDeepStrictEqual', 'types', 'TextDecoder', 'TextEncoder'],
        'events': ['EventEmitter', 'once', 'on'],
        'stream': ['Readable', 'Writable', 'Duplex', 'Transform', 'PassThrough', 'pipeline', 'finished'],
        'buffer': ['Buffer', 'Blob', 'atob', 'btoa'],
        'crypto': ['randomBytes', 'createHash', 'createHmac', 'randomUUID', 'subtle'],
        'os': ['platform', 'arch', 'homedir', 'tmpdir', 'hostname', 'cpus', 'freemem', 'totalmem', 'type', 'release', 'EOL'],
        'process': ['env', 'cwd', 'argv', 'exit', 'nextTick', 'platform', 'arch', 'version', 'versions', 'stdout', 'stderr', 'stdin'],
        'http': ['createServer', 'request', 'get', 'Agent', 'Server', 'IncomingMessage', 'ServerResponse', 'STATUS_CODES'],
        'https': ['createServer', 'request', 'get', 'Agent', 'Server'],
        'module': ['createRequire', 'builtinModules', 'Module'],
        'assert': ['ok', 'equal', 'notEqual', 'deepEqual', 'notDeepEqual', 'strictEqual', 'notStrictEqual', 'deepStrictEqual', 'notDeepStrictEqual', 'fail', 'throws', 'doesNotThrow', 'rejects', 'doesNotReject'],
        'perf_hooks': ['performance', 'PerformanceObserver'],
        'querystring': ['parse', 'stringify', 'escape', 'unescape'],
        'timers': ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'setImmediate', 'clearImmediate'],
        'tty': ['isatty', 'ReadStream', 'WriteStream'],
        'zlib': ['gzip', 'gunzip', 'deflate', 'inflate', 'createGzip', 'createGunzip', 'createDeflate', 'createInflate'],
        'readline': ['createInterface', 'Interface'],
        'child_process': ['spawn', 'exec', 'execSync', 'execFile', 'fork', 'spawnSync'],
        'net': ['createServer', 'createConnection', 'connect', 'Socket', 'Server'],
    }

    return new Set(exports[name] || [])
}

// Primary client ID getter (set by service worker)
let getPrimaryClientId: (() => string | null) | null = null

export function setPrimaryClientIdGetter(getter: () => string | null): void {
    getPrimaryClientId = getter
}

// Pending file read requests waiting for client response
const pendingReads = new Map<string, {
    resolve: (content: Uint8Array | null) => void
    reject: (error: Error) => void
}>()

// Cache resolved module paths and content
const moduleCache = new Map<string, { content: string; timestamp: number }>()
const pathCache = new Map<string, { resolved: string | null; timestamp: number }>()
const CACHE_TTL_MS = 10000 // 10 second cache

/**
 * Module resolution cache: maps bare specifiers to resolved absolute file paths.
 * Used by rewriteImports/wrapCjsAsEsm to emit deterministic ~file/ URLs instead
 * of specifier?from= URLs, preventing combinatorial module loading explosion.
 * (e.g., the browser treating postcss?from=/a and postcss?from=/b as different modules)
 */
const resolvedSpecifierCache = new Map<string, string>()

/**
 * Request a file read from a client (which uses sync fs infrastructure)
 * Prefers the primary client since it has direct VFS access
 */
async function requestFileRead(filePath: string): Promise<Uint8Array | null> {
    const requestId = `${filePath}-${Date.now()}-${Math.random()}`

    // Try to use the primary client first (has direct VFS access)
    const primaryId = getPrimaryClientId?.()
    let client: Client | undefined
    let clientSource = 'none'

    if (primaryId) {
        client = await sw.clients.get(primaryId)
        if (client) clientSource = 'primary'
    }

    // Fall back to any available client if primary not available
    if (!client) {
        const clients = await sw.clients.matchAll({ type: 'window' })
        if (clients.length === 0) {
            console.error('[ModuleServer] No clients available for file read')
            return null
        }
        client = clients[0]
        clientSource = 'fallback'
    }

    console.log(`[ModuleServer] Requesting file read via ${clientSource} client: ${filePath}`)

    return new Promise((resolve, reject) => {
        // Set up timeout
        const timeout = setTimeout(() => {
            pendingReads.delete(requestId)
            console.error(`[ModuleServer] File read timeout after 5s: ${filePath}`)
            reject(new Error(`File read timeout: ${filePath}`))
        }, 5000)

        pendingReads.set(requestId, {
            resolve: (content) => {
                clearTimeout(timeout)
                pendingReads.delete(requestId)
                console.log(`[ModuleServer] File read response received: ${filePath} (${content?.length || 0} bytes)`)
                resolve(content)
            },
            reject: (error) => {
                clearTimeout(timeout)
                pendingReads.delete(requestId)
                reject(error)
            }
        })

        // Send read request to client
        client!.postMessage({
            type: 'vfs-read-request',
            requestId,
            filePath
        })
    })
}

/**
 * Handle file read response from client
 */
export function handleFileReadResponse(requestId: string, content: Uint8Array | null, error?: string): void {
    const pending = pendingReads.get(requestId)
    if (!pending) {
        console.warn('[ModuleServer] No pending request for:', requestId)
        return
    }

    if (error) {
        pending.reject(new Error(error))
    } else {
        pending.resolve(content)
    }
}

/**
 * Read a file from VFS via client
 */
async function readFileFromVfs(filePath: string): Promise<Uint8Array | null> {
    try {
        const content = await requestFileRead(filePath)
        if (content && content.length > 0) {
            return content
        }
        return null // 0-byte = likely a directory
    } catch (err) {
        console.error('[ModuleServer] Error reading file:', filePath, err)
        return null
    }
}

/**
 * Check if a file exists in VFS by trying to read it
 */
async function fileExists(filePath: string): Promise<boolean> {
    // Check path cache first
    const cached = pathCache.get(filePath)
    if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
        return cached.resolved !== null
    }

    const content = await readFileFromVfs(filePath)
    // Require non-empty content: 0-byte results typically mean a directory was read
    // (VFS returns empty data for directories instead of ENOENT)
    const exists = content !== null && content.length > 0
    pathCache.set(filePath, { resolved: exists ? filePath : null, timestamp: Date.now() })
    return exists
}

/**
 * Try multiple paths and return the first one that exists
 */
async function tryPaths(paths: string[]): Promise<string | null> {
    for (const path of paths) {
        if (await fileExists(path)) {
            return path
        }
    }
    return null
}

/**
 * Resolve a module specifier to a VFS file path
 * Handles: postcss → /node_modules/postcss/lib/postcss.js (via package.json)
 *
 * Optimized: reads package.json FIRST to skip non-existent directories quickly (1 read)
 * instead of trying multiple direct paths (4-7 reads per directory).
 * For subpath imports, checks exports before direct paths (matches Node.js algorithm).
 */
async function resolveModulePath(specifier: string, importerDir?: string | null): Promise<string | null> {
    // Check cache first (include importerDir in cache key for correctness)
    const cacheKey = importerDir ? `${specifier}::${importerDir}` : specifier
    const cached = pathCache.get(cacheKey)
    if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
        return cached.resolved
    }

    // Remove node: prefix
    const cleanSpec = specifier.startsWith('node:') ? specifier.slice(5) : specifier

    // Try direct path first (only for path-like specifiers, not bare package names)
    const isBareSpecifier = !cleanSpec.startsWith('/') && !cleanSpec.startsWith('.')
    if (!isBareSpecifier) {
        const basePath = cleanSpec.startsWith('/') ? cleanSpec : `/${cleanSpec}`
        const directResult = await tryPaths([
            basePath,
            `${basePath}.js`,
            `${basePath}.mjs`,
            `${basePath}/index.js`,
            `${basePath}/index.mjs`,
        ])
        if (directResult) {
            pathCache.set(cacheKey, { resolved: directResult, timestamp: Date.now() })
            return directResult
        }
        // For absolute paths, don't fall through to node_modules walk-up
        // (would construct nonsensical paths like /node_modules//ecommerce/...)
        if (cleanSpec.startsWith('/')) {
            console.warn('[ModuleServer] Direct path not found, not falling through to node_modules:', cleanSpec)
            pathCache.set(cacheKey, { resolved: null, timestamp: Date.now() })
            return null
        }
    }

    // Build node_modules search paths by walking up from importer directory
    // This mirrors Node.js module resolution: check node_modules at each parent level
    // Skip directories that would create invalid paths
    const nodeModulesPaths: string[] = []
    if (importerDir) {
        const parts = importerDir.split('/').filter(Boolean)
        for (let i = parts.length; i >= 0; i--) {
            // Skip node_modules directories (would create node_modules/node_modules)
            if (i > 0 && parts[i - 1] === 'node_modules') continue
            // Skip scope directories (@scope/pkg) — scopes don't have their own node_modules
            if (i > 0 && parts[i - 1].startsWith('@')) continue
            const dir = '/' + parts.slice(0, i).join('/')
            const nmDir = (dir === '/' ? '' : dir) + '/node_modules'
            nodeModulesPaths.push(nmDir)
        }
    }
    // Always include root node_modules as fallback
    if (!nodeModulesPaths.includes('/node_modules')) {
        nodeModulesPaths.push('/node_modules')
    }

    // Parse package name and subpath
    let packageName: string
    let subPath: string | null = null

    if (cleanSpec.startsWith('@')) {
        const parts = cleanSpec.split('/')
        packageName = parts.length >= 2 ? `${parts[0]}/${parts[1]}` : cleanSpec
        subPath = parts.length > 2 ? parts.slice(2).join('/') : null
    } else {
        const slashIdx = cleanSpec.indexOf('/')
        if (slashIdx > 0) {
            packageName = cleanSpec.slice(0, slashIdx)
            subPath = cleanSpec.slice(slashIdx + 1)
        } else {
            packageName = cleanSpec
        }
    }

    for (const nmPath of nodeModulesPaths) {
        const pkgPath = `${nmPath}/${packageName}`

        // Read package.json FIRST — if it doesn't exist, skip this node_modules entirely.
        // This is the key optimization: 1 read to skip vs. 4-7 reads trying direct paths.
        const pkgJsonData = await readFileFromVfs(`${pkgPath}/package.json`)
        if (!pkgJsonData) continue // Package not in this node_modules

        let pkgJson: any
        try {
            pkgJson = JSON.parse(new TextDecoder().decode(pkgJsonData))
        } catch {
            continue // Invalid package.json
        }

        if (subPath) {
            // Subpath resolution: check exports FIRST (Node.js algorithm),
            // then fall back to direct paths. Don't fall through to main entry.
            const subResult = await resolveSubpath(pkgPath, subPath, pkgJson)
            if (subResult) {
                pathCache.set(cacheKey, { resolved: subResult, timestamp: Date.now() })
                return subResult
            }
            // Subpath not found in this package — try next node_modules
            continue
        }

        // Main entry resolution: exports['.'] > module > main > index.js
        let entry: string | null = null
        if (pkgJson.exports) {
            if (typeof pkgJson.exports === 'string') {
                entry = pkgJson.exports
            } else if (pkgJson.exports['.']) {
                entry = resolveExportCondition(pkgJson.exports['.'])
            }
        }
        if (!entry && pkgJson.module) entry = pkgJson.module
        if (!entry && pkgJson.main) entry = pkgJson.main
        if (!entry) entry = 'index.js'

        const entryPath = `${pkgPath}/${entry.replace(/^\.\//, '')}`
        const entryResult = await tryPaths([
            entryPath,
            `${entryPath}.js`,
            `${entryPath}.mjs`,
        ])
        if (entryResult) {
            pathCache.set(cacheKey, { resolved: entryResult, timestamp: Date.now() })
            return entryResult
        }

        // Fallback to index.js
        const fallbackResult = await tryPaths([
            `${pkgPath}/index.js`,
            `${pkgPath}/index.mjs`,
        ])
        if (fallbackResult) {
            pathCache.set(cacheKey, { resolved: fallbackResult, timestamp: Date.now() })
            return fallbackResult
        }
    }

    pathCache.set(cacheKey, { resolved: null, timestamp: Date.now() })
    return null
}

/**
 * Resolve a subpath import using package.json exports, then direct paths.
 * Matches Node.js resolution: exports take priority over direct file access.
 */
async function resolveSubpath(pkgPath: string, subPath: string, pkgJson: any): Promise<string | null> {
    // 1. Check exports map first (Node.js resolution algorithm)
    if (pkgJson.exports && typeof pkgJson.exports === 'object') {
        // Try various subpath patterns
        const subpathPatterns = [
            `./${subPath}`,
            `./${subPath.replace(/\.js$/, '')}`,
            `./${subPath.replace(/\.mjs$/, '')}`,
        ]

        for (const pattern of subpathPatterns) {
            const exp = pkgJson.exports[pattern]
            if (exp) {
                const resolved = resolveExportCondition(exp)
                if (resolved) {
                    const resolvedPath = `${pkgPath}/${resolved.replace(/^\.\//, '')}`
                    const subExportResult = await tryPaths([
                        resolvedPath,
                        `${resolvedPath}.js`,
                        `${resolvedPath}.mjs`,
                    ])
                    if (subExportResult) {
                        return subExportResult
                    }
                }
            }
        }

        // Try wildcard exports pattern matching
        for (const [key, value] of Object.entries(pkgJson.exports)) {
            if (key.includes('*')) {
                // Pattern like "./*" or "./lib/*"
                const pattern = key.replace(/\*/g, '(.*)')
                const regex = new RegExp(`^${pattern.replace(/\//g, '\\/')}$`)
                const match = `./${subPath}`.match(regex)
                if (match && match[1]) {
                    const resolved = resolveExportCondition(value)
                    if (resolved) {
                        const actualPath = resolved.replace(/\*/g, match[1])
                        const wildcardPath = `${pkgPath}/${actualPath.replace(/^\.\//, '')}`
                        const wildcardResult = await tryPaths([
                            wildcardPath,
                            `${wildcardPath}.js`,
                            `${wildcardPath}.mjs`,
                        ])
                        if (wildcardResult) {
                            return wildcardResult
                        }
                    }
                }
            }
        }
    }

    // 2. Fall back to direct paths (for packages without exports map)
    return tryPaths([
        `${pkgPath}/${subPath}`,
        `${pkgPath}/${subPath}.js`,
        `${pkgPath}/${subPath}.mjs`,
        `${pkgPath}/${subPath}/index.js`,
    ])
}

/**
 * Handle a fetch request for a VFS module
 */
export async function handleModuleFetch(request: Request): Promise<Response | null> {
    const url = new URL(request.url)

    // Handle /vfs-config/ requests - serve bundled config code
    if (url.pathname.startsWith(VFS_CONFIG_PREFIX)) {
        const configPath = decodeURIComponent(url.pathname.slice(VFS_CONFIG_PREFIX.length))
        console.log('[ModuleServer] Config request:', configPath)

        const bundledCode = getBundledConfigFromSW(configPath)
        if (bundledCode) {
            console.log(`[ModuleServer] Serving bundled config for: ${configPath} (${bundledCode.length} bytes)`)
            console.log(`[ModuleServer] Config content preview: ${bundledCode.substring(0, 500).replace(/\n/g, '\\n')}...`)
            return moduleResponse(bundledCode)
        }

        console.warn('[ModuleServer] No bundled config found for:', configPath)
        return moduleResponse(`// Config not found: ${configPath}\nthrow new Error("Config not found: ${configPath}");`, 404)
    }

    // Only handle /vfs-module/ requests
    if (!url.pathname.startsWith(VFS_MODULE_PREFIX)) {
        return null
    }

    let specifier = decodeURIComponent(url.pathname.slice(VFS_MODULE_PREFIX.length))
    // Normalize file paths: if specifier looks like a VFS path (contains node_modules or file extensions)
    // but is missing leading /, add it. This happens when blob URL imports use absolute /vfs-module/ paths.
    // Don't touch ~file/ prefixed specifiers — those are handled separately below.
    if (!specifier.startsWith('/') && !specifier.startsWith('@') && !specifier.startsWith('~file/') &&
        (specifier.includes('/node_modules/') || specifier.includes('.mjs') || specifier.includes('.js'))) {
        specifier = '/' + specifier
    }
    // Extract importer directory from ?from= param (tells us which node_modules to search)
    const importerDir = url.searchParams.get('from') ? decodeURIComponent(url.searchParams.get('from')!) : null
    console.log('[ModuleServer] Fetching module:', specifier, importerDir ? `(from ${importerDir})` : '')

    // @rolldown/pluginutils — serve inline shim (pure JS composable filter utilities)
    // This is NOT the same as @rollup/pluginutils — completely different API
    if (specifier === '@rolldown/pluginutils' || specifier.startsWith('@rolldown/pluginutils/')) {
        console.log('[ModuleServer] Serving @rolldown/pluginutils shim:', specifier)
        return moduleResponse(generateRolldownPluginutilsShim())
    }

    // Redirect rollup imports to @rolldown/browser (which is loaded globally)
    // rollup's native.js requires WASM/native bindings that don't exist in browser
    // @rolldown/browser provides API-compatible implementation
    if (specifier === 'rollup' || specifier === 'rollup/parseAst' ||
        specifier.startsWith('rollup/') || specifier.includes('rollup/dist/')) {
        console.log('[ModuleServer] Redirecting rollup to @rolldown/browser shim:', specifier)
        return moduleResponse(generateRolldownShim(specifier))
    }

    // Redirect esbuild imports to browser shim (native bindings required)
    if (specifier === 'esbuild' || specifier.startsWith('esbuild/')) {
        console.log('[ModuleServer] Redirecting esbuild to browser shim:', specifier)
        return moduleResponse(generateEsbuildShim(specifier))
    }

    // Handle native deps that have globalThis polyfills
    // These are externalized by rolldown and loaded separately (WASM, no-op stubs, etc.)
    if (specifier === 'lightningcss' || specifier.startsWith('lightningcss/')) {
        console.log('[ModuleServer] Serving lightningcss shim:', specifier)
        // Use lazy getters so values resolve at call time, not import time.
        // globalThis.__node_lightningcss is set asynchronously by lightningcss-loader.
        return moduleResponse(`// lightningcss shim -> globalThis.__node_lightningcss (lazy)
const _mod = () => globalThis.__node_lightningcss || {};
export default new Proxy({}, { get: (_, k) => _mod()[k] });
export function transform(opts) {
  const fn = _mod().transform;
  if (!fn) throw new Error('lightningcss not loaded yet');
  const r = fn(opts);
  if (r && !r.warnings) r.warnings = [];
  return r;
}
export function transformSync(opts) { return transform(opts); }
export function bundle(...a) { return _mod().bundle(...a); }
export function bundleAsync(...a) { return _mod().bundleAsync(...a); }
export function browserslistToTargets(...a) { return _mod().browserslistToTargets(...a); }
export function composeVisitors(...a) { return _mod().composeVisitors(...a); }
export function transformStyleAttribute(...a) { return _mod().transformStyleAttribute(...a); }
export const Features = new Proxy({}, { get(_, k) { return (_mod().Features || {})[k]; } });
`)
    }

    if (specifier === 'fsevents' || specifier.startsWith('fsevents/')) {
        // fsevents is macOS-only, return empty stub
        console.log('[ModuleServer] Serving fsevents stub:', specifier)
        return moduleResponse(`// fsevents stub (macOS-only, not available in browser)
export default {};
`)
    }

    // Handle pre-registered worker modules (~worker/ prefix)
    // Used for rayon sub-worker scripts: code is pre-transformed with absolute import URLs,
    // stored in SW via postMessage, and served as native ESM module workers.
    if (specifier.startsWith('~worker/')) {
        console.log('[ModuleServer] Worker module request:', specifier)

        // Check immediately, then retry with delays (store-worker-module may be in transit)
        const stored = workerModuleStore.get(specifier)
        if (stored && Date.now() - stored.timestamp < 60000) {
            console.log(`[ModuleServer] Serving worker module: ${specifier} (${stored.code.length} bytes)`)
            return moduleResponse(stored.code)
        }

        for (let i = 0; i < 30; i++) {
            await new Promise(r => setTimeout(r, 100))
            const retried = workerModuleStore.get(specifier)
            if (retried && Date.now() - retried.timestamp < 60000) {
                console.log(`[ModuleServer] Serving worker module after ${i + 1} retries: ${specifier}`)
                return moduleResponse(retried.code)
            }
        }

        console.error('[ModuleServer] Worker module not found after retries:', specifier)
        return moduleResponse(`// Worker module not found: ${specifier}\nthrow new Error("Worker module not found: ${specifier}");`, 500)
    }

    // Handle direct file paths (from relative import resolution)
    // ~file prefix indicates a direct VFS file path
    if (specifier.startsWith('~file/')) {
        const filePath = specifier.slice(5) // Remove '~file' prefix, keep leading /
        console.log('[ModuleServer] Direct file access:', filePath)

        // Redirect rollup files to @rolldown/browser shim
        if (filePath.includes('/rollup/dist/') || filePath.includes('/rollup/')) {
            const rollupSubpath = filePath.includes('/rollup/dist/')
                ? 'rollup/' + filePath.split('/rollup/dist/')[1]
                : 'rollup/' + filePath.split('/rollup/')[1]
            console.log('[ModuleServer] Redirecting rollup file to @rolldown/browser:', filePath, '->', rollupSubpath)
            return moduleResponse(generateRolldownShim(rollupSubpath))
        }

        // Check pre-registered worker module store first (exec worker pre-registers
        // transformed rayon worker scripts before VFS write propagates)
        const storedModule = workerModuleStore.get(filePath)
        if (storedModule && Date.now() - storedModule.timestamp < 60000) {
            console.log(`[ModuleServer] Serving pre-registered worker module: ${filePath} (${storedModule.code.length} bytes)`)
            workerModuleStore.delete(filePath) // One-time use
            return moduleResponse(storedModule.code)
        }

        let content = await readFileFromVfs(filePath)

        // Retry for files that may be in transit (written by exec worker, not yet visible).
        // The exec worker writes to VFS via SAB, and the service worker reads via postMessage.
        // There can be a propagation delay, so retry with short waits.
        if (!content) {
            for (let retry = 0; retry < 10; retry++) {
                await new Promise(r => setTimeout(r, 50))
                // Check if pre-registered module arrived via postMessage
                const stored = workerModuleStore.get(filePath)
                if (stored && Date.now() - stored.timestamp < 60000) {
                    console.log(`[ModuleServer] Serving pre-registered worker module (after ${retry + 1} retries): ${filePath}`)
                    workerModuleStore.delete(filePath)
                    return moduleResponse(stored.code)
                }
                content = await readFileFromVfs(filePath)
                if (content) {
                    console.log(`[ModuleServer] File found after ${retry + 1} retries: ${filePath}`)
                    break
                }
            }
        }

        if (!content) {
            // Try with common extensions
            for (const ext of ['.js', '.mjs', '.ts', '/index.js', '/index.mjs']) {
                const tryPath = filePath + ext
                const tryContent = await readFileFromVfs(tryPath)
                if (tryContent) {
                    const isJson = tryPath.endsWith('.json')
                    let responseContent: string
                    if (isJson) {
                        responseContent = `export default ${new TextDecoder().decode(tryContent)};`
                    } else {
                        responseContent = new TextDecoder().decode(tryContent)
                        if (isCjsModule(responseContent)) {
                            responseContent = wrapCjsAsEsm(responseContent, tryPath)
                        } else {
                            responseContent = rewriteImports(responseContent, tryPath)
                        }
                    }
                    return moduleResponse(responseContent, 200, isJson ? 'application/json' : 'application/javascript')
                }
            }
            console.warn('[ModuleServer] Direct file not found:', filePath)
            return moduleResponse(`// File not found: ${filePath}\nthrow new Error("File not found: ${filePath}");`, 404)
        }

        const isJson = filePath.endsWith('.json')
        let responseContent: string
        if (isJson) {
            responseContent = `export default ${new TextDecoder().decode(content)};`
        } else {
            responseContent = new TextDecoder().decode(content)
            if (isCjsModule(responseContent)) {
                responseContent = wrapCjsAsEsm(responseContent, filePath)
            } else {
                responseContent = rewriteImports(responseContent, filePath)
            }
        }
        return moduleResponse(responseContent, 200, isJson ? 'application/json' : 'application/javascript')
    }

    // Handle Node.js builtins - return shim that re-exports from globalThis
    if (isNodeBuiltin(specifier)) {
        console.log('[ModuleServer] Serving builtin shim:', specifier)
        return moduleResponse(generateBuiltinShim(specifier))
    }

    // Resolve the module path
    const resolvedPath = await resolveModulePath(specifier, importerDir)
    if (!resolvedPath) {
        console.warn('[ModuleServer] Module not found:', specifier)
        return moduleResponse(`// Module not found: ${specifier}\nthrow new Error("Module not found: ${specifier}");`, 404)
    }

    console.log('[ModuleServer] Resolved:', specifier, '->', resolvedPath)

    // Cache the resolution so rewriteImports can use ~file/ URLs for this specifier
    // instead of specifier?from= URLs. This deduplicates module loads: the same package
    // imported from different locations resolves to the same ~file URL.
    resolvedSpecifierCache.set(specifier, resolvedPath)

    // Serve the resolved file directly (can't use redirect — Chrome rejects redirects
    // for module worker scripts with redirect: 'error' mode)
    const content = await readFileFromVfs(resolvedPath)
    if (!content) {
        console.warn('[ModuleServer] Resolved file not readable:', resolvedPath)
        return moduleResponse(`// File not found: ${resolvedPath}\nthrow new Error("File not found: ${resolvedPath}");`, 404)
    }

    const isJson = resolvedPath.endsWith('.json')
    let responseContent: string
    if (isJson) {
        responseContent = `export default ${new TextDecoder().decode(content)};`
    } else {
        responseContent = new TextDecoder().decode(content)
        if (isCjsModule(responseContent)) {
            responseContent = wrapCjsAsEsm(responseContent, resolvedPath)
        } else {
            responseContent = rewriteImports(responseContent, resolvedPath)
        }
    }
    return moduleResponse(responseContent, 200, isJson ? 'application/json' : 'application/javascript')
}

/**
 * Resolve a relative path against a base path
 */
function resolveRelativePath(relativePath: string, basePath: string): string {
    // Get the directory of the base file
    const baseDir = basePath.substring(0, basePath.lastIndexOf('/')) || '/'

    if (relativePath.startsWith('./')) {
        return baseDir + relativePath.slice(1)
    }

    if (relativePath.startsWith('../')) {
        const parts = baseDir.split('/').filter(Boolean)
        const relParts = relativePath.split('/')

        for (const part of relParts) {
            if (part === '..') {
                parts.pop()
            } else if (part !== '.') {
                parts.push(part)
            }
        }

        return '/' + parts.join('/')
    }

    // Absolute path
    if (relativePath.startsWith('/')) {
        return relativePath
    }

    // Bare specifier - return as-is
    return relativePath
}

/**
 * Detect if code is CommonJS (uses require/module.exports without ESM syntax)
 * Returns true if the module should be wrapped in a CJS-to-ESM shim
 */
function isCjsModule(code: string): boolean {
    // Quick check: if it has top-level ESM syntax, it's ESM
    // Check for import/export at the start of lines (not inside strings/comments)
    const hasEsmImport = /^\s*import\s+/m.test(code)
    const hasEsmExport = /^\s*export\s+/m.test(code)
    if (hasEsmImport || hasEsmExport) return false

    // Check for CJS patterns
    const hasRequire = /\brequire\s*\(/m.test(code)
    const hasModuleExports = /\bmodule\.exports\b/m.test(code)
    const hasExportsAssign = /\bexports\.\w+\s*=/m.test(code)
    const hasDefineProperty = /Object\.defineProperty\s*\(\s*exports/m.test(code)

    return hasRequire || hasModuleExports || hasExportsAssign || hasDefineProperty
}

/**
 * Wrap a CJS module in an ESM-compatible shim
 * Provides module/exports/require/__dirname/__filename and re-exports as ESM default.
 *
 * Pre-scans require() calls and converts them to static ESM imports from /vfs-module/ URLs.
 * This routes CJS dependencies through the service worker (which can access VFS directly)
 * instead of relying on mockRequire's SAB-based VFS access in the exec worker.
 */
function wrapCjsAsEsm(code: string, filePath: string): string {
    const dirPath = filePath.substring(0, filePath.lastIndexOf('/')) || '/'

    // Pre-scan for static require() calls
    const requireRegex = /\brequire\s*\(\s*(['"])([^'"]+)\1\s*\)/g
    const deps = new Map<string, string>() // specifier -> variable name
    let match
    let counter = 0

    while ((match = requireRegex.exec(code)) !== null) {
        const specifier = match[2]
        if (!deps.has(specifier)) {
            deps.set(specifier, `__cjs_dep_${counter++}`)
        }
    }

    // Build static ESM imports for each dependency
    const imports: string[] = []
    const switchCases: string[] = []

    for (const [specifier, varName] of deps) {
        let moduleUrl: string

        if (specifier.startsWith('./') || specifier.startsWith('../')) {
            // Relative path - resolve to absolute, use ~file prefix for direct VFS access
            const resolved = resolveRelativePath(specifier, filePath)
            moduleUrl = `${VFS_MODULE_PREFIX}~file${resolved}`
        } else if (specifier.startsWith('/')) {
            moduleUrl = `${VFS_MODULE_PREFIX}~file${specifier}`
        } else {
            // Bare specifier: check resolution cache for deterministic ~file/ URL
            const cachedPath = resolvedSpecifierCache.get(specifier)
            if (cachedPath) {
                moduleUrl = `${VFS_MODULE_PREFIX}~file${cachedPath}`
            } else {
                moduleUrl = `${VFS_MODULE_PREFIX}${specifier}?from=${encodeURIComponent(dirPath)}`
            }
        }

        imports.push(`import ${varName} from '${moduleUrl}';`)
        // Escape single quotes in specifier for the switch case string
        const escapedSpec = specifier.replace(/'/g, "\\'")
        switchCases.push(`    case '${escapedSpec}': return ${varName};`)
    }

    const importSection = imports.length > 0 ? imports.join('\n') + '\n' : ''
    // Build a lazy switch-based require that defers import binding access until call time.
    // This avoids TDZ errors in circular dependencies — import bindings are only accessed
    // when require() is actually called, by which time the circular dep has resolved.
    const switchBody = switchCases.length > 0
        ? `\n  switch(id) {\n${switchCases.join('\n')}\n  }`
        : ''

    return `${importSection}// CJS-to-ESM wrapper for: ${filePath}
var module = { exports: {} };
var exports = module.exports;
var __filename = "${filePath}";
var __dirname = "${dirPath}";
var __baseRequire = globalThis.require || globalThis.__globalRequire || ((id) => { throw new Error("Cannot find module '" + id + "'"); });
var require = function(id) {${switchBody}
  return __baseRequire(id, __dirname);
};
require.resolve = __baseRequire.resolve ? function(id, opts) { return __baseRequire.resolve(id, opts || { paths: [__dirname] }); } : function(id) { return id; };
require.cache = __baseRequire.cache || {};
var process = globalThis.process || globalThis.__node_process || { env: {} };
var Buffer = globalThis.Buffer || undefined;
var global = globalThis;

${code}

// Use 'export { x as default }' instead of 'export default x' to avoid TDZ in circular deps.
// 'var' is hoisted (starts as undefined), so the binding is always accessible.
// 'export default expr' creates an uninitialized binding until the line executes → TDZ error.
var __cjsExports = module.exports;
export { __cjsExports as default };
export var __esModule = __cjsExports?.__esModule;
`
}

/**
 * Validate module code for common syntax issues
 * Logs warnings for patterns that might cause "Unexpected token '*'" errors
 */
function validateModuleCode(code: string, modulePath: string): void {
    // Check for malformed import * (missing "as namespace")
    const malformedImportStar = /\bimport\s+\*\s+from\b/g
    let match
    while ((match = malformedImportStar.exec(code)) !== null) {
        const start = Math.max(0, match.index - 20)
        const end = Math.min(code.length, match.index + 50)
        console.error(`[ModuleServer] MALFORMED 'import * from' in ${modulePath}: ...${code.slice(start, end)}...`)
    }

    // Check for export * patterns to trace what's being re-exported
    const exportStarPattern = /\bexport\s+\*\s+(?:as\s+\w+\s+)?from\s+/g
    let exportCount = 0
    while ((match = exportStarPattern.exec(code)) !== null) {
        exportCount++
        if (exportCount <= 5) {
            const start = Math.max(0, match.index)
            const end = Math.min(code.length, match.index + 80)
            console.log(`[ModuleServer] Found 'export *' in ${modulePath}: ${code.slice(start, end)}`)
        }
    }
    if (exportCount > 5) {
        console.log(`[ModuleServer] ... and ${exportCount - 5} more 'export *' patterns in ${modulePath}`)
    }
}

/**
 * Rewrite imports in a module to use /vfs-module/ paths
 * Simple regex-based transform (no AST needed)
 *
 * @param code - The module source code
 * @param basePath - The resolved file path (for resolving relative imports)
 */
function rewriteImports(code: string, basePath: string): string {
    // Validate before rewriting
    validateModuleCode(code, basePath)
    // Derive the directory of the resolved file for ?from= context
    const baseDir = basePath.substring(0, basePath.lastIndexOf('/')) || '/'
    // Helper to rewrite a specifier
    const rewriteSpecifier = (specifier: string): string => {
        if (specifier.startsWith('./') || specifier.startsWith('../')) {
            // Resolve relative path against the base path and use ~file prefix for direct file access
            const resolved = resolveRelativePath(specifier, basePath)
            return `${VFS_MODULE_PREFIX}~file${resolved}`
        }
        if (isRelativeOrAbsolute(specifier)) {
            // Other absolute paths (http:, data:, blob:, etc.) - leave as-is
            return specifier
        }
        // Bare specifier: check resolution cache for deterministic ~file/ URL.
        // This prevents combinatorial explosion from ?from= making the browser
        // treat the same package as different modules depending on importer.
        const cachedPath = resolvedSpecifierCache.get(specifier)
        if (cachedPath) {
            return `${VFS_MODULE_PREFIX}~file${cachedPath}`
        }
        // Cache miss — use ?from= for resolution context (first encounter of this specifier)
        return `${VFS_MODULE_PREFIX}${specifier}?from=${encodeURIComponent(baseDir)}`
    }

    const result = code
        // import X from "specifier"
        .replace(
            /\bimport\s+([^'"]+)\s+from\s+(['"])([^'"]+)\2/g,
            (match, imports, quote, specifier) => {
                const rewritten = rewriteSpecifier(specifier)
                if (rewritten === specifier) return match
                return `import ${imports} from ${quote}${rewritten}${quote}`
            }
        )
        // import "specifier" (side-effect)
        .replace(
            /\bimport\s+(['"])([^'"]+)\1\s*;?/g,
            (match, quote, specifier) => {
                // Check if this looks like a type import (skip those)
                if (match.includes('import type')) return match
                const rewritten = rewriteSpecifier(specifier)
                if (rewritten === specifier) return match
                return `import ${quote}${rewritten}${quote};`
            }
        )
        // export X from "specifier"
        .replace(
            /\bexport\s+([^'"]+)\s+from\s+(['"])([^'"]+)\2/g,
            (match, exports, quote, specifier) => {
                const rewritten = rewriteSpecifier(specifier)
                if (rewritten === specifier) return match
                return `export ${exports} from ${quote}${rewritten}${quote}`
            }
        )
        // Dynamic import("specifier")
        .replace(
            /\bimport\s*\(\s*(['"])([^'"]+)\1\s*\)/g,
            (match, quote, specifier) => {
                const rewritten = rewriteSpecifier(specifier)
                if (rewritten === specifier) return match
                return `import(${quote}${rewritten}${quote})`
            }
        )

    // Validate after rewriting
    validateModuleCode(result, basePath + ' (after rewrite)')

    return result
}

function isRelativeOrAbsolute(specifier: string): boolean {
    return specifier.startsWith('./') ||
           specifier.startsWith('../') ||
           specifier.startsWith('/') ||
           specifier.startsWith('data:') ||
           specifier.startsWith('blob:') ||
           specifier.startsWith('http:') ||
           specifier.startsWith('https:')
}


/**
 * Check if a request is for a VFS module
 */
export function isModuleRequest(request: Request): boolean {
    const url = new URL(request.url)
    return url.pathname.startsWith(VFS_MODULE_PREFIX) || url.pathname.startsWith(VFS_CONFIG_PREFIX)
}

/**
 * Invalidate the cached paths (call when VFS changes)
 */
export function invalidateIndexCache(): void {
    moduleCache.clear()
    pathCache.clear()
    resolvedSpecifierCache.clear()
}
