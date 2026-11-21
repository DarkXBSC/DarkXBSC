import { useEffect, useState } from "react";
import { useApp } from "../lib/context";
import { api, errors } from "../lib/hire";
export function useRead<T>(path: string) {
  const [value, set] = useState<T | null>(null),
    [error, fail] = useState<unknown>(null),
    [revision, refresh] = useState(0);
  useEffect(() => {
    let live = true;
    set(null);
    fail(null);
    api<T>(path)
      .then((v) => {
        if (live) set(v);
      })
      .catch((e) => {
        if (live) fail(e);
      });
    return () => {
      live = false;
    };
  }, [path, revision]);
  return { value, error, retry: () => refresh((n) => n + 1) };
}
export function Wait({
  state,
}: {
  state: { error: unknown; retry: () => void };
}) {
  const { t } = useApp();
  return (
    <div className="hire-wait" role="status">
      {state.error ? (
        <>
          {errors(state.error, t)}{" "}
          <button className="hire-text" onClick={state.retry}>
            {t("Retry", "重试")}
          </button>
        </>
      ) : (
        t("Loading…", "正在加载…")
      )}
    </div>
  );
}
