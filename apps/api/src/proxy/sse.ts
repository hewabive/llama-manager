export function sseDataPayloads(frame: string): string[] {
  const payloads: string[] = [];
  for (const line of frame.split("\n")) {
    const trimmed = line.trimStart();
    if (!trimmed.startsWith("data:")) {
      continue;
    }
    const data = trimmed.slice("data:".length).trim();
    if (data) {
      payloads.push(data);
    }
  }
  return payloads;
}

export type SseFrameBuffer = {
  push: (chunk: Uint8Array) => string[];
  flush: () => string | null;
};

export function createSseFrameBuffer(): SseFrameBuffer {
  const decoder = new TextDecoder();
  let pending = "";
  return {
    push(chunk) {
      pending += decoder.decode(chunk, { stream: true });
      const frames: string[] = [];
      let index = pending.indexOf("\n\n");
      while (index !== -1) {
        frames.push(pending.slice(0, index));
        pending = pending.slice(index + 2);
        index = pending.indexOf("\n\n");
      }
      return frames;
    },
    flush() {
      pending += decoder.decode();
      return pending.trim() ? pending : null;
    },
  };
}
