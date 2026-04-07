"use client";

export function HeroLeadParagraph() {
  return (
    <p className="text-lg leading-relaxed text-muted-foreground sm:text-xl">
      Fecal Classification guides clinicians from slide upload to staged
      predictions:{" "}
      <span className="group/pretext-phrase inline">
        <span className="pretext-underline-inner text-foreground/90 group-hover/pretext-phrase:bg-[length:100%_2px]">
          fecal screening, binary classification, and multi-class findings with
          on-image overlays
        </span>
      </span>
      —always with human judgment in the loop.
    </p>
  );
}
