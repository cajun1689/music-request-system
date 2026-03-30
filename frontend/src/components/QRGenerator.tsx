import { QRCodeSVG } from "qrcode.react";

export function QRGenerator({ value }: { value: string }) {
  return (
    <div className="inline-flex flex-col items-center gap-2 rounded-lg bg-white p-3 text-slate-900">
      <QRCodeSVG value={value} size={164} />
      <p className="max-w-44 break-all text-center text-xs">{value}</p>
    </div>
  );
}
