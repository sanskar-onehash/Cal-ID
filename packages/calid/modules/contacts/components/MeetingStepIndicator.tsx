import { cn } from "@calid/features/lib/cn";

interface MeetingStepIndicatorProps {
  step: number;
  steps?: string[];
}

const DEFAULT_STEPS = ["Event Type", "Date & Time", "Guests", "Confirm"];

export const MeetingStepIndicator = ({ step, steps = DEFAULT_STEPS }: MeetingStepIndicatorProps) => {
  const clampedStep = Math.min(Math.max(step, 1), steps.length);
  return (
    <div className="flex items-center gap-2 py-2">
      {steps.map((_, index) => {
        const value = index + 1;
        return (
          <div key={value} className="flex items-center gap-2">
            <div
              className={cn(
                "flex h-7 w-7 items-center justify-center rounded-full text-xs font-medium transition-colors",
                value <= clampedStep ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
              )}>
              {value}
            </div>
            {value < steps.length ? (
              <div className={cn("h-px w-6", value < clampedStep ? "bg-primary" : "bg-border")} />
            ) : null}
          </div>
        );
      })}
      <span className="text-muted-foreground ml-2 text-xs">{steps[clampedStep - 1] ?? "Confirm"}</span>
    </div>
  );
};
