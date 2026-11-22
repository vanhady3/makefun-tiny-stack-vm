import * as fs from "node:fs";
import * as path from "node:path";

const inDir = process.argv[2] || process.env.MAKEFUN_INPUT_DIR || "/input";
const outDir = process.argv[3] || process.env.MAKEFUN_OUTPUT_DIR || "/output";

function run(prog: Buffer, inp: Buffer): [Buffer, number] {
  const mem = new Int32Array(256);
  const st: number[] = [];
  const cs: number[] = [];
  const out: number[] = [];
  let pc = 0;
  let ip = 0;
  let steps = 0;
  const n = prog.length;
  const end = (code: number): [Buffer, number] => [Buffer.from(out), code];
  const chk = (pops: number, pushes: number): number => {
    if (st.length < pops) return 2;
    if (st.length - pops + pushes > 256) return 3;
    return 0;
  };
  while (true) {
    if (steps >= 1000000) return end(10);
    if (pc < 0 || pc >= n) return end(9);
    const op = prog[pc];
    let imm = 0;
    if (op === 1) imm = 1;
    else if (op === 2) imm = 4;
    else if (op >= 48 && op <= 51) imm = 2;
    else if ("000304050607101112131415161718191a1b1c1d1e20212234404150515253".indexOf(op.toString(16).padStart(2, "0")) < 0) return end(5);
    if (pc + 1 + imm > n) return end(9);
    steps++;
    const next = pc + 1 + imm;
    let t = 0;
    switch (op) {
      case 0x00: return end(0);
      case 0x01:
        if ((t = chk(0, 1))) return end(t);
        st.push((prog[pc + 1] << 24) >> 24);
        pc = next;
        break;
      case 0x02:
        if ((t = chk(0, 1))) return end(t);
        st.push(prog.readInt32LE(pc + 1));
        pc = next;
        break;
      case 0x03:
        if ((t = chk(1, 0))) return end(t);
        st.pop();
        pc = next;
        break;
      case 0x04:
        if ((t = chk(1, 2))) return end(t);
        st.push(st[st.length - 1]);
        pc = next;
        break;
      case 0x05: {
        if ((t = chk(2, 2))) return end(t);
        const x = st[st.length - 1];
        st[st.length - 1] = st[st.length - 2];
        st[st.length - 2] = x;
        pc = next;
        break;
      }
      case 0x06:
        if ((t = chk(2, 3))) return end(t);
        st.push(st[st.length - 2]);
        pc = next;
        break;
      case 0x07: {
        if ((t = chk(3, 3))) return end(t);
        const a = st[st.length - 3];
        st[st.length - 3] = st[st.length - 2];
        st[st.length - 2] = st[st.length - 1];
        st[st.length - 1] = a;
        pc = next;
        break;
      }
      case 0x10: case 0x11: case 0x12: case 0x13: case 0x14: case 0x15:
      case 0x16: case 0x18: case 0x19: case 0x1a: case 0x1c: case 0x1d:
      case 0x1e: case 0x20: case 0x21: case 0x22: {
        if ((t = chk(2, 1))) return end(t);
        const b = st.pop()!;
        const a = st.pop()!;
        let r = 0;
        if (op === 0x10) r = (a + b) | 0;
        else if (op === 0x11) r = (a - b) | 0;
        else if (op === 0x12) r = Math.imul(a, b);
        else if (op === 0x13) {
          if (b === 0) return end(4);
          r = (a / b) | 0;
        } else if (op === 0x14) {
          if (b === 0) return end(4);
          r = a % b;
        } else if (op === 0x15) {
          if (b === 0) return end(4);
          r = ((a >>> 0) / (b >>> 0)) | 0;
        } else if (op === 0x16) {
          if (b === 0) return end(4);
          r = ((a >>> 0) % (b >>> 0)) | 0;
        } else if (op === 0x18) r = a & b;
        else if (op === 0x19) r = a | b;
        else if (op === 0x1a) r = a ^ b;
        else if (op === 0x1c) r = a << (b & 31);
        else if (op === 0x1d) r = a >> (b & 31);
        else if (op === 0x1e) r = (a >>> (b & 31)) | 0;
        else if (op === 0x20) r = a === b ? 1 : 0;
        else if (op === 0x21) r = a < b ? 1 : 0;
        else r = (a >>> 0) < (b >>> 0) ? 1 : 0;
        st.push(r);
        pc = next;
        break;
      }
      case 0x17: case 0x1b:
        if ((t = chk(1, 1))) return end(t);
        st[st.length - 1] = op === 0x17 ? (-st[st.length - 1]) | 0 : ~st[st.length - 1];
        pc = next;
        break;
      case 0x30:
        pc = next + prog.readInt16LE(pc + 1);
        break;
      case 0x31: case 0x32: {
        if ((t = chk(1, 0))) return end(t);
        const v = st.pop()!;
        pc = (op === 0x31 ? v === 0 : v !== 0) ? next + prog.readInt16LE(pc + 1) : next;
        break;
      }
      case 0x33:
        if (cs.length >= 64) return end(7);
        cs.push(next);
        pc = prog.readUInt16LE(pc + 1);
        break;
      case 0x34:
        if (cs.length === 0) return end(8);
        pc = cs.pop()!;
        break;
      case 0x40: {
        if ((t = chk(1, 1))) return end(t);
        const a = st.pop()!;
        if (a < 0 || a > 255) return end(6);
        st.push(mem[a]);
        pc = next;
        break;
      }
      case 0x41: {
        if ((t = chk(2, 0))) return end(t);
        const a = st.pop()!;
        const v = st.pop()!;
        if (a < 0 || a > 255) return end(6);
        mem[a] = v;
        pc = next;
        break;
      }
      case 0x50: {
        if ((t = chk(1, 0))) return end(t);
        const v = st.pop()!;
        const s = String(v);
        if (out.length + s.length > 65536) return end(11);
        for (let i = 0; i < s.length; i++) out.push(s.charCodeAt(i));
        pc = next;
        break;
      }
      case 0x51: {
        if ((t = chk(1, 0))) return end(t);
        const v = st.pop()!;
        if (out.length + 1 > 65536) return end(11);
        out.push(v & 255);
        pc = next;
        break;
      }
      case 0x52:
        if ((t = chk(0, 1))) return end(t);
        st.push(ip < inp.length ? inp[ip++] : -1);
        pc = next;
        break;
      case 0x53: {
        if ((t = chk(1, 0))) return end(t);
        return end((st.pop()!) & 255);
      }
    }
  }
}

const ids = fs.readdirSync(inDir, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name)
  .sort();
for (const id of ids) {
  const dir = path.join(inDir, id);
  let prog: Buffer;
  try {
    prog = fs.readFileSync(path.join(dir, "program.bin"));
  } catch {
    continue;
  }
  let inp = Buffer.alloc(0);
  try {
    inp = fs.readFileSync(path.join(dir, "input.bin"));
  } catch {
    inp = Buffer.alloc(0);
  }
  const [o, code] = run(prog, inp);
  const od = path.join(outDir, id);
  fs.mkdirSync(od, { recursive: true });
  fs.writeFileSync(path.join(od, "stdout.bin"), o);
  fs.writeFileSync(path.join(od, "exit.txt"), String(code) + "\n");
}
