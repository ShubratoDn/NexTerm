// Minimal Telnet option negotiation (RFC 854/855/857/858/1073/1091), written from the public RFCs.

export const IAC = 255;
const DONT = 254;
const DO = 253;
const WONT = 252;
const WILL = 251;
const SB = 250;
const SE = 240;

const OPT_ECHO = 1;
const OPT_SGA = 3;
const OPT_TTYPE = 24;
const OPT_NAWS = 31;

type State = 'data' | 'iac' | 'verb' | 'sb' | 'sb-iac';

export interface FilterResult {
  /** Application data with all protocol bytes removed. */
  output: Buffer;
  /** Bytes that must be written back to the peer. */
  replies: Buffer;
}

export class TelnetFilter {
  private state: State = 'data';
  private verb = 0;
  private sb: number[] = [];
  private cols = 80;
  private rows = 24;
  private naws = false;

  constructor(private readonly termType = 'xterm-256color') {}

  setSize(cols: number, rows: number): Buffer {
    this.cols = cols;
    this.rows = rows;
    return this.naws ? this.nawsFrame() : Buffer.alloc(0);
  }

  private nawsFrame(): Buffer {
    const b = [IAC, SB, OPT_NAWS, this.cols >> 8, this.cols & 255, this.rows >> 8, this.rows & 255];
    // 255 inside a subnegotiation must be doubled.
    const esc = b.slice(3).flatMap((x) => (x === IAC ? [IAC, IAC] : [x]));
    return Buffer.from([IAC, SB, OPT_NAWS, ...esc, IAC, SE]);
  }

  process(chunk: Buffer): FilterResult {
    const out: number[] = [];
    const rep: number[] = [];
    for (const byte of chunk) {
      switch (this.state) {
        case 'data':
          if (byte === IAC) this.state = 'iac';
          else out.push(byte);
          break;
        case 'iac':
          if (byte === IAC) {
            out.push(IAC);
            this.state = 'data';
          } else if (byte === DO || byte === DONT || byte === WILL || byte === WONT) {
            this.verb = byte;
            this.state = 'verb';
          } else if (byte === SB) {
            this.sb = [];
            this.state = 'sb';
          } else {
            this.state = 'data'; // NOP, GA, etc.
          }
          break;
        case 'verb':
          this.negotiate(this.verb, byte, rep);
          this.state = 'data';
          break;
        case 'sb':
          if (byte === IAC) this.state = 'sb-iac';
          else this.sb.push(byte);
          break;
        case 'sb-iac':
          if (byte === SE) {
            this.subnegotiate(rep);
            this.state = 'data';
          } else {
            if (byte === IAC) this.sb.push(IAC);
            this.state = 'sb';
          }
          break;
      }
    }
    return { output: Buffer.from(out), replies: Buffer.from(rep) };
  }

  private negotiate(verb: number, opt: number, rep: number[]): void {
    if (verb === DO) {
      if (opt === OPT_TTYPE) rep.push(IAC, WILL, opt);
      else if (opt === OPT_NAWS) {
        if (!this.naws) {
          this.naws = true;
          rep.push(IAC, WILL, opt, ...this.nawsFrame());
        }
      } else rep.push(IAC, WONT, opt);
    } else if (verb === WILL) {
      if (opt === OPT_ECHO || opt === OPT_SGA) rep.push(IAC, DO, opt);
      else rep.push(IAC, DONT, opt);
    }
    // DONT / WONT need no reply here.
  }

  private subnegotiate(rep: number[]): void {
    // IAC SB TERMINAL-TYPE SEND IAC SE -> IAC SB TERMINAL-TYPE IS <name> IAC SE
    if (this.sb[0] === OPT_TTYPE && this.sb[1] === 1) {
      rep.push(IAC, SB, OPT_TTYPE, 0, ...Buffer.from(this.termType, 'ascii'), IAC, SE);
    }
  }
}

/** Double 0xFF bytes so user input is not mistaken for a command. */
export function escapeOutgoing(data: Buffer): Buffer {
  if (!data.includes(IAC)) return data;
  const out: number[] = [];
  for (const b of data) {
    out.push(b);
    if (b === IAC) out.push(IAC);
  }
  return Buffer.from(out);
}
