"use client";

import { useSyncExternalStore } from "react";
import { greetingFor } from "@/lib/dashboard/rules";

const noSubscribe = () => () => {};

/** "Good morning, Ada" by the reader's own clock (the server's is UTC). */
export function Greeting({ name }: { name: string }) {
  const hello = useSyncExternalStore(
    noSubscribe,
    () => greetingFor(new Date().getHours()),
    () => "Welcome back",
  );
  return (
    <>
      {hello}, {name}
    </>
  );
}
