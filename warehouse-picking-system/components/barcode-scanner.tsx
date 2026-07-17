"use client";

import { useEffect, useRef, useState } from "react";

type Detector = { detect: (source: ImageBitmapSource) => Promise<Array<{ rawValue: string }>> };

export function BarcodeScanner({ onScan }: { onScan: (value: string) => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const frameRef = useRef<number | null>(null);
  const [active, setActive] = useState(false);
  const [manual, setManual] = useState("");
  const [message, setMessage] = useState("Camera is off");

  const stop = () => {
    if (frameRef.current) cancelAnimationFrame(frameRef.current);
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    setActive(false);
    setMessage("Camera is off");
  };

  useEffect(() => stop, []);

  const start = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false });
      streamRef.current = stream;
      if (videoRef.current) { videoRef.current.srcObject = stream; await videoRef.current.play(); }
      setActive(true);
      setMessage("Point the camera at a product barcode");
      const BarcodeDetectorClass = (window as unknown as { BarcodeDetector?: new (options: { formats: string[] }) => Detector }).BarcodeDetector;
      if (!BarcodeDetectorClass) { setMessage("Live detection is unavailable in this browser. Enter the code below."); return; }
      const detector = new BarcodeDetectorClass({ formats: ["ean_13", "ean_8", "code_128", "code_39", "upc_a", "upc_e"] });
      const scanFrame = async () => {
        if (!videoRef.current || !streamRef.current) return;
        const results = await detector.detect(videoRef.current).catch(() => []);
        if (results[0]?.rawValue) { onScan(results[0].rawValue); stop(); return; }
        frameRef.current = requestAnimationFrame(scanFrame);
      };
      frameRef.current = requestAnimationFrame(scanFrame);
    } catch { setMessage("Camera permission was not granted. Enter the barcode manually."); }
  };

  return (
    <div>
      <div style={{ borderRadius: 12, overflow: "hidden", background: "#102e27", aspectRatio: "16/9", display: "grid", placeItems: "center", color: "#c9ddd6", fontSize: 12 }}>
        <video ref={videoRef} playsInline muted style={{ width: "100%", height: "100%", objectFit: "cover", display: active ? "block" : "none" }} />
        {!active && <span>{message}</span>}
      </div>
      <p>{message}</p>
      <div style={{ display: "flex", gap: 8 }}>
        <button className="primary-button" onClick={active ? stop : start}>{active ? "Stop camera" : "Start camera"}</button>
        <input aria-label="Manual barcode" value={manual} onChange={(event) => setManual(event.target.value)} placeholder="Enter barcode" style={{ minWidth: 0, flex: 1, border: "1px solid #dce5e1", borderRadius: 9, padding: "9px 11px" }} />
        <button className="ghost-button" onClick={() => manual && onScan(manual)}>Check</button>
      </div>
    </div>
  );
}

