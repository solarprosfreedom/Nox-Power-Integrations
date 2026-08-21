"use client";

import { useRef, useState } from "react";
import FormCard from "@/components/ui/FormCard";
import {
  extractAddressFromOcrText,
  type ExtractedIdAddress,
} from "@/lib/id-ocr/extract-address";
import { recognizeImageText } from "@/lib/id-ocr/recognize";

const ACCEPT = "image/jpeg,image/png,image/webp,image/gif,image/heic,image/heif";

export default function ImageExtractionTab() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ status: string; percent: number } | null>(null);
  const [rawText, setRawText] = useState("");
  const [address, setAddress] = useState<ExtractedIdAddress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const formatted = address
    ? [
        address.street,
        [address.city, [address.state, address.zip].filter(Boolean).join(" ")].filter(Boolean).join(", "),
      ]
        .filter(Boolean)
        .join(", ")
    : "";

  function resetResult() {
    setRawText("");
    setAddress(null);
    setError(null);
    setCopied(false);
    setProgress(null);
  }

  function onPick(next: File | null) {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setFile(next);
    setPreviewUrl(next ? URL.createObjectURL(next) : null);
    resetResult();
  }

  async function onExtract() {
    if (!file) return;
    setBusy(true);
    resetResult();
    try {
      const text = await recognizeImageText(file, setProgress);
      setRawText(text);
      const parsed = extractAddressFromOcrText(text);
      setAddress(parsed);
      if (!text) {
        setError("No text found. Try a clearer, well-lit photo of the ID.");
      } else if (!parsed) {
        setError("Text was found, but no mailing address could be parsed. Copy from the raw OCR below.");
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(`OCR failed: ${message}`);
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }

  async function copyFormatted() {
    if (!formatted) return;
    await navigator.clipboard.writeText(formatted);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  }

  return (
    <FormCard
      title="Image Extraction"
      subtitle="Upload a photo of a driver's license or state ID. OCR runs in the browser with Tesseract (no API key) and tries to pull the mailing address."
    >
      <div className="space-y-6">
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPT}
          className="hidden"
          onChange={event => onPick(event.target.files?.[0] ?? null)}
        />

        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="flex w-full flex-col items-center justify-center rounded-lg border border-dashed border-gray-700 bg-gray-800/40 px-4 py-10 text-center transition-colors hover:border-amber-700 hover:bg-gray-800/70"
        >
          {previewUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={previewUrl}
              alt="ID preview"
              className="mb-4 max-h-64 rounded-md border border-gray-700 object-contain"
            />
          ) : (
            <span className="mb-3 text-3xl text-amber-400">▣</span>
          )}
          <p className="text-sm font-medium text-gray-200">
            {file ? file.name : "Click to upload an ID photo"}
          </p>
          <p className="mt-1 text-xs text-gray-500">JPG, PNG, or WebP. Avoid PDFs — Tesseract needs an image.</p>
        </button>

        <div className="flex items-center gap-3">
          <button
            type="button"
            disabled={!file || busy}
            onClick={onExtract}
            className="rounded-lg bg-amber-600 px-6 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-amber-500 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy ? "Extracting…" : "Extract address"}
          </button>
          {file && !busy && (
            <button
              type="button"
              onClick={() => {
                onPick(null);
                if (inputRef.current) inputRef.current.value = "";
              }}
              className="text-sm text-gray-400 hover:text-gray-200"
            >
              Clear
            </button>
          )}
        </div>

        {busy && (
          <div className="rounded-lg border border-amber-900/50 bg-amber-950/30 px-4 py-3 text-sm text-amber-200">
            <p className="font-medium">
              {progress?.status === "recognizing text"
                ? `Reading image… ${progress.percent}%`
                : progress?.status
                  ? `Loading OCR… ${progress.status}`
                  : "Starting Tesseract…"}
            </p>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-gray-800">
              <div
                className="h-full bg-amber-500 transition-all"
                style={{ width: `${Math.max(progress?.percent ?? 8, 8)}%` }}
              />
            </div>
          </div>
        )}

        {error && (
          <div className="rounded-lg border border-amber-900/50 bg-amber-950/30 px-4 py-3 text-sm text-amber-200">
            {error}
          </div>
        )}

        {address && (
          <div className="space-y-4 rounded-lg border border-emerald-900/50 bg-emerald-950/20 p-4">
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm font-semibold text-emerald-200">Extracted address</p>
              <button
                type="button"
                onClick={copyFormatted}
                className="rounded-md border border-emerald-800 px-3 py-1 text-xs text-emerald-200 hover:bg-emerald-900/40"
              >
                {copied ? "Copied" : "Copy"}
              </button>
            </div>
            <p className="text-base text-white">{formatted}</p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <EditField
                label="Street"
                value={address.street}
                onChange={street => setAddress({ ...address, street })}
              />
              <EditField
                label="City"
                value={address.city}
                onChange={city => setAddress({ ...address, city })}
              />
              <EditField
                label="State"
                value={address.state}
                onChange={state => setAddress({ ...address, state: state.toUpperCase() })}
              />
              <EditField
                label="ZIP"
                value={address.zip}
                onChange={zip => setAddress({ ...address, zip })}
              />
            </div>
          </div>
        )}

        {rawText && (
          <details className="rounded-lg border border-gray-800 bg-gray-950/50 p-4">
            <summary className="cursor-pointer text-sm text-gray-400">Raw OCR text</summary>
            <pre className="mt-3 whitespace-pre-wrap break-words font-mono text-xs text-gray-400">
              {rawText}
            </pre>
          </details>
        )}
      </div>
    </FormCard>
  );
}

function EditField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs text-gray-500">{label}</span>
      <input
        value={value}
        onChange={event => onChange(event.target.value)}
        className="rounded-md border border-gray-800 bg-gray-900 px-3 py-2 text-sm text-gray-100 outline-none focus:border-amber-600"
      />
    </label>
  );
}
