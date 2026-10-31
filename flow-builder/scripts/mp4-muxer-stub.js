// Stand-in for the 'mp4-muxer' module (loaded by Flow's import map) in browser probes that never mux.
export class Muxer {
  constructor() {
    throw new Error('mp4-muxer is not available in this probe');
  }
}
export class ArrayBufferTarget {}
