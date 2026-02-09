// Export all fs classes

export { Stats, BigIntStats, createStats } from './Stats'
export type { StatsInit } from './Stats'

export { Dirent, createDirent } from './Dirent'
export type { DirentInit } from './Dirent'

export { Dir } from './Dir'
export type { DirInit } from './Dir'

export { FileHandle, setFileHandleAsyncRequestFn } from './FileHandle'
export type { ReadResult, WriteResult } from './FileHandle'

export { ReadStream, setReadStreamReadFn, setReadStreamChunkFn, setReadStreamSizeFn } from './ReadStream'
export type { ReadStreamOptions } from './ReadStream'

export { WriteStream, setWriteStreamWriteFn, setWriteStreamAppendFn } from './WriteStream'
export type { WriteStreamOptions } from './WriteStream'

export {
    FSError,
    ERROR_CODES,
    createENOENT,
    createEEXIST,
    createENOTDIR,
    createEISDIR,
    createENOTEMPTY,
    createEACCES,
    createEPERM,
    createEBADF,
    createEINVAL,
    createELOOP,
} from './FSError'
