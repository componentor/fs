// src/protocol/opcodes.ts
var OP = {
  READ: 1,
  WRITE: 2,
  UNLINK: 3,
  STAT: 4,
  LSTAT: 5,
  MKDIR: 6,
  RMDIR: 7,
  READDIR: 8,
  RENAME: 9,
  EXISTS: 10,
  TRUNCATE: 11,
  APPEND: 12,
  COPY: 13,
  ACCESS: 14,
  REALPATH: 15,
  CHMOD: 16,
  CHOWN: 17,
  UTIMES: 18,
  SYMLINK: 19,
  READLINK: 20,
  LINK: 21,
  OPEN: 22,
  CLOSE: 23,
  FREAD: 24,
  FWRITE: 25,
  FSTAT: 26,
  FTRUNCATE: 27,
  FSYNC: 28,
  OPENDIR: 29,
  MKDTEMP: 30
};
var SAB_OFFSETS = {
  CONTROL: 0,
  // Int32 - signal (0=idle, 1=request, 2=response, 3=chunk, 4=ack)
  OPCODE: 4,
  // Int32 - operation code
  STATUS: 8,
  // Int32 - response status / error
  CHUNK_LEN: 12,
  // Int32 - bytes in this chunk
  TOTAL_LEN: 16,
  // BigUint64 - full data size across all chunks
  CHUNK_IDX: 24,
  // Int32 - 0-based chunk index
  RESERVED: 28,
  // Int32 - reserved
  HEADER_SIZE: 32
  // Data payload starts here
};
var SIGNAL = {
  IDLE: 0,
  REQUEST: 1,
  RESPONSE: 2,
  CHUNK: 3,
  CHUNK_ACK: 4
};
var encoder = new TextEncoder();
var decoder = new TextDecoder();
function encodeRequest(op, path, flags = 0, data) {
  const pathBytes = encoder.encode(path);
  const dataLen = data ? data.byteLength : 0;
  const totalLen = 16 + pathBytes.byteLength + dataLen;
  const buf = new ArrayBuffer(totalLen);
  const view = new DataView(buf);
  view.setUint32(0, op, true);
  view.setUint32(4, flags, true);
  view.setUint32(8, pathBytes.byteLength, true);
  view.setUint32(12, dataLen, true);
  const bytes = new Uint8Array(buf);
  bytes.set(pathBytes, 16);
  if (data) {
    bytes.set(data, 16 + pathBytes.byteLength);
  }
  return buf;
}
function decodeResponse(buf) {
  const view = new DataView(buf);
  const status = view.getUint32(0, true);
  const dataLen = view.getUint32(4, true);
  const data = dataLen > 0 ? new Uint8Array(buf, 8, dataLen) : null;
  return { status, data };
}
function encodeTwoPathRequest(op, path1, path2, flags = 0) {
  const path2Bytes = encoder.encode(path2);
  const payload = new Uint8Array(4 + path2Bytes.byteLength);
  const pv = new DataView(payload.buffer);
  pv.setUint32(0, path2Bytes.byteLength, true);
  payload.set(path2Bytes, 4);
  return encodeRequest(op, path1, flags, payload);
}

// src/workers/async-relay.worker.ts
var encoder2 = new TextEncoder();
var HEADER_SIZE = SAB_OFFSETS.HEADER_SIZE;
var asyncSab = null;
var asyncCtrl = null;
var wakeCtrl = null;
function sabRequest(requestBuf) {
  const maxChunk = asyncSab.byteLength - HEADER_SIZE;
  const requestBytes = new Uint8Array(requestBuf);
  const totalLenView = new BigUint64Array(asyncSab, SAB_OFFSETS.TOTAL_LEN, 1);
  if (requestBytes.byteLength <= maxChunk) {
    new Uint8Array(asyncSab, HEADER_SIZE, requestBytes.byteLength).set(requestBytes);
    Atomics.store(asyncCtrl, 3, requestBytes.byteLength);
    Atomics.store(totalLenView, 0, BigInt(requestBytes.byteLength));
    Atomics.store(asyncCtrl, 0, SIGNAL.REQUEST);
    Atomics.notify(asyncCtrl, 0);
    if (wakeCtrl) Atomics.notify(wakeCtrl, 0);
  } else {
    let sent = 0;
    while (sent < requestBytes.byteLength) {
      const chunkSize = Math.min(maxChunk, requestBytes.byteLength - sent);
      new Uint8Array(asyncSab, HEADER_SIZE, chunkSize).set(
        requestBytes.subarray(sent, sent + chunkSize)
      );
      Atomics.store(asyncCtrl, 3, chunkSize);
      Atomics.store(totalLenView, 0, BigInt(requestBytes.byteLength));
      Atomics.store(asyncCtrl, 6, Math.floor(sent / maxChunk));
      if (sent === 0) {
        Atomics.store(asyncCtrl, 0, SIGNAL.REQUEST);
      } else {
        Atomics.store(asyncCtrl, 0, SIGNAL.CHUNK);
      }
      Atomics.notify(asyncCtrl, 0);
      if (sent === 0 && wakeCtrl) Atomics.notify(wakeCtrl, 0);
      sent += chunkSize;
      if (sent < requestBytes.byteLength) {
        Atomics.wait(asyncCtrl, 0, sent === chunkSize ? SIGNAL.REQUEST : SIGNAL.CHUNK);
      }
    }
  }
  Atomics.wait(asyncCtrl, 0, SIGNAL.REQUEST);
  const signal = Atomics.load(asyncCtrl, 0);
  const respChunkLen = Atomics.load(asyncCtrl, 3);
  const respTotalLen = Number(Atomics.load(totalLenView, 0));
  let responseBytes;
  if (signal === SIGNAL.RESPONSE && respTotalLen <= maxChunk) {
    responseBytes = new Uint8Array(asyncSab, HEADER_SIZE, respChunkLen).slice();
  } else {
    responseBytes = new Uint8Array(respTotalLen);
    let received = 0;
    responseBytes.set(new Uint8Array(asyncSab, HEADER_SIZE, respChunkLen), 0);
    received += respChunkLen;
    while (received < respTotalLen) {
      Atomics.store(asyncCtrl, 0, SIGNAL.CHUNK_ACK);
      Atomics.notify(asyncCtrl, 0);
      Atomics.wait(asyncCtrl, 0, SIGNAL.CHUNK_ACK);
      const nextLen = Atomics.load(asyncCtrl, 3);
      responseBytes.set(new Uint8Array(asyncSab, HEADER_SIZE, nextLen), received);
      received += nextLen;
    }
  }
  Atomics.store(asyncCtrl, 0, SIGNAL.IDLE);
  Atomics.notify(asyncCtrl, 0);
  return decodeResponse(responseBytes.buffer);
}
var leaderPort = null;
var pending = /* @__PURE__ */ new Map();
var requestId = 0;
function nextId() {
  return "a" + requestId++;
}
function portRequest(buffer) {
  return new Promise((resolve) => {
    const id = nextId();
    pending.set(id, (respBuf) => {
      resolve(decodeResponse(respBuf));
    });
    leaderPort.postMessage({ id, buffer }, [buffer]);
  });
}
async function sendRequest(reqBuffer) {
  if (asyncSab) {
    return sabRequest(reqBuffer);
  } else if (leaderPort) {
    return portRequest(reqBuffer);
  }
  return { status: 7, data: null };
}
self.onmessage = async (e) => {
  const msg = e.data;
  if (msg.type === "init-leader") {
    asyncSab = msg.asyncSab;
    asyncCtrl = new Int32Array(msg.asyncSab, 0, 8);
    if (msg.wakeSab) {
      wakeCtrl = new Int32Array(msg.wakeSab, 0, 1);
    }
    return;
  }
  if (msg.type === "init-follower") {
    return;
  }
  if (msg.type === "leader-port") {
    leaderPort = msg.port;
    leaderPort.onmessage = (ev) => {
      const { id, buffer } = ev.data;
      const resolve = pending.get(id);
      if (resolve) {
        pending.delete(id);
        resolve(buffer);
      }
    };
    leaderPort.start();
    return;
  }
  if (msg.type === "request") {
    const { callId, op, path, data, flags, path2, fdArgs } = msg;
    try {
      let reqBuffer;
      if (path2 !== void 0) {
        reqBuffer = encodeTwoPathRequest(op, path, path2, flags ?? 0);
      } else if (fdArgs) {
        reqBuffer = encodeFdRequest(op, fdArgs);
      } else {
        const encodedData = encodeData(data);
        reqBuffer = encodeRequest(op, path ?? "", flags ?? 0, encodedData ?? void 0);
      }
      const { status, data: respData } = await sendRequest(reqBuffer);
      self.postMessage(
        { type: "response", callId, status, data: respData },
        respData ? [respData.buffer] : []
      );
    } catch (err) {
      self.postMessage({
        type: "response",
        callId,
        status: 7,
        // EINVAL
        data: null,
        error: err.message
      });
    }
  }
};
function encodeData(data) {
  if (data === null || data === void 0) return null;
  if (data instanceof Uint8Array) return data;
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (typeof data === "string") return encoder2.encode(data);
  return null;
}
function encodeFdRequest(op, args) {
  switch (op) {
    case OP.FREAD: {
      const buf = new Uint8Array(12);
      const view = new DataView(buf.buffer);
      view.setUint32(0, args.fd, true);
      view.setUint32(4, args.length ?? 0, true);
      view.setInt32(8, args.position ?? -1, true);
      return encodeRequest(op, "", 0, buf);
    }
    case OP.FWRITE: {
      const writeData = args.data ?? new Uint8Array(0);
      const buf = new Uint8Array(8 + writeData.byteLength);
      const view = new DataView(buf.buffer);
      view.setUint32(0, args.fd, true);
      view.setInt32(4, args.position ?? -1, true);
      buf.set(writeData, 8);
      return encodeRequest(op, "", 0, buf);
    }
    case OP.FSTAT:
    case OP.CLOSE: {
      const buf = new Uint8Array(4);
      new DataView(buf.buffer).setUint32(0, args.fd, true);
      return encodeRequest(op, "", 0, buf);
    }
    case OP.FTRUNCATE: {
      const buf = new Uint8Array(8);
      const view = new DataView(buf.buffer);
      view.setUint32(0, args.fd, true);
      view.setUint32(4, args.length ?? 0, true);
      return encodeRequest(op, "", 0, buf);
    }
    case OP.FSYNC:
      return encodeRequest(op, "", 0);
    default:
      return encodeRequest(op, "", 0);
  }
}
//# sourceMappingURL=async-relay.worker.js.map