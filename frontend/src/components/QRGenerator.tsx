import { QRCodeSVG } from "qrcode.react";
import { useRef } from "react";

export function QRGenerator({ value }: { value: string }) {
  const qrCodeRef = useRef<HTMLDivElement>(null);

  const handleDownload = () => {
    const wrapper = qrCodeRef.current;
    if (!wrapper) {
      return;
    }

    const svg = wrapper.querySelector("svg");
    if (!svg) {
      return;
    }

    const svgData = new XMLSerializer().serializeToString(svg);
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");
    const image = new Image();

    image.onload = () => {
      canvas.width = image.width;
      canvas.height = image.height;
      context?.drawImage(image, 0, 0);
      const png = canvas.toDataURL("image/png");
      const link = document.createElement("a");
      link.href = png;
      link.download = "qr-code.png";
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    };

    image.src = `data:image/svg+xml;base64,${btoa(svgData)}`;
  };

  return (
    <div className="inline-flex flex-col items-center gap-2 rounded-lg bg-white p-3 text-slate-900">
      <div ref={qrCodeRef}>
        <QRCodeSVG value={value} size={164} />
      </div>
      <p className="max-w-44 break-all text-center text-xs">QR Code for requests</p>
      <button
        type="button"
        onClick={handleDownload}
        className="rounded-md bg-slate-700 px-3 py-1.5 text-sm font-semibold text-slate-100 disabled:opacity-60"
      >
        Download QR (Image Only)
      </button>
    </div>
  );
}
