import * as fs from "node:fs";
import * as path from "node:path";

// Tiny stack VM, ISA v1. Node 22 stdlib only. 32-bit wrapping values,
// data stack <= 256, call stack <= 64, 256 words of memory,
// output <= 65,536 bytes, at most 1,000,000 steps.

class Trap extends Error {
  code: number;
  constructor(c: number) {
    super("trap " + c);
    this.code = c;
  }
}

function run(prog: Buffer, input: Buffer): { out: Buffer; code: number } {
  const mem = new Int32Array(256);
  const st: number[] = [];
  const cs: number[] = [];
  const out: number[] = [];
  let pc = 0, steps = 0, ip = 0;
  const end = (code: number) => ({ out: Buffer.from(out), code });
  const need = (n: number): void => { if (st.length < n) throw new Trap(2); };
  const room = (): void => { if (st.length >= 256) throw new Trap(3); };
  const bin = (f: (a: number, b: number) => number): void => {
    need(2);
    const b = st.pop() as number;
    const a = st.pop() as number;
    st.push(f(a, b) | 0);
  };
  const divop = (f: (a: number, b: number) => number): void => {
    need(2);
    const b = st[st.length - 1];
    if (b === 0) throw new Trap(4);
    const a = st[st.length - 2];
    st.pop();
    st[st.length - 1] = f(a, b) | 0;
  };
  try {
    for (;;) {
      if (steps >= 1000000) return end(10); // step limit, checked first
      if (pc < 0 || pc >= prog.length) return end(9); // pc outside
      const op = prog[pc];
      // Unknown opcode: exact range test. Valid: 00-07, 10-1E, 20-22,
      // 30-34, 40-41, 50-53. A substring test over opcode pairs is wrong
      // (0x23 matches across the 22/34 boundary, 0x60 across 06/07).
      if ((op > 7 && op < 16) || op === 31 || (op > 34 && op < 48) ||
        (op > 52 && op < 64) || (op > 65 && op < 80) || op > 83)
        throw new Trap(5);
      const imm = op === 1 ? 1 : op === 2 ? 4 : op >= 0x30 && op <= 0x33 ? 2 : 0;
      if (pc + 1 + imm > prog.length) return end(9); // truncated immediate
      steps++;
      let next = pc + 1 + imm;
      switch (op) {
        case 0: return end(0);
        case 1: room(); st.push((prog[pc + 1] << 24) >> 24); break;
        case 2: room(); st.push(prog.readInt32LE(pc + 1)); break;
        case 3: need(1); st.pop(); break;
        case 4: need(1); room(); st.push(st[st.length - 1]); break;
        case 5: need(2); { const t = st[st.length - 1]; st[st.length - 1] = st[st.length - 2]; st[st.length - 2] = t; } break;
        case 6: need(2); room(); st.push(st[st.length - 2]); break;
        case 7: need(3); { const t = st[st.length - 3]; st[st.length - 3] = st[st.length - 2]; st[st.length - 2] = st[st.length - 1]; st[st.length - 1] = t; } break;
        case 0x10: bin((a, b) => a + b); break;
        case 0x11: bin((a, b) => a - b); break;
        case 0x12: bin((a, b) => Math.imul(a, b)); break;
        case 0x13: divop((a, b) => (a / b) | 0); break;
        case 0x14: divop((a, b) => a % b); break;
        case 0x15: divop((a, b) => ((a >>> 0) / (b >>> 0)) | 0); break;
        case 0x16: divop((a, b) => ((a >>> 0) % (b >>> 0)) | 0); break;
        case 0x17: need(1); st[st.length - 1] = (-st[st.length - 1]) | 0; break;
        case 0x18: bin((a, b) => a & b); break;
        case 0x19: bin((a, b) => a | b); break;
        case 0x1a: bin((a, b) => a ^ b); break;
        case 0x1b: need(1); st[st.length - 1] = ~st[st.length - 1]; break;
        case 0x1c: bin((a, b) => a << (b & 31)); break;
        case 0x1d: bin((a, b) => a >> (b & 31)); break;
        case 0x1e: bin((a, b) => (a >>> (b & 31)) | 0); break;
        case 0x20: bin((a, b) => (a === b ? 1 : 0)); break;
        case 0x21: bin((a, b) => (a < b ? 1 : 0)); break;
        case 0x22: bin((a, b) => ((a >>> 0) < (b >>> 0) ? 1 : 0)); break;
        case 0x30: next = pc + 3 + prog.readInt16LE(pc + 1); break;
        case 0x31:
        case 0x32: need(1); { const v = st.pop() as number; if ((v === 0) === (op === 0x31)) next = pc + 3 + prog.readInt16LE(pc + 1); } break;
        case 0x33: if (cs.length >= 64) throw new Trap(7); cs.push(pc + 3); next = prog.readUInt16LE(pc + 1); break;
        case 0x34: if (cs.length === 0) throw new Trap(8); next = cs.pop() as number; break;
        case 0x40: need(1); { const a = st.pop() as number; if (a < 0 || a > 255) throw new Trap(6); st.push(mem[a]); } break;
        case 0x41: need(2); { const a = st.pop() as number; const v = st.pop() as number; if (a < 0 || a > 255) throw new Trap(6); mem[a] = v; } break;
        case 0x50: need(1); { const v = st.pop() as number; const s = String(v); if (out.length + s.length > 65536) throw new Trap(11); for (let i = 0; i < s.length; i++) out.push(s.charCodeAt(i)); } break;
        case 0x51: need(1); { const v = st.pop() as number; if (out.length + 1 > 65536) throw new Trap(11); out.push(v & 255); } break;
        case 0x52: room(); st.push(ip < input.length ? input[ip++] : -1); break;
        case 0x53: need(1); return end((st.pop() as number) & 255);
        default: throw new Trap(5); // unreachable (range test above), but the dispatch itself must trap 5, never spin.
      }
      pc = next;
    }
  } catch (e) {
    if (e instanceof Trap) return end(e.code);
    throw e;
  }
}

function main(): void {
  const inDir = process.argv[2] ?? process.env.MAKEFUN_INPUT_DIR ?? "/input";
  const outDir = process.argv[3] ?? process.env.MAKEFUN_OUTPUT_DIR ?? "/output";
  for (const id of fs.readdirSync(inDir)) {
    const dir = path.join(inDir, id);
    if (!fs.statSync(dir).isDirectory()) continue;
    const prog = fs.readFileSync(path.join(dir, "program.bin"));
    const f = path.join(dir, "input.bin");
    const input = fs.existsSync(f) ? fs.readFileSync(f) : Buffer.alloc(0);
    const { out, code } = run(prog, input);
    const od = path.join(outDir, id);
    fs.mkdirSync(od, { recursive: true });
    fs.writeFileSync(path.join(od, "stdout.bin"), out);
    fs.writeFileSync(path.join(od, "exit.txt"), String(code) + "\n");
  }
}

main();
