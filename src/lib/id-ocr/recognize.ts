"use client";

export type OcrProgress = {
  status: string;
  percent: number;
};

/**
 * Run Tesseract.js in the browser (no API key). ID images stay on the client.
 */
export async function recognizeImageText(
  image: File | Blob,
  onProgress?: (progress: OcrProgress) => void,
): Promise<string> {
  const { createWorker } = await import("tesseract.js");
  const worker = await createWorker("eng", 1, {
    logger: message => {
      if (!onProgress) return;
      const percent =
        typeof message.progress === "number" ? Math.round(message.progress * 100) : 0;
      onProgress({ status: String(message.status ?? ""), percent });
    },
  });
  try {
    const { data } = await worker.recognize(image);
    return String(data.text ?? "").trim();
  } finally {
    await worker.terminate();
  }
}
