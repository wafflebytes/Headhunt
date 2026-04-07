'use client';

import React, { useState, useEffect, useRef } from 'react';

interface AnimatedNumberProps {
  value: number;
  prefix?: string;
  suffix?: string;
  delay?: number;
  padZero?: boolean;
  precision?: number;
}

export function AnimatedNumber({ 
  value, 
  prefix = "", 
  suffix = "", 
  delay = 0, 
  padZero = false,
  precision = 0
}: AnimatedNumberProps) {
  const [count, setCount] = useState(0);
  const countRef = useRef(0);

  useEffect(() => {
    let startTimestamp: number;
    const duration = 1400; // ms
    const initialCount = countRef.current;

    if (initialCount === value) return;

    let timeoutId: NodeJS.Timeout;
    let animationFrameId: number;

    const step = (timestamp: number) => {
      if (!startTimestamp) startTimestamp = timestamp;
      const progress = Math.min((timestamp - startTimestamp) / duration, 1);

      // Ease out expo: 1 - 2^(-10 * x)
      const easeOut = progress === 1 ? 1 : 1 - Math.pow(2, -10 * progress);
      const nextCount = initialCount + easeOut * (value - initialCount);

      setCount(nextCount);
      countRef.current = nextCount;

      if (progress < 1) {
        animationFrameId = window.requestAnimationFrame(step);
      } else {
        setCount(value);
        countRef.current = value;
      }
    };

    timeoutId = setTimeout(() => {
      animationFrameId = window.requestAnimationFrame(step);
    }, delay);

    return () => {
      clearTimeout(timeoutId);
      if (animationFrameId) window.cancelAnimationFrame(animationFrameId);
    };
  }, [value, delay]);

  const displayCount = count.toLocaleString('en-US', {
    minimumFractionDigits: precision,
    maximumFractionDigits: precision,
  });

  const finalDisplay = padZero && count < 10 && precision === 0 ? `0${displayCount}` : displayCount;

  return (
    <span
      className="inline-flex items-baseline animate-slide-up-fade"
      style={{ animationDelay: `${delay}ms` }}
    >
      {prefix && <span className="mr-[1px]">{prefix}</span>}
      <span 
        className="tabular-nums inline-block" 
        style={{ minWidth: value > 999 ? '3em' : value > 9 ? '1.2em' : '0.6em' }}
      >
        {finalDisplay}
      </span>
      {suffix && <span className="ml-[4px]">{suffix}</span>}
    </span>
  );
}
