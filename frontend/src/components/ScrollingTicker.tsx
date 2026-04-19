import { useLayoutEffect, useRef, useState } from "react";

const SCROLL_SPEED_PX_PER_SEC = 100;

export function ScrollingTicker({
  items,
  accentColor,
  emptyMessage = "SCAN THE QR CODE TO REQUEST A SONG & PICK TONIGHT'S GENRE",
}: {
  items: string[];
  accentColor: string;
  emptyMessage?: string;
}) {
  const text = items.length ? items.join("      •      ") : emptyMessage;
  const textRef = useRef<HTMLDivElement>(null);
  const [duration, setDuration] = useState(28);

  useLayoutEffect(() => {
    if (!textRef.current) return;
    const totalWidth = textRef.current.scrollWidth;
    if (totalWidth > 0) {
      setDuration(Math.max(10, totalWidth / SCROLL_SPEED_PX_PER_SEC));
    }
  }, [text]);

  return (
    <div className="pointer-events-none fixed bottom-0 left-0 w-full overflow-hidden bg-black/80 py-3">
      <div
        ref={textRef}
        className="whitespace-nowrap text-2xl font-bold tracking-wide text-white"
        style={{
          color: accentColor,
          textShadow: "0 0 8px rgba(0,0,0,0.9)",
          animation: `ticker ${duration}s linear infinite`,
          display: "inline-block",
          paddingLeft: "100%",
        }}
      >
        {text}
      </div>
      <style>{`@keyframes ticker { 0% { transform: translateX(0%); } 100% { transform: translateX(-100%); } }`}</style>
    </div>
  );
}
