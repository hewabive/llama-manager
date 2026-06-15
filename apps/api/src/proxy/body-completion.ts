export function observeBodyCompletion(
  body: ReadableStream<Uint8Array>,
  onSettled: () => void,
): ReadableStream<Uint8Array> {
  let settled = false;
  const settle = () => {
    if (settled) {
      return;
    }
    settled = true;
    onSettled();
  };

  const reader = body.getReader();
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { done, value } = await reader.read();
        if (done) {
          controller.close();
          settle();
          return;
        }
        controller.enqueue(value);
      } catch (error) {
        controller.error(error);
        settle();
      }
    },
    async cancel(reason) {
      await reader.cancel(reason);
      settle();
    },
  });
}
