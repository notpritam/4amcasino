/** gifenc ships no types. Only the three entry points the replay GIF encoder
 *  uses are declared here (see features/share/replayGif.ts). */
declare module 'gifenc' {
  export interface GifFrameOptions {
    palette?: number[][];
    delay?: number;
    transparent?: boolean;
    dispose?: number;
  }
  export interface GifEncoderInstance {
    writeFrame(index: Uint8Array, width: number, height: number, opts?: GifFrameOptions): void;
    finish(): void;
    /** Explicitly backed by an ArrayBuffer (not SharedArrayBuffer) so the result
     *  is a valid BlobPart. */
    bytes(): Uint8Array<ArrayBuffer>;
    reset(): void;
  }
  export function GIFEncoder(opts?: { auto?: boolean; initialCapacity?: number }): GifEncoderInstance;
  export function quantize(
    data: Uint8Array | Uint8ClampedArray,
    maxColors: number,
    opts?: { format?: string; oneBitAlpha?: boolean; clearAlpha?: boolean },
  ): number[][];
  export function applyPalette(
    data: Uint8Array | Uint8ClampedArray,
    palette: number[][],
    format?: string,
  ): Uint8Array;
}
