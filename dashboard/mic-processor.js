/**
 * AudioWorkletProcessor for microphone capture.
 * Converts float32 PCM audio from the mic to 16-bit PCM
 * for transmission over WebSocket.
 */
class MicProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.sampleRate = options.processorOptions?.sampleRate || 48000;
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0];
    if (!input || input.length === 0 || !input[0]) return true;

    const left = input[0];
    const right = input.length > 1 ? input[1] : left;
    const numFrames = Math.min(left.length, right.length);
    if (numFrames === 0) return true;

    const buffer = new ArrayBuffer(numFrames * 4);
    const view = new DataView(buffer);

    for (let i = 0; i < numFrames; i++) {
      const l = Math.max(-1, Math.min(1, left[i]));
      const r = Math.max(-1, Math.min(1, right[i]));
      view.setInt16(i * 4, Math.round(l * 32767), true);
      view.setInt16(i * 4 + 2, Math.round(r * 32767), true);
    }

    this.port.postMessage(buffer, [buffer]);
    return true;
  }
}

registerProcessor('mic-processor', MicProcessor);