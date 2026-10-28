export declare const HOLD_MS: number;
export declare const DOUBLE_TAP_MS: number;
export declare function createHoldKey(options: {
  emit: (event: "start" | "end" | "cancel" | "type") => void;
  schedule?: (fn: () => void, ms: number) => unknown;
  cancelTimer?: (id: never) => void;
}): {
  setKey(code: number | null): void;
  keydown(code: number, now: number): void;
  keyup(code: number, now: number): void;
};
