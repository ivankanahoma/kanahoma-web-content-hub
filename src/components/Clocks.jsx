import { useEffect, useState } from "react";
import { formatClock } from "../lib/format";

/**
 * Pacific is the clock every deadline in the hub is measured against, so it leads.
 * Central is shown for reference because Matt works in it.
 */
export default function Clocks() {
  const [, tick] = useState(0);

  useEffect(() => {
    const id = setInterval(() => tick((n) => n + 1), 30_000);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="clocks">
      <div className="clock">
        <div className="zone">Pacific</div>
        <div className="time">{formatClock("America/Los_Angeles")}</div>
      </div>
      <div className="clock secondary">
        <div className="zone">Central</div>
        <div className="time">{formatClock("America/Chicago")}</div>
      </div>
    </div>
  );
}
