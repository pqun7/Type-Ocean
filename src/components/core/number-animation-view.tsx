"use client";

import { useEffect, useReducer } from "react";

import { NumberAnimation as BaseNumberAnimation } from "./number-animation";

type NumberAnimationViewProps = {
  value: number;
  unit?: string;
  color?: string;
  delay?: number;
  decimals?: number;
};

export function NumberAnimation(props: NumberAnimationViewProps) {
  const [, forceRender] = useReducer((x: number) => x + 1, 0);

  useEffect(() => {
    const delayMs = (0.3 + (props.delay ?? 0)) * 1000;
    const durationMs = 1200;

    let intervalId: number | null = null;
    let startTimeoutId: number | null = null;
    let stopTimeoutId: number | null = null;

    startTimeoutId = window.setTimeout(() => {
      intervalId = window.setInterval(() => {
        forceRender();
      }, 1000 / 30);

      stopTimeoutId = window.setTimeout(() => {
        if (intervalId !== null) window.clearInterval(intervalId);
        intervalId = null;
        forceRender();
      }, durationMs + 50);
    }, Math.max(0, Math.floor(delayMs)));

    return () => {
      if (startTimeoutId !== null) window.clearTimeout(startTimeoutId);
      if (stopTimeoutId !== null) window.clearTimeout(stopTimeoutId);
      if (intervalId !== null) window.clearInterval(intervalId);
    };
  }, [props.value, props.delay, props.unit, props.color, props.decimals]);

  return <BaseNumberAnimation {...props} />;
}
