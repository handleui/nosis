export interface ShimmerProps {
  text?: string;
  className?: string;
}

export function Shimmer({ text = "Processing", className = "" }: ShimmerProps) {
  return (
    <p
      className={`animate-shimmer bg-[length:200%_100%] bg-gradient-to-r from-slate-200 via-slate-500 to-slate-200 bg-clip-text font-sans text-transparent text-xs leading-normal ${className}`}
    >
      {text}
    </p>
  );
}
