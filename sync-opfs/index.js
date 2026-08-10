/**
 * `sync-opfs` — a name people can find.
 *
 * The implementation lives in `@componentor/fs`; this package is a re-export and nothing else,
 * so there is one codebase, one test suite and one changelog. It exists because npm search
 * weights the package name heavily, and the term people actually type is "opfs" — a scoped name
 * like `@componentor/fs` cannot match it.
 *
 * Both names are supported and always the same version. Import from either.
 */
export * from '@componentor/fs';
