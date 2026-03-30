import type { RequestRecord } from "../types";

export function ScrollingTicker({
  requests,
  accentColor,
}: {
  requests: RequestRecord[];
  accentColor: string;
}) {
  const text = requests.length
    ? requests.map((req) => `${req.songTitle} - ${req.artistName}`).join("      •      ")
    : "No approved requests yet";

  return (
    <div className="pointer-events-none fixed bottom-0 left-0 w-full overflow-hidden bg-black/80 py-3">
      <div
        className="whitespace-nowrap text-2xl font-bold tracking-wide text-white"
        style={{
          color: accentColor,
          animation: "ticker 28s linear infinite",
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
