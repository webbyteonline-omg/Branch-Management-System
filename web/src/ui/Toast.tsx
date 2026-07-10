import { useEffect, useState } from "react";

let emit: (msg: string) => void = () => {};
export const toast = (msg: string) => emit(msg);

export function ToastHost() {
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => {
    emit = (m) => {
      setMsg(m);
      window.clearTimeout((emit as any)._t);
      (emit as any)._t = window.setTimeout(() => setMsg(null), 2200);
    };
  }, []);
  if (!msg) return null;
  return <div className="toast">{msg}</div>;
}
