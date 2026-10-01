// SPDX-License-Identifier: AGPL-3.0-only

'use client';

import { useId, useRef, useState, type KeyboardEvent } from 'react';
import {
  ConsoleFrame,
  PhoneFrame,
  ScreenFind,
  ScreenPay,
  ScreenProof,
  ScreenQueue,
  ScreenWeigh,
} from '@/components/public/FieldScreens';

export type ShowcaseStep = {
  readonly actor: string;
  readonly title: string;
  readonly copy: string;
};

type StepShowcaseProps = {
  readonly steps: readonly ShowcaseStep[];
  readonly label: string;
  readonly sampleNote: string;
};

function Panel({ index }: { readonly index: number }) {
  switch (index) {
    case 0:
      return (
        <PhoneFrame>
          <ScreenFind />
        </PhoneFrame>
      );
    case 1:
      return (
        <PhoneFrame>
          <ScreenWeigh />
        </PhoneFrame>
      );
    case 2:
      return (
        <PhoneFrame>
          <ScreenProof />
        </PhoneFrame>
      );
    case 3:
      return (
        <PhoneFrame>
          <ScreenQueue />
        </PhoneFrame>
      );
    default:
      return (
        <ConsoleFrame>
          <ScreenPay />
        </ConsoleFrame>
      );
  }
}

/**
 * A tab list on the left, the matching illustrative screen on the right. Arrow keys move
 * between steps. The screen is decorative; each step's own text carries the meaning.
 */
export function StepShowcase({ steps, label, sampleNote }: StepShowcaseProps) {
  const [active, setActive] = useState(0);
  const baseId = useId();
  const refs = useRef<(HTMLButtonElement | null)[]>([]);

  function move(next: number) {
    const clamped = (next + steps.length) % steps.length;
    setActive(clamped);
    refs.current[clamped]?.focus();
  }

  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    if (event.key === 'ArrowDown' || event.key === 'ArrowRight') {
      event.preventDefault();
      move(index + 1);
    } else if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') {
      event.preventDefault();
      move(index - 1);
    }
  }

  return (
    <div className="grid items-center gap-10 lg:grid-cols-[1fr_auto] lg:gap-16">
      <div role="tablist" aria-label={label} aria-orientation="vertical" className="space-y-3">
        {steps.map((step, index) => {
          const selected = index === active;
          return (
            <div key={step.title} role="presentation">
            <button
              ref={(node) => {
                refs.current[index] = node;
              }}
              id={`${baseId}-tab-${index}`}
              role="tab"
              type="button"
              aria-selected={selected}
              aria-controls={`${baseId}-panel`}
              tabIndex={selected ? 0 : -1}
              onClick={() => setActive(index)}
              onKeyDown={(event) => onKeyDown(event, index)}
              className={`flex w-full gap-4 rounded-xl border p-5 text-left transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring ${
                selected
                  ? 'border-primary bg-card shadow-[0_6px_24px_rgb(20_20_20/0.08)]'
                  : 'border-border bg-transparent hover:bg-card'
              }`}
            >
              <span
                className={`grid size-9 shrink-0 place-items-center rounded-full font-mono text-sm font-bold ${
                  selected ? 'bg-primary text-primary-foreground' : 'bg-secondary text-primary'
                }`}
              >
                {index + 1}
              </span>
              <span>
                <span className="block font-display text-xs font-bold uppercase tracking-[0.08em] text-primary">
                  {step.actor}
                </span>
                <span className="mt-1 block font-display text-xl font-bold tracking-[-0.02em]">
                  {step.title}
                </span>
                {selected ? (
                  <span className="mt-2 block leading-7 text-muted-foreground">{step.copy}</span>
                ) : null}
              </span>
            </button>
            {selected ? (
              <div className="mt-5 lg:hidden">
                <Panel index={index} />
              </div>
            ) : null}
            </div>
          );
        })}
      </div>
      <div
        id={`${baseId}-panel`}
        role="tabpanel"
        aria-labelledby={`${baseId}-tab-${active}`}
        className="hidden w-full lg:block lg:w-[420px]"
      >
        <Panel index={active} />
        <p className="mt-5 text-center text-xs text-muted-foreground">{sampleNote}</p>
      </div>
      <p className="text-center text-xs text-muted-foreground lg:hidden">{sampleNote}</p>
    </div>
  );
}
